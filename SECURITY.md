# Security policy

## Supported versions

Security fixes are made for the latest minor release only.

## Reporting a vulnerability

Report privately through GitHub Security Advisories: open the repository's Security tab and click "Report a vulnerability". Do not open a public issue for security problems.

Handling is best effort. Expect an acknowledgement within 7 days, followed by an assessment and, if confirmed, a fix and an advisory crediting the reporter unless they prefer otherwise.

## Scope and design notes

epic-board is a single-user local service. The following properties are intended; a way around any of them is in scope:

- The server listens on `127.0.0.1` only.
- Requests are pinned by `Host` and `Origin` headers to defeat DNS rebinding and cross-site requests from the browser.
- Document access is restricted to the data directory and to registered repositories and their worktrees.
- Git refnames are validated before they reach any command's argv.
- No telemetry. The service makes no outbound network calls other than the `git`, `glab` or `gh` invocations the user configured.

Out of scope: attacks that require an already compromised local user account, and issues in `git`, `glab` or `gh` themselves.
