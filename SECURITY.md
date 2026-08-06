# Security Policy

## Supported Versions

Masthead is **pre-1.0** (soft open source). Security fixes target the current `main` branch and the package version line shown in `package.json`.

## Reporting a Vulnerability

Do **not** open a public issue with exploit details, private logs, local database contents, secrets, or raw session transcripts.

Use **GitHub Security Advisories** for private reporting on this repository. Include:

- Affected version or commit.
- Operating system and install mode (dev launcher vs packaged desktop).
- Steps to reproduce with **sanitized** data.
- Whether local data, source harness files, MCP access, or hook configuration are involved.

## Security Boundaries

- Core functionality is **local-first** and should not require Masthead accounts, cloud databases, or mandatory remote services.
- MCP is **read-only** for the launch surface.
- Source harness files and Git repositories remain externally owned.
- Optional remote enrichment (if enabled) must stay scoped, redacted, previewable, and auditable.
- Reset and retention operations must report whether external harness state was touched.
- Hooks and connectors run with the privileges of the local user; treat them as part of your security boundary.

## Soft open-source note

See [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) for product maturity expectations. Pre-1.0 does not mean “ignore security”—report issues privately as above.
