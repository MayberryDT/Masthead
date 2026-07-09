# Workbench Pipeline V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Masthead V1 around an explicit Now -> Workbench -> Logbook pipeline where only published, normalized sessions appear in Logbook.

**Architecture:** Add a durable Workbench pipeline model as the canonical source for per-session publication state, Workbench Activity, and active agent claims. Move raw-session cleanup, transcript work, agent-authored enrichment, publication, and activity visualization into Workbench; keep Sources focused on harness capture and permissions; gate Logbook, search, and MCP on explicit publication state.

**Tech Stack:** TypeScript, React, Vitest, SQLite migrations/repositories, local daemon HTTP API, existing Masthead CLI, existing Masthead CSS/design system.

## Global Constraints

- Do not implement during planning. This document is the execution plan.
- Preserve unrelated dirty worktree changes. Read current files before editing and do not revert user or prior-agent work blindly.
- `CONTEXT.md` and `docs/adr/0009-logbook-only-shows-published-sessions.md` are the domain contract for this plan.
- Workbench is an operations surface only: no hero panels, onboarding copy, teaching copy, visible CLI command recipes, or board lanes.
- Workbench UI shape is a dense table plus live Workbench Activity rail.
- Logbook shows only published sessions.
- Existing Logbook-visible sessions are migrated through explicit `legacy_backfill` publication only if they pass the cheap quality screen.
- All cheap-quality failures go to `Not Added to Logbook`; they are not recoverable default-queue items.
- Default agent prompts, default CLI queue scopes, and MCP retrieval must not include `Not Added to Logbook` session IDs or details.
- Transcript import is explicit user or user-directed agent action; lightweight transcript availability checks may run automatically.
- Transcript import permission is source-scoped. Do not rely on global/runtime-wide transcript approval for Workbench import.
- Every meaningful human Workbench action needs an agent-facing CLI equivalent operating on the same pipeline state.
- Every published session requires applied session enrichment plus a current session dossier. `bug_fix_trace` is first-class but can be explicitly `not_applicable` when evidence does not support it.
- Use existing libraries and patterns. Do not add a state-management library, ORM, background agent launcher, or task-assignment system.

## Definition Of Done

- `workbench_session_state`, `workbench_activity`, and `workbench_claims` exist, migrate cleanly, and are covered by repository tests.
- Legacy backfill classifies existing visible sessions as `published` or `not_added_to_logbook` with Workbench Activity receipts.
- Logbook, `/sessions`, `/logbook/search`, summaries, search fallbacks, and MCP retrieval are publication-gated.
- Workbench queue/read APIs return publish-path sessions, next actions, readiness fields, claim state, and recent Activity.
- `Not Added to Logbook` is reviewable by the human as aggregate summary by default, with explicit inspection only.
- Workbench CLI can status/list/evidence/check/import/quality/claim/release/apply/publish/activity using the same pipeline state as the UI.
- Sources no longer presents per-session import/enrichment workflow as its primary job; it owns harness capture, source health, readable paths, and source-scoped permissions.
- Session Dossier no longer has an Enrich action and instead shows compact Workbench Activity milestones for published sessions.
- Workbench UI has a dense operations table, top action bar with `Copy Agent Prompt`, and live Activity rail.
- Existing visible command recipes are absent from Workbench and Dossier UI.
- Focused tests pass, followed by `npm run build`, `npm run test`, and the relevant surface/endpoint checks.

## Implementation Risk Controls

- Treat publication gating as a compatibility migration, not a normal refactor. Backfill must run before published-only Logbook reads are enforced.
- Add a temporary diagnostic count in the backfill result: total candidates, published, not added, skipped existing state. Tests must assert the counts add up.
- Do not delete or purge sessions in V1. `Not Added to Logbook` hides sessions from default flows but preserves reviewability.
- Keep `session_artifacts` for real artifacts only. `bug_fix_trace = not_applicable` belongs to Workbench state and Activity, not a fake artifact row.
- Keep `workbench_runs` as low-level command receipt history. `workbench_activity` is the user-facing progress stream.
- Prefer one repository boundary for pipeline state: callers should not write `workbench_session_state`, `workbench_activity`, or `workbench_claims` directly outside `workbenchPipelineRepository.ts`.
- Update the worktree bridge only for read endpoints. Write endpoints must stay blocked in secondary worktree bridge mode.
- Re-run the no-visible-command search after UI work:

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx
```

---

## File Map

**New core state**
- Create `src/daemon/db/migrations/017_workbench_pipeline.sql`: Workbench state/activity/claims tables.
- Modify `src/daemon/db/schema.ts`: register migration 17 and critical tables.
- Create `src/daemon/db/workbenchPipelineRepository.ts`: current state, activity, claims, publish, not-added, and query helpers.
- Create `src/workbench/qualityPrecheck.ts`: deterministic cheap quality screen.
- Create `src/workbench/legacyPublicationBackfill.ts`: one-time legacy classifier and Activity writer.

**Read/write API and DTOs**
- Replace/expand `src/shared/workbench.ts`: pipeline DTOs, activity DTOs, next-action enums, Not Added summaries.
- Modify `src/daemon/server.ts`: Workbench queue/activity/action endpoints; startup backfill; publication-gated reads.
- Modify `src/app/daemonClient.ts`: Workbench pipeline client methods.
- Modify `src/core/worktreeConnector.ts` and `scripts/masthead-endpoint-matrix.js`: bridge/endpoint coverage for new read APIs.

**Workbench agent machinery**
- Modify `src/workbench/queueRepository.ts`: queue from pipeline state, not missing `session_capsule`.
- Modify `src/workbench/applySessionEnrichment.ts`: record Activity/readiness, never auto-publish.
- Modify `src/workbench/applyArtifact.ts`: satisfy dossier/bug-fix requirements, never auto-publish.
- Modify `src/workbench/batch.ts`: use pipeline queue and exclude Not Added by default.
- Modify `src/cli/workbench.ts`: add pipeline commands and default scopes.
- Modify `src/workbench/instructions.ts`: describe required enrichment+dossier and conditional bug-fix trace.

**Logbook, MCP, Sources, Now, Dossier**
- Modify `src/daemon/db/sessionQueryRepository.ts`, `src/daemon/db/logbookSummaryRepository.ts`, and `src/daemon/db/searchRepository.ts`: published-only Logbook/search behavior.
- Modify `src/mcp/sessionRetrieval.ts`, `src/mcp/policy.ts`, and `src/mcp/tools.ts`: agent retrieval respects publication state.
- Modify `src/daemon/sources/sourceConnectService.ts`, `src/daemon/sources/sourceSetupService.ts`, `src/daemon/import/importWorkUnitRunner.ts`, and related source APIs: Workbench owns per-session import/enrichment workflow; Sources owns capture/health/permissions.
- Modify `src/ui/session-dossier/SessionDossier.tsx` and related dossier components/tests: remove enrich button; show compact Workbench Activity.
- Modify Now surface files after locating current component names in `src/app/App.tsx` and `src/ui`: shallow state cards only.

**Workbench UI**
- Modify `src/app/workbench/useWorkbenchController.ts`: load pipeline queue, Activity rail, Not Added summary, selection, and handoff.
- Modify `src/ui/workbench/WorkbenchPanel.tsx`: dense semantic table plus Activity rail.
- Modify `src/ui/workbench/workbenchHandoff.ts`: generate a plain-language agent prompt without Not Added IDs/details or visible CLI recipe text in UI.
- Modify `src/styles/masthead.css`: table/rail layout using existing dense console language.
- Modify navigation/menu files in `src/app/App.tsx` and `src/ui/ObservabilitySidebar.tsx`: order Now, Workbench, Logbook, Usage, Sources, Settings.

**Tests and docs**
- Add/modify repository tests under `src/daemon/db/__tests__/`.
- Add/modify daemon API tests under `src/daemon/__tests__/workbenchApi.test.ts`.
- Add/modify CLI tests under `src/cli/__tests__/mastheadctl.test.ts`.
- Add/modify Workbench UI tests under `src/ui/workbench/__tests__/`.
- Add/modify Logbook, Dossier, Sources, MCP, bridge, and endpoint matrix tests.
- Update `docs/reference/daemon-api.md`, `docs/reference/sources.md`, `docs/reference/mcp-tools.md`, `docs/reference/enrichment.md`, and `docs/acceptance/product-release-gate.md`.
- Mark `docs/superpowers/plans/2026-07-08-workbench-raw-enrichment-sessions.md` as superseded by this plan.

---

### Task 0: Establish Baseline And Protect Existing Work

**Files:**
- Inspect `git status --short`
- Inspect `CONTEXT.md`
- Inspect `docs/adr/0009-logbook-only-shows-published-sessions.md`
- Inspect `docs/superpowers/plans/2026-07-08-workbench-pipeline-v1.md`

**Interfaces:**
- Consumes current dirty worktree.
- Produces an execution note listing which existing files are user/prior-agent work and must not be reverted.

- [ ] **Step 1: Capture dirty worktree state**

Run:

```bash
git status --short
git diff --stat
```

Expected: many existing modified/untracked files. Do not reset them.

- [ ] **Step 2: Confirm current domain contract**

Run:

```bash
sed -n '1,260p' CONTEXT.md
sed -n '1,120p' docs/adr/0009-logbook-only-shows-published-sessions.md
```

Expected: Workbench pipeline, published-only Logbook, Not Added exclusion, explicit publication, and Sources boundary are present.

- [ ] **Step 3: Record execution guardrails in the implementation notes**

Before code edits, write a short note in the working session, not product code:

```text
Do not revert unrelated dirty files.
Do not implement the superseded raw-enrichment plan.
Do not expose Not Added session IDs/details in default agent prompts.
Do not make enrichment apply publish sessions.
Do not put not_applicable bug-fix traces in session_artifacts.
```

- [ ] **Step 4: Run the no-visible-command baseline**

Run:

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx
```

Expected before UI cleanup: existing matches may appear. Save them for Task 9/10 verification.

---

### Task 1: Add Durable Workbench Pipeline State

**Files:**
- Create `src/daemon/db/migrations/017_workbench_pipeline.sql`
- Modify `src/daemon/db/schema.ts`
- Create `src/daemon/db/workbenchPipelineRepository.ts`
- Test `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`
- Test `src/daemon/db/__tests__/schema.test.ts`

**Interfaces:**
- Produces `WorkbenchPublicationStatus = "publish_path" | "published" | "not_added_to_logbook"`.
- Produces `WorkbenchNextAction = "check_transcript" | "import_transcript" | "review_quality" | "enrich" | "create_dossier" | "publish" | "active" | "blocked" | "none"`.
- Produces `recordWorkbenchActivity(db, input)`, `ensureWorkbenchSessionState(db, sessionId)`, `markWorkbenchPublished(db, input)`, `markWorkbenchNotAdded(db, input)`, `listWorkbenchQueue(db, options)`, `listWorkbenchActivity(db, options)`, `claimWorkbenchSessions(db, input)`, and `releaseWorkbenchClaim(db, input)`.

- [ ] **Step 1: Write repository tests first**

Create tests covering:

```ts
test("creates default publish-path state for a captured session", () => {
  const db = createMigratedTestDatabase();
  seedSession(db, { sessionId: "session:1", title: "Meaningful work" });

  const state = ensureWorkbenchSessionState(db, "session:1");

  expect(state).toMatchObject({
    sessionId: "session:1",
    publicationStatus: "publish_path",
    nextAction: "check_transcript",
    transcriptStatus: "unchecked",
    qualityStatus: "unchecked",
    sessionEnrichmentStatus: "missing",
    sessionDossierStatus: "missing",
    bugFixTraceStatus: "unknown"
  });
});

test("published state is an explicit transition with activity", () => {
  const db = createMigratedTestDatabase();
  seedSession(db, { sessionId: "session:1", title: "Meaningful work" });

  const result = markWorkbenchPublished(db, {
    actor: { kind: "agent", id: "codex" },
    publishedVia: "workbench_publish",
    sessionId: "session:1"
  });

  expect(result.state.publicationStatus).toBe("published");
  expect(result.state.publishedAt).toEqual(expect.any(String));
  expect(listWorkbenchActivity(db, { sessionId: "session:1", limit: 10 })[0]).toMatchObject({
    eventType: "published",
    details: expect.objectContaining({ publishedVia: "workbench_publish" })
  });
});

test("claims are short-lived and do not change publication state", () => {
  const db = createMigratedTestDatabase();
  seedSession(db, { sessionId: "session:1", title: "Meaningful work" });
  const before = ensureWorkbenchSessionState(db, "session:1");

  const claim = claimWorkbenchSessions(db, {
    claimedBy: "codex",
    expiresAt: "2026-07-08T12:05:00.000Z",
    sessionIds: ["session:1"]
  });

  const after = ensureWorkbenchSessionState(db, "session:1");
  expect(claim.claims).toHaveLength(1);
  expect(after.publicationStatus).toBe(before.publicationStatus);
  expect(after.activeClaim?.claimedBy).toBe("codex");
});
```

Run:

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/db/__tests__/schema.test.ts
```

Expected: fail because migration/repository do not exist.

- [ ] **Step 2: Add migration 17**

Create the migration with these tables and indexes:

```sql
CREATE TABLE IF NOT EXISTS workbench_session_state (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  publication_status TEXT NOT NULL DEFAULT 'publish_path',
  next_action TEXT NOT NULL DEFAULT 'check_transcript',
  transcript_status TEXT NOT NULL DEFAULT 'unchecked',
  quality_status TEXT NOT NULL DEFAULT 'unchecked',
  session_enrichment_status TEXT NOT NULL DEFAULT 'missing',
  session_dossier_status TEXT NOT NULL DEFAULT 'missing',
  bug_fix_trace_status TEXT NOT NULL DEFAULT 'unknown',
  non_publication_reason TEXT,
  published_at TEXT,
  published_activity_id TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (publication_status IN ('publish_path', 'published', 'not_added_to_logbook')),
  CHECK (next_action IN ('check_transcript', 'import_transcript', 'review_quality', 'enrich', 'create_dossier', 'publish', 'active', 'blocked', 'none')),
  CHECK (transcript_status IN ('unchecked', 'available', 'imported', 'missing', 'permission_needed')),
  CHECK (quality_status IN ('unchecked', 'passed', 'failed')),
  CHECK (session_enrichment_status IN ('missing', 'satisfied')),
  CHECK (session_dossier_status IN ('missing', 'satisfied')),
  CHECK (bug_fix_trace_status IN ('unknown', 'required', 'satisfied', 'not_applicable'))
);

CREATE TABLE IF NOT EXISTS workbench_activity (
  activity_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  related_run_id TEXT,
  related_claim_id TEXT
);

CREATE TABLE IF NOT EXISTS workbench_claims (
  claim_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  claim_kind TEXT NOT NULL DEFAULT 'publish_path',
  claimed_by TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT,
  CHECK (claim_kind IN ('publish_path'))
);

CREATE INDEX IF NOT EXISTS idx_workbench_session_state_publication
  ON workbench_session_state(publication_status, next_action, updated_at);
CREATE INDEX IF NOT EXISTS idx_workbench_activity_session_time
  ON workbench_activity(session_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_activity_type_time
  ON workbench_activity(event_type, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_claims_active
  ON workbench_claims(session_id, expires_at)
  WHERE released_at IS NULL;
```

- [ ] **Step 3: Register migration and critical tables**

Add version 17 in `schema.ts`:

```ts
{
  version: 17,
  name: "017_workbench_pipeline",
  path: resolve(currentDir, "migrations/017_workbench_pipeline.sql")
}
```

Add critical tables:

```ts
"workbench_session_state",
"workbench_activity",
"workbench_claims"
```

- [ ] **Step 4: Implement repository functions**

Implement row mappers and repository methods in `workbenchPipelineRepository.ts`. Use explicit JSON parsing for `details_json`; use `stableRecordId` for deterministic `activity_id` when the same transition is idempotent and `randomUUID` for claims.

Repository methods must run state changes and Activity inserts inside the same transaction for publication, Not Added classification, and artifact readiness updates. If an Activity insert fails, the state transition must roll back.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/db/__tests__/schema.test.ts
```

Expected: pass.

---

### Task 2: Implement Cheap Quality Screen And Legacy Backfill

**Files:**
- Create `src/workbench/qualityPrecheck.ts`
- Create `src/workbench/legacyPublicationBackfill.ts`
- Modify `src/daemon/server.ts`
- Modify `src/daemon/legacyJournalMigration.ts`
- Test `src/workbench/__tests__/qualityPrecheck.test.ts`
- Test `src/workbench/__tests__/legacyPublicationBackfill.test.ts`

**Interfaces:**
- Produces `runCaptureQualityPrecheck(db, sessionId): CaptureQualityPrecheckResult`.
- Produces `runLegacyWorkbenchPublicationBackfill(db): LegacyWorkbenchPublicationBackfillResult`.

- [ ] **Step 1: Write failing quality precheck tests**

Cover these cases:

```ts
expect(runCaptureQualityPrecheck(db, "session:meaningful")).toMatchObject({
  ok: true,
  reason: "meaningful_message"
});

expect(runCaptureQualityPrecheck(db, "session:no-messages")).toMatchObject({
  ok: false,
  reason: "no_messages"
});

expect(runCaptureQualityPrecheck(db, "session:hook-only")).toMatchObject({
  ok: false,
  reason: "hook_only"
});

expect(runCaptureQualityPrecheck(db, "session:missing-identity")).toMatchObject({
  ok: false,
  reason: "missing_identity"
});
```

Run:

```bash
npm test -- --run src/workbench/__tests__/qualityPrecheck.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 2: Implement deterministic precheck**

Use existing signals:
- `getTranscriptCoverage` from `src/daemon/db/sessionTranscriptRepository.ts`.
- Coverage levels from existing dossier/narrative facts where available.
- `sessions`, `runtimes`, `ingest_sources`, and `session_sources` metadata for source/runtime/time identity.
- Existing low-value text rules in `src/shared/sessionTextQuality.ts`.

Return only deterministic reasons:

```ts
export type CaptureQualityFailureReason =
  | "no_messages"
  | "hook_only"
  | "metadata_only"
  | "duplicate_noise"
  | "missing_identity";

export type CaptureQualityPassReason = "meaningful_message" | "usable_transcript";
```

Do not import transcripts in this module.

- [ ] **Step 3: Write failing legacy backfill tests**

Cover two-way migration:

```ts
test("legacy backfill publishes passing sessions with activity", () => {
  const result = runLegacyWorkbenchPublicationBackfill(db);
  expect(result.published).toContain("session:meaningful");
  expect(readWorkbenchSessionState(db, "session:meaningful")?.publicationStatus).toBe("published");
  expect(listWorkbenchActivity(db, { sessionId: "session:meaningful", limit: 5 })[0]).toMatchObject({
    eventType: "published",
    details: expect.objectContaining({ publishedVia: "legacy_backfill" })
  });
});

test("legacy backfill moves failures to Not Added to Logbook", () => {
  const result = runLegacyWorkbenchPublicationBackfill(db);
  expect(result.notAdded).toContain("session:no-messages");
  expect(readWorkbenchSessionState(db, "session:no-messages")?.publicationStatus).toBe("not_added_to_logbook");
  expect(readWorkbenchSessionState(db, "session:no-messages")?.nonPublicationReason).toBe("no_messages");
});
```

Run:

```bash
npm test -- --run src/workbench/__tests__/legacyPublicationBackfill.test.ts
```

Expected: fail until backfill exists.

- [ ] **Step 4: Implement one-time backfill**

Use `legacy_migrations` as the idempotency guard with a key such as `workbench_publication_backfill_v1`. Classify all `sessions.deleted_at IS NULL` rows that do not already have `workbench_session_state`.

Backfill outcome:
- pass -> `publication_status = 'published'`, Activity `event_type = 'published'`, `details_json.publishedVia = 'legacy_backfill'`.
- fail -> `publication_status = 'not_added_to_logbook'`, Activity `event_type = 'not_added_to_logbook'`, `details_json.reason = <failure reason>`.

Backfill result shape:

```ts
export type LegacyWorkbenchPublicationBackfillResult = {
  ok: true;
  totalCandidates: number;
  published: string[];
  notAdded: Array<{ sessionId: string; reason: CaptureQualityFailureReason }>;
  skippedExistingState: number;
};
```

Assert `published.length + notAdded.length + skippedExistingState === totalCandidates`.

- [ ] **Step 5: Run backfill before published-only reads become visible**

Call the backfill during daemon startup after migrations and before startup indexing/search visibility work. Keep the call idempotent and log counts.

If backfill throws, startup should fail loudly rather than launching with partially enforced published-only Logbook reads.

- [ ] **Step 6: Verify focused tests**

Run:

```bash
npm test -- --run src/workbench/__tests__/qualityPrecheck.test.ts src/workbench/__tests__/legacyPublicationBackfill.test.ts
```

Expected: pass.

---

### Task 3: Gate Logbook, Search, And MCP On Published State

**Files:**
- Modify `src/daemon/db/sessionQueryRepository.ts`
- Modify `src/daemon/db/logbookSummaryRepository.ts`
- Modify `src/daemon/db/searchRepository.ts`
- Modify `src/daemon/server.ts`
- Modify `src/mcp/sessionRetrieval.ts`
- Modify `src/mcp/policy.ts`
- Modify `src/mcp/tools.ts`
- Test `src/daemon/db/__tests__/sessionQueryRepository.test.ts`
- Test `src/daemon/db/__tests__/logbookSummaryRepository.test.ts`
- Test `src/daemon/db/__tests__/searchRepository.test.ts`
- Test `src/mcp/__tests__/retrieval.test.ts`
- Test `src/mcp/__tests__/tools.test.ts`
- Test `src/mcp/__tests__/policy.test.ts`

**Interfaces:**
- Consumes `workbench_session_state.publication_status = 'published'`.
- Produces published-only normal retrieval.

- [ ] **Step 1: Write failing repository/API tests**

Add tests that seed two sessions:
- `session:published` with `publication_status = 'published'`.
- `session:not-added` with `publication_status = 'not_added_to_logbook'`.

Assert:

```ts
expect(querySessions(db, {}).items.map((item) => item.sessionId)).toEqual(["session:published"]);
expect(readLogbookSummary(db).sessionCount).toBe(1);
expect(searchSessions(db, { query: "anything" }).items.map((item) => item.sessionId)).not.toContain("session:not-added");
```

For MCP:

```ts
expect(await callMcpSearch("not-added")).not.toContainEqual(expect.objectContaining({
  sessionId: "session:not-added"
}));
```

- [ ] **Step 2: Join publication state in Logbook repositories**

Update Logbook list/summary/search SQL to require:

```sql
JOIN workbench_session_state
  ON workbench_session_state.session_id = sessions.session_id
 AND workbench_session_state.publication_status = 'published'
```

Keep `sessions.deleted_at IS NULL`.

- [ ] **Step 3: Gate MCP retrieval**

Apply the same publication boundary before MCP policy access. MCP access remains separate: publication allows Logbook/MCP candidacy, but source MCP policy and `excluded_from_mcp_at` still apply.

- [ ] **Step 4: Keep explicit Workbench inspection separate**

Do not use these published-only repositories for Workbench queue or explicit `Not Added` inspection APIs. Workbench needs unpublished state.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionQueryRepository.test.ts src/daemon/db/__tests__/logbookSummaryRepository.test.ts src/daemon/db/__tests__/searchRepository.test.ts src/mcp/__tests__/retrieval.test.ts src/mcp/__tests__/tools.test.ts src/mcp/__tests__/policy.test.ts
```

Expected: pass after updating expected counts for published-only behavior.

---

### Task 4: Build Workbench Queue, Activity, And Not Added APIs

**Files:**
- Modify `src/shared/workbench.ts`
- Modify `src/workbench/queueRepository.ts`
- Modify `src/daemon/server.ts`
- Modify `src/app/daemonClient.ts`
- Modify `src/core/worktreeConnector.ts`
- Modify `scripts/masthead-endpoint-matrix.js`
- Test `src/daemon/__tests__/workbenchApi.test.ts`
- Test `src/app/__tests__/daemonClient.test.ts`
- Test `src/core/__tests__/worktreeConnector.test.ts`
- Test `src/daemon/__tests__/endpointMatrix.test.ts`

**Interfaces:**
- Produces `GET /workbench/sessions?scope=default`.
- Produces `GET /workbench/activity?limit=50&sessionId=<id>`.
- Produces `GET /workbench/not-added-summary`.
- Produces explicit `GET /workbench/not-added?includeDetails=true` only for user-directed inspection.

- [ ] **Step 1: Replace missing-enrichment DTOs**

In `src/shared/workbench.ts`, add DTOs:

```ts
export type WorkbenchPublicationStatus = "publish_path" | "published" | "not_added_to_logbook";
export type WorkbenchNextAction =
  | "check_transcript"
  | "import_transcript"
  | "review_quality"
  | "enrich"
  | "create_dossier"
  | "publish"
  | "active"
  | "blocked"
  | "none";

export type WorkbenchQueueSessionDto = {
  sessionId: string;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  publicationStatus: "publish_path";
  nextAction: WorkbenchNextAction;
  transcriptStatus: string;
  qualityStatus: string;
  sessionEnrichmentStatus: string;
  sessionDossierStatus: string;
  bugFixTraceStatus: string;
  activeClaim?: { claimedBy: string; expiresAt: string };
  latestActivity?: WorkbenchActivityDto;
};

export type WorkbenchActivityDto = {
  activityId: string;
  sessionId: string;
  eventType: string;
  eventAt: string;
  actorKind: string;
  actorId?: string;
  summary: string;
  details: Record<string, unknown>;
};

export type WorkbenchNotAddedSummaryDto = {
  ok: true;
  total: number;
  reasons: Array<{ reason: string; count: number }>;
};
```

- [ ] **Step 2: Write API tests for default queue non-leakage**

Test:
- `GET /workbench/sessions` returns only `publication_status = 'publish_path'`.
- `GET /workbench/not-added-summary` returns counts/reasons, no session IDs.
- `GET /workbench/activity` returns Activity rows.
- bridge allowlist includes read endpoints.

- [ ] **Step 3: Implement API routes**

Add read routes in `server.ts`:

```text
GET /workbench/sessions
GET /workbench/activity
GET /workbench/not-added-summary
GET /workbench/not-added
```

Make `/workbench/not-added` explicit and separate. Do not call it from default Workbench controller or default CLI prompt generation.

- [ ] **Step 4: Update daemon client**

Add:

```ts
getWorkbenchSessions(baseUrl, options)
getWorkbenchActivity(baseUrl, options)
getWorkbenchNotAddedSummary(baseUrl, options)
getWorkbenchNotAddedSessions(baseUrl, options)
```

- [ ] **Step 5: Update bridge and endpoint matrix**

Allow read endpoints only. Do not allow state-changing Workbench action endpoints through the read-only worktree bridge.

- [ ] **Step 6: Verify focused tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts src/core/__tests__/worktreeConnector.test.ts src/daemon/__tests__/endpointMatrix.test.ts
node scripts/masthead-endpoint-matrix.js
```

Expected: pass.

---

### Task 5: Record Apply, Artifact, Applicability, And Publish Readiness

**Files:**
- Modify `src/workbench/applySessionEnrichment.ts`
- Modify `src/workbench/applyArtifact.ts`
- Modify `src/workbench/validation.ts`
- Modify `src/daemon/db/sessionArtifactRepository.ts` only to keep real artifact storage separate from `not_applicable` readiness state
- Test `src/workbench/__tests__/applySessionEnrichment.test.ts`
- Test `src/workbench/__tests__/applyArtifact.test.ts`
- Test `src/daemon/__tests__/workbenchApi.test.ts`

**Interfaces:**
- `applySessionEnrichment` sets `session_enrichment_status = 'satisfied'` and records Activity.
- `applyArtifact(session_dossier)` sets `session_dossier_status = 'satisfied'` and records Activity.
- `applyArtifact(bug_fix_trace)` sets `bug_fix_trace_status = 'satisfied'` and records Activity.
- A separate Workbench readiness operation records `bug_fix_trace_status = 'not_applicable'`.

- [ ] **Step 1: Change tests that assume apply means publication**

Update tests so apply may refresh internal search projection rows, but normal Logbook/search visibility still requires explicit publication.

- [ ] **Step 2: Keep fake not-applicable artifacts invalid**

Add validation test:

```ts
expect(validateWorkbenchOutput("bug_fix_trace", {
  notApplicable: true,
  reason: "no bug evidence"
}).ok).toBe(false);
```

`not_applicable` lives in Workbench pipeline state, not `session_artifacts`.

- [ ] **Step 3: Update apply paths to record Activity**

After successful apply, record Activity:

```ts
recordWorkbenchActivity(db, {
  actor: { kind: "agent", id: "external_agent" },
  eventType: "session_enrichment_applied",
  sessionId,
  summary: "Session enrichment applied",
  details: { provider: "workbench_cli", outputKind: "session_enrichment" }
});
```

Use analogous event types:
- `session_dossier_applied`
- `bug_fix_trace_applied`

- [ ] **Step 4: Add readiness helper**

Add a repository/helper method:

```ts
setWorkbenchArtifactApplicability(db, {
  actor,
  artifactKind: "bug_fix_trace",
  sessionId,
  status: "not_applicable",
  reason: "no_bug_fix_evidence"
});
```

This records Activity and updates state without writing a fake artifact row.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
npm test -- --run src/workbench/__tests__/applySessionEnrichment.test.ts src/workbench/__tests__/applyArtifact.test.ts
```

Expected: pass.

---

### Task 6: Add Explicit Publication Transition

**Files:**
- Modify `src/daemon/db/workbenchPipelineRepository.ts`
- Modify `src/daemon/server.ts`
- Modify `src/cli/workbench.ts`
- Test `src/daemon/__tests__/workbenchApi.test.ts`
- Test `src/cli/__tests__/mastheadctl.test.ts`

**Interfaces:**
- Produces `POST /workbench/sessions/:sessionId/publish`.
- Produces `mastheadctl workbench publish --session <id> --json`.
- Publication requires transcript checked, quality passed, session enrichment satisfied, session dossier satisfied, and bug-fix trace satisfied or not applicable.

- [ ] **Step 1: Write failing publish gate tests**

Cases:

```ts
expect(publishWorkbenchSession(db, { sessionId: "session:missing-dossier", actor })).toMatchObject({
  ok: false,
  code: "publication_gate_failed",
  missing: ["session_dossier"]
});

expect(publishWorkbenchSession(db, { sessionId: "session:ready", actor })).toMatchObject({
  ok: true,
  state: expect.objectContaining({ publicationStatus: "published" })
});
```

- [ ] **Step 2: Implement publish gate**

Check:
- `transcript_status IN ('available', 'imported')` or an accepted transcript-ready equivalent.
- `quality_status = 'passed'`.
- `session_enrichment_status = 'satisfied'`.
- `session_dossier_status = 'satisfied'`.
- `bug_fix_trace_status IN ('satisfied', 'not_applicable')`.

- [ ] **Step 3: Add daemon route and CLI command**

Daemon route:

```text
POST /workbench/sessions/:sessionId/publish
```

CLI:

```bash
node dist/daemon/src/cli/mastheadctl.js workbench publish --session <session-id> --json
```

- [ ] **Step 4: Verify focused tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/cli/__tests__/mastheadctl.test.ts
```

Expected: pass.

---

### Task 7: Move Workbench CLI To Pipeline State

**Files:**
- Modify `src/cli/workbench.ts`
- Modify `src/workbench/queueRepository.ts`
- Modify `src/workbench/batch.ts`
- Modify `src/workbench/instructions.ts`
- Test `src/cli/__tests__/mastheadctl.test.ts`
- Test `src/workbench/__tests__/queueRepository.test.ts`
- Test `src/workbench/__tests__/batch.test.ts`
- Test `src/workbench/__tests__/instructions.test.ts`

**Interfaces:**
- Default `queue`, `next`, `instructions`, and `batch prepare` use publish-path sessions only.
- Explicit Not Added inspection requires an explicit command/scope.

- [ ] **Step 1: Write non-leakage tests**

Test that default commands do not contain Not Added session IDs:

```ts
expect(await runWorkbenchCli(["queue", "--kind", "session_enrichment", "--json"], env)).not.toContain("session:not-added");
expect(await runWorkbenchCli(["next", "--kind", "session_enrichment", "--json"], env)).not.toContain("session:not-added");
```

Add explicit inspect behavior:

```ts
expect(await runWorkbenchCli(["not-added", "summary", "--json"], env)).toContain('"total":1');
expect(await runWorkbenchCli(["not-added", "list", "--json"], env)).toContain("session:not-added");
```

- [ ] **Step 2: Update status**

`workbench status --json` should include database path plus queue counts:

```json
{
  "ok": true,
  "command": "workbench status",
  "databasePath": "...",
  "queue": { "publishPath": 3, "notAdded": 8, "published": 120 },
  "activeClaims": 1
}
```

- [ ] **Step 3: Update queue and next**

Read from `workbench_session_state`, not missing enrichment. Return next action, readiness, claim, and latest Activity.

- [ ] **Step 4: Add claim/release/activity/publish commands**

Commands:

```text
workbench claim --session <id> --by <agent> --json
workbench release --claim <id> --json
workbench activity --session <id> --json
workbench publish --session <id> --json
workbench not-added summary --json
workbench not-added list --json
```

- [ ] **Step 5: Verify CLI**

Run:

```bash
npm test -- --run src/cli/__tests__/mastheadctl.test.ts src/workbench/__tests__/queueRepository.test.ts src/workbench/__tests__/batch.test.ts src/workbench/__tests__/instructions.test.ts
```

Expected: pass.

---

### Task 8: Move Transcript Import Workflow Into Workbench And Enforce Source Permissions

**Files:**
- Modify `src/daemon/sources/sourceConnectService.ts`
- Modify `src/daemon/sources/sourceSetupService.ts`
- Modify `src/daemon/import/importWorkUnitRunner.ts`
- Modify `src/daemon/server.ts`
- Modify `src/daemon/db/sourcePolicyRepository.ts` to expose a direct source-scoped transcript permission check when the existing API does not already provide one
- Modify `src/ui/sources/*` only to remove per-session workflow controls from Sources
- Test `src/daemon/__tests__/workbenchApi.test.ts`
- Test `src/daemon/sources/__tests__/sourceConnectService.test.ts`
- Test `src/daemon/sources/__tests__/sourceSetupService.test.ts`
- Test `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`
- Test `src/ui/sources/__tests__/SourcesImportModal.test.tsx`
- Test `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`

**Interfaces:**
- Sources owns harness capture, source health, readable paths, and source-scoped transcript permission.
- Workbench owns per-session transcript availability check, import preview, transcript import, and import Activity.

- [ ] **Step 1: Write permission tests**

Cases:

```ts
expect(createWorkbenchTranscriptImport(db, { sourceId: "source:denied", sessionIds })).toMatchObject({
  ok: false,
  code: "transcript_permission_required"
});

expect(createWorkbenchTranscriptImport(db, { sourceId: "source:allowed", sessionIds })).toMatchObject({
  ok: true
});
```

- [ ] **Step 2: Stop Sources connect from launching per-session workflow**

Remove or ignore `queueEnrichment`, broad `importTranscripts`, and global `transcriptApproved` behavior from source connect flow. Source connection may record source availability and permissions, not enqueue session enrichment.

- [ ] **Step 3: Add Workbench transcript routes and CLI commands**

Routes:

```text
POST /workbench/sessions/:sessionId/check-transcript
POST /workbench/sessions/:sessionId/import-transcript-preview
POST /workbench/sessions/:sessionId/import-transcript
```

CLI:

```text
workbench transcript check --session <id> --json
workbench transcript preview --session <id> --json
workbench transcript import --session <id> --json
```

- [ ] **Step 4: Enforce source-scoped permission at job creation and work-unit start**

Check `source_policies` for the specific source before transcript content import. Do not accept global/runtime-wide transcript approval as sufficient.

- [ ] **Step 5: Record Activity**

Record:
- `transcript_checked`
- `transcript_import_previewed`
- `transcript_import_started`
- `transcript_import_completed`
- `transcript_import_failed`
- `transcript_permission_required`

- [ ] **Step 6: Verify focused tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/daemon/sources/__tests__/sourceConnectService.test.ts src/daemon/sources/__tests__/sourceSetupService.test.ts src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: pass.

---

### Task 9: Rebuild Workbench UI As Table Plus Activity Rail

**Files:**
- Modify `src/app/workbench/useWorkbenchController.ts`
- Modify `src/ui/workbench/WorkbenchPanel.tsx`
- Modify `src/ui/workbench/workbenchHandoff.ts`
- Modify `src/styles/masthead.css`
- Test `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Test `src/ui/workbench/__tests__/workbenchHandoff.test.ts`

**Interfaces:**
- UI consumes `WorkbenchQueueSessionDto[]`, `WorkbenchActivityDto[]`, and `WorkbenchNotAddedSummaryDto`.
- UI copies a plain-language agent prompt from selected publish-path rows only.

- [ ] **Step 1: Write UI tests for no instructional page**

Assertions:

```ts
expect(screen.queryByText(/choose raw sessions/i)).not.toBeInTheDocument();
expect(screen.queryByText(/agent workbench/i)).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: /copy agent prompt/i })).toBeInTheDocument();
expect(screen.getByRole("table", { name: /workbench sessions/i })).toBeInTheDocument();
expect(screen.getByLabelText(/workbench activity/i)).toBeInTheDocument();
```

- [ ] **Step 2: Write handoff non-leakage tests**

Build handoff from selected publish-path rows and a Not Added summary. Assert:

```ts
expect(handoff).toContain("session:publish-path");
expect(handoff).not.toContain("session:not-added");
expect(handoff).not.toMatch(/mastheadctl|npm run|output\.json|schema\.json|apply\.sh/);
```

- [ ] **Step 3: Implement controller**

Load:
- Workbench queue on surface activation.
- Activity rail for selected session and recent global Activity.
- Not Added aggregate summary.

Poll only while Workbench is active. Keep polling modest, such as 5 seconds, and cancel with `AbortController`.

- [ ] **Step 4: Implement table and rail**

Table columns:
- select
- session
- project
- source/runtime
- transcript
- quality
- memory
- next action
- active claim
- latest activity

Rail content:
- active claims
- recent Activity events
- selected session evidence/activity summary
- Not Added aggregate count/reason summary

No visible CLI commands.

- [ ] **Step 5: CSS**

Use existing dense console visual language:
- semantic table
- sticky header
- compact row height
- right rail or bottom rail on narrow width
- no cards inside cards
- no hero/empty instructional panels

- [ ] **Step 6: Verify UI tests**

Run:

```bash
npm test -- --run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts
```

Expected: pass.

---

### Task 10: Simplify Logbook, Dossier, Sources, Now, And Navigation

**Files:**
- Modify `src/ui/session-dossier/SessionDossier.tsx`
- Modify dossier subcomponents under `src/ui/session-dossier/`
- Modify `src/ui/SourcesPanel.tsx` and `src/ui/sources/*`
- Modify current Now/Operations surface files discovered in `src/app/App.tsx`
- Modify `src/ui/ObservabilitySidebar.tsx`
- Modify navigation tests.

**Interfaces:**
- Logbook is published search/browse/filter/sort/inspect only.
- Dossier shows compact Workbench Activity milestones and no Enrich button.
- Sources shows capture configuration/source health/source permissions only.
- Now shows shallow live state only.
- Menu order: Now, Workbench, Logbook, Usage, Sources, Settings.

- [ ] **Step 1: Remove Dossier enrich action**

Delete the user-facing enrich button and polling UI from Dossier. Replace with a compact Activity milestone strip for published sessions:

```text
Workbench Activity
- Legacy published / Published / Enrichment applied / Dossier applied
- timestamp, actor when available, compact status
```

- [ ] **Step 2: Remove Logbook selection/workflow controls**

Remove selection checkboxes and workflow actions from Logbook. Keep table row selection only if it opens/updates the inspector.

- [ ] **Step 3: Reframe Sources**

Remove per-session import/enrichment workflow as primary UI. Keep:
- known harnesses
- hook/capture status
- readable paths
- source health/errors
- source-scoped transcript permission controls

- [ ] **Step 4: Simplify Now**

Now cards show shallow state only:
- running/idle/attention
- runtime/source identity
- last activity
- small counts

Do not make Now a transcript viewer, Dossier surface, or Workbench progress board.

- [ ] **Step 5: Reorder navigation**

Set order:

```text
Now
Workbench
Logbook
Usage
Sources
Settings
```

- [ ] **Step 6: Verify focused tests**

Run:

```bash
npm test -- --run src/ui/__tests__/navigation.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: pass after expectation updates.

---

### Task 11: Update Docs And Acceptance Evidence

**Files:**
- Modify `docs/reference/daemon-api.md`
- Modify `docs/reference/sources.md`
- Modify `docs/reference/mcp-tools.md`
- Modify `docs/reference/enrichment.md`
- Modify `docs/acceptance/product-release-gate.md`
- Modify `docs/superpowers/plans/2026-07-08-workbench-raw-enrichment-sessions.md`
- Create or update `docs/acceptance/workbench-pipeline-v1-evidence.md`

**Interfaces:**
- Docs match the new workflow and no longer describe Sources as import workflow owner.

- [ ] **Step 1: Mark older plan superseded**

Add this at the top of `docs/superpowers/plans/2026-07-08-workbench-raw-enrichment-sessions.md`:

```md
> Superseded by `docs/superpowers/plans/2026-07-08-workbench-pipeline-v1.md`.
```

- [ ] **Step 2: Update reference docs**

Document:
- published-only Logbook
- Workbench pipeline state
- Workbench Activity
- Not Added aggregate/default exclusion behavior
- source-scoped transcript permissions
- explicit Workbench transcript import
- explicit publication transition
- CLI command names

- [ ] **Step 3: Update acceptance gate**

Add checks:
- Logbook excludes unpublished/Not Added sessions.
- Default agent handoff excludes Not Added IDs/details.
- Workbench table plus Activity rail renders at desktop/tablet/mobile.
- Sources has no per-session import workflow as primary UI.
- Dossier has no Enrich button.

- [ ] **Step 4: Verify docs references**

Run:

```bash
rg -n "Sources.*import workflow|choose raw sessions|Agent Workbench|Enrich data|Not Added" docs README.md src/ui src/app
```

Expected: only intentional references remain.

---

### Task 12: Full Verification And Local Visual Check

**Files:**
- No new files unless acceptance evidence captures screenshots.

**Interfaces:**
- Produces a verified local V1 implementation.

- [ ] **Step 1: Run focused verification**

Run the focused tests from Tasks 1-11.

- [ ] **Step 2: Run build and test**

Run:

```bash
npm run build
npm run test
```

Expected: pass or document unrelated pre-existing failures with exact failing tests.

- [ ] **Step 3: Run product checks**

Run:

```bash
npm run verify:no-citations
node scripts/masthead-endpoint-matrix.js
```

Expected: pass.

- [ ] **Step 4: Run locally**

Start Masthead using the repository launcher:

```bash
npm run dev
```

Do not steal port `5173` from the installed Electron Dev app. Use the launcher behavior described in `AGENTS.md`.

- [ ] **Step 5: Inspect with in-app Browser**

Use the in-app Browser skill, not standalone Playwright, to check:
- desktop
- tablet
- narrow mobile

Verify:
- Workbench opens as dense table plus Activity rail.
- `Copy Agent Prompt` is in the top action bar.
- Not Added summary is aggregate-only by default.
- no hero/instructional page copy appears.
- Logbook shows only published sessions.
- Dossier has no Enrich button and shows Activity milestones.
- Sources is capture/permissions focused.

- [ ] **Step 6: Record acceptance evidence**

Update `docs/acceptance/workbench-pipeline-v1-evidence.md` with:
- commands run
- test result summary
- local URL inspected
- screenshots or textual Browser notes
- known residual risks

---

## Execution Order

0. Task 0: baseline and dirty-worktree guardrails.
1. Task 1: schema/repository foundation.
2. Task 2: cheap quality and legacy backfill.
3. Task 3: published-only Logbook/search/MCP.
4. Task 4: Workbench read APIs.
5. Task 5: apply/artifact readiness.
6. Task 6: explicit publication.
7. Task 7: CLI parity.
8. Task 8: transcript workflow and Sources boundary.
9. Task 9: Workbench UI.
10. Task 10: surrounding surface cleanup.
11. Task 11: docs.
12. Task 12: full verification/local run.

Do not start Task 9 before Tasks 1-7 are merged into the working tree; otherwise the UI will invent state instead of rendering canonical state.

## Self-Review

**Spec coverage:** The plan covers durable pipeline state, Activity, claims, legacy backfill, cheap quality screen, Not Added behavior, default agent prompt exclusion, explicit publication, required enrichment/dossier, conditional bug-fix trace, Workbench table plus Activity rail, Logbook-only published sessions, Sources boundary, Dossier cleanup, Now simplification, navigation order, CLI parity, source-scoped transcript permission, and verification.

**Placeholder scan:** No `TBD`, `TODO`, or "implement later" placeholders are present. Commands and file paths are concrete. Known current test files are named for CLI, Workbench, Logbook, Sources, MCP, bridge, and UI checks.

**Type consistency:** The state terms are consistent across tasks: `publish_path`, `published`, `not_added_to_logbook`; next-action names match the migration checks; artifact readiness uses `missing`, `satisfied`, `unknown`, `required`, and `not_applicable`.
