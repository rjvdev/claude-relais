# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes |

## Scope

claude-relais runs locally, for one user, on one workstation. It handles sensitive material: the claude.ai session cookies of two accounts (browser extension) and a shared memory read by every Claude on the machine.

In scope:

- anything that lets a claude.ai session cookie leave the browser (to the native host, a file, the network, another extension or website);
- weaknesses of the encrypted vault (key handling, storage of cookies in clear);
- the native messaging host answering an extension other than the one in `navigateur/`;
- bypassing the memory filters (secrets, e-mail addresses, phone numbers) or deleting memory entries without the user's approval;
- a switch that runs commands outside the user's session or acts on processes that are not Claude Code, Claude Desktop or the configured browsers.

Out of scope: vulnerabilities in Claude Code, Claude Desktop, claude.ai or the browsers themselves (report them to their vendors), and attacks that require an already compromised user account.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting instead: open the repository's **Security** tab, then **Report a vulnerability**.

Include the steps to reproduce, the affected version (`git describe --tags`), your distribution and desktop, and the browser if the extension is involved. Remove any cookie, token or personal data from what you send. You should get a first answer within a week.
