# Architecture

Masthead is built as a thin desktop shell around a local daemon and a canonical SQLite store. The repository is intentionally split so that runtime concerns stay in the right layer:

- `src/electron` owns desktop windowing, tray, IPC, process launch, and packaged-app behavior.
- `src/app` owns renderer state, surfaces, and data-fetch orchestration.
- `src/daemon` owns HTTP APIs, persistence, source discovery/import, health, and runtime diagnostics.
- `src/core` holds pure domain logic and reducers used by the daemon and UI.
- `src/enrichment` turns canonical sessions into durable summaries and search projections.
- `src/workbench` owns the raw→ready session pipeline (state, quality, claims, activity).
- `src/mcp` exposes read-only access to the same database over stdio MCP (artifact-primary reuse).

## Runtime shape

A typical local run starts from `npm run dev` or the Electron Dev launcher (`npm run install:electron-dev-launcher` from the intended checkout).

- Electron launches the app shell and can own daemon lifecycle in desktop mode.
- The daemon binds to `127.0.0.1:17373` by default and serves the live projection plus the local HTTP API.
- The renderer consumes the daemon through typed clients in `src/app/daemonClient.ts`, `src/app/liveProjectionClient.ts`, and related helpers.
- The MCP server is separate from the ingest daemon. It requires `MASTHEAD_DB_PATH` and reads the same canonical store.

The repository’s main data-flow summary is:

```text
source files / hooks / local scans
  -> daemon source discovery and live ingest
  -> canonical SQLite session graph
  -> Now projection (shallow live cards)
  -> Workbench pipeline (session readiness + multi-kind compile/publish)
  -> published artifacts (session_dossier, runbook, adr, incident_timeline)
  -> Logbook UI + artifact-primary MCP retrieval
```

## Renderer and shell

`src/app/App.tsx` is the top-level renderer coordinator. It:

- tracks active surfaces and board filters,
- wires Sources, Workbench, Logbook, and settings controllers,
- manages first-run onboarding visibility,
- handles collector autostart state and startup log entries,
- consumes live projection, logbook artifacts, and session detail data.

The renderer Usage tab and sidebar Today statistics are retired. The daemon usage endpoint may
remain for compatibility or internal consumers, but it is not a primary renderer surface.

Surface modules (do not force Now card DOM onto every surface):

- Logbook: `src/ui/logbook/`, `src/app/logbook/` — artifact search + body/provenance inspector.
- Workbench: `src/ui/workbench/`, `src/app/workbench/` — package path ops table + Activity rail.
- Sources: `src/ui/sources/` — live connector rows.
- Now/Board: session cards over `/projection`.

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
- `src/daemon/db/sessionArtifactRepository.ts` / `logbookArtifactRepository.ts` own published artifact capsules and search.
- `src/daemon/sources/` derives source setup, preflight, and harness connector snapshots.
- `src/core/ingestion.ts`, `src/core/liveProjection.ts`, and `src/core/sessionReducer.ts` provide pure transformations that turn events into board/session state.

`src/core/index.ts` re-exports shared domain helpers. Keep the live hook adapter (`src/core/liveHookAdapter.ts`) and board-headline framing in sync with UI/daemon changes that depend on them. Session-ended desktop notifications live in the renderer; **Logbook no longer has bulk-enrich selection** — detail open is single-artifact via `getLogbookArtifact`.

## Enrichment, Workbench, and MCP

Enrichment is a derived-data pipeline used on the Workbench path:

- `src/enrichment/enrichmentCoordinator.ts` builds session facts, calls providers, writes capsules/summaries/search projections, and avoids needless rewrites when the fingerprint is unchanged.
- Workbench apply paths and agent CLI write validated enrichment/dossier/kind outputs; **apply ≠ publish**.

MCP is a read-only boundary:

- `src/mcp/server.ts` opens the active database and handles stdio requests.
- Prefer `search_artifacts` / `get_artifact` for knowledge reuse; session tools remain for evidence/compile.
- The MCP server is intentionally separate from the local ingest daemon; it is for retrieval, not mutation.

## What to watch out for

- Do not blur the daemon/core boundary. Core should stay as pure as possible; daemon owns storage and process state.
- Do not treat Electron as the source of truth for product data. It is a shell around the daemon and renderer.
- Keep Logbook and Workbench product language aligned with ADR 0011 and `docs/internal/CONTEXT.md`.
- Keep `MASTHEAD_DB_PATH` and `MASTHEAD_DATA_DIR` semantics consistent across daemon, MCP, and desktop launch code.
- After moving checkouts, re-run `npm run install:electron-dev-launcher` so Masthead Dev is not stuck on a stale worktree path.
- Use `docs/internal/design.md` for visual contract and `docs/internal/CONTEXT.md` + ADR 0011 for Logbook/Workbench product truth.
