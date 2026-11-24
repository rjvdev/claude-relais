// Relais (Claude Relais) : la session claude.ai de ce navigateur suit le compte actif de claude-relais.
//
// Principe : chaque compte se connecte une fois dans ce navigateur. Ses cookies claude.ai sont gardés dans un
// coffre chiffré (AES-GCM) du stockage de l'extension ; la clé vient du trousseau du poste via l'hôte natif.
// À chaque bascule, les cookies du compte quitté sont remis au coffre et ceux du compte actif posés, puis les
// onglets claude.ai rechargés. Aucune déconnexion côté serveur : les deux sessions restent valides.
// Les cookies ne sortent jamais du navigateur : l'hôte natif ne reçoit que le nom du compte connecté.

const HOTE = "com.claude_relais.nm";
const DOMAINE = "claude.ai";
let NOMS = [];                                   // comptes de config.json, envoyés par l'hôte natif

let port = null;
let etat = { relie: false, navigateur: null, actif: null, orgs: {}, cle: null, erreur: null };
let cleCrypto = null;
let occupe = false;
let attente = null;

// ---------- hôte natif ----------
function connecter() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOTE);
  } catch (e) {
    port = null;
    etat.erreur = "hôte natif introuvable (lancer installer.sh)";
    return badge();
  }
  port.onMessage.addListener(recu);
  port.onDisconnect.addListener(() => {
    etat.erreur = chrome.runtime.lastError?.message || "hôte natif déconnecté";
    etat.relie = false;
    port = null;
    badge();
  });
}

async function recu(m) {
  if (m.type === "etat") {
    Object.assign(etat, { relie: true, erreur: null, navigateur: m.navigateur, actif: m.actif, orgs: m.orgs || {}, cle: m.cle });
    NOMS = m.comptes || [];
    cleCrypto = null;
    if (!m.cle) etat.erreur = "clé du coffre indisponible (trousseau verrouillé ?) : rien n'est enregistré";
    await appliquer();
  } else if (m.type === "actif") {
    etat.actif = m.actif;
    await appliquer();
  }
}

function signalerCompte(nom) {
  try { port?.postMessage({ type: "compte", compte: nom }); } catch (e) { /* hôte parti */ }
}

// ---------- coffre chiffré ----------
function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function deb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

async function cle() {
  if (!etat.cle) return null;
  if (!cleCrypto) cleCrypto = await crypto.subtle.importKey("raw", deb64(etat.cle), "AES-GCM", false, ["encrypt", "decrypt"]);
  return cleCrypto;
}

async function coffre() {
  return (await chrome.storage.local.get("coffre")).coffre || {};
}

async function enregistrer(nom, cookies) {
  const k = await cle();
  if (!k || !NOMS.includes(nom)) return false;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(cookies)));
  const c = await coffre();
  c[nom] = { iv: b64(iv), data: b64(data), maj: Date.now() };
  await chrome.storage.local.set({ coffre: c });
  return true;
}

async function ouvrir(nom) {
  const k = await cle();
  const e = (await coffre())[nom];
  if (!k || !e) return null;
  try {
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(e.iv) }, k, deb64(e.data));
    return JSON.parse(new TextDecoder().decode(clair));
  } catch (err) {
    return null;                                   // clé changée : entrée inutilisable, sera remplacée
  }
}

// ---------- cookies claude.ai ----------
const urlDe = (c) => "https://" + c.domain.replace(/^\./, "") + c.path;
const cookiesActuels = () => chrome.cookies.getAll({ domain: DOMAINE });
const session = (cookies) => cookies.find((c) => c.name === "sessionKey")?.value || null;

async function identite(cookies) {
  const sk = session(cookies);
  if (!sk) return null;
  const org = cookies.find((c) => c.name === "lastActiveOrg")?.value;
  if (org && etat.orgs[org]) return etat.orgs[org];
  for (const nom of NOMS) {                        // session déjà connue du coffre
    const j = await ouvrir(nom);
    if (j && session(j) === sk) return nom;
  }
  return null;                                     // inconnue : à déclarer dans la fenêtre de l'extension
}

async function effacer(cookies) {
  for (const c of cookies) {
    const d = { url: urlDe(c), name: c.name };
    if (c.partitionKey) d.partitionKey = c.partitionKey;
    try { await chrome.cookies.remove(d); } catch (e) { /* déjà absent */ }
  }
}

async function poser(cookies) {
  const maintenant = Date.now() / 1000;
  for (const c of cookies) {
    if (!c.session && c.expirationDate && c.expirationDate < maintenant) continue;
    const d = { url: urlDe(c), name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite };
    if (!c.hostOnly) d.domain = c.domain;
    if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
    if (c.partitionKey) d.partitionKey = c.partitionKey;
    try { await chrome.cookies.set(d); } catch (e) { console.warn("cookie non posé", c.name, e); }
  }
}

async function recharger() {
  for (const t of await chrome.tabs.query({ url: "https://claude.ai/*" })) chrome.tabs.reload(t.id);
}

// ---------- connexion Google automatique ----------
// Pendant l'ajout d'un compte, le bouton « Se connecter avec Google » intégré à claude.ai (accounts.google.com/gsi)
// reconnecte tout seul le compte Google du navigateur. On bloque ce script sur claude.ai, 10 min au plus,
// le temps de se connecter avec l'autre compte (« Continuer avec l'e-mail »). Le bouton Google normal reste utilisable.
const REGLE_GOOGLE = 1;
async function bloquerGoogle(oui) {
  const r = { removeRuleIds: [REGLE_GOOGLE] };
  if (oui) r.addRules = [{ id: REGLE_GOOGLE, priority: 1, action: { type: "block" },
    condition: { urlFilter: "||accounts.google.com/gsi/", initiatorDomains: [DOMAINE],
                 resourceTypes: ["script", "sub_frame", "xmlhttprequest", "image", "other"] } }];
  await chrome.declarativeNetRequest.updateSessionRules(r);
  if (oui) chrome.alarms.create("google", { delayInMinutes: 10 });
  else chrome.alarms.clear("google");
  etat.googleBloque = oui;
}

// ---------- bascule ----------
// Met la session claude.ai de ce navigateur sur le compte actif.
async function appliquer() {
  if (occupe || !etat.relie || !etat.actif) return badge();
  occupe = true;
  try {
    const cookies = await cookiesActuels();
    const qui = await identite(cookies);
    if (qui) await enregistrer(qui, cookies);      // garde la version la plus récente de la session quittée
    if (qui === etat.actif) return;
    if (!qui && session(cookies)) return;          // session inconnue : on n'efface rien (elle serait perdue)
    if (!(await cle())) return;
    const cible = await ouvrir(etat.actif);
    await effacer(cookies);
    if (cible) await poser(cible);
    await recharger();                             // sans session enregistrée : page de connexion, capturée ensuite
  } finally {
    occupe = false;
    await badge();
  }
}

// Après une connexion ou un renouvellement de cookie : enregistre la session, puis revient au compte actif si besoin.
async function capturer() {
  if (occupe || !etat.relie) return;
  const cookies = await cookiesActuels();
  const qui = await identite(cookies);
  if (qui) {
    if (etat.googleBloque) await bloquerGoogle(false);   // nouveau compte connecté : fin du blocage
    await enregistrer(qui, cookies);
    if (qui !== etat.actif && (await coffre())[etat.actif]) return appliquer();
  }
  await badge();
}

chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (!cookie.domain.replace(/^\./, "").endsWith(DOMAINE) || occupe) return;
  clearTimeout(attente);
  attente = setTimeout(capturer, 2000);
});

// ---------- affichage ----------
async function badge() {
  let texte = "", couleur = "#5f6368", titre = "Relais";
  if (!etat.relie) {
    texte = "×"; couleur = "#b00020"; titre += " : " + (etat.erreur || "non relié");
  } else {
    const qui = await identite(await cookiesActuels());
    signalerCompte(qui);
    if (!qui && session(await cookiesActuels())) { texte = "?"; couleur = "#e37400"; titre += " : compte connecté inconnu, à déclarer"; }
    else if (!qui) { texte = "!"; couleur = "#e37400"; titre += ` : se connecter avec ${etat.actif}`; }
    else if (qui !== etat.actif) { texte = "≠"; couleur = "#b00020"; titre += ` : connecté ${qui}, actif ${etat.actif}`; }
    else { texte = qui[0]; couleur = NOMS.indexOf(qui) === 0 ? "#1a73e8" : "#188038"; titre += ` : ${qui}`; }
  }
  await chrome.action.setBadgeText({ text: texte });
  await chrome.action.setBadgeBackgroundColor({ color: couleur });
  await chrome.action.setTitle({ title: titre });
}

// ---------- fenêtre de l'extension ----------
chrome.runtime.onMessage.addListener((m, _exp, repondre) => {
  (async () => {
    if (m.type === "etat") {
      const cookies = await cookiesActuels();
      const c = await coffre();
      repondre({ ...etat, cle: undefined, comptes: NOMS, googleBloque: !!etat.googleBloque, connecte: await identite(cookies), session: !!session(cookies),
                 coffre: Object.fromEntries(NOMS.map((n) => [n, c[n]?.maj || null])) });
    } else if (m.type === "declarer" && NOMS.includes(m.compte)) {
      const ok = await enregistrer(m.compte, await cookiesActuels());
      await appliquer();
      repondre({ ok });
    } else if (m.type === "ajouter") {
      // garde la session actuelle, puis ouvre la page de connexion pour l'autre compte (sans déconnexion serveur)
      const cookies = await cookiesActuels();
      const qui = await identite(cookies);
      if (!qui) return repondre({ ok: false, raison: "déclarer d'abord le compte connecté" });
      occupe = true;
      try {
        await enregistrer(qui, cookies);
        await bloquerGoogle(true);
        await effacer(cookies);
      } finally { occupe = false; }
      await chrome.tabs.create({ url: "https://claude.ai/login" });
      repondre({ ok: true });
    } else if (m.type === "basculer" && NOMS.includes(m.cible)) {
      try { port?.postMessage({ type: "basculer", cible: m.cible }); repondre({ ok: !!port }); }
      catch (e) { repondre({ ok: false }); }
    } else if (m.type === "oublier") {
      await chrome.storage.local.remove("coffre");
      repondre({ ok: true });
      await badge();
    } else if (m.type === "reconnecter") {
      connecter();
      repondre({ ok: true });
    }
  })();
  return true;
});

// ---------- démarrage ----------
chrome.runtime.onStartup.addListener(connecter);
chrome.runtime.onInstalled.addListener(connecter);
chrome.alarms.create("relais", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "google") bloquerGoogle(false); else connecter(); });
connecter();
