#!/usr/bin/env bash
# Installe Relais (claude-relais) sur ce poste : configuration, scripts (liens dans ~/.local/bin), hôte natif des
# navigateurs, lanceur Claude Desktop, extension VS Code, applet COSMIC et entrée dans le panneau.
# Chaque étape optionnelle est sautée si l'outil correspondant est absent (Claude Desktop, VS Code, cargo, COSMIC).
# Relançable sans risque : chaque étape vérifie si elle est déjà faite.
# Usage : ./installer.sh             tout
#         ./installer.sh extensions  tout sauf l'applet et le panneau (pas de compilation)
set -euo pipefail
MODE="${1:-tout}"
R="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
PANEL="$HOME/.config/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
APPLET_ID="io.claude_relais.CosmicApplet"

CONF="$HOME/.config/claude-relais"

echo "== configuration"
mkdir -p "$CONF"
if [ -f "$CONF/config.json" ]; then
  echo "  $CONF/config.json (existant, gardé)"
else
  cp "$R/config.example.json" "$CONF/config.json"
  echo "  $CONF/config.json créé depuis config.example.json : à adapter (comptes, navigateurs), puis relancer ./installer.sh"
fi

echo "== scripts"
mkdir -p "$BIN"
for s in claude-statusline claude-usage-lib.sh claude-usage claude-relais claude-relais-hook claude-relais-ctl claude-sync-mcp memoire \
         claude-relais-nm claude-desktop-relais relais_config.py; do
  ln -sfn "$R/bin/$s" "$BIN/$s"
done

echo "== navigateurs : hôte de messagerie native (profils déclarés dans config.json)"
EXT_ID="jbplmooanajbfahpdapodpjiejknhekd"           # fixé par la clé publique de navigateur/manifest.json
while IFS= read -r d; do
  [ -d "$d" ] || { echo "  $d : absent, sauté"; continue; }
  mkdir -p "$d/NativeMessagingHosts"
  cat > "$d/NativeMessagingHosts/com.claude_relais.nm.json" <<EOF
{
  "name": "com.claude_relais.nm",
  "description": "claude-relais : compte Claude actif pour l'extension navigateur",
  "path": "$BIN/claude-relais-nm",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "  $d"
done < <("$R/bin/relais_config.py" profils)
echo "  extension à charger une fois par navigateur : chrome://extensions (opera://extensions),"
echo "  mode développeur, « Charger l'extension non empaquetée » → $R/navigateur"

echo "== Claude Desktop : lanceur sur le profil du compte actif"
mkdir -p "$APPS"
if [ -f /usr/share/applications/com.anthropic.Claude.desktop ]; then
  sed -e "s#^Exec=claude-desktop#Exec=$BIN/claude-desktop-relais#" /usr/share/applications/com.anthropic.Claude.desktop \
    > "$APPS/com.anthropic.Claude.desktop"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "  $APPS/com.anthropic.Claude.desktop (remplace l'entrée du paquet pour cet utilisateur)"
fi

echo "== VS Code : extension Claude Relais"
if command -v code >/dev/null; then
  VSIX="$(mktemp -d)/claude-relais.vsix"
  python3 -I "$R/outils/vsix.py" "$R/vscode" "$VSIX" >/dev/null
  code --install-extension "$VSIX" --force 2>&1 | tail -1
  rm -rf "$(dirname "$VSIX")"
else
  echo "  commande code absente, sauté"
fi

echo "== unités systemd locales (facultatif : $CONF/systemd/*.service|*.timer, hors dépôt)"
if compgen -G "$CONF/systemd/*.timer" >/dev/null; then
  mkdir -p "$HOME/.config/systemd/user"
  install -m 644 "$CONF"/systemd/*.service "$CONF"/systemd/*.timer "$HOME/.config/systemd/user/"
  systemctl --user daemon-reload
  for t in "$CONF"/systemd/*.timer; do systemctl --user enable --now "$(basename "$t")" >/dev/null 2>&1 || echo "  $(basename "$t") non activée"; done
else
  echo "  aucune"
fi

if [ "$MODE" = "extensions" ]; then
  echo "Terminé (sans applet). VS Code : la barre d'état « ✳ » apparaît dans les fenêtres ouvertes (sinon : Developer: Reload Window)."
  exit 0
fi

if ! command -v cargo >/dev/null || [ ! -d "$HOME/.config/cosmic" ]; then
  echo "== applet COSMIC : cargo ou bureau COSMIC absent, sauté"
  echo "Terminé. Brancher les hooks et la barre d'état dans ~/.claude/settings.json : voir README (Install)."
  exit 0
fi

echo "== applet (compilation)"
(cd "$R/applet" && cargo build --release)
install -m 755 "$R/applet/target/release/cosmic-applet-claude" "$BIN/cosmic-applet-claude-bin"
ln -sfn "$R/bin/cosmic-applet-claude" "$BIN/cosmic-applet-claude"
mkdir -p "$APPS"
install -m 644 "$R/applet/data/$APPLET_ID.desktop" "$APPS/$APPLET_ID.desktop"

echo "== panneau"
if [ -f "$PANEL" ] && grep -q "$APPLET_ID" "$PANEL"; then
  # déjà présente : on la retire puis on la remet pour que le panneau relance le nouveau binaire
  sed -i "/\"$APPLET_ID\",/d" "$PANEL"; sleep 2
fi
if [ -f "$PANEL" ] && ! grep -q "$APPLET_ID" "$PANEL"; then
  [ -e "$PANEL.bak-$(date +%F)" ] || cp -p "$PANEL" "$PANEL.bak-$(date +%F)"
  python3 -I - "$PANEL" "$APPLET_ID" <<'EOF'
import sys
from pathlib import Path
p, app = Path(sys.argv[1]), sys.argv[2]
s = p.read_text()
i = s.index("], [") + len("], [")
p.write_text(s[:i] + f'\n    "{app}",' + s[i:])
EOF
  echo "applet ajoutée au panneau (à gauche des applets de droite)"
else
  echo "déjà présente dans le panneau (ou config du panneau absente)"
fi
echo "Terminé. Si l'applet n'apparaît pas : se déconnecter puis se reconnecter. Hooks et barre d'état Claude Code : voir README (Install)."
