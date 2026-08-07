# Security Policy

## Supported versions

Masthead is **pre-1.0**. Security fixes target the current `main` branch and the version line in `package.json`.

## Reporting a vulnerability

Do **not** open a public issue with exploit details, private logs, local database contents, secrets, or raw session transcripts.

Use **[GitHub Security Advisories](https://github.com/MayberryDT/Masthead/security/advisories/new)** for private reporting. Include:

- Affected version, tag, or commit
- Operating system and install mode (desktop package vs `npm run dev`)
- Steps to reproduce with **sanitized** data
- Whether local data, source harness files, MCP access, or hook configuration are involved

## Security boundaries

- **Local-first core** — no required Masthead cloud account or remote database for primary use
- **MCP is read-only** on the launch surface
- Source harness files and Git repositories remain externally owned
- Optional remote enrichment (if enabled) must stay scoped, redacted, previewable, and auditable
- Reset and retention operations must report whether external harness state was touched
- Hooks and connectors run with the privileges of the local user; treat them as part of your security boundary
- Packaged macOS builds may be **adhoc-signed** until Developer ID notarization ships; verify you trust the release channel (GitHub Releases from this repository)

## Soft open-source note

See [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md). Pre-1.0 does not mean “ignore security”—report issues privately as above.
