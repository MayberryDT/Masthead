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
- `GET /sources/connectors` returns the Sources V2 harness-connector snapshot: eight live targets with `presence` (`not_found` | `found`), `live` (`not_installed` | `needs_action` | `ready` | `error`), optional activation fields, config/endpoints, and a `summary` of ready / needsAction / notInstalled / notFound / error counts. Read-only and safe through a worktree bridge.
- `GET /sources/scan/latest` returns the latest multi-adapter scan result, or runs a bounded scan if none is cached.
- `GET /diagnostics/runtime` returns runtime diagnostics, import queue state, and a small active import page for Advanced diagnostics.
- `GET /logbook/artifacts` searches **published Logbook artifacts** (primary Logbook path). Query `q` searches capsule fields plus the complete first-class artifact body. Other params include `kind` (`session_dossier` \| `runbook` \| `adr` \| `incident_timeline`), `project`, `dateFrom`, `dateTo`, `limit`, `offset`. Bridge-safe read.
- `GET /logbook/artifacts/:artifactId` returns one published artifact detail: body, provenance session ids, join rationale, confidence, evidence refs. Bridge-safe read.
- `GET /logbook/search` is a compatibility alias for artifact capsule search. It returns the same `artifacts` shape as `/logbook/artifacts`, never session rows. New clients should use `/logbook/artifacts`.
- `GET /sessions` searches canonical sessions (evidence / Workbench / compile — not the primary Logbook listing). Query params include `q`, `project`, `runtime`, `host`, `model`, `state`, date filters, and `limit`.
- `GET /sessions/:sessionId` returns one session detail.
- `GET /sessions/:sessionId/excerpts` returns bounded excerpts, with optional `q` and `limit`.
- `GET /sessions/:sessionId/dossier` returns the session dossier (Workbench/evidence; Logbook opens **artifacts**, not this, as the primary detail path).
- `GET /sessions/:sessionId/live-explain` explains the current Board live-state decision for one session, including the selected authority, latest live report, latest event fallback, unresolved blockers, and headline fact freshness.
- `GET /sessions/:sessionId/transcript` returns paginated canonical transcript items from messages, tools, checkpoints, runtime signals, and file effects. Query params include `cursor`, `limit`, `kind=all|user|assistant|tools|checkpoints|files|signals`, and `q`.
- `GET /workbench/sessions?limit=...` returns package-path Workbench sessions with next action, readiness/package/kind/resolution fields, active claim, and latest Activity. This endpoint is read-only and safe through a worktree bridge.
- `GET /workbench/activity?limit=...&sessionId=...` returns recent Workbench Activity receipts.
- `GET /workbench/not-added-summary` returns aggregate Not Added to Logbook counts by reason.
- `GET /workbench/not-added?includeDetails=true&limit=...` explicitly inspects Not Added to Logbook sessions.
- `GET /workbench/missing-sessions?limit=...` remains a compatibility read endpoint backed by the Workbench pipeline queue.
- `GET /workbench/authoring/capabilities` returns the daemon-owned authoring protocol, installed CLI command, database identity, bundle version, complete-redacted-evidence policy, and supported operations. Bridge-safe read.
- `GET /workbench/authoring/runs/:runId` returns one durable run, its exact selected sessions and claims, evidence revision state, structured findings, accepted bundle when present, and immutable completion report when finished. Bridge-safe read.
- `GET /workbench/authoring/runs/:runId/evidence?sessionId=...` returns complete canonical redacted evidence pages for a selected session. Optional params are `cursor`, `limit` (1–250), `order=asc|desc`, `kind=all|user|assistant|tools|checkpoints|files|signals`, and `query`. Bridge-safe read.
- `GET /live/state` returns latest live runtime-state reports. Optional query params include `runtime`, `sourceSessionId`, `canonicalSessionId`, and `freshOnly=0|1`.
- `GET /projects` lists known projects.
- `GET /imports` lists import jobs.
- `GET /imports/:importJobId` returns one import job.
- `GET /data/summary` returns Masthead-owned data counts for a scope.
- `GET /knowledge-flow/summary` returns `{ ok: true, summary: { capturedSessions, workbenchSessions, publishedArtifacts, automaticallyResolvedSessions } }`. `capturedSessions` counts non-deleted canonical sessions; `workbenchSessions` counts non-deleted sessions currently on the Workbench `publish_path`; `publishedArtifacts` counts published artifacts whose status is `current`; and `automaticallyResolvedSessions` counts non-deleted Workbench sessions whose resolution status is `automatic_resolved`. This endpoint is GET-only, read-only, and safe through a worktree bridge; there is no mutation counterpart.
- `GET /data/export` exports the local session graph.
- `GET /usage/summary?window=today|24h|7d|30d|all` returns canonical usage totals, token aggregates, model/project/runtime breakdowns, activity buckets, and source coverage. It does not estimate cost.
- `GET /mcp/status` returns MCP readiness, permissions, and audit summary.
- `GET /mcp/launch-config` returns the stdio launch config for the active database.
- `GET /mcp/tools` lists read-only MCP tool metadata.
- `GET /mcp/audit` lists recent MCP audit rows.
- `GET /settings` returns settings state.
- `GET /settings/hooks` returns live connector settings for the release target runtimes.
- `GET /settings/hooks/:runtime` returns one runtime live connector setting for `codex`, `claude_code`, `cursor`, `grok`, `opencode`, `omp`, `pi`, or `hermes`.

## Write Endpoints

Write endpoints are local daemon operations. They are not exposed through MCP.

- `POST /ingest` accepts live hook payloads for focused runtimes via `?runtime=...` or `x-masthead-runtime`, defaulting to Claude Code only for legacy local callers. When a hook includes `transcriptPath`, exact source-scoped transcript import permission exists, and `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP` is not `0`, the daemon may schedule a bounded catch-up import for that transcript file so live sessions receive canonical messages and token usage.
- `POST /live/state` accepts explicit current runtime-state reports from trusted local hooks/plugins. It records `working`, `blocked`, `idle`, or `unknown` state beside event ingestion and returns `accepted`, `ignored_stale`, `ignored_expired`, `disabled`, or `malformed`. `MASTHEAD_LIVE_CAPTURE=0` disables all state capture, and `MASTHEAD_LIVE_CAPTURE_<RUNTIME>=0` disables one runtime.
- `POST /sources/discover` refreshes source discovery.
- `POST /sources/connectors/discover` recomputes the Sources V2 harness-connector snapshot (same shape as `GET /sources/connectors`). Primary-only; not bridge-safe.
- `POST /sources/connectors/:runtime/enable` installs or repairs the Masthead-managed live connector for one runtime (`codex`, `claude_code`, `cursor`, `grok`, `opencode`, `omp`, `pi`, `hermes`), then returns the updated connectors snapshot.
- `POST /sources/connectors/:runtime/test` runs the connector test (ingest + live-state) for one runtime and returns the updated snapshot.
- `POST /sources/connectors/:runtime/uninstall` removes Masthead-managed live connector files for one runtime and returns the updated snapshot.
- `POST /sources/connectors/:runtime/confirm-activation` clears stored host-activation state for one runtime (for example after Codex `/hooks` trust) and returns the updated snapshot.
- `POST /sources/scan` scans known local agent-history locations for all active adapters. It is read-only and allowed through the worktree bridge.
- `POST /sources/connect` connects selected scan results and queues metadata jobs. Per-session transcript import work belongs to Workbench.
- `POST /adapters/:runtime/import-metadata` and `/sync` queue adapter-shaped metadata work for active focused runtimes. Runtime-wide transcript approval/import endpoints are not part of V1.
- `POST /imports` queues an import for `{ "sourceId": "...", "kind": "metadata" | "transcript" }`. Transcript imports require exact source-scoped policy.
- `POST /workbench/sessions/:sessionId/check-transcript` records a lightweight transcript availability check.
- `POST /workbench/sessions/:sessionId/import-transcript-preview` verifies source-scoped permission before transcript import.
- `POST /workbench/sessions/:sessionId/import-transcript` records the Workbench import request and queues daemon transcript import when the approved source is discoverable.
- `POST /workbench/enroll-missing` enrolls non-deleted sessions that have no Workbench pipeline row onto `publish_path` / `check_transcript`. Optional body: `{ "limit"?: number, "actorId"?: string }` (defaults limit `500` clamped 1–2000, actor user `workbench_ui`). Returns `{ ok: true, enrolled, skippedExisting, enrolledSessionIds, limit, generatedAt }`. Primary-only; not bridge-safe.
- `POST /workbench/sessions/:sessionId/claim` claims a publish-path session for an operator. Optional body: `{ "claimedBy"?: string, "ttlSeconds"?: number }` (defaults `workbench_ui`, `900`). Returns `{ ok: true, claims: [...] }` with `claimId`. Primary-only; not bridge-safe.
- `POST /workbench/claims/:claimId/release` releases an active claim. Optional body: `{ "reason"?: string }` (default `released`). Returns `{ ok: true, claim }` or `404` when the claim is missing. Primary-only; not bridge-safe.
- `POST /workbench/sessions/:sessionId/quality` marks capture quality. Body is either `{ "status": "passed" | "failed", "reason"?: string, "actorId"?: string }` or `{ "mode": "precheck", "actorId"?: string }`. Precheck runs capture quality heuristics then marks pass/fail. Actor defaults to user `workbench_ui`. Failing quality on an already published session returns `409` with `cannot_fail_quality_on_published_session`. Primary-only; not bridge-safe.
- `POST /workbench/sessions/:sessionId/publish` publishes the **session package** (dossier capsule) when package gates are satisfied. Multi-kind artifacts (runbook/ADR/timeline) use separate apply/publish or N/A paths; apply ≠ publish.
- `POST /workbench/authoring/runs` opens or idempotently reuses one authoring run. Body: `{ "actorId": "...", "databaseId": "...", "sessionIds": ["..."] }`. A database mismatch or incompatible session state fails before a claim or artifact write. Primary daemon only; blocked by the read-only bridge.
- `POST /workbench/authoring/runs/:runId/submit` validates and stores one complete `workbench-authoring-v1` bundle plus structured findings. It writes no enrichment or artifact rows. The submit body limit is 5 MiB. Primary daemon only; blocked by the read-only bridge.
- `POST /workbench/authoring/runs/:runId/finish` atomically applies, publishes, indexes, resolves, releases claims, and stores the completion report for an accepted bundle. Retry returns the same report without duplicates. Primary daemon only; blocked by the read-only bridge.
- `POST /imports/:importJobId/cancel` cancels an import job.
- `POST /imports/:importJobId/retry` queues a retry.
- `PUT /sources/:sourceId/policies` updates source policy state.
- `POST /sources/exclusions` adds an import exclusion.
- `POST /review-dispositions` writes local review state.
- `POST /data/delete` deletes Masthead-owned local data by scope.
- `POST /data/retention/default` applies default retention.
- `POST /retention` prunes legacy compatibility journals.
- `POST /clear` clears Masthead-owned canonical and compatibility state.
- `POST /settings/hooks/:runtime/install`, `/uninstall`, and `/test` manage one live connector for `codex`, `claude_code`, `cursor`, `grok`, `opencode`, `omp`, `pi`, or `hermes`. Connector tests validate both `/ingest` and `/live/state`.
- `POST /mcp/launch-config/validate` validates a candidate MCP launch config.
- `POST /mcp/test-connection` starts and probes a candidate MCP server.

## Verification

```bash
npm run doctor
npm run check:endpoint-matrix
```

`npm run doctor:json` includes a `sources-pipeline` check with scan freshness, connected source count, transcript coverage, enrichment coverage, import failures, unrecognized-schema count, and repair recommendations. The check is read-only and reports warnings from observed daemon data only.

`npm run doctor` also verifies `artifact_authoring` health capability, the complete authoring operation contract, the capabilities-reported executable command, and that the installed CLI reaches the same database identity. It checks focused live connector status, the Sources V2 `harness-connectors` snapshot (`GET /sources/connectors`; warns when any found harness is `needs_action`, `not_installed`, or `error`), live-state endpoint health, live capture kill-switch environment variables, recent normalized hook events that include transcript paths but still have no useful transcript messages or token rows, and that MCP exposes only read-only tools. A hook transcript warning usually means transcript import is not approved, the daemon was started with `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0`, the recovery sweep has not run yet, or the referenced transcript file cannot be imported.
