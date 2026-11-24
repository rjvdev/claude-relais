// Relais (Claude Relais) pour VS Code : compte Claude actif dans la barre d'état, bascule en un clic, et réouverture
// des conversations du panneau Claude restées sur l'autre compte. Toute la logique de bascule reste dans
// claude-relais-ctl ; cette extension affiche, envoie les ordres et rouvre les onglets.
//
// Réouverture : l'extension Claude Code lit CLAUDE_CONFIG_DIR (posé par claude-relais) au lancement de chaque
// processus Claude. Fermer l'onglet d'une conversation puis la rouvrir par son identifiant
// (claude-vscode.editor.open) relance donc la même conversation sur le compte actif. On attend la fin de la
// réponse en cours (et de la passation demandée par le hook Stop) avant de le faire.

const vscode = require("vscode");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CTL = path.join(os.homedir(), ".local/bin/claude-relais-ctl");
const A_SURVEILLER = [
  path.join(os.homedir(), ".config/claude-relais"),        // etat.json : compte actif
  path.join(os.homedir(), ".cache/claude-relais/sessions"), // fin de réponse d'une session (hooks)
  path.join(os.homedir(), ".cache/claude-usage"),           // usage
];

let barre, journal;
let etat = null;
let enCours = false, encore = false;
const ignores = new Set();   // `${session}:${compte actif}` annulés par l'utilisateur
const signales = new Set();  // conversations introuvables déjà signalées
const attente = new Map();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const autre = (n) => (etat?.comptes || []).map((c) => c.nom).find((x) => x !== n) || n;

function ctl(args, timeout = 30000) {
  return new Promise((ok, ko) => {
    execFile(CTL, args, { timeout }, (err, stdout, stderr) => {
      if (err) return ko(new Error((stderr || err.message).trim()));
      ok(stdout);
    });
  });
}
const ctlJson = async (args, t) => JSON.parse(await ctl(args, t));

// ---------- barre d'état ----------
function u(c) { return `${c.five ?? "--"}/${c.week ?? "--"}${Math.max(c.five ?? 0, c.week ?? 0) >= 90 ? " ⚠" : ""}`; }

async function rafraichir() {
  try {
    etat = await ctlJson(["status", "--json"]);
  } catch (e) {
    barre.text = "✳ Relais ?";
    barre.tooltip = `claude-relais-ctl ne répond pas : ${e.message}`;
    return;
  }
  const actif = etat.comptes.find((c) => c.nom === etat.actif) || { nom: etat.actif };
  const lautre = etat.comptes.find((c) => c.nom !== etat.actif);
  barre.text = `✳ Relais · ${actif.nom} ${u(actif)}`;
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**Relais** : compte actif **${etat.actif}**, bascule auto à ${etat.seuil} % : ${etat.auto ? "oui" : "non"}\n\n`);
  md.appendMarkdown(`| Compte | 5 h / semaine |\n|---|---|\n`);
  for (const c of etat.comptes) md.appendMarkdown(`| ${c.nom} (${c.compte}) | ${u(c)} |\n`);
  md.appendMarkdown(`\n| Appli | Compte |\n|---|---|\n| Panneau VS Code | ${etat.vscode} |\n`);
  for (const n of etat.navigateurs) md.appendMarkdown(`| ${n.nom} | ${n.compte || "—"} ${n.detecte ? "(détecté)" : n.ouvert ? "(déclaré)" : "(fermé)"} |\n`);
  md.appendMarkdown(`\nClic : menu (basculer sur ${lautre ? lautre.nom : autre(etat.actif)}…)`);
  barre.tooltip = md;
  barre.backgroundColor = Math.max(actif.five ?? 0, actif.week ?? 0) >= 90 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
}

// ---------- réouverture des conversations ----------
function ongletsClaude() {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview && /claudeVSCodePanel$/.test(t.input.viewType));
}

const net = (s) => s.replace(/[…]+$/, "").trim();
const memeTitre = (label, titre) => label === titre || (net(label).length >= 8 && titre.startsWith(net(label)));

function trouverOnglet(titre) {
  if (!titre) return null;
  const t = ongletsClaude().filter((o) => memeTitre(o.label, titre));
  return t.length === 1 ? t[0] : null;
}

// Conversation vide (aucun message) : pas de titre. Son onglet est le seul onglet Claude qui ne porte le titre
// d'aucune conversation de la fenêtre, à condition qu'elle soit la seule conversation sans titre.
function trouverOngletVide(plan) {
  if (plan.sans_titre !== 1) return null;
  const libres = ongletsClaude().filter((o) => !plan.titres.some((t) => memeTitre(o.label, t)));
  return libres.length === 1 ? libres[0] : null;
}

function compteARebours(titre, cible) {
  const s = vscode.workspace.getConfiguration("claudeRelais").get("delai", 8);
  if (s <= 0) return Promise.resolve(true);
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Relais", cancellable: true },
    async (progress, jeton) => {
      for (let i = s; i > 0; i--) {
        if (jeton.isCancellationRequested) return false;
        progress.report({ message: `« ${titre} » rouverte sur ${cible} dans ${i} s (Annuler pour la garder)`, increment: 100 / s });
        await dormir(1000);
      }
      return !jeton.isCancellationRequested;
    });
}

async function rouvrir(s, cible, forcer, plan) {
  const cle = `${s.session_id}:${cible}`;
  const nom = s.vide ? "nouvelle conversation (vide)" : s.titre;
  const onglet = s.vide ? trouverOngletVide(plan) : trouverOnglet(s.titre);
  if (!onglet) {
    if (!signales.has(cle)) {
      signales.add(cle);
      vscode.window.showWarningMessage(s.vide
        ? `Relais : une conversation vide est encore sur ${s.compte}, onglet introuvable. Ferme-la et ouvre une nouvelle conversation : elle partira sur ${cible}.`
        : `Relais : conversation « ${s.titre || s.session_id} » encore sur ${s.compte}, onglet introuvable. Ferme-la puis rouvre-la depuis l'historique : elle repartira sur ${cible}.`);
    }
    return;
  }
  if (!forcer && !(await compteARebours(nom, cible))) {
    ignores.add(cle);
    return;
  }
  // l'utilisateur a peut-être relancé la conversation pendant le compte à rebours
  const neuf = await ctlJson(["vscode-plan", "--hote", String(process.pid)]);
  const toujours = neuf.sessions.find((x) => x.session_id === s.session_id);
  if (!toujours || neuf.actif !== cible || (!forcer && !toujours.pret)) return;
  const colonne = onglet.group.viewColumn;
  await vscode.window.tabGroups.close(onglet, true);
  await dormir(1500);
  // conversation vide : rien à reprendre, on ouvre une nouvelle conversation à la même place
  await vscode.commands.executeCommand("claude-vscode.editor.open", s.vide ? undefined : s.session_id, undefined, colonne);
  journal.appendLine(`${new Date().toLocaleTimeString("fr-FR")} rouverte sur ${cible} : ${nom} (${s.session_id})`);
}

async function verifier(forcer = false) {
  if (enCours) { encore = true; return; }
  enCours = true;
  try {
    if (!forcer && !vscode.workspace.getConfiguration("claudeRelais").get("rouvrirAuto", true)) return;
    const plan = await ctlJson(["vscode-plan", "--hote", String(process.pid)]);
    for (const s of plan.sessions) {
      if (!forcer && (!s.pret || ignores.has(`${s.session_id}:${plan.actif}`))) continue;
      try { await rouvrir(s, plan.actif, forcer, plan); } catch (e) { journal.appendLine(`échec réouverture ${s.session_id} : ${e.message}`); }
    }
  } catch (e) {
    journal.appendLine(`plan indisponible : ${e.message}`);
  } finally {
    enCours = false;
    if (encore) { encore = false; setTimeout(() => verifier(), 500); }
  }
}

// ---------- surveillance ----------
function plusTard(nom, fn, ms) {
  clearTimeout(attente.get(nom));
  attente.set(nom, setTimeout(fn, ms));
}

function surveiller(contexte) {
  for (const d of A_SURVEILLER) {
    try {
      const w = fs.watch(d, () => {
        plusTard("barre", rafraichir, 800);
        plusTard("plan", () => verifier(), 2000);
      });
      contexte.subscriptions.push({ dispose: () => w.close() });
    } catch (e) { /* dossier absent : la minuterie prend le relais */ }
  }
  const t = setInterval(() => { rafraichir(); verifier(); }, 60000);
  contexte.subscriptions.push({ dispose: () => clearInterval(t) });
}

// ---------- commandes ----------
async function basculer(cible) {
  cible = cible || autre(etat?.actif);
  try {
    const sortie = await ctl(["basculer", cible], 60000);
    vscode.window.showInformationMessage(sortie.trim().split("\n").join(" · "));
  } catch (e) {
    vscode.window.showErrorMessage(`Bascule impossible : ${e.message}`);
  }
  rafraichir();
}

async function menu() {
  await rafraichir();
  if (!etat) return;
  const cible = autre(etat.actif);
  const choix = [
    { label: `$(arrow-swap) Basculer tout sur ${cible}`, faire: () => basculer(cible) },
    { label: `$(debug-restart) Rouvrir maintenant les conversations de cette fenêtre sur ${etat.actif}`, faire: () => rouvrirMaintenant() },
    { label: "$(pulse) Mesurer l'usage des deux comptes", faire: () => sonder() },
    { label: `$(sync) Bascule automatique à ${etat.seuil} % : ${etat.auto ? "activée (désactiver)" : "désactivée (activer)"}`,
      faire: async () => { await ctl(["auto", etat.auto ? "off" : "on"]); rafraichir(); } },
    { label: "$(output) État complet", faire: () => afficherEtat() },
  ];
  const c = await vscode.window.showQuickPick(choix, { placeHolder: `Relais : actif ${etat.actif}` });
  if (c) await c.faire();
}

async function rouvrirMaintenant() {
  const plan = await ctlJson(["vscode-plan", "--hote", String(process.pid)]);
  if (!plan.sessions.length) return vscode.window.showInformationMessage(`Toutes les conversations de cette fenêtre sont déjà sur ${plan.actif}.`);
  const occ = plan.sessions.filter((s) => s.occupe);
  if (occ.length) {
    const r = await vscode.window.showWarningMessage(
      `${occ.length} conversation(s) en train de répondre : les rouvrir maintenant interrompt leur réponse.`, { modal: true }, "Rouvrir quand même");
    if (r !== "Rouvrir quand même") return;
  }
  for (const s of plan.sessions) ignores.delete(`${s.session_id}:${plan.actif}`);
  await verifier(true);
}

async function sonder() {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Relais : mesure de l'usage" },
    async () => { try { await ctl(["sonder"], 120000); } catch (e) { vscode.window.showErrorMessage(e.message); } });
  rafraichir();
}

async function afficherEtat() {
  journal.appendLine(await ctl(["status"]).catch((e) => e.message));
  journal.show(true);
}

function activate(contexte) {
  journal = vscode.window.createOutputChannel("Relais");
  barre = vscode.window.createStatusBarItem("claudeRelais.compte", vscode.StatusBarAlignment.Right, 1000);
  barre.name = "Relais";
  barre.command = "claudeRelais.menu";
  barre.text = "✳ …";
  barre.show();
  contexte.subscriptions.push(barre, journal,
    vscode.commands.registerCommand("claudeRelais.menu", menu),
    vscode.commands.registerCommand("claudeRelais.basculer", () => basculer()),
    vscode.commands.registerCommand("claudeRelais.rouvrir", rouvrirMaintenant),
    vscode.commands.registerCommand("claudeRelais.sonder", sonder),
    vscode.commands.registerCommand("claudeRelais.etat", afficherEtat));
  surveiller(contexte);
  rafraichir();
  setTimeout(() => verifier(), 5000);
}

function deactivate() {}

module.exports = { activate, deactivate };
