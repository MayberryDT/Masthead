# Security Policy

## Supported Versions

Masthead is pre-1.0. Security fixes target the current `main` branch and the current package version line shown in `package.json`.

## Reporting a Vulnerability

Do not open a public issue with exploit details, private logs, local database contents, secrets, or raw session transcripts.

Use GitHub Security Advisories for private reporting. Include:

- Affected version or commit.
- Operating system and install mode.
- Steps to reproduce with sanitized data.
- Whether local data, source harness files, MCP access, or hook configuration are involved.

## Security Boundaries

- Core functionality is local-first and should not require accounts, cloud databases, or mandatory remote services.
- MCP is read-only for launch.
- Source harness files and Git repositories remain externally owned.
- Remote enrichment is optional and must stay scoped, redacted, previewable, and auditable.
- Reset and retention operations must report whether external state was touched.
