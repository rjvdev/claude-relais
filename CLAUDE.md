# claude-relais: agent guide

Relais makes two Claude accounts (for example personal and work) behave as one on a Linux workstation: one active account, a handoff in every running session before a switch, and every surface following the switch (terminal, VS Code panel, Claude Desktop, claude.ai in Chromium browsers). The code, comments and user interface are in French.

## Layout

```
bin/claude-relais-ctl   engine (Python stdlib, run as python3 -I): status, basculer, auto, sonder, navigateur, hook,
                        desktop, desktop-relancer, vscode-plan, nm (native messaging host)
bin/relais_config.py    reads ~/.config/claude-relais/config.json; shared by the engine, memoire and the bash scripts
bin/memoire             shared memory: MCP server (stdio) and user command, append-only journal
bin/claude-relais       terminal wrapper: runs claude on the active account, resumes the session after a switch
bin/claude-statusline   Claude Code status line (usage of both accounts), with claude-usage-lib.sh and claude-usage
bin/claude-relais-hook  hook entry point (SessionStart, UserPromptSubmit, Stop) → claude-relais-ctl hook
bin/claude-relais-nm    native messaging host entry point → claude-relais-ctl nm
bin/claude-desktop-relais  Claude Desktop launcher on the active account's profile
navigateur/             Chromium extension (MV3, plain JS): claude.ai session vault and swap
vscode/                 VS Code extension (plain JS): status bar, menu, reopening of panel conversations
applet/                 COSMIC panel applet (Rust, libcosmic)
outils/vsix.py          builds the .vsix without Node or vsce
tests/                  moteur.sh (engine, fake HOME), navigateur.test.js (extension, fake browser)
config.example.json     template of ~/.config/claude-relais/config.json
installer.sh            installs everything; each optional part is skipped when its tool is missing
```

All logic lives in `claude-relais-ctl`. The applet and both extensions only display state (`claude-relais-ctl status --json`) and send orders.

## Files outside the repository

| File | Role |
|---|---|
| `~/.config/claude-relais/config.json` | accounts, browsers, forbidden folders, handoff path, memory instructions (personal: never commit) |
| `~/.config/claude-relais/etat.json` | runtime state: active account, automatic switch, declared browsers |
| `~/.config/claude-relais/memoire_ext_*.py` | private memory extensions, executed in the `memoire` namespace, may add `COMMANDES_EXT` |
| `~/.cache/claude-usage/<Name>.json` | last usage seen by the status line or `sonder` |
| `~/.cache/claude-relais/sessions/<pid>.json` | busy / idle state of each Claude Code session, written by the hooks |
| `~/.cache/claude-relais/bascule.json` | last switch request (valid 1 h) |
| `~/.cache/claude-relais/navigateurs/<browser>.json` | browsers whose extension is connected right now |
| `~/.local/share/memoire-commune/` | memory journal, daily backups, Markdown views |

## Testing

- `tests/moteur.sh`: engine, config, hooks and memory in a temporary fake HOME. Must end with `tous les tests passent`.
- `node tests/navigateur.test.js`: the browser extension against a fake browser. Must end with `tous les tests passent`.
- `shellcheck -x bin/claude-relais bin/claude-statusline bin/claude-usage bin/claude-usage-lib.sh bin/claude-sync-mcp bin/claude-relais-hook bin/claude-relais-nm bin/claude-desktop-relais bin/cosmic-applet-claude installer.sh`
- `cd applet && cargo build --release` for the applet.

When testing by hand, **always set `CLAUDE_RELAIS_TEST=1`**: without it, `basculer` sees and may stop the real Claude sessions of the machine. Use `HOME=<temporary dir>` with fake `.claude.json` files, `MEMOIRE_DIR`, `CU_DIR`, `CU_SEUIL`, and `CLAUDE_RELAIS_PID_TEST` (process to act on instead of a Claude process).

## Rules

- No personal data in the repository: names, e-mail addresses, domains, employer or customer names, local paths. Everything specific to a workstation goes in `config.json`.
- An account is recognised by its config directory or by the e-mail address stored in it, never by a domain written in the code.
- Cookies: the engine and the native host never read a browser cookie or session file. Only the browser extension handles claude.ai cookies, inside the browser, encrypted with a key from the keyring. Nothing from the vault may leave the browser.
- The memory server refuses secrets, e-mail addresses and phone numbers; Claudes never delete, they request a deletion that the user accepts.
- Automatic switching stays off by default.
- Every change to a command or its behaviour updates this file, both READMEs and `CHANGELOG.md`.
