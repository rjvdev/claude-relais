# claude-relais

**Relais: switch everywhere between your personal and your work Claude account. Terminal, VS Code, Claude Desktop and claude.ai in your browsers follow one switch, and every running session writes a handoff first, so no work is lost.**

[![CI](https://github.com/rjvdev/claude-relais/actions/workflows/ci.yml/badge.svg)](https://github.com/rjvdev/claude-relais/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Version française](README.fr.md)

## The problem

Many developers have two Claude accounts: a personal one and one provided by their employer. Claude Code supports this with one config directory per account (`CLAUDE_CONFIG_DIR`), but nothing else follows:

- the VS Code panel keeps the account it started with, and so do the conversations already open;
- Claude Desktop is signed in to one account, and changing means signing out and in again;
- each browser holds one claude.ai session, and signing out of claude.ai revokes it;
- a session moved to the other account loses the thread unless someone writes down where it was.

Relais (the project is `claude-relais`) turns this into one switch:

- **One active account for the whole workstation**, chosen in a panel applet, the VS Code status bar or the browser extension.
- **Handoff before every switch**: a Claude Code hook asks each running session to update its `HANDOFF.md` at the end of its current answer, then the same conversation resumes on the other account (`--resume`).
- **VS Code**: an extension shows the active account in the status bar and reopens each Claude panel conversation on the new account once its answer is finished (8-second countdown, can be cancelled).
- **Claude Desktop**: one Electron profile per account, each signed in once. Desktop is restarted on the right profile after its sessions have finished.
- **claude.ai in Chromium browsers**: an extension keeps the claude.ai session of each account in an encrypted vault inside the browser and swaps them, without ever signing out.
- **Shared memory (optional)**: an MCP server gives every Claude on the workstation, on both accounts, the same facts, daily log and messages.
- **Folder rules**: forbid an account in some folders (for example, no personal side project with the work account).

Automatic switching when an account reaches 90 % of its usage window exists but is **off by default**. See [Terms of use](#terms-of-use).

## Requirements

- Linux, Python 3.10+, bash, `jq`, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with two config directories, each logged in.
- Optional, each part is skipped when absent: VS Code with the Claude Code extension; Claude Desktop (`/usr/bin/claude-desktop`); Chrome, Chromium, Brave, Edge, Vivaldi or Opera; `secret-tool` (GNOME keyring, needed by the browser extension); the COSMIC desktop and Rust (`cargo`) for the panel applet.

The user interface and the code comments are in French for now (see [Contributing](#contributing)).

## Install

```sh
git clone https://github.com/rjvdev/claude-relais ~/claude-relais
cd ~/claude-relais
./installer.sh             # everything; ./installer.sh extensions skips the COSMIC applet
```

The first run creates `~/.config/claude-relais/config.json` from [`config.example.json`](config.example.json). Edit it (next section), then run `./installer.sh` again.

Log in each account in its own config directory, once:

```sh
claude /login                                   # first account, default ~/.claude
CLAUDE_CONFIG_DIR=~/.claude-pro claude /login   # second account
```

Then plug Relais into Claude Code, in `~/.claude/settings.json` (and in the second config directory if it does not share this file):

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

Optional pieces:

- **Terminal**: start Claude Code through `claude-relais` (for example `alias claude=claude-relais`) to get automatic resume on the other account.
- **Browsers**: in each browser, open `chrome://extensions` (`opera://extensions` in Opera), enable developer mode, click **Load unpacked** and pick the `navigateur/` folder. Then sign in to claude.ai with each account, using **Ajouter l'autre compte** in the extension popup for the second one.
- **Shared memory**: `claude mcp add memoire -s user -- ~/.local/bin/memoire mcp`, and the same command with `CLAUDE_CONFIG_DIR` set for the second account (or run `claude-sync-mcp`).

## Configuration

`~/.config/claude-relais/config.json` holds everything that is specific to your workstation. Nothing personal lives in the repository.

| Key | Meaning |
|---|---|
| `comptes` | The two accounts: `nom` (display name), `signature` (3 letters, used in the shared memory), `libelle`, `config` (Claude Code config directory; `~/.claude` means `CLAUDE_CONFIG_DIR` unset), `desktop` (Claude Desktop profile directory) |
| `navigateurs` | Browsers to follow: `nom` and `profil` (the browser's user data directory, `--user-data-dir`) |
| `interdits` | Folders where an account must not work, per account name |
| `handoff` | Optional `HANDOFF.md` opened from the applet menu |
| `memoire` | Extra instructions and examples shown to every Claude by the shared memory server |

An account is recognised by its config directory, or by the e-mail address stored in that directory. No address or domain is ever written in the code.

## Commands

| Command | Effect |
|---|---|
| `claude-relais [claude args]` | Claude Code on the active account; resumes the same session on the other account after a switch |
| `claude-relais-ctl status [--json]` | Active account, usage of both accounts, running sessions, where each app stands |
| `claude-relais-ctl basculer [<account>]` | Switch the whole workstation (handoff in each running session) |
| `claude-relais-ctl auto on\|off` | Automatic switch at 90 % (off by default) |
| `claude-relais-ctl sonder` | Measure the real usage of both accounts (one tiny Haiku request each) |
| `claude-relais-ctl navigateur "<browser>" <account>\|aucun` | Declare the account of a browser without the extension |
| `claude-usage` | Last known usage of both accounts |
| `claude-desktop-relais` | Start Claude Desktop on the active account's profile (the installer points the desktop entry to it) |
| `memoire …` | Shared memory from the command line (`memoire aide` prints the commands) |

## How it works

- **State**: `~/.config/claude-relais/etat.json` (active account, automatic switch, declared browsers). Sessions are found in `/proc`; hooks record whether each one is busy in `~/.cache/claude-relais/sessions/`.
- **Handoff**: when a session stops on the old account, the `Stop` hook blocks once and asks it to update its `HANDOFF.md`, add a line to the shared log and leave a message to the other account. At the next stop, the switch goes on.
- **VS Code**: `claudeCode.environmentVariables` gets the new `CLAUDE_CONFIG_DIR`, so new conversations start on the new account. The extension then closes and reopens, by session id, each conversation still on the old account once it is idle. An empty conversation is replaced by a new one.
- **Claude Desktop**: started with `--user-data-dir=<profile of the account>`. On a switch, Relais waits until no Desktop Code session is busy, closes Desktop (SIGTERM) and starts it on the other profile. MCP servers of the default profile are copied to the other one at each start.
- **Browsers**: the extension talks to a native messaging host (`claude-relais-nm`). The host sends the active account, the organisation of each account and the vault key from the keyring; the extension answers with the name of the account signed in. **Cookies never leave the browser.** During **Ajouter l'autre compte**, the extension blocks Google's one-tap sign-in script on claude.ai for up to 10 minutes, so the browser's Google account does not sign you back in automatically.
- **Shared memory**: an append-only journal in `~/.local/share/memoire-commune/`. Claudes read, add, correct (new version) and *request* deletions; only you accept them. Text that looks like a secret, an e-mail address or a phone number is refused. Local extensions (`~/.config/claude-relais/memoire_ext_*.py`, outside the repository) can add commands, for example a sync to another tool.

## Terms of use

Relais is meant for people who legitimately hold two Claude accounts, typically a personal one and one provided by their employer, and want each piece of work done with the right one. Use it only with accounts you own or are allowed to use, and follow [Anthropic's terms](https://www.anthropic.com/legal) and your employer's rules. Do not use it to get around usage limits. This is why automatic switching is off by default.

## FAQ

**Does it read my browser cookies?**
Only the browser extension touches the claude.ai cookies, inside the browser, to swap the two sessions. They are stored encrypted (AES-GCM) in the extension storage, with a key kept in your keyring. The native host and the command line tools never read a cookie.

**I signed out of claude.ai and the extension lost the session.**
"Log out" on claude.ai revokes the session on the server. Never use it to change account: use the switch. Sign in again once and the extension records the new session.

**The login page closes by itself and signs me in with my Google account.**
Use **Ajouter l'autre compte** in the extension popup: it blocks Google's one-tap sign-in on claude.ai while you sign in with e-mail.

**Do I need COSMIC?**
No. The applet is COSMIC-only, but the switch works from the VS Code status bar, the browser extension popup and `claude-relais-ctl basculer`.

**macOS or Windows?**
Not yet: Relais relies on `/proc`, the GNOME keyring and Linux paths.

**More than two accounts?**
Not supported: a switch always goes to "the other" account.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

---

**Not affiliated with Anthropic.** Claude and Claude Code are trademarks of Anthropic. This project only uses public features of Claude Code (config directories, hooks, status line) and of the browsers (extensions, native messaging).
