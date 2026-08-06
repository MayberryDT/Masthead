# Masthead

**Local-first session data for AI coding agents.**

Masthead captures work from local agent harnesses (Codex, Claude Code, Cursor, and others), stores it in a canonical SQLite database, and turns selected sessions into **published knowledge artifacts**—dossiers, runbooks, ADRs, and incident timelines—that people and agents can search and reuse.

It is not a chat client, live monitoring tower, analytics dashboard, or task manager. Observability is a view over continuously collected session data.

| Surface | Role |
| --- | --- |
| **Sources** | Discover and enable live harness connectors |
| **Workbench** | Raw session → quality → agent authoring → publish |
| **Logbook** | Published artifacts only (not a session library) |
| **MCP** | Read-only, artifact-primary tools for other agents |
| **Now** | Shallow live presence |

## Status

Soft open-source, **pre-1.0** (`package.json` version is the source of truth; currently **0.1.15**).

- MIT licensed.
- Local-first by design: no required cloud account or remote database for core use.
- APIs, schema, and UI can still change; treat this as early access for builders and dogfooders.
- Packaged desktop builds are available for Linux and macOS (macOS packaging is adhoc-signed unless you supply your own Apple identity).

See [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) for soft-release expectations and privacy boundaries.

## Requirements

- **Node.js** `>= 24.15.0` (see `package.json` `engines`)
- Linux, macOS, or Windows for development; Electron packaging is best tested on the target OS

## Install and run

```bash
git clone https://github.com/MayberryDT/Masthead.git
cd Masthead
npm install
npm run dev
```

`npm run dev` starts the local daemon (default `http://127.0.0.1:17373`) and the UI on the first free Vite port starting at `5173`. Open the URL printed in the terminal.

Useful overrides:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
```

Desktop (Electron) from a checkout:

```bash
npm run install:electron-dev-launcher   # once per checkout path
npm run dev:electron
```

Packaged release build:

```bash
npm run build:electron
```

macOS packaging notes: [docs/reference/macos-release-build.md](docs/reference/macos-release-build.md).

## First hour

1. Run `npm run dev` and open the UI.
2. Open **Sources**, discover local harnesses, enable and test connectors you use.
3. Import history where offered (transcript import may require explicit approval—it can contain private work).
4. Use **Workbench** to select sessions and drive enrichment / V5 pack authoring with your coding agent.
5. Read published results in **Logbook**; query via read-only **MCP** if you attach Masthead to an agent.

Tutorials and how-tos:

- [First run / Codex import](docs/tutorials/first-run-codex-import.md)
- [Import Codex history](docs/how-to/import-codex-history.md)
- [Reset local data](docs/how-to/reset-local-data.md)
- [OpenWiki quickstart](openwiki/quickstart.md) — product map for humans and coding agents

## Product model (short)

1. **Canonical session database** — local SQLite owned by the Masthead daemon.
2. **Workbench** — raw → ready pipeline: transcript checks, quality, agent-authored enrichment, optional multi-kind artifacts, atomic publish.
3. **Logbook** — published artifacts only (`session_dossier`, `runbook`, `adr`, `incident_timeline`).
4. **Read-only MCP** — prefer `search_knowledge` / `get_knowledge`; session tools for evidence.
5. **Now** — shallow live cards over collected data.
6. **Sources V2** — harness live-connect (Discover → Enable → Activate → Test).

Vocabulary: [CONTEXT.md](CONTEXT.md). Logbook unit of search: [ADR 0011](docs/adr/0011-artifact-first-logbook.md). Current authoring contract: [ADR 0016](docs/adr/0016-agent-led-v5-pack-authoring.md).

### V5 authoring (summary)

**Select sessions → Copy Agent Prompt → paste request ID + start command into one coding agent → finish every pack → reuse artifacts in Logbook/MCP.**

The agent owns prose fields (title, description, keywords, purpose, outcome, key work, verification, optional-artifact judgment). Masthead owns identity, evidence catalogs, validation, Activity, atomic publication, and receipts. Details: [ADR 0016](docs/adr/0016-agent-led-v5-pack-authoring.md), [daemon API](docs/reference/daemon-api.md).

## Data location

`MASTHEAD_DATA_DIR` owns the writable daemon directory. Defaults:

```text
Linux:   ~/.local/share/masthead-dev
macOS:   ~/Library/Application Support/Masthead Dev
Windows: %LOCALAPPDATA%/Masthead Dev
```

Canonical store: `masthead.sqlite` inside that directory. Harness files and Git repos stay owned by their original tools.

See [docs/architecture/data-paths.md](docs/architecture/data-paths.md).

## MCP boundary

Launch MCP is **read-only**. It can search knowledge and return bounded evidence; it cannot mutate files, Git, shell state, harness sessions, imports, settings, or Masthead data.

See [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

## Verify (contributors)

```bash
npm run doctor
npm run check:product-contract
npm run verify:no-citations
```

Full local gate:

```bash
npm run verify
npm run test:electron
npm run test:electron-security
```

Release checklist: [docs/acceptance/product-release-gate.md](docs/acceptance/product-release-gate.md).

## Documentation map

| Doc | Audience |
| --- | --- |
| [openwiki/quickstart.md](openwiki/quickstart.md) | Fast product/architecture map |
| [design.md](design.md) | Visual / UI design source of truth |
| [prd.md](prd.md) | Product scope (read with ADR supersession notes) |
| [docs/reference/](docs/reference/) | APIs, Sources, configuration, MCP |
| [docs/adr/](docs/adr/) | Architecture decisions |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents working in this repo |
| [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md) | Soft open-source expectations |

Historical plans under `docs/superpowers/plans/` and many files under `docs/acceptance/` are **implementation or dogfood history**, not current visual direction.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please open issues for bugs and proposals; keep PRs focused; do not commit secrets, private transcripts, or local databases.

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately via GitHub Security Advisories—not public issues with exploit detail or private logs.

## License

[MIT](LICENSE) — Copyright (c) 2026 Masthead contributors.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
