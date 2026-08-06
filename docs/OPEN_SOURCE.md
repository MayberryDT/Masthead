# Soft open-source release

Masthead is released as **soft open source**: the source is public under the MIT license so others can inspect, run, and contribute, while the product remains **pre-1.0** and actively evolving.

## What “soft” means here

- **Public source, MIT license** — free to use, modify, and redistribute under [LICENSE](../LICENSE).
- **Not a finished platform promise** — APIs, SQLite schema, CLI commands, and UI surfaces may change without a long deprecation cycle until 1.0.
- **Not an npm library publish** — `package.json` stays `"private": true`. Install from Git and build locally (or use packaged desktop artifacts you produce yourself).
- **Local-first privacy model** — core operation does not require a Masthead cloud account. Your session databases, hooks, and harness files stay on machines you control.
- **Dogfood and acceptance history stay in-tree** — `docs/acceptance/` and older plans document how the product was proven; they are evidence, not end-user manuals.

## Privacy and contribution boundaries

- Do not open issues or PRs that include private session transcripts, production databases, API keys, or customer data.
- Prefer sanitized fixtures. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).
- MCP remains read-only for the launch surface; do not add write tools without an explicit product decision.

## What maintainers still own

- Product direction and release identity (`package.json` version).
- Accepting or rejecting PRs that expand scope beyond the session data layer / Workbench / Logbook / Sources model described in the README and OpenWiki.
- Security triage via private advisories.

## Getting help

- Bugs and feature requests: GitHub Issues on this repository.
- Security: GitHub Security Advisories (see SECURITY.md).
- Product map: [openwiki/quickstart.md](../openwiki/quickstart.md).
