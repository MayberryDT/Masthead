# Masthead

Masthead is a local-first, harness-neutral session data layer for AI-agent work.
It captures local harness history into a canonical SQLite session graph, runs a
Workbench raw→publish pipeline, stores **published knowledge as artifacts** in
Logbook, and exposes that knowledge to existing agents through read-only MCP
tools (artifact-primary).

Sessions remain the unit of capture and Workbench pipeline. **Logbook rows are
published artifacts** (session dossiers, runbooks, ADRs, incident timelines),
not session table rows. Live Now is a shallow view over collected session data,
not the product category.

Start with agents: `openwiki/quickstart.md`, `CONTEXT.md`, and
`docs/adr/0011-artifact-first-logbook.md`.

## Stable Today

- Canonical local SQLite ownership for Masthead-owned sessions, published
  artifacts + provenance, source/connector state, import jobs, settings, and MCP
  audit rows (schema 18+ for artifact-first Logbook).
- Multi-adapter / multi-harness live connect (Sources V2) and conservative
  history adapters where coverage exists.
- Workbench package path: transcript checks/import, quality, claims, Activity,
  disposable agent handoffs, **session package publish**, and multi-kind
  resolution (runbook / ADR / incident timeline or N/A).
- Logbook artifact book: `GET /logbook/artifacts` + body/provenance inspector;
  filters kind · project · date · search; no bulk enrich / checkboxes / summary strip.
- Read-only MCP with **`search_artifacts` / `get_artifact`** preferred for reuse;
  session/transcript tools for evidence and compile.
- `npm run dev` launcher (writable daemon or read-only worktree bridge).
- Electron Dev desktop launcher (`npm run install:electron-dev-launcher` from the
  checkout you intend to run — path is hardwired into the desktop entry).
- Product, surface, endpoint-matrix, doctor, smoke, build, and test gates.

## Experimental

- Deeper schema coverage for additional source adapters beyond the initial
  bounded scanners.
- Transcript import breadth and exclusion policy tuning.
- Legacy/dev native remote enrichment hooks. Masthead V1 launch enrichment uses
  user-facing Workbench handoffs plus an agent-facing CLI write path; no native
  remote model key is required.
- Longer packaged desktop release-smoke automation.

## Install

Masthead requires Node 24.15 or newer.

```bash
npm install
```

## Run

Use the harness-neutral launcher from this checkout or any Masthead worktree:

```bash
npm run dev
```

The launcher starts the daemon on `127.0.0.1:17373` and the UI on the first
available Vite port starting at `5173`. If another compatible primary daemon is
already running, a secondary worktree starts a read-only bridge instead of
opening the primary database for writes.

Useful overrides:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
MASTHEAD_BRIDGE_PORT=17374 npm run dev
```

## Verify

Fast product checks:

```bash
npm run check:product-contract
npm run verify:no-citations
npm run doctor
```

Full local gate:

```bash
npm run verify
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run smoke:electron:packaged
```

`npm run doctor` checks the active daemon contract, source/import readiness,
Sources pipeline diagnostics, Logbook state, MCP status/tools, and local data
summary. `npm run verify` runs the product and surface contracts, typecheck,
Vitest, build, endpoint matrix, and smoke suite.

## Data Path

`MASTHEAD_DATA_DIR` owns the runtime directory for a writable daemon. By
default, development data is stored under:

```text
Linux:   ~/.local/share/masthead-dev
macOS:   ~/Library/Application Support/Masthead Dev
Windows: %LOCALAPPDATA%/Masthead Dev
```

Inside that directory, `masthead.sqlite` is the canonical Masthead store.
Legacy NDJSON files are migration or compatibility inputs, not the runtime
source of truth. Source harness files and Git repositories remain owned by
their original tools.

See [docs/architecture/data-paths.md](docs/architecture/data-paths.md).

## MCP Boundary

The launch MCP server is read-only. It can search sessions, return bounded
session evidence, list project history, and report coverage. It cannot mutate
files, Git, shell state, harness sessions, source imports, settings, or
Masthead data.

See [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

## Start Here

- First run: [docs/tutorials/first-run-codex-import.md](docs/tutorials/first-run-codex-import.md)
- Import existing Codex history: [docs/how-to/import-codex-history.md](docs/how-to/import-codex-history.md)
- Reset local Masthead data: [docs/how-to/reset-local-data.md](docs/how-to/reset-local-data.md)
- Daemon API reference: [docs/reference/daemon-api.md](docs/reference/daemon-api.md)
- Sources reference: [docs/reference/sources.md](docs/reference/sources.md)
- Adapter reference: [docs/reference/adapters.md](docs/reference/adapters.md)
- Workbench enrichment reference: [docs/reference/enrichment.md](docs/reference/enrichment.md)
- Session dossier reference: [docs/reference/session-dossier.md](docs/reference/session-dossier.md)
- Configuration reference: [docs/reference/configuration.md](docs/reference/configuration.md)
- Release gates: [docs/release-gates.md](docs/release-gates.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
