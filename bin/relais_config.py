#!/usr/bin/python3 -I
"""Configuration de Relais, partagée par claude-relais-ctl, memoire et les scripts bash.

Tout ce qui est propre à un poste vit dans ~/.config/claude-relais/config.json (hors dépôt) ; voir
config.example.json. Un compte est reconnu par son dossier de config Claude Code, ou par l'adresse e-mail
lue dans ce dossier (jamais par un domaine écrit dans le code).

Utilisable en ligne de commande (scripts bash) :
  relais_config.py nom [dossier]     « Nom libellé » du compte de ce dossier de config (vide = ~/.claude)
  relais_config.py noms              noms des comptes, un par ligne
  relais_config.py autre <Nom>       l'autre compte
  relais_config.py dossiers          dossiers de config des comptes (vide = ~/.claude), un par ligne
  relais_config.py profils           profils des navigateurs (dossiers de données), un par ligne
"""
import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()
FICHIER = Path(os.environ.get("CLAUDE_RELAIS_CONFIG", HOME / ".config/claude-relais/config.json"))
DEFAUT_CLAUDE = HOME / ".claude"

DEFAUT = {
    "comptes": [
        {"nom": "Perso", "signature": "PER", "libelle": "personnel", "config": "~/.claude", "desktop": "~/.config/Claude"},
        {"nom": "Pro", "signature": "PRO", "libelle": "professionnel", "config": "~/.claude-pro", "desktop": "~/.config/Claude-Pro"},
    ],
    "navigateurs": [{"nom": "Chrome", "profil": "~/.config/google-chrome"}],
    "interdits": {},
    "handoff": None,
    "memoire": {"consignes": "", "exemples_projet": "ex. mon-projet, poste", "exemples_sujet": "profil, preferences, poste…"},
}

# Navigateurs Chromium connus : nom de l'exécutable principal → profil par défaut (sans --user-data-dir)
PROFILS_PAR_DEFAUT = {
    "chrome": "~/.config/google-chrome",
    "opera": "~/.config/opera",
    "chromium": "~/.config/chromium",
    "chromium-browser": "~/.config/chromium",
    "brave": "~/.config/BraveSoftware/Brave-Browser",
    "msedge": "~/.config/microsoft-edge",
    "vivaldi-bin": "~/.config/vivaldi",
}

_cache = None


def chemin(d):
    return os.path.realpath(os.path.expanduser(str(d)))


def config():
    global _cache
    if _cache is None:
        c = dict(DEFAUT)
        try:
            c.update(json.loads(FICHIER.read_text()))
        except (OSError, ValueError):
            pass
        c["memoire"] = {**DEFAUT["memoire"], **(c.get("memoire") or {})}
        _cache = c
    return _cache


def comptes():
    return config()["comptes"]


def noms():
    return [c["nom"] for c in comptes()]


def compte(nom):
    return next((c for c in comptes() if c["nom"] == nom), None)


def autre(nom):
    autres = [n for n in noms() if n != nom]
    return autres[0] if autres else nom


def dossier(c):
    """Dossier de config au sens de CLAUDE_CONFIG_DIR : "" pour ~/.claude (variable absente)."""
    d = chemin(c.get("config") or "~/.claude")
    return "" if d == chemin(DEFAUT_CLAUDE) else d


def claude_json(dossier_cfg):
    """~/.claude.json quand CLAUDE_CONFIG_DIR est absent, sinon <dossier>/.claude.json."""
    j = Path(dossier_cfg) / ".claude.json" if dossier_cfg else HOME / ".claude.json"
    return j if j.exists() else HOME / ".claude.json"


def email_de_dossier(dossier_cfg):
    try:
        return (json.loads(claude_json(dossier_cfg).read_text()).get("oauthAccount") or {}).get("emailAddress") or ""
    except (OSError, ValueError):
        return ""


def org_de_dossier(dossier_cfg):
    try:
        return (json.loads(claude_json(dossier_cfg).read_text()).get("oauthAccount") or {}).get("organizationUuid") or ""
    except (OSError, ValueError):
        return ""


def compte_de_config(dossier_cfg):
    """(Nom, libellé) du compte dont c'est le dossier de config ; ("?", …) sinon ou s'il n'est pas connecté."""
    d = "" if not dossier_cfg or chemin(dossier_cfg) == chemin(DEFAUT_CLAUDE) else chemin(dossier_cfg)
    for c in comptes():
        if dossier(c) == d:
            return (c["nom"], c.get("libelle", "")) if email_de_dossier(d) else ("?", "non connecté")
    return "?", "inconnu"


def compte_de_email(email):
    """(Nom, libellé) du compte connecté avec cette adresse (lue dans chaque dossier de config)."""
    if not email:
        return "?", "non connecté"
    for c in comptes():
        if email_de_dossier(dossier(c)).lower() == email.lower():
            return c["nom"], c.get("libelle", "")
    return "?", "autre"


def dossier_de_compte(nom):
    """Dossier de config du compte s'il y est connecté, sinon None."""
    c = compte(nom)
    if not c:
        return None
    d = dossier(c)
    return d if email_de_dossier(d) else None


def signature(nom):
    c = compte(nom)
    return c.get("signature", nom[:3].upper()) if c else "???"


def compte_de_signature(sig):
    return next((c["nom"] for c in comptes() if c.get("signature") == sig), None)


def navigateurs():
    return config()["navigateurs"]


def navigateur_de_processus(exe, cmdline):
    """Nom du navigateur configuré qui correspond à ce processus (exécutable + ligne de commande), sinon None."""
    base = os.path.basename(exe)
    if base not in PROFILS_PAR_DEFAUT:
        return None                                     # pas un navigateur, ou processus auxiliaire (crashpad…)
    m = re.search(rb"(?:^|[\s\0])--user-data-dir=(\S+?)(?=[\s\0]|$)", cmdline)
    profil = m.group(1).decode(errors="replace") if m else PROFILS_PAR_DEFAUT[base]
    for n in navigateurs():
        if chemin(n["profil"]) == chemin(profil):
            return n["nom"]
    return None


def interdits():
    return config().get("interdits") or {}


def desktop(nom):
    c = compte(nom)
    return os.path.expanduser(c["desktop"]) if c and c.get("desktop") else None


def handoff():
    h = config().get("handoff")
    return os.path.expanduser(h) if h else None


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "nom":
        print(" ".join(compte_de_config(argv[2] if len(argv) > 2 else "")))
    elif cmd == "noms":
        print("\n".join(noms()))
    elif cmd == "autre" and len(argv) > 2:
        print(autre(argv[2]))
    elif cmd == "dossiers":
        print("\n".join(dossier(c) for c in comptes()))
    elif cmd == "profils":
        print("\n".join(os.path.expanduser(n["profil"]) for n in navigateurs()))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
