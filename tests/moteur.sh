#!/usr/bin/env bash
# Tests du moteur (claude-relais-ctl, relais_config.py, memoire) dans un faux HOME : deux comptes fictifs,
# aucune vraie session touchée (CLAUDE_RELAIS_TEST=1), aucun navigateur, aucune notification.
# Usage : tests/moteur.sh
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
B="$R/bin"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T" CLAUDE_RELAIS_TEST=1 MEMOIRE_DIR="$T/memoire"
unset CLAUDE_CONFIG_DIR CLAUDE_CODE_USER_EMAIL
mkdir -p "$T/.claude-pro" "$T/.config/claude-relais" "$T/.local/bin"
for f in claude-relais-ctl relais_config.py memoire; do ln -s "$B/$f" "$T/.local/bin/$f"; done
echo '{"oauthAccount":{"emailAddress":"home@example.org","organizationUuid":"org-home"}}' > "$T/.claude.json"
echo '{"oauthAccount":{"emailAddress":"work@example.com","organizationUuid":"org-work"}}' > "$T/.claude-pro/.claude.json"
cat > "$T/.config/claude-relais/config.json" <<'JSON'
{"comptes": [{"nom": "Home", "signature": "HOM", "libelle": "personal", "config": "~/.claude"},
             {"nom": "Work", "signature": "WRK", "libelle": "work", "config": "~/.claude-pro"}],
 "navigateurs": [{"nom": "Chrome", "profil": "~/.config/google-chrome"}],
 "interdits": {"Work": ["~/side"]}}
JSON
echecs=0
verifier() {  # $1 = libellé, $2 = attendu, $3 = obtenu
  if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "ÉCHEC $1 : attendu « $2 », obtenu « $3 »"; echecs=$((echecs + 1)); fi; }
json() { "$B/claude-relais-ctl" status --json | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

verifier "compte de ~/.claude"             "Home personal" "$("$B/relais_config.py" nom "")"
verifier "compte de ~/.claude-pro"         "Work work"     "$("$B/relais_config.py" nom "$T/.claude-pro")"
verifier "autre compte"                    "Work"          "$("$B/relais_config.py" autre Home)"
verifier "compte actif par défaut"         "Home"          "$(json "d['actif']")"
verifier "bascule auto désactivée par défaut" "False"      "$(json "d['auto']")"
"$B/claude-relais-ctl" basculer Work >/dev/null
verifier "bascule manuelle"                "Work"          "$(json "d['actif']")"
verifier "etat.json sans réglages dérivés" "False"         "$(python3 -c "import json; print('interdits' in json.load(open('$T/.config/claude-relais/etat.json')))")"
"$B/claude-relais-ctl" auto on
verifier "bascule auto activée"            "True"          "$(json "d['auto']")"
"$B/claude-relais-ctl" navigateur Chrome Home
verifier "compte déclaré d'un navigateur"  "Home"          "$(json "[n['compte'] for n in d['navigateurs'] if n['nom'] == 'Chrome'][0]")"
sortie=$(echo '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"'"$T"'/side/app"}' \
  | CLAUDE_CONFIG_DIR="$T/.claude-pro" CLAUDE_RELAIS_PID_TEST=$$ "$B/claude-relais-ctl" hook)
verifier "dossier interdit : demande refusée" "block"      "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['decision'])" "$sortie")"
sortie=$(echo '{"hook_event_name":"SessionStart","session_id":"s2","cwd":"'"$T"'"}' \
  | CLAUDE_RELAIS_PID_TEST=$$ "$B/claude-relais-ctl" hook)
verifier "reprise de la mémoire au démarrage" "True"       "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['hookSpecificOutput']['additionalContext'].startswith('Tu es Home (HOM).'))" "$sortie")"
verifier "mémoire : message"               "Message M1 laissé pour Work." "$(MEMOIRE_AUTEUR=UTI "$B/memoire" message Work bonjour)"
verifier "mémoire : refus d'une adresse e-mail" "1"        "$("$B/memoire" ajouter test "écrire à someone@example.net" >/dev/null; echo $?)"
verifier "mémoire : non lus pour Work"     "1"             "$("$B/memoire" stats --json | python3 -c "import json,sys; print(json.load(sys.stdin)['non_lus']['Work'])")"
if [ "$echecs" -eq 0 ]; then echo "tous les tests passent"; else echo "$echecs échec(s)"; exit 1; fi
