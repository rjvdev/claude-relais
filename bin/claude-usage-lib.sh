# shellcheck shell=bash
# Fonctions communes à claude-statusline et claude-usage (sourcé, pas exécuté).
# Cache d'usage par compte : ~/.cache/claude-usage/<Nom>.json  {five, five_reset, week, week_reset, ts}
CU_DIR="${CU_DIR:-$HOME/.cache/claude-usage}"; CU_SEUIL="${CU_SEUIL:-90}"
CU_CFG="$HOME/.local/bin/relais_config.py"   # comptes définis dans ~/.config/claude-relais/config.json
cu_nom() {  # $1 = dossier de config (vide = ~/.claude) → "Nom libellé"
  "$CU_CFG" nom "${1:-}" 2>/dev/null || echo "? inconnu"; }
cu_lire() {  # $1 = Nom → "five week age_min" (pourcentage remis à 0 si la fenêtre est réinitialisée)
  local f="$CU_DIR/$1.json"; [ -f "$f" ] || { echo "-- -- -"; return; }
  jq -r --argjson now "$(date +%s)" '
    def p(v; r): if v == null then "--" elif (r != null and r < $now) then 0 else (v|round) end;
    "\(p(.five; .five_reset)) \(p(.week; .week_reset)) \(([0, (($now - .ts)/60)] | max | floor))"' "$f"; }

# Comptes : un dossier de config par compte (connexion séparée), tout le reste partagé avec ~/.claude.
cu_noms() { "$CU_CFG" noms; }
cu_autre() { "$CU_CFG" autre "$1"; }
cu_max() {  # $1 = Nom → plus grand des deux pourcentages (0 si inconnu)
  local s w; read -r s w _ <<<"$(cu_lire "$1")"; [[ $s =~ ^[0-9]+$ ]] || s=0; [[ $w =~ ^[0-9]+$ ]] || w=0
  echo $(( s > w ? s : w )); }
