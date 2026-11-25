# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A session interrupted by the user stayed marked busy (Claude Code runs no `Stop` hook on an interruption), so Claude Desktop waited up to 2 hours before restarting on the new account. A busy session is now treated as idle when its transcript ends with an interruption newer than the last hook, or when neither the transcript nor its subagents have been written for 20 minutes.

## [1.0.0] - 2026-11-24

### Added

- Engine `claude-relais-ctl` (Python standard library): one active account for the workstation, `status`, `basculer`, `auto`, `sonder`, `navigateur`, `hook`, `desktop`, `desktop-relancer`, `vscode-plan`, `nm`.
- Workstation configuration in `~/.config/claude-relais/config.json` (`relais_config.py`, `config.example.json`): accounts, browsers, forbidden folders, handoff path, memory instructions. Accounts are recognised by their Claude Code config directory or by the e-mail address stored in it.
- Handoff before every switch: the `Stop` hook asks each running session to update its `HANDOFF.md`, log the step and leave a message to the other account, then the switch goes on.
- Terminal wrapper `claude-relais`: runs Claude Code on the active account and resumes the same session on the other account after a switch.
- Optional automatic switch when an account reaches 90 % of its 5-hour or weekly window, off by default.
- Forbidden folders per account, enforced by the `UserPromptSubmit` hook.
- Claude Code status line with the usage of both accounts (`claude-statusline`, `claude-usage`).
- VS Code extension "Claude Relais": active account in the status bar, menu (switch, reopen now, measure usage, automatic switch), conversations of the Claude panel reopened on the new account once idle, empty conversations replaced.
- Claude Desktop: one profile per account (`--user-data-dir`), restart on the right profile after the Desktop Code sessions have finished, launcher `claude-desktop-relais`, MCP servers copied to every profile.
- Chromium browser extension "Claude Relais": claude.ai sessions of both accounts kept in an AES-GCM vault (key in the keyring, through the native messaging host) and swapped on every switch; Google one-tap sign-in blocked on claude.ai while adding the second account.
- Shared memory `memoire` (MCP server and command): facts, daily log and messages between Claudes, append-only journal, corrections as new versions, deletions approved by the user only, secret / e-mail / phone filters, local extensions (`memoire_ext_*.py`).
- COSMIC panel applet "Relais".
- `installer.sh`: configuration, scripts, native messaging hosts, Claude Desktop launcher, VS Code extension, applet; optional parts skipped when their tool is missing.
- Tests: `tests/moteur.sh` (engine in a fake HOME) and `tests/navigateur.test.js` (extension against a fake browser). CI: shellcheck, both test suites, extension syntax, applet build.

[Unreleased]: https://github.com/rjvdev/claude-relais/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/rjvdev/claude-relais/releases/tag/v1.0.0
