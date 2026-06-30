# Masthead

Masthead is a local-first, harness-neutral session data layer and session manager
for AI-agent work. It discovers local harness history, imports it into a
canonical SQLite session graph, makes it searchable in Logbook, and exposes
bounded historical context to existing agents through read-only MCP tools.

Masthead starts Codex-first because one complete adapter loop is more useful
than shallow support for many runtimes. The core model remains adapter-neutral.
Live Now is a view over collected session data, not the product category.

## Stable Today

- Canonical local SQLite ownership for Masthead-owned sessions, source state,
  import jobs, search records, settings, and MCP audit rows.
- Multi-adapter source discovery for Codex, Cursor, Claude Code,
  Antigravity, OpenCode, Aider, OpenClaw, Hermes, and Pi, with conservative
  metadata imports and reviewed transcript history.
- A harness catalog that also names detector-only local harnesses and
  cloud-reference harnesses without claiming import support before local
  schema coverage exists.
- Logbook search and session detail APIs backed by the canonical store.
- Shared Board and Logbook session dossier backed by canonical identity,
  coverage diagnostics, transcript rows, files, tools, verification, timeline,
  usage, and provenance.
- Read-only local MCP access for search, bounded session retrieval, project
  history, and coverage counts.
- `npm run dev` launcher that starts either a writable daemon or a read-only
  worktree bridge as needed.
- `npm run dev:desktop` Electron/Chromium desktop shell for app-menu and
  packaged-app workflows.
- Product, surface, endpoint-matrix, doctor, smoke, build, and test gates.

## Experimental

- Deeper schema coverage for additional source adapters beyond the initial
  bounded scanners.
- Transcript import breadth and exclusion policy tuning.
- Optional remote enrichment. It is off by default and must stay scoped,
  redacted, previewable, strict, and auditable when enabled. Remote provider
  failures are surfaced in diagnostics and dossier provenance instead of being
  silently replaced by local copy.
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
- Enrichment reference: [docs/reference/enrichment.md](docs/reference/enrichment.md)
- Session dossier reference: [docs/reference/session-dossier.md](docs/reference/session-dossier.md)
- Configuration reference: [docs/reference/configuration.md](docs/reference/configuration.md)
- Release gates: [docs/release-gates.md](docs/release-gates.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
