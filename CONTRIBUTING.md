# Contributing to claude-relais

Thanks for your interest! Bug reports, fixes, documentation and ideas are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Be kind and constructive: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues must not be reported in public issues: see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Linux, Python 3.10+, bash, `jq`, Node 20+ (for the extension tests), [shellcheck](https://www.shellcheck.net/). Rust and the COSMIC desktop only for the applet.

```sh
git clone https://github.com/rjvdev/claude-relais ~/claude-relais
cd ~/claude-relais
tests/moteur.sh
node tests/navigateur.test.js
```

Both tests run in isolation: a temporary fake HOME for the engine, a fake browser for the extension. They never touch your real Claude sessions or browsers.

## Checks before opening a pull request

1. `tests/moteur.sh` and `node tests/navigateur.test.js` end with `tous les tests passent`.
2. shellcheck passes with no warning (the exact command is in [`CLAUDE.md`](CLAUDE.md)).
3. If you touched the applet: `cd applet && cargo build --release`.
4. No personal data: no names, e-mail addresses, domains, employer or customer names, local paths. Workstation-specific values belong in `config.json`, never in the code.
5. Update `CLAUDE.md` and the README (both `README.md` and `README.fr.md`) when you change a command or its behavior.
6. Add a line under `[Unreleased]` in `CHANGELOG.md`.

The CI runs shellcheck, both test suites, a syntax check of the extensions and a build of the applet on every pull request.

## Guidelines

- All logic stays in `bin/claude-relais-ctl` (Python standard library only). The applet and the extensions display state and send orders.
- No new runtime dependency: Python stdlib, bash, `jq`, plain JavaScript without a build step.
- Cookies are only handled by the browser extension, inside the browser. The engine and the native host never read them.
- Manual tests: always with `CLAUDE_RELAIS_TEST=1` and a fake `HOME` (see `CLAUDE.md`).
- The existing code, comments and interface are in French. New contributions may be written in English or French; an English user interface is welcome.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(vscode): reopen conversations in the sidebar too
fix(engine): keep the forbidden folder check after a switch
docs: explain the Opera native messaging path
ci: build the applet with cargo cache
```

## Pull requests

- Branch from `main` and open the pull request against `main`.
- `main` is protected: the CI checks must pass before merging.
- Keep pull requests focused: one topic per pull request.
