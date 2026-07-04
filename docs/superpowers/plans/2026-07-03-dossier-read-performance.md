# Dossier Read Performance Implementation Plan

> **Status:** Implemented on 2026-07-03.

**Goal:** Make `GET /sessions/:id/dossier` reliably return from the live Masthead database without wedging the daemon in disk wait, even while background enrichment is active.

**Finding:** `getSessionDossier` was fast in isolation after the first repository fix, but the live daemon still timed out because background enrichment used a slow `tool_calls LEFT JOIN tool_results` query. On the live 7.6 GB dev database, SQLite created a temporary automatic index for `tool_results.tool_call_id`, which blocked the single Node process and delayed unrelated HTTP requests.

## Implementation

- [x] Profile the live Dossier route and direct repository reads.
  - Direct `getSessionDossier` returned in roughly 120 to 230 ms.
  - Live route took 8 to 28 seconds and left the daemon in disk wait.
  - `/proc/$pid/wchan` showed disk wait and the process held a SQLite temp file.

- [x] Fix Dossier tool retrieval.
  - Select the bounded set of Dossier tool calls first.
  - Fetch latest matching tool results in a second bounded query.
  - Add a regression proving multiple tool results cannot consume the 100-tool Dossier budget.

- [x] Prevent repeated hook transcript catch-up from Dossier opens.
  - Skip hook transcript catch-up when useful user and assistant transcript messages are already current relative to the hook event.
  - Add an API regression proving stale hook transcript rows are not re-imported on every Dossier open.

- [x] Fix background enrichment command facts.
  - Select the latest 50 tool calls first.
  - Fetch matching latest tool results second.
  - Add a regression proving multiple tool results cannot consume the 50-command enrichment budget.

- [x] Add durable SQLite indexes.
  - `tool_results_tool_call_completed_idx` for tool-call result lookup.
  - `tool_results_session_status_idx` for session list and error-count lookups.
  - `runtime_signals_session_observed_idx` for Dossier and narrative signal lookups.
  - `checkpoints_session_observed_idx` for Dossier and narrative checkpoint lookups.
  - Use migration version 13 because the live dev database already had a historical version 12 marker named `012_session_enrichment_chunks`.

## Verification

- [x] `npm run typecheck`
- [x] `npm test -- --run`, 204 files and 1040 tests passed.
- [x] Live migration applied to the dev database in about 0.36 seconds.
- [x] Previous slow enrichment command path dropped from about 7.5 seconds to about 12 ms through `buildSessionFacts`.
- [x] Recent live Dossier route returned in about 70 ms.
- [x] Old sparse Dossier route returned in about 3 ms.
- [x] Daemon stayed responsive after Dossier reads; health remained sub-2 ms.

## Follow-Up Watchpoints

- Keep future Dossier and enrichment queries bounded before joining high-volume auxiliary tables.
- Avoid relying on SQLite automatic indexes in request or enrichment paths.
- If startup background work becomes noisy again, profile route latency alongside background enrichment queue work before adding more UI-side retries.
