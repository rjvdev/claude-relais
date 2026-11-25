# claude-relais

**Relais : basculez partout entre votre compte Claude personnel et votre compte professionnel. Terminal, VS Code, Claude Desktop et claude.ai dans vos navigateurs suivent une seule bascule, et chaque session en cours écrit d'abord sa passation : aucun travail n'est perdu.**

[![CI](https://github.com/rjvdev/claude-relais/actions/workflows/ci.yml/badge.svg)](https://github.com/rjvdev/claude-relais/actions/workflows/ci.yml)
[![Licence : MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English version](README.md)

## Le problème

Beaucoup de développeurs ont deux comptes Claude : un personnel et un fourni par leur employeur. Claude Code le permet avec un dossier de config par compte (`CLAUDE_CONFIG_DIR`), mais rien d'autre ne suit :

- le panneau VS Code garde le compte avec lequel il a démarré, tout comme les conversations déjà ouvertes ;
- Claude Desktop est connecté à un seul compte, et en changer impose de se déconnecter puis se reconnecter ;
- chaque navigateur garde une seule session claude.ai, et se déconnecter de claude.ai l'annule ;
- une session passée sur l'autre compte perd le fil si personne n'a noté où elle en était.

Relais (le projet s'appelle `claude-relais`) en fait une seule bascule :

- **Un seul compte actif pour tout le poste**, choisi dans une applet du panneau, la barre d'état de VS Code ou l'extension navigateur.
- **Passation avant chaque bascule** : un hook Claude Code demande à chaque session en cours de mettre à jour son `HANDOFF.md` à la fin de sa réponse, puis la même conversation reprend sur l'autre compte (`--resume`).
- **VS Code** : une extension affiche le compte actif dans la barre d'état et rouvre chaque conversation du panneau Claude sur le nouveau compte dès que sa réponse est finie (compte à rebours de 8 secondes, annulable).
- **Claude Desktop** : un profil Electron par compte, chacun connecté une fois. Desktop est relancé sur le bon profil une fois ses sessions terminées.
- **claude.ai dans les navigateurs Chromium** : une extension garde la session claude.ai de chaque compte dans un coffre chiffré, à l'intérieur du navigateur, et les échange, sans jamais se déconnecter.
- **Mémoire commune (facultative)** : un serveur MCP donne à tous les Claude du poste, sur les deux comptes, les mêmes faits, le même journal du jour et les mêmes messages.
- **Règles par dossier** : interdire un compte dans certains dossiers (par exemple, aucun projet perso avec le compte pro).

La bascule automatique quand un compte atteint 90 % de sa fenêtre d'usage existe, mais elle est **désactivée par défaut**. Voir [Conditions d'utilisation](#conditions-dutilisation).

## Prérequis

- Linux, Python 3.10+, bash, `jq`, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) avec deux dossiers de config, chacun connecté.
- Facultatif, chaque partie est sautée si l'outil manque : VS Code avec l'extension Claude Code ; Claude Desktop (`/usr/bin/claude-desktop`) ; Chrome, Chromium, Brave, Edge, Vivaldi ou Opera ; `secret-tool` (trousseau GNOME, requis par l'extension navigateur) ; le bureau COSMIC et Rust (`cargo`) pour l'applet du panneau.

L'interface et les commentaires du code sont en français pour l'instant (voir [Contribuer](#contribuer)).

## Installation

```sh
git clone https://github.com/rjvdev/claude-relais ~/claude-relais
cd ~/claude-relais
./installer.sh             # tout ; ./installer.sh extensions saute l'applet COSMIC
```

Le premier lancement crée `~/.config/claude-relais/config.json` à partir de [`config.example.json`](config.example.json). Adaptez-le (section suivante), puis relancez `./installer.sh`.

Connectez chaque compte dans son propre dossier de config, une fois :

```sh
claude /login                                   # premier compte, ~/.claude par défaut
CLAUDE_CONFIG_DIR=~/.claude-pro claude /login   # second compte
```

Branchez ensuite Relais dans Claude Code, dans `~/.claude/settings.json` (et dans le second dossier de config s'il ne partage pas ce fichier) :

```json
{
  "hooks": {
    "SessionStart":     [{"hooks": [{"type": "command", "command": "~/.local/bin/claude-relais-hook"}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "~/.local/bin/claude-relais-hook"}]}],
    "Stop":             [{"hooks": [{"type": "command", "command": "~/.local/bin/claude-relais-hook"}]}]
  },
  "statusLine": {"type": "command", "command": "~/.local/bin/claude-statusline", "refreshInterval": 60}
}
```

Éléments facultatifs :

- **Terminal** : lancez Claude Code par `claude-relais` (par exemple `alias claude=claude-relais`) pour la reprise automatique sur l'autre compte.
- **Navigateurs** : dans chaque navigateur, ouvrez `chrome://extensions` (`opera://extensions` dans Opera), activez le mode développeur, cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `navigateur/`. Connectez-vous ensuite sur claude.ai avec chaque compte, avec **Ajouter l'autre compte** dans la fenêtre de l'extension pour le second.
- **Mémoire commune** : `claude mcp add memoire -s user -- ~/.local/bin/memoire mcp`, puis la même commande avec `CLAUDE_CONFIG_DIR` pour le second compte (ou lancez `claude-sync-mcp`).

## Configuration

`~/.config/claude-relais/config.json` contient tout ce qui est propre à votre poste. Rien de personnel n'est dans le dépôt.

| Clé | Rôle |
|---|---|
| `comptes` | Les deux comptes : `nom` (nom affiché), `signature` (3 lettres, utilisées dans la mémoire commune), `libelle`, `config` (dossier de config Claude Code ; `~/.claude` signifie `CLAUDE_CONFIG_DIR` absent), `desktop` (dossier de profil Claude Desktop) |
| `navigateurs` | Navigateurs à suivre : `nom` et `profil` (dossier de données du navigateur, `--user-data-dir`) |
| `interdits` | Dossiers où un compte ne doit pas travailler, par nom de compte |
| `handoff` | `HANDOFF.md` facultatif, ouvert depuis le menu de l'applet |
| `memoire` | Consignes et exemples supplémentaires montrés à chaque Claude par le serveur de mémoire commune |

Un compte est reconnu par son dossier de config, ou par l'adresse e-mail enregistrée dans ce dossier. Aucune adresse ni aucun domaine n'est écrit dans le code.

## Commandes

| Commande | Effet |
|---|---|
| `claude-relais [arguments de claude]` | Claude Code sur le compte actif ; reprend la même session sur l'autre compte après une bascule |
| `claude-relais-ctl status [--json]` | Compte actif, usage des deux comptes, sessions en cours, état de chaque appli |
| `claude-relais-ctl basculer [<compte>]` | Bascule tout le poste (passation dans chaque session en cours) |
| `claude-relais-ctl auto on\|off` | Bascule automatique à 90 % (désactivée par défaut) |
| `claude-relais-ctl sonder` | Mesure l'usage réel des deux comptes (une petite requête Haiku chacun) |
| `claude-relais-ctl navigateur "<navigateur>" <compte>\|aucun` | Déclare le compte d'un navigateur sans l'extension |
| `claude-usage` | Dernier usage connu des deux comptes |
| `claude-desktop-relais` | Lance Claude Desktop sur le profil du compte actif (l'installeur y fait pointer l'entrée du bureau) |
| `memoire …` | Mémoire commune en ligne de commande (`memoire aide` affiche les commandes) |

## Fonctionnement

- **État** : `~/.config/claude-relais/etat.json` (compte actif, bascule automatique, navigateurs déclarés). Les sessions sont trouvées dans `/proc` ; les hooks notent si chacune est occupée dans `~/.cache/claude-relais/sessions/`. Une session occupée compte comme inactive si sa transcription se termine par une interruption (Claude Code ne lance alors pas le hook `Stop`) ou n'a pas été écrite depuis 20 minutes.
- **Passation** : quand une session s'arrête sur l'ancien compte, le hook `Stop` la bloque une fois et lui demande de mettre à jour son `HANDOFF.md`, d'ajouter une ligne au journal commun et de laisser un message à l'autre compte. Au prochain arrêt, la bascule continue.
- **VS Code** : `claudeCode.environmentVariables` reçoit le nouveau `CLAUDE_CONFIG_DIR`, donc les nouvelles conversations démarrent sur le nouveau compte. L'extension ferme puis rouvre, par identifiant de session, chaque conversation encore sur l'ancien compte dès qu'elle est inactive. Une conversation vide est remplacée par une nouvelle.
- **Claude Desktop** : lancé avec `--user-data-dir=<profil du compte>`. À la bascule, Relais attend qu'aucune session Code de Desktop ne travaille, ferme Desktop (SIGTERM) et le relance sur l'autre profil. Les serveurs MCP du profil par défaut sont recopiés dans l'autre à chaque lancement.
- **Navigateurs** : l'extension parle à un hôte de messagerie native (`claude-relais-nm`). L'hôte envoie le compte actif, l'organisation de chaque compte et la clé du coffre lue dans le trousseau ; l'extension répond par le nom du compte connecté. **Les cookies ne sortent jamais du navigateur.** Pendant **Ajouter l'autre compte**, l'extension bloque le script de connexion en un clic de Google sur claude.ai, 10 minutes au plus, pour que le compte Google du navigateur ne vous reconnecte pas tout seul.
- **Mémoire commune** : un journal en ajout seul dans `~/.local/share/memoire-commune/`. Les Claude lisent, ajoutent, corrigent (nouvelle version) et *demandent* les suppressions ; vous seul les acceptez. Un texte qui ressemble à un secret, une adresse e-mail ou un numéro de téléphone est refusé. Des extensions locales (`~/.config/claude-relais/memoire_ext_*.py`, hors dépôt) peuvent ajouter des commandes, par exemple une synchronisation vers un autre outil.

## Conditions d'utilisation

Relais s'adresse aux personnes qui ont légitimement deux comptes Claude, typiquement un compte personnel et un compte fourni par leur employeur, et qui veulent faire chaque travail avec le bon. Ne l'utilisez qu'avec des comptes qui vous appartiennent ou que vous avez le droit d'utiliser, en respectant les [conditions d'Anthropic](https://www.anthropic.com/legal) et les règles de votre employeur. Ne l'utilisez pas pour contourner les limites d'usage : c'est pourquoi la bascule automatique est désactivée par défaut.

## FAQ

**Relais lit-il mes cookies de navigateur ?**
Seule l'extension navigateur touche aux cookies claude.ai, à l'intérieur du navigateur, pour échanger les deux sessions. Ils sont gardés chiffrés (AES-GCM) dans le stockage de l'extension, avec une clé conservée dans votre trousseau. L'hôte natif et les outils en ligne de commande ne lisent jamais un cookie.

**Je me suis déconnecté de claude.ai et l'extension a perdu la session.**
« Se déconnecter » sur claude.ai annule la session côté serveur. Ne l'utilisez jamais pour changer de compte : utilisez la bascule. Reconnectez-vous une fois et l'extension enregistre la nouvelle session.

**La page de connexion se ferme toute seule et me connecte avec mon compte Google.**
Utilisez **Ajouter l'autre compte** dans la fenêtre de l'extension : elle bloque la connexion en un clic de Google sur claude.ai pendant que vous vous connectez par e-mail.

**Faut-il COSMIC ?**
Non. L'applet n'existe que pour COSMIC, mais la bascule se fait aussi depuis la barre d'état de VS Code, la fenêtre de l'extension navigateur et `claude-relais-ctl basculer`.

**macOS ou Windows ?**
Pas encore : Relais s'appuie sur `/proc`, le trousseau GNOME et les chemins Linux.

**Plus de deux comptes ?**
Non : une bascule va toujours vers « l'autre » compte.

## Contribuer

Les contributions sont les bienvenues. Voir [CONTRIBUTING.md](CONTRIBUTING.md) et le [code de conduite](CODE_OF_CONDUCT.md). Pour signaler une vulnérabilité, voir [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE)

---

**Projet non affilié à Anthropic.** Claude et Claude Code sont des marques d'Anthropic. Ce projet n'utilise que des fonctions publiques de Claude Code (dossiers de config, hooks, barre d'état) et des navigateurs (extensions, messagerie native).
