# Data and integrations

This page covers the canonical local store, the daemon HTTP surface, the MCP boundary, and derived data from enrichment.

## Canonical data path

Masthead uses one runtime data directory per writable daemon. The canonical store is `masthead.sqlite` inside that directory. `docs/architecture/data-paths.md` is the clearest summary of the runtime ownership rules.

The main idea is simple:

- source files and harness histories remain owned by the original tool,
- Masthead imports and normalizes the useful parts,
- the SQLite store becomes the source of truth for Masthead-owned data,
- read-only consumers read from that canonical store.

Live connector events are part of that flow too: `src/daemon/server.ts` routes ingest by runtime, and `src/core/liveIdentity.ts` scopes canonical live sessions by host plus runtime so Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode can share a source session ID without colliding.

## Daemon API

The local HTTP daemon is the main integration surface for the app, smoke tests, doctor, and worktree bridge. `src/daemon/server.ts` implements the API; `docs/reference/daemon-api.md` lists the endpoints.

A few important contracts:

- `GET /health` is the compatibility oracle,
- `GET /projection` serves the live Now projection,
- `GET /sessions`, `GET /projects`, `GET /imports`, and related endpoints expose canonical reads,
- `GET /settings/hooks` exposes live connector status and installer/test/uninstall controls for Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode,
- runtime-specific `/settings/hooks/:runtime` routes manage one connector at a time for the non-Codex release targets,
- write endpoints like `/ingest`, `/sources/connect`, `/imports`, `/data/delete`, and hook-management routes stay local to the daemon and are not exposed through MCP.

`POST /ingest` defaults to Codex. Other release target hooks use the runtime query parameter or header so live data is stored under the correct runtime-specific source and canonical session identity. Connector tests now hit a validation-only ingest variant (`validate=1` or `dryRun=true`) so installer/test flows can verify the hook path without mutating the canonical store. The live hook normalizer in `src/core/liveHookAdapter.ts` now hardens the hook boundary by rejecting oversized payloads, validating runtime support, redacting raw prompt/output fields, and mapping each runtime’s event vocabulary into the canonical event model before ingest. The runtime profiles in `src/adapters/live/runtimeProfiles.ts` keep Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode events aligned before they reach the canonical store.

`src/enrichment/enrichmentCoordinator.ts` writes `session_capsule`, `live_summary`, and `search_projection` together in one transaction after a successful provider response. It records durable audit events for the start, facts, provider response, failure, and persisted states, and it skips rewriting a current capsule when the content fingerprint and provider still match. When a provider result is weak for a transcript-rich session, the coordinator falls back to the deterministic enrichment path rather than treating the current capsule as authoritative. The logbook bulk-enrich flow now calls the daemon with a `sessionIds` scope so selected sessions can be rebuilt in one request instead of reusing a single-session path.

`src/core/liveIdentity.ts` now scopes live projection sessions by host, runtime, and source session ID, so identical source IDs from different runtimes remain distinct in the canonical store. That identity shape is also what the live projection and replay logic use when they scope events and snapshots for projection.

`src/daemon/codexTranscriptLive.ts` adds a lightweight Codex transcript scanner that watches the most recently updated `.codex/sessions/**/*.jsonl` file under the configured home directory. `/projection` now refreshes that scanner before building the board, which means a recent desktop transcript can surface as a live Codex session even before a transcript import is approved. The scanner emits metadata-only events and redacts prompt text; it is a live projection aid, not a replacement for the explicit Sources import flow.

## MCP

`src/mcp/server.ts` starts a stdio MCP server and requires `MASTHEAD_DB_PATH`.

The MCP layer is intentionally read-only:

- it opens the active Masthead database,
- exposes retrieval/tools over the same canonical data,
- writes audit rows for access,
- does not mutate Masthead state, source state, Git, or shell state.

That makes MCP the model-facing retrieval boundary rather than another control plane.

## Enrichment

`src/enrichment/enrichmentCoordinator.ts` turns session facts into durable derived records. It writes three kinds of enrichment artifacts:

- `session_capsule`
- `live_summary`
- `search_projection`

The enrichment pipeline is evidence-sensitive. It fingerprints the facts for a session and avoids rewriting a current result when the fingerprint and provider match. It also backs off after recent failures.

## Identity and privacy notes

- `src/core/sessionReducer.ts`, `src/core/liveProjection.ts`, and related core files define the pure session model and live board behavior.
- `src/core/redaction.ts` and the enrichment/MCP code are where evidence should be bounded and privacy-aware.
- The docs explicitly avoid `.env` values and secrets; configuration references should stay at the variable/behavior level only.

## What to watch out for

- Keep the writable daemon and read-only MCP roles separate in docs and code changes.
- Don’t treat enrichment as raw storage; it is derived data that depends on canonical facts.
- Keep the data-path docs consistent with the current runtime behavior of `MASTHEAD_DATA_DIR` and `MASTHEAD_DB_PATH`.
- If you change what is persisted, check the repository’s data lifecycle and retention behavior before assuming the new data should be long-lived.
