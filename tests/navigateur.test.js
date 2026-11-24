// Tests de navigateur/background.js contre un faux navigateur (cookies, stockage, hôte natif simulés).
// Usage : node tests/navigateur.test.js            (Node 20+ : WebCrypto global)
const vm = require("vm"), fs = require("fs"), path = require("path");
let echecs = 0;
const jar = []; const store = {}; const ecoutes = { cookie: [], msg: [] }; const traces = { reload: 0, envoyes: [], badge: "", regles: null };
const nomDom = (u) => new URL(u).hostname;
function notifier(c, removed) { for (const f of ecoutes.cookie) f({ cookie: c, removed }); }
let port;
const chrome = {
  runtime: { lastError: undefined,
    connectNative: () => (port = { _m: [], _d: [], onMessage: { addListener: (f) => port._m.push(f) }, onDisconnect: { addListener: (f) => port._d.push(f) }, postMessage: (m) => traces.envoyes.push(m) }),
    onMessage: { addListener: (f) => ecoutes.msg.push(f) }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  declarativeNetRequest: { updateSessionRules: async (r) => { traces.regles = (r.addRules || []).map((x) => x.condition.urlFilter); } },
  storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async (k) => delete store[k] } },
  cookies: {
    getAll: async ({ domain }) => jar.filter((c) => c.domain.replace(/^\./, "").endsWith(domain)).map((c) => ({ ...c })),
    remove: async ({ url, name }) => { const i = jar.findIndex((c) => c.name === name && nomDom(url) === c.domain.replace(/^\./, "")); if (i >= 0) notifier(jar.splice(i, 1)[0], true); },
    set: async (d) => { const c = { name: d.name, value: d.value, domain: d.domain || nomDom(d.url), hostOnly: !d.domain, path: d.path, secure: d.secure, httpOnly: d.httpOnly, sameSite: d.sameSite, session: !d.expirationDate, expirationDate: d.expirationDate };
      const i = jar.findIndex((x) => x.name === c.name && x.domain === c.domain); if (i >= 0) jar.splice(i, 1); jar.push(c); notifier(c, false); },
    onChanged: { addListener: (f) => ecoutes.cookie.push(f) } },
  tabs: { query: async () => [{ id: 1 }], reload: () => traces.reload++, create: async () => {} },
  action: { setBadgeText: async ({ text }) => (traces.badge = text), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
};
const ctx = vm.createContext({ chrome, crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, Uint8Array, JSON, Date, Object });
vm.runInContext(fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "navigateur", "background.js"), "utf8"), ctx);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const exp = () => Date.now() / 1000 + 86400;
const loge = (org, v) => jar.push(
  { name: "sessionKey", value: v, domain: ".claude.ai", hostOnly: false, path: "/", secure: true, httpOnly: true, sameSite: "lax", session: false, expirationDate: exp() },
  { name: "lastActiveOrg", value: org, domain: ".claude.ai", hostOnly: false, path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: exp() },
  { name: "cf_clearance", value: "cf", domain: ".claude.ai", hostOnly: false, path: "/", secure: true, httpOnly: true, sameSite: "no_restriction", session: false, expirationDate: exp() });
const sk = () => jar.find((c) => c.name === "sessionKey")?.value || "(aucune)";
const hote = async (m) => { for (const f of port._m) await f(m); await pause(50); };
const changement = async () => { for (const f of ecoutes.cookie) f({ cookie: jar[0] || { domain: ".claude.ai" } }); await pause(2600); };
const message = (m) => new Promise((r) => ecoutes.msg[0](m, {}, r));
const ok = (cond, txt) => { if (!cond) echecs++; console.log((cond ? "OK   " : "ÉCHEC") + " " + txt); };
(async () => {
  loge("org-A", "SK-HOME");
  const cle = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  await hote({ type: "etat", navigateur: "Opera", actif: "Work", comptes: ["Work", "Home"], orgs: { "org-A": "Home", "org-N": "Work" }, cle });
  ok(sk() === "(aucune)" && traces.reload === 1, "1. actif Work sans session Work : cookies vidés, onglets rechargés");
  ok(store.coffre?.Home && !JSON.stringify(store).includes("SK-HOME"), "2. session Home au coffre, chiffrée");
  await pause(2600); loge("org-N", "SK-WORK"); await changement();
  ok(store.coffre?.Work && traces.badge === "W", `3. connexion Work capturée, badge ${traces.badge}`);
  await hote({ type: "actif", actif: "Home" }); await pause(100);
  ok(sk() === "SK-HOME", `4. bascule Home (${sk()})`);
  await hote({ type: "actif", actif: "Work" }); await pause(100);
  ok(sk() === "SK-WORK" && jar.filter((c) => c.name === "sessionKey").length === 1, `5. retour Work, une seule session (${sk()})`);
  jar.length = 0; loge("org-X", "SK-INCONNUE"); await hote({ type: "actif", actif: "Home" }); await pause(100);
  ok(sk() === "SK-INCONNUE" && traces.badge === "?", "6. session inconnue : rien d'effacé, badge ?");
  // cas Opera : coffre vide, Home connecté, actif Work → ajouter
  await message({ type: "oublier" }); jar.length = 0; loge("org-A", "SK-A2");
  await hote({ type: "actif", actif: "Home" }); await changement();
  await hote({ type: "actif", actif: "Work" }); await pause(100);   // pas de session Work : vidage
  await pause(2600); jar.length = 0; loge("org-A", "SK-A3"); await changement(); // Google reconnecte Home
  const e1 = await message({ type: "etat" });
  ok(e1.connecte === "Home" && !e1.coffre.Work && traces.badge === "≠", "7. Google reconnecte Home : badge ≠, Work manquant");
  const rep = await message({ type: "ajouter" });
  ok(rep.ok && sk() === "(aucune)" && traces.regles?.[0] === "||accounts.google.com/gsi/", "8. ajouter : session vidée, script Google bloqué sur claude.ai");
  const e2 = await message({ type: "etat" });
  ok(e2.googleBloque === true, "9. la fenêtre signale le blocage Google");
  await pause(2600); loge("org-N", "SK-N3"); await changement();
  ok(traces.regles?.length === 0 && sk() === "SK-N3" && traces.badge === "W", `10. connexion Work : blocage levé, badge ${traces.badge}`);
  await hote({ type: "actif", actif: "Home" }); await pause(100);
  ok(sk() === "SK-A3", `11. bascule Home (${sk()})`);
  console.log(echecs ? `${echecs} échec(s)` : "tous les tests passent");
  process.exit(echecs ? 1 : 0);
})();
