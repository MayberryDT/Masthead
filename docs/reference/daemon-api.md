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
- `GET /sessions` searches canonical sessions. Query params include `q`, `project`, `runtime`, `host`, `model`, `state`, date filters, and `limit`.
- `GET /sessions/:sessionId` returns one session detail.
- `GET /sessions/:sessionId/excerpts` returns bounded excerpts, with optional `q` and `limit`.
- `GET /projects` lists known projects.
- `GET /imports` lists import jobs.
- `GET /imports/:importJobId` returns one import job.
- `GET /data/summary` returns Masthead-owned data counts for a scope.
- `GET /data/export` exports the local session graph.
- `GET /mcp/status` returns MCP readiness, permissions, and audit summary.
- `GET /mcp/launch-config` returns the stdio launch config for the active database.
- `GET /mcp/tools` lists read-only MCP tool metadata.
- `GET /mcp/audit` lists recent MCP audit rows.
- `GET /settings` returns settings state.
- `GET /settings/hooks/codex` returns Codex hook settings.

## Write Endpoints

Write endpoints are local daemon operations. They are not exposed through MCP.

- `POST /ingest` accepts Codex hook payloads.
- `POST /sources/discover` refreshes source discovery.
- `POST /sources/codex/import-metadata` queues Codex metadata import.
- `POST /sources/codex/approve-transcripts` records transcript import approval.
- `POST /sources/codex/import-transcripts` queues Codex transcript import after approval.
- `POST /adapters/codex/import-metadata`, `/approve-transcripts`, `/import-transcripts`, and `/sync` are adapter-shaped equivalents.
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
- `POST /settings/hooks/codex/install`, `/uninstall`, and `/test` manage the Masthead Codex hook.
- `POST /mcp/launch-config/validate` validates a candidate MCP launch config.
- `POST /mcp/test-connection` starts and probes a candidate MCP server.

## Verification

```bash
npm run doctor
npm run check:endpoint-matrix
```
