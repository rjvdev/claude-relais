//! Applet COSMIC « Relais » : compte Claude actif, usage, sessions en cours, bascule avec passation.
//! Toute la logique est dans `claude-relais-ctl` ; l'applet ne fait qu'afficher son état et lui envoyer des ordres.

use std::process::Command;
use std::time::Duration;

use cosmic::app::{Core, Task};
use cosmic::iced::core::window;
use cosmic::iced::window::Id;
use cosmic::iced::{Alignment, Length, Limits, Rectangle, Subscription};
use cosmic::surface::action::{app_popup, destroy_popup};
use cosmic::widget::{self, divider, settings, text, toggler};
use cosmic::Element;
use serde::Deserialize;

const ID: &str = "io.claude_relais.CosmicApplet";
const LARGEUR: f32 = 440.0;

#[derive(Debug, Clone, Default, Deserialize)]
struct Compte {
    nom: String,
    compte: String,
    five: Option<u32>,
    week: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Session {
    lieu: String,
    cwd: String,
    compte: String,
    relais: bool,
    occupe: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Navigateur {
    nom: String,
    compte: Option<String>,
    #[serde(default)]
    ouvert: bool,
    #[serde(default)]
    detecte: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct DemandeMemoire {
    id: u32,
    sujet: String,
    texte: String,
    raison: Option<String>,
    auteur: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Memoire {
    actives: u32,
    demandes: Vec<DemandeMemoire>,
    #[serde(default)]
    non_lus: std::collections::HashMap<String, u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Etat {
    actif: String,
    auto: bool,
    seuil: u32,
    comptes: Vec<Compte>,
    vscode: String,
    sessions: Vec<Session>,
    navigateurs: Vec<Navigateur>,
    #[serde(default)]
    memoire: Option<Memoire>,
    #[serde(default)]
    handoff: Option<String>,
}

impl Etat {
    fn compte(&self, nom: &str) -> Option<&Compte> {
        self.comptes.iter().find(|c| c.nom == nom)
    }
    fn autre(&self) -> String {
        self.comptes.iter().map(|c| c.nom.clone()).find(|n| *n != self.actif).unwrap_or_else(|| self.actif.clone())
    }
}

fn pct(v: Option<u32>) -> String {
    v.map_or("--".into(), |x| x.to_string())
}

fn usage(c: Option<&Compte>, seuil: u32) -> String {
    match c {
        Some(c) => {
            let alerte = c.five.unwrap_or(0) >= seuil || c.week.unwrap_or(0) >= seuil;
            format!("{}/{}{}", pct(c.five), pct(c.week), if alerte { " ⚠" } else { "" })
        }
        None => "--/--".into(),
    }
}

fn ctl(args: &[&str]) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let out = Command::new(format!("{home}/.local/bin/claude-relais-ctl")).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn lire_etat() -> Option<Etat> {
    tokio::task::spawn_blocking(|| ctl(&["status", "--json"]).and_then(|s| serde_json::from_str(&s).ok()))
        .await
        .ok()
        .flatten()
}

async fn executer(args: Vec<String>) -> Option<Etat> {
    tokio::task::spawn_blocking(move || {
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        ctl(&a);
    })
    .await
    .ok()?;
    lire_etat().await
}

#[derive(Default)]
pub struct Applet {
    core: Core,
    popup: Option<Id>,
    etat: Option<Etat>,
    occupe: bool,
}

#[derive(Clone, Debug)]
pub enum Message {
    PopupClosed(Id),
    Surface(cosmic::surface::Action<Message>),
    Rafraichir,
    Etat(Option<Etat>),
    Basculer,
    Auto(bool),
    Navigateur(String),
    OuvrirHandoff,
    Sonder,
    Memoire(String, u32),
}

fn ligne<'a>(contenu: impl Into<Element<'a, Message>>) -> Element<'a, Message> {
    cosmic::applet::padded_control(contenu).into()
}

impl Applet {
    fn contenu(&self) -> Element<'_, Message> {
        let Some(e) = &self.etat else {
            return widget::container(text::body("claude-relais-ctl ne répond pas")).padding(16).into();
        };
        let actif = e.compte(&e.actif);
        let autre = e.autre();
        let ca = e.compte(&autre);
        let mut col = widget::Column::new().spacing(2).padding([8, 0]);

        // Comptes
        col = col.push(ligne(
            widget::Row::new()
                .push(text::title4(format!("Relais · Claude actif : {}", e.actif)).width(Length::Fill))
                .push(text::title4(usage(actif, e.seuil)))
                .align_y(Alignment::Center),
        ));
        col = col.push(ligne(
            widget::Row::new()
                .push(text::caption(format!("compte {}", actif.map_or("?", |c| c.compte.as_str()))).width(Length::Fill))
                .push(text::caption("% utilisés : 5 h / semaine")),
        ));
        col = col.push(ligne(
            widget::Row::new()
                .push(text::body(format!("Autre : {} ({})", autre, ca.map_or("?", |c| c.compte.as_str()))).width(Length::Fill))
                .push(text::body(usage(ca, e.seuil))),
        ));
        col = col.push(ligne(divider::horizontal::default()));

        // Sessions Claude Code
        col = col.push(ligne(text::heading("Où tourne Claude")));
        if e.sessions.is_empty() {
            col = col.push(ligne(text::caption("Aucune session Claude Code ouverte")));
        }
        for s in &e.sessions {
            let etat = match s.occupe {
                Some(true) => "en cours",
                Some(false) => "inactif",
                None => "",
            };
            let lieu = if s.relais { format!("{} · relais", s.lieu) } else { s.lieu.clone() };
            col = col.push(ligne(
                widget::Row::new()
                    .spacing(8)
                    .push(widget::Column::new().push(text::body(lieu)).push(text::caption(s.cwd.clone())).width(Length::Fill))
                    .push(text::body(s.compte.clone()))
                    .push(text::caption(etat).width(Length::Fixed(56.0)))
                    .align_y(Alignment::Center),
            ));
        }
        col = col.push(ligne(
            widget::Row::new()
                .push(text::body("VS Code : compte du panneau").width(Length::Fill))
                .push(text::body(e.vscode.clone())),
        ));

        // Navigateurs (compte déclaré)
        for n in &e.navigateurs {
            col = col.push(
                cosmic::applet::menu_button(
                    widget::Row::new()
                        .push(
                            widget::Column::new()
                                .push(text::body(n.nom.clone()))
                                .push(text::caption(if n.ouvert { "ouvert" } else { "fermé" }))
                                .width(Length::Fill),
                        )
                        .push(text::body(format!(
                            "{} ({})",
                            n.compte.clone().unwrap_or_else(|| "—".into()),
                            if n.detecte { "détecté" } else { "déclaré" }
                        ))),
                )
                .on_press(Message::Navigateur(n.nom.clone())),
            );
        }
        col = col.push(ligne(divider::horizontal::default()));

        // Mémoire commune
        if let Some(m) = &e.memoire {
            col = col.push(ligne(
                widget::Row::new()
                    .push(text::heading("Mémoire commune").width(Length::Fill))
                    .push(text::caption(format!("{} entrées · {} demande(s)", m.actives, m.demandes.len()))),
            ));
            col = col.push(ligne(text::caption(format!(
                "Messages non lus pour {} : {}",
                e.actif,
                m.non_lus.get(&e.actif).copied().unwrap_or(0)
            ))));
            for d in &m.demandes {
                col = col.push(ligne(
                    widget::Column::new()
                        .push(text::body(format!("#{} [{}] {}", d.id, d.sujet, d.texte)))
                        .push(text::caption(format!(
                            "suppression demandée par {} : {}",
                            d.auteur.clone().unwrap_or_default(),
                            d.raison.clone().unwrap_or_default()
                        ))),
                ));
                col = col.push(ligne(
                    widget::Row::new()
                        .spacing(8)
                        .push(widget::button::destructive("Supprimer").on_press(Message::Memoire("accepter".into(), d.id)))
                        .push(widget::button::standard("Garder").on_press(Message::Memoire("refuser".into(), d.id))),
                ));
            }
            col = col.push(ligne(divider::horizontal::default()));
        }

        // Actions
        let libelle = if self.occupe {
            "Bascule en cours…".to_string()
        } else {
            format!("⇄  Basculer sur {autre} (passation de chaque session)")
        };
        let mut bouton = cosmic::applet::menu_button(text::body(libelle));
        if !self.occupe {
            bouton = bouton.on_press(Message::Basculer);
        }
        col = col.push(bouton);
        col = col.push(ligne(settings::item(
            format!("Bascule automatique à {} %", e.seuil),
            toggler(e.auto).on_toggle(Message::Auto),
        )));
        col = col.push(
            cosmic::applet::menu_button(text::body(if self.occupe { "Mesure en cours…" } else { "Actualiser l'usage (petite requête par compte)" }))
                .on_press_maybe((!self.occupe).then_some(Message::Sonder)),
        );
        if e.handoff.is_some() {
            col = col.push(cosmic::applet::menu_button(text::body("Ouvrir HANDOFF.md")).on_press(Message::OuvrirHandoff));
        }
        col.into()
    }
}

impl cosmic::Application for Applet {
    type Executor = cosmic::SingleThreadExecutor;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = ID;

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(core: Core, _flags: ()) -> (Self, Task<Message>) {
        let applet = Applet { core, ..Default::default() };
        (applet, cosmic::task::future(async { Message::Etat(lire_etat().await) }))
    }

    fn on_close_requested(&self, id: window::Id) -> Option<Message> {
        Some(Message::PopupClosed(id))
    }

    fn subscription(&self) -> Subscription<Message> {
        let periode = if self.popup.is_some() { 3 } else { 15 };
        cosmic::iced::time::every(Duration::from_secs(periode)).map(|_| Message::Rafraichir)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        if !matches!(message, Message::Rafraichir | Message::Etat(_)) {
            log::warn!("message reçu : {message:?}");
        }
        match message {
            Message::PopupClosed(id) => {
                if self.popup == Some(id) {
                    self.popup = None;
                }
            }
            Message::Surface(a) => return cosmic::task::message(cosmic::Action::Surface(a)),
            Message::Rafraichir => return cosmic::task::future(async { Message::Etat(lire_etat().await) }),
            Message::Etat(e) => {
                self.occupe = false;
                if e.is_some() {
                    self.etat = e;
                }
            }
            Message::Basculer => {
                self.occupe = true;
                return cosmic::task::future(async { Message::Etat(executer(vec!["basculer".into()]).await) });
            }
            Message::Auto(v) => {
                if let Some(e) = &mut self.etat {
                    e.auto = v;
                }
                let arg = if v { "on" } else { "off" }.to_string();
                return cosmic::task::future(async move { Message::Etat(executer(vec!["auto".into(), arg]).await) });
            }
            Message::Navigateur(nom) => {
                // compte déclaré : chaque compte de la configuration tour à tour, puis « aucun »
                let Some(e) = self.etat.as_ref() else { return Task::none() };
                let mut choix: Vec<String> = e.comptes.iter().map(|c| c.nom.clone()).collect();
                choix.push("aucun".into());
                let actuel = e.navigateurs.iter().find(|n| n.nom == nom).and_then(|n| n.compte.clone()).unwrap_or("aucun".into());
                let i = choix.iter().position(|c| *c == actuel).unwrap_or(choix.len() - 1);
                let suivant = choix[(i + 1) % choix.len()].clone();
                return cosmic::task::future(async move {
                    Message::Etat(executer(vec!["navigateur".into(), nom, suivant]).await)
                });
            }
            Message::Sonder => {
                self.occupe = true;
                return cosmic::task::future(async { Message::Etat(executer(vec!["sonder".into()]).await) });
            }
            Message::Memoire(action, id) => {
                return cosmic::task::future(async move {
                    Message::Etat(executer(vec!["memoire".into(), action, id.to_string()]).await)
                });
            }
            Message::OuvrirHandoff => {
                if let Some(h) = self.etat.as_ref().and_then(|e| e.handoff.clone()) {
                    let _ = Command::new("xdg-open").arg(h).spawn();
                }
            }
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        let libelle = match &self.etat {
            Some(e) => {
                let n = e.memoire.as_ref().map_or(0, |m| m.demandes.len());
                let alerte = if n > 0 { format!(" · 🗑{n}") } else { String::new() };
                format!("✳ Relais · {} {}{}", e.actif, usage(e.compte(&e.actif), e.seuil), alerte)
            }
            None => "✳ Relais".into(),
        };
        let have_popup = self.popup;
        let btn = self
            .core
            .applet
            .text_button(self.core.applet.text(libelle).wrapping(cosmic::iced::widget::text::Wrapping::None), Message::Rafraichir)
            .on_press_with_rectangle(move |offset, bounds| {
                if let Some(id) = have_popup {
                    Message::Surface(destroy_popup(id))
                } else {
                    Message::Surface(app_popup::<Applet>(
                        |_| Default::default(),
                        move |state: &mut Applet| {
                            log::warn!("création du popup");
                            let new_id = Id::unique();
                            state.popup = Some(new_id);
                            let mut s = state.core.applet.get_popup_settings(
                                state.core.main_window_id().unwrap(),
                                new_id,
                                None,
                                None,
                                None,
                            );
                            s.positioner.anchor_rect = Rectangle {
                                x: (bounds.x - offset.x) as i32,
                                y: (bounds.y - offset.y) as i32,
                                width: bounds.width as i32,
                                height: bounds.height as i32,
                            };
                            s.positioner.size_limits =
                                Limits::NONE.min_height(1.0).min_width(LARGEUR).max_width(LARGEUR).max_height(1080.0);
                            s
                        },
                        Some(Box::new(|state: &Applet| {
                            Element::from(
                                state
                                    .core
                                    .applet
                                    .popup_container(state.contenu())
                                    .limits(Limits::NONE.min_height(1.0).min_width(LARGEUR).max_width(LARGEUR).max_height(1000.0)),
                            )
                            .map(cosmic::Action::App)
                        })),
                    ))
                }
            });

        let info = match &self.etat {
            Some(e) => format!("Relais Claude : compte actif {}", e.actif),
            None => "Relais Claude".to_string(),
        };
        let bulle = self.core.applet.applet_tooltip::<Message>(
            btn,
            info,
            self.popup.is_some(),
            Message::Surface,
            None,
        );
        self.core.applet.autosize_window(bulle).into()
    }

    fn view_window(&self, _id: Id) -> Element<'_, Message> {
        "".into()
    }

    fn style(&self) -> Option<cosmic::iced::theme::Style> {
        Some(cosmic::applet::style())
    }
}

fn main() -> cosmic::iced::Result {
    // Journal : CLAUDE_APPLET_LOG=debug (défaut warn), sortie d'erreur (redirigée par le panneau ou à la main)
    env_logger::Builder::from_env(env_logger::Env::default().filter_or("CLAUDE_APPLET_LOG", "warn")).init();
    log::warn!("démarrage de l'applet Claude");
    cosmic::applet::run::<Applet>(())
}
