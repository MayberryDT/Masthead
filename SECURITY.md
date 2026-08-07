# Security Policy

## Supported versions

Masthead is **pre-1.0**. Security fixes target the current `main` branch and the
version line in `package.json`.

## Reporting a vulnerability

Do **not** open a public issue with exploit details, private logs, local
database contents, secrets, or raw session transcripts.

Use **[GitHub Security Advisories](https://github.com/MayberryDT/Masthead/security/advisories/new)**
for private reporting. Include:

- Affected version, tag, or commit
- Operating system and install mode (desktop package vs `npm run dev`)
- Steps to reproduce with **sanitized** data
- Whether local data, source harness files, MCP access, or hook configuration are involved
- For dependency reports: output of `npm run audit:report` (not only raw full-tree `npm audit`)

## What installers should trust

1. **Preferred:** packaged desktop builds from
   [GitHub Releases](https://github.com/MayberryDT/Masthead/releases/latest)
   for this repository.
2. **Source build:** supported for contributors. After `npm ci`, run
   `npm run audit:runtime` — production dependencies must show **0 high/critical**.
3. Full-tree `npm audit` includes **Electron Forge / Vite build tooling**. Those
   advisories are build-machine supply chain, not the production dependency set.
   See [docs/reference/dependency-security.md](docs/reference/dependency-security.md).

```bash
npm ci
npm run audit:runtime
npm run audit:report
npm run test:electron-security
```

## Security boundaries

- **Local-first core** — no required Masthead cloud account or remote database for primary use
- **Loopback trust** — the daemon is designed for local use; binding off loopback is rejected
- **Secondary worktree bridge is read-only** — mutating and process-spawn endpoints are not proxied
- **MCP is read-only** on the launch surface
- **MCP connection tests** use the daemon’s canonical launch config only (no caller-supplied command/args/env)
- Source harness files and Git repositories remain externally owned
- Optional remote enrichment (if enabled) must stay scoped, redacted, previewable, and auditable
- Reset and retention operations must report whether external harness state was touched
- Hooks and connectors run with the privileges of the local user; treat them as part of your security boundary
- Packaged macOS builds may be **adhoc-signed** until Developer ID notarization ships; verify you trust the release channel (GitHub Releases from this repository)

## Residual / intentional risks

These are product posture, not “forgot to patch”:

- **Same-user local attackers** who can already run code as your OS user are inside the trust boundary
- **Loopback HTTP** is not multi-user network auth; do not expose the daemon on a hostile network
- **Optional provider calls** (enrichment / headlines) send only context you enable
- Some **session-identity edge cases** (colliding source session IDs across runtimes) remain hardening backlog

## Soft open-source note

See [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md). Pre-1.0 does not mean “ignore
security”—report issues privately as above.
