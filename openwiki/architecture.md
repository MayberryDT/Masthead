# Architecture

Masthead is built as a thin desktop shell around a local daemon and a canonical SQLite store. The repository is intentionally split so that runtime concerns stay in the right layer:

- `src/electron` owns desktop windowing, tray, IPC, process launch, and packaged-app behavior.
- `src/app` owns renderer state, surfaces, and data-fetch orchestration.
- `src/daemon` owns HTTP APIs, persistence, source discovery/import, health, and runtime diagnostics.
- `src/core` holds pure domain logic and reducers used by the daemon and UI.
- `src/enrichment` turns canonical sessions into durable summaries and search projections.
- `src/mcp` exposes read-only access to the same database over stdio MCP.

## Runtime shape

A typical local run starts from `npm run dev` or `npm run dev:desktop`.

- Electron launches the app shell and can own daemon lifecycle in desktop mode.
- The daemon binds to `127.0.0.1:17373` by default and serves the live projection plus the local HTTP API.
- The renderer consumes the daemon through typed clients in `src/app/daemonClient.ts`, `src/app/liveProjectionClient.ts`, and related helpers.
- The MCP server is separate from the ingest daemon. It requires `MASTHEAD_DB_PATH` and reads the same canonical store.

The repository’s main data-flow summary is:

```text
source files / hooks / local scans
  -> daemon source discovery and import
  -> canonical SQLite session graph
  -> live projection, Logbook, dossiers, search, usage, settings
  -> enrichment / search projections
  -> read-only MCP retrieval
```

## Renderer and shell

`src/app/App.tsx` is the top-level renderer coordinator. It:

- tracks active surfaces and board filters,
- wires the sources controller,
- manages first-run onboarding visibility,
- handles collector autostart state and startup log entries,
- consumes live projection, logbook, usage, and session detail data.

The Electron main process (`src/electron/main.ts`) is responsible for:

- creating the BrowserWindow,
- registering the custom protocol,
- owning desktop tray behavior,
- launching or stopping owned daemon processes,
- smoke-test startup paths such as renderer-triggered collector autostart.

## Daemon and core

The daemon is the runtime owner of canonical state.

- `src/daemon/main.ts` starts the ingest server and background hydration.
- `src/daemon/server.ts` wires the HTTP API and the database-backed services.
- `src/daemon/sources/sourceSetupService.ts` derives source setup status and onboarding-friendly scan results.
- `src/core/ingestion.ts`, `src/core/liveProjection.ts`, and `src/core/sessionReducer.ts` provide the pure transformations that turn events into board/session state.

`src/core/index.ts` re-exports the shared domain helpers. The files under `src/core` are where the business rules are easiest to inspect when changing attention, conflicts, outcomes, redaction, or session history behavior.

## Enrichment and MCP

Enrichment is a separate derived-data pipeline.

- `src/enrichment/enrichmentCoordinator.ts` builds session facts, calls providers, writes `session_capsule`, `live_summary`, and `search_projection`, and avoids needless rewrites when the fingerprint is unchanged.
- The enrichment code treats transcript-rich and transcript-poor sessions differently, so output quality is evidence-sensitive.

MCP is a read-only boundary.

- `src/mcp/server.ts` opens the active database and handles stdio requests.
- `src/mcp/protocol.ts`, `src/mcp/tools.ts`, and `src/mcp/sessionRetrieval.ts` define the model-facing retrieval surface.
- The MCP server is intentionally separate from the local ingest daemon; it is for retrieval, not mutation.

## What to watch out for

- Do not blur the daemon/core boundary. Core should stay as pure as possible; daemon owns storage and process state.
- Do not treat Electron as the source of truth for product data. It is a shell around the daemon and renderer.
- Keep onboarding logic aligned between renderer state and daemon setup status; the first-run flow spans both layers.
- Keep `MASTHEAD_DB_PATH` and `MASTHEAD_DATA_DIR` semantics consistent across daemon, MCP, and desktop launch code.
- Use `design.md` and `prd.md` as the product and UI contract before changing screens or workflows.
