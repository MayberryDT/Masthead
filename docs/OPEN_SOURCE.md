# Soft open-source release

Masthead is **soft open source**: public under the MIT license so others can inspect, run, and contribute, while the product remains **pre-1.0** and actively evolving.

## What “soft” means here

- **Public source, MIT license** — free to use, modify, and redistribute under [LICENSE](../LICENSE)
- **Not a finished platform promise** — APIs, SQLite schema, CLI commands, and UI surfaces may change without a long deprecation cycle until 1.0
- **Desktop-first install** — preferred path is a packaged app from [GitHub Releases](https://github.com/MayberryDT/Masthead/releases/latest); source install remains fully supported
- **Not an npm library publish (yet)** — `package.json` stays `"private": true` until a deliberate one-line / package publish story lands (see [ROADMAP.md](../ROADMAP.md))
- **Local-first privacy model** — core operation does not require a Masthead cloud account; session databases, hooks, and harness files stay on machines you control
- **Selective PRs** — issues are the main intake; large or category-expanding PRs should be discussed first ([CONTRIBUTING.md](../CONTRIBUTING.md))

## Privacy and contribution boundaries

- Do not open issues or PRs that include private session transcripts, production databases, API keys, or customer data
- Prefer sanitized fixtures — see [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md)
- MCP remains read-only for the launch surface; do not add write tools without an explicit product decision

## Repository front door vs archive

Public orientation lives in the root README, community files, OpenWiki, and release artifacts.

Historical specs and research sit under [docs/archive/](archive/) and are **not** current product direction.

Agent-oriented language for contributors who work in-tree:

- [CONTEXT.md](internal/CONTEXT.md)
- [AGENTS.md](internal/AGENTS.md)
- [design.md](internal/design.md)

## What maintainers still own

- Product direction and release identity (`package.json` version + GitHub Releases)
- Accepting or rejecting PRs that expand scope beyond the session data layer / Workbench / Logbook / Sources model
- Security triage via private advisories

## Getting help

- Bugs and feature requests: GitHub Issues
- Security: GitHub Security Advisories ([SECURITY.md](../SECURITY.md))
- Product map: [openwiki/quickstart.md](openwiki/quickstart.md)
