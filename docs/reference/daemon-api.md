# Daemon API Reference

The daemon API is the local HTTP contract used by the UI, smoke tests, doctor, and worktree bridge. `/health` is the compatibility oracle.

Default base URL:

```text
http://127.0.0.1:17373
```

## Compatibility

- `GET /health` returns product identity, API version, schema version, build info, capabilities, runtime identity, writable/read-only state, data directory, database path, database ID, migration state, live counts, and compatibility URLs.

Clients should reject a daemon that does not identify `product: "masthead"` with a supported API version and required capabilities.

## Read Endpoints

- `GET /projection` returns the live Now projection from collected session data.
- `GET /sources` discovers and returns source statuses.
- `GET /adapters` returns adapter statuses.
- `GET /sources/scan/latest` returns the latest multi-adapter scan result, or runs a bounded scan if none is cached.
- `GET /diagnostics/runtime` returns runtime diagnostics, import queue state, and a small active import page for Advanced diagnostics.
- `GET /sessions` searches canonical sessions. Query params include `q`, `project`, `runtime`, `host`, `model`, `state`, date filters, and `limit`.
- `GET /sessions/:sessionId` returns one session detail.
- `GET /sessions/:sessionId/excerpts` returns bounded excerpts, with optional `q` and `limit`.
- `GET /sessions/:sessionId/dossier` returns the canonical session dossier used by Board and Logbook detail views.
- `GET /sessions/:sessionId/transcript` returns paginated canonical transcript items from messages, tools, checkpoints, runtime signals, and file effects. Query params include `cursor`, `limit`, `kind=all|user|assistant|tools|checkpoints|files|signals`, and `q`.
- `GET /projects` lists known projects.
- `GET /imports` lists import jobs.
- `GET /imports/:importJobId` returns one import job.
- `GET /data/summary` returns Masthead-owned data counts for a scope.
- `GET /data/export` exports the local session graph.
- `GET /usage/summary?window=today|24h|7d|30d|all` returns canonical usage totals, token aggregates, model/project/runtime breakdowns, activity buckets, and source coverage. It does not estimate cost.
- `GET /mcp/status` returns MCP readiness, permissions, and audit summary.
- `GET /mcp/launch-config` returns the stdio launch config for the active database.
- `GET /mcp/tools` lists read-only MCP tool metadata.
- `GET /mcp/audit` lists recent MCP audit rows.
- `GET /settings` returns settings state.
- `GET /settings/hooks` returns live connector settings for the release target runtimes.
- `GET /settings/hooks/codex` returns Codex hook settings.
- `GET /settings/hooks/:runtime` returns one runtime live connector setting for `codex`, `claude_code`, `cursor`, `grok`, or `opencode`.

## Write Endpoints

Write endpoints are local daemon operations. They are not exposed through MCP.

- `POST /ingest` accepts live hook payloads. It defaults to Codex and accepts `?runtime=claude_code|cursor|grok|opencode` or `x-masthead-runtime` for the other release target runtimes. When a Codex hook includes `transcriptPath`, transcript import has been approved, and `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP` is not `0`, the daemon schedules a bounded catch-up import for that transcript file so live sessions receive canonical messages and token usage. The daemon also performs a bounded recovery sweep for recent stored hook events with transcript paths after transcript approval and on startup.
- `POST /sources/discover` refreshes source discovery.
- `POST /sources/scan` scans known local agent-history locations for all active adapters. It is read-only and allowed through the worktree bridge.
- `POST /sources/connect` connects selected scan results and queues metadata/enrichment jobs. Transcript import requires explicit approval.
- `POST /sources/codex/import-metadata` queues Codex metadata import.
- `POST /sources/codex/approve-transcripts` records transcript import approval.
- `POST /sources/codex/import-transcripts` queues Codex transcript import after approval.
- `POST /adapters/:runtime/import-metadata`, `/approve-transcripts`, `/import-transcripts`, and `/sync` queue adapter-shaped source work for active runtimes.
- `POST /imports` queues an import for `{ "sourceId": "...", "kind": "metadata" | "transcript" }`.
- `POST /imports/:importJobId/cancel` cancels an import job.
- `POST /imports/:importJobId/retry` queues a retry.
- `PUT /sources/:sourceId/policies` updates source policy state.
- `POST /sources/exclusions` adds an import exclusion.
- `POST /review-dispositions` writes local review state.
- `POST /data/delete` deletes Masthead-owned local data by scope.
- `POST /data/retention/default` applies default retention.
- `POST /retention` prunes legacy compatibility journals.
- `POST /clear` clears Masthead-owned canonical and compatibility state.
- `POST /settings/hooks/codex/install`, `/uninstall`, and `/test` preserve compatibility and manage the release target live connector set.
- `POST /settings/hooks/:runtime/install`, `/uninstall`, and `/test` manage one live connector for `claude_code`, `cursor`, `grok`, or `opencode`.
- `POST /mcp/launch-config/validate` validates a candidate MCP launch config.
- `POST /mcp/test-connection` starts and probes a candidate MCP server.

## Verification

```bash
npm run doctor
npm run check:endpoint-matrix
```

`npm run doctor:json` includes a `sources-pipeline` check with scan freshness, connected source count, transcript coverage, enrichment coverage, import failures, unrecognized-schema count, and repair recommendations. The check is read-only and reports warnings from observed daemon data only.

`npm run doctor` also checks release target live connector status and recent normalized Codex hook events that include transcript paths but still have no useful transcript messages or token rows. That warning usually means transcript import is not approved, the daemon was started with `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0`, the recovery sweep has not run yet, or the referenced transcript file cannot be imported.
