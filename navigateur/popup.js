const $ = (id) => document.getElementById(id);
const envoyer = (m) => chrome.runtime.sendMessage(m);
let comptes = [];
const autre = (n) => comptes.find((x) => x !== n) || n;
const date = (t) => (t ? new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "non");

async function afficher() {
  const e = await envoyer({ type: "etat" });
  $("nav").textContent = e.navigateur ? `· ${e.navigateur}` : "";
  $("actif").textContent = e.actif || "—";
  $("connecte").textContent = e.connecte || (e.session ? "inconnu" : "aucun");
  comptes = e.comptes || [];
  $("coffres").replaceChildren(...comptes.map((n) => {
    const l = document.createElement("div"); l.className = "ligne";
    const a = document.createElement("span"); a.textContent = `Session ${n} enregistrée`;
    const b = document.createElement("span"); b.textContent = date(e.coffre[n]);
    l.append(a, b); return l;
  }));
  $("declarer-boutons").replaceChildren(...comptes.map((n) => {
    const b = document.createElement("button"); b.textContent = n;
    b.onclick = async () => { await envoyer({ type: "declarer", compte: n }); afficher(); };
    return b;
  }));
  $("erreur").textContent = e.erreur || "";
  $("erreur").classList.toggle("cache", !e.erreur);
  $("declarer").classList.toggle("cache", !(e.session && !e.connecte));
  const manque = e.relie && !e.session;
  const autreManque = e.relie && e.connecte && e.connecte !== e.actif && !e.coffre[e.actif];
  let aide = "";
  if (manque) aide = `Connecte-toi sur claude.ai avec ${e.actif} : la session sera enregistrée.`;
  else if (autreManque) aide = `Session ${e.actif} pas encore enregistrée : clique sur « Ajouter l'autre compte » et connecte-toi avec ${e.actif}.`;
  if (e.googleBloque) aide += " Connexion Google automatique bloquée 10 min : utilise « Continuer avec l'e-mail ».";
  $("connexion").classList.toggle("cache", !aide);
  $("connexion-texte").textContent = aide;
  $("basculer").textContent = e.actif ? `Basculer tout sur ${autre(e.actif)}` : "Basculer tout";
  $("basculer").disabled = !e.relie;
  $("basculer").onclick = async () => { await envoyer({ type: "basculer", cible: autre(e.actif) }); setTimeout(afficher, 1500); };
}

$("ajouter").onclick = async () => {
  const r = await envoyer({ type: "ajouter" });
  if (!r.ok) { $("erreur").textContent = r.raison; $("erreur").classList.remove("cache"); }
  afficher();
};
$("reconnecter").onclick = async () => { await envoyer({ type: "reconnecter" }); setTimeout(afficher, 800); };
$("oublier").onclick = async () => {
  if (confirm("Oublier les sessions enregistrées des deux comptes ? Il faudra se reconnecter à chaque compte.")) {
    await envoyer({ type: "oublier" }); afficher();
  }
};
afficher();
