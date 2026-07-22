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
- `GET /logbook/artifacts` searches **published Logbook artifacts** (primary Logbook path). Query `q` ranks title, summary, and agent-authored dossier keywords ahead of matches found only in the complete first-class artifact body. Other params include `kind` (`session_dossier` \| `runbook` \| `adr` \| `incident_timeline`), `project`, `dateFrom`, `dateTo`, `limit`, `offset`. Bridge-safe read.
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

### Current V4 authoring runtime

- `GET /workbench/authoring/capabilities` returns the stable daemon transport protocol
  `masthead.workbench.authoring/v1`, instance-bound CLI command, database/build/manifest identity,
  `workbench-authoring-v4`, policy `guided-authoring-v1`, assignment limits, and guided operations.
  Bridge-safe read.
- `GET /workbench/authoring/runs/:runId` returns one historical V3 run, selected sessions and claims,
  evidence revision state, findings, accepted bundle, and completion report. Historical V1 and V2
  runs are audit-only. Bridge-safe read.
- `GET /workbench/authoring/runs/:runId/context` and
  `GET /workbench/authoring/runs/:runId/evidence?sessionId=...` expose historical V3 canonical context,
  advisory suggestions, and cursor-paginated evidence. Bridge-safe audit reads.
- `GET /workbench/authoring/requests/:requestId` returns one durable guided authoring request, its
  assignments, campaign state, and single required next action. Bridge-safe read.
- `GET /workbench/authoring/canaries/pending` returns staged V4 canary drafts awaiting operator review.
  Bridge-safe read.
- `GET /workbench/authoring/assignments/:assignmentId/inspect` returns the next canonical evidence
  page and records returned refs as evidence-coverage progress. Primary-only
  and never forwarded by the read-only worktree bridge.
- `GET /workbench/authoring/assignments/:assignmentId/review` returns structured editorial findings
  and the next required action. Bridge-safe read.
- Legacy `GET /workbench/authoring/runs/:runId`, context, evidence, status, and completion-receipt reads
  remain available for immutable V1, V2, and V3 audit history; they are not resumable
  authoring work.
- `GET /live/state` returns latest live runtime-state reports. Optional query params include `runtime`, `sourceSessionId`, `canonicalSessionId`, and `freshOnly=0|1`.
- `GET /projects` lists known projects.
- `GET /imports` lists import jobs.
- `GET /imports/:importJobId` returns one import job.
- Import completion reports separate source-unit reconciliation, recognized/rejected records,
  import-health counts, Workbench package/Not Added counts, deterministic anomalies, and timestamp
  basis (`semantic`, `source_path`, `file_modified`, `unknown`). For `transcript_recent`, old units
  are excluded without a cursor; an old changed unit is an incremental refresh only with its
  existing cursor; unit-limit deferrals are disclosed as capped/deferred work.
- `GET /data/summary` returns Masthead-owned data counts for a scope.
- `GET /logbook/summary` returns artifact-native published Logbook totals as `{ artifacts, byKind, projects, earliestPublishedAt?, latestPublishedAt? }`. It reads only current published `session_artifacts`; it does not scan sessions, messages, tools, or file effects.
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
- `POST /workbench/enroll-missing` reconciles non-deleted sessions that have no Workbench pipeline row. Sessions whose latest import health is complete run the normal transcript/quality classification, sessions without import health retain ordinary enrollment, and sessions whose latest import health is partial or repair-required remain outside Workbench. Optional body: `{ "limit"?: number, "actorId"?: string }` (defaults limit `500` clamped 1–2000, actor user `workbench_ui`). Returns `{ ok: true, enrolled, heldForImportRepair, skippedExisting, enrolledSessionIds, limit, generatedAt }`. The operation is idempotent, preserves existing published/manual/Not Added rows, and is primary-only / not bridge-safe.
- `POST /workbench/sessions/:sessionId/claim` claims a publish-path session for an operator. Optional body: `{ "claimedBy"?: string, "ttlSeconds"?: number }` (defaults `workbench_ui`, `900`). Returns `{ ok: true, claims: [...] }` with `claimId`. Primary-only; not bridge-safe.
- `POST /workbench/claims/:claimId/release` releases an active claim. Optional body: `{ "reason"?: string }` (default `released`). Returns `{ ok: true, claim }` or `404` when the claim is missing. Primary-only; not bridge-safe.
- `POST /workbench/sessions/:sessionId/quality` marks capture quality. Body is either `{ "status": "passed" | "failed", "reason"?: string, "actorId"?: string }` or `{ "mode": "precheck", "actorId"?: string }`. Precheck runs capture quality heuristics then marks pass/fail. Actor defaults to user `workbench_ui`. Failing quality on an already published session returns `409` with `cannot_fail_quality_on_published_session`. Primary-only; not bridge-safe.

### Current V4 authoring runtime

- `POST /workbench/authoring/suggestions` returns advisory suggestions for 1–12 selected sessions and
  is allowed through the read-only bridge.

- `POST /workbench/authoring/requests` creates one durable V4 request from the Workbench selection and
  campaign policy. The daemon plans assignments and a legal canary before committing anything. If it
  cannot choose a complete strong group of at most three sessions or diverse dossier-only sessions,
  returns `guided_canary_not_constructible` and persists nothing. Primary daemon only.
- `POST /workbench/authoring/requests/:requestId/start` claims and starts the released assignment.
- `POST /workbench/authoring/assignments/:assignmentId/draft` validates and saves one grounded
  `workbench-authoring-v4` draft after complete evidence traversal. Every durable session enrichment
  includes agent-authored `keywords: string[]`; the daemon scaffold leaves the array empty and never
  derives keyword prose from session evidence. It creates no Logbook rows. Legacy stored capsules
  without `keywords` remain readable as an empty keyword list.
- `POST /workbench/authoring/requests/:requestId/canary-decision` records operator approval or rejection
  of the staged three-session canary.
- `POST /workbench/authoring/assignments/:assignmentId/finish` atomically applies enrichment, rebuilds
  canonical dossiers, publishes accepted optional artifacts, records revisions and Activity, releases
  claims, stores an idempotent receipt, and releases the next assignment. All V4 mutations verify
  daemon URL, database ID, build SHA, canonical manifest path, and instance identity immediately before
  calling the service. Primary-only and blocked by the read-only bridge.
- Legacy V3 `POST /workbench/authoring/runs`, submit, and finish mutations are retired. They return
  HTTP 409 with `{ "code": "authoring_contract_retired" }` before
  opening claims or writing enrichment, drafts, artifacts, or receipts. V1 and V2 mutations remain
  retired on the same boundary.
- `POST /imports/:importJobId/cancel` cancels an import job.
- `POST /imports/:importJobId/retry` queues a retry.
- `POST /imports/repair/preview` accepts `{ "importJobIds": ["..."] }` and returns a read-only,
  provenance-scoped repair plan. It identifies removable pseudo-sessions, sessions to reparse,
  automatic suppressions eligible to reopen, old out-of-range sessions to defer, preserved live or
  shared sessions, published-artifact blockers, source/job plans, and `planHash`.
- `POST /imports/repair/apply` accepts `{ "importJobIds": ["..."], "planHash": "<sha256>" }`.
  Apply recomputes the preview under a write transaction and rejects hash drift. It preserves
  unrelated/live/shared/manual/published data and stages only exact eligible replacement jobs.
  Preview is read-only; apply is a primary-daemon mutation. Neither operation is exposed through
  MCP, and the read-only worktree bridge does not forward repair operations.
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

`npm run doctor` also verifies `artifact_authoring` health capability, the complete guided operation
contract, the instance-bound executable command, and equality of daemon URL, database ID, build SHA,
and manifest identity. It checks focused live connector status, the Sources V2 `harness-connectors`
snapshot (`GET /sources/connectors`; warns when any found harness is `needs_action`, `not_installed`,
or `error`), live-state endpoint health, live capture kill-switch environment variables, recent
normalized hook events that include transcript paths but still have no useful transcript messages or
token rows, and that MCP exposes only read-only tools. A hook transcript warning usually means
transcript import is not approved, the daemon was started with `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0`,
the recovery sweep has not run yet, or the referenced transcript file cannot be imported.

## Failed V1 recovery boundary

Failed-generation recovery intentionally has no HTTP route. It is offline local
maintenance and every command requires an explicit database path:

```bash
mastheadctl workbench audit-v1-generation --db <path> --json
mastheadctl workbench prepare-v1-recovery --db <path> --json
mastheadctl workbench invalidate-v1-generation --db <path> --audit-hash <sha256> --confirm --json
mastheadctl workbench restore-v1-recovery --db <active> --backup <sibling masthead.sqlite.backup-current> --audit-hash <sha256> --confirm --json
```

`audit` opens the database read-only and fails closed unless the exact known V1
population, membership, template, windows, actor, schema, provenance, search,
pipeline, claims, runs, and receipts agree. Its SHA-256 `auditHash` covers that
sorted recovery snapshot. `prepare` acquires daemon-equivalent exclusive writer
ownership, uses SQLite online backup so WAL state is included, verifies database
identity and `PRAGMA integrity_check`, refuses audit drift, and retains exactly
one `masthead.sqlite.backup-current` snapshot. Neither command changes product
rows.

`invalidate` re-audits and requires the exact lowercase 64-hex hash plus
`--confirm`. In one immediate transaction it deletes only matching artifact,
search, and provenance rows; resets affected dossiers to missing and optional
statuses to unknown; releases matching claims; and records one recovery Activity.
The 66 completed V1 runs and their receipts remain audit history. Production use
is prohibited until fixture recovery readiness, a temporary-copy rehearsal, and
a separately authorized human-reviewed canary have passed.

`restore-v1-recovery` is the only supported rollback executable. It refuses
unless the backup is the exact non-symlink sibling `masthead.sqlite.backup-current`,
the active and backup database identities match, both databases and the staged
copy pass integrity checks, and the backup audit hash matches `--audit-hash`.
While holding daemon-equivalent exclusive ownership it stages and verifies the
backup, removes active WAL/SHM/journal sidecars, atomically promotes the stage,
and verifies the restored active identity, integrity, and audit hash. It never
deletes or renames the backup.

The successful JSON object has exactly `databasePath`, `ok`, and `receipt` at
the top level. `receipt` has exactly these fields:

| Field | Successful value |
|---|---|
| `artifactsRestored` | `1283` |
| `auditHash` | exact requested SHA-256 |
| `backupPath` | exact sibling `masthead.sqlite.backup-current` |
| `backupPreserved` | `true` |
| `databaseId` | active/backup database identity |
| `integrityResult` | `ok` |
| `runsRestored` | `66` |
| `sessionsRestored` | `1283` |
