# Daemon-Owned Artifact Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent-orchestrated, direct-SQLite Workbench CLI flow with a daemon-owned authoring module that gives agents complete redacted evidence, validates a complete artifact bundle, and atomically publishes a resolved Logbook result.

**Architecture:** Add one daemon-owned authoring seam with four operations: open, evidence, submit, and finish. The CLI becomes an installed HTTP adapter to that seam; the daemon owns claims, evidence manifests, draft validation, canonical writes, publication, resolution, and idempotent recovery.

**Tech Stack:** TypeScript, Node.js 24, `node:sqlite`, local HTTP daemon, React, Vitest, Electron Forge, SQLite FTS5.

## Global Constraints

- A copied Workbench handoff and directed agent conversation use the same evidence, schemas, quality bar, persistence, and publication behavior.
- A copied handoff tells the agent to complete unattended; it does not make the agent more conservative.
- Artifact authoring may use every canonically stored, redacted session record without a transcript privacy-permission prompt.
- Sparse but non-empty canonical evidence produces low-confidence/missing-evidence findings; it does not pause for approval or remove the session from the automatic path.
- Redaction remains an ingestion/canonical-storage responsibility. Authoring never reads unredacted payload fields.
- Session package is mandatory: session enrichment plus exactly one single-session dossier.
- Runbook, ADR, and incident timeline each resolve through a published artifact, an existing published contribution, or an explicit N/A decision.
- Apply is not publish. Only a published artifact can satisfy an automatic artifact kind.
- Session dossiers have exactly one provenance session. Runbooks, ADRs, and incident timelines may use multiple sessions with explicit provenance and join rationale.
- For a newly published multi-session automatic artifact, its seed session becomes `published` and its other selected provenance sessions become `contributed`.
- Masthead does not run an internal authoring model. The external coding agent writes and revises artifacts against deterministic findings.
- MCP stays artifact-primary and read-only.
- Logbook remains published-artifact-only; finish never creates or exposes a session row as a Logbook entry.
- The Workbench UI continues to generate a plain-language handoff; it does not display terminal recipes or become an artifact editor.
- Logbook rewrite, improve, supersede, and remove tools are explicitly out of scope for this plan.
- Existing historical artifact bodies remain readable. New authoring writes `*-v2` schemas.
- The normal agent path never opens or migrates SQLite from the CLI process.
- Every copied handoff carries the canonical database identity; `open` refuses to run against a different daemon/database.

## Success Criteria

1. `mastheadctl` is installed and discoverable in development and packaged Electron installs, and its capabilities response exposes both the daemon database identity and the authoritative command path.
2. An agent can open one database-bound Workbench handoff, page/search all canonical redacted evidence, submit a complete artifact bundle, and finish it through four primary operations.
3. Evidence responses expose total counts, kind counts, first/last timestamps, revision, cursors, and descending retrieval; no fixed first-80/40 ceiling remains.
4. Submission produces deterministic, field-addressed findings and cannot mutate Logbook.
5. Finish is idempotent and atomic across artifact writes, publication, pipeline resolution, Activity, claim release, search indexing, and the authoring receipt.
6. Automatic resolution requires optional kinds to be `published`, `not_applicable`, or `contributed`; `applied` is not resolved.
7. Full artifact bodies are searchable through Logbook and `search_artifacts`.
8. Logbook renders all first-class fields for every supported artifact kind and remains backward-compatible with V1 bodies.
9. A long-session dogfood fixture proves evidence after item 80 affects the published artifact and remains available through Logbook and MCP.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/shared/workbenchAuthoring.ts` | Transport-neutral authoring DTOs, bundle, findings, receipt, and evidence contracts |
| `src/daemon/db/migrations/019_workbench_authoring_runs.sql` | Authoring run storage and optional-kind status correction |
| `src/daemon/db/migrations/020_artifact_body_search.sql` | FTS5 artifact-body search index |
| `src/daemon/db/workbenchAuthoringRepository.ts` | Persist and reload authoring runs, selected sessions, submissions, and receipts |
| `src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts` | Migration/repository behavior |
| `src/workbench/authoring/evidenceCatalog.ts` | Complete redacted evidence manifests, paging, search, and revision calculation |
| `src/workbench/authoring/authoringSchemas.ts` | V2 artifact and bundle JSON schemas |
| `src/workbench/authoring/authoringValidation.ts` | Deterministic bundle, grounding, N/A, contribution, and editorial findings |
| `src/workbench/authoring/authoringService.ts` | Deep open/evidence/submit/finish module |
| `src/workbench/authoring/__tests__/evidenceCatalog.test.ts` | Long-session complete-evidence tests |
| `src/workbench/authoring/__tests__/authoringValidation.test.ts` | V2 quality contract tests |
| `src/workbench/authoring/__tests__/authoringService.test.ts` | Open/submit/atomic-finish/idempotency tests |
| `src/daemon/workbenchAuthoringApi.ts` | Narrow HTTP route adapter returning status/body results |
| `src/daemon/__tests__/workbenchAuthoringApi.test.ts` | Real daemon HTTP contract tests |
| `src/cli/authoringClient.ts` | HTTP client used by authoring CLI commands |
| `src/electron/cliLauncher.ts` | Development/packaged `mastheadctl` launcher resolution and installation |
| `src/electron/__tests__/cliLauncher.test.ts` | Launcher path/content tests |
| `docs/adr/0012-daemon-owned-artifact-authoring.md` | Durable repository decision |

### Existing files with focused changes

| File | Change |
|---|---|
| `src/daemon/db/schema.ts` | Register migrations 019/020 and critical tables |
| `src/daemon/db/sessionTranscriptRepository.ts` | Add ascending/descending evidence paging |
| `src/shared/sessionTranscript.ts` | Add closed ascending/descending transcript query contract |
| `src/daemon/db/__tests__/sessionTranscriptRepository.test.ts` | Verify descending and uncapped iterator behavior |
| `src/daemon/db/sessionArtifactRepository.ts` | Caller-owned transaction primitives and FTS indexing |
| `src/daemon/db/__tests__/sessionArtifactRepository.test.ts` | Verify atomic persistence and body search indexing |
| `src/daemon/db/logbookArtifactRepository.ts` | Query full-body FTS for published artifact capsules |
| `src/daemon/db/workbenchPipelineRepository.ts` | Applied/published distinction and caller-owned transition primitives |
| `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts` | Verify optional status and legacy compatibility mappings |
| `src/workbench/applySessionEnrichment.ts` | Caller-owned transaction primitive |
| `src/workbench/applyArtifact.ts` | Reuse transaction primitives; stop satisfying optional kinds on apply |
| `src/workbench/types.ts` | Add V2-only grounded output types without changing V1 contracts |
| `src/workbench/transcriptWorkflow.ts` | Reuse transaction-free authoring transcript transition |
| `src/workbench/qualityPrecheck.ts` | Surface sparse-evidence warnings for authoring |
| `src/daemon/server.ts` | Delegate authoring routes and advertise capability |
| `src/core/worktreeConnector.ts` | Forward authoring GETs but block authoring mutations in read-only bridges |
| `src/core/__tests__/worktreeConnector.test.ts` | Verify method-aware authoring bridge policy |
| `src/shared/protocol.ts` | Add the `artifact_authoring` daemon capability |
| `src/daemon/healthService.ts` | Advertise authoring capability in health |
| `src/daemon/__tests__/healthService.test.ts` | Verify authoring capability in health |
| `src/daemon/settingsService.ts` | Keep Settings runtime identity capabilities aligned with health |
| `fixtures/protocol/current-health.json` | Keep the canonical compatible-health fixture current |
| `src/core/__tests__/daemonCompatibility.test.ts` | Assert authoring is a required capability |
| `src/core/__tests__/viteConnectorManager.test.ts` | Keep the compatible Vite health fixture current |
| `src/cli/mastheadctl.ts` | Structured top-level error handling |
| `src/cli/workbench.ts` | Make open/evidence/submit/finish the primary agent interface |
| `src/cli/output.ts` | Keep JSON and human-readable command results consistent |
| `src/cli/__tests__/mastheadctl.test.ts` | Agent-facing command contract |
| `src/daemon/__tests__/workbenchApi.test.ts` | Preserve existing Workbench HTTP behavior beside new routes |
| `src/electron/main.ts` | Install/refresh packaged CLI launcher on ready |
| `scripts/install-electron-dev-launcher.js` | Install dev `mastheadctl` wrapper |
| `scripts/prepare-electron-resources.js` | Assert packaged Node and CLI entries |
| `scripts/masthead-electron-packaged-smoke.js` | Prove packaged absolute CLI launcher execution |
| `src/ui/workbench/workbenchHandoff.ts` | Handoff automatic-completion protocol text |
| `src/ui/workbench/__tests__/workbenchHandoff.test.ts` | Handoff authority and no-recipe assertions |
| `src/app/daemonClient.ts` | Fetch daemon authoring capabilities for the handoff |
| `src/app/workbench/useWorkbenchController.ts` | Bind Copy handoff to live capabilities/database identity |
| `src/app/workbench/__tests__/useWorkbenchController.test.tsx` | Connected/disconnected handoff behavior |
| `src/ui/logbook/LogbookInspector.tsx` | Render complete artifact bodies |
| `src/ui/logbook/__tests__/LogbookInspector.test.tsx` | Full-body rendering |
| `src/mcp/__tests__/tools.test.ts` | Body-only artifact search |
| `scripts/dogfood-workbench-v1.js` | Replace direct-DB CLI dogfood with daemon-owned authoring dogfood |
| `scripts/dogfood-workbench-ops.js` | Assert publication/resolution invariants |
| `scripts/masthead-doctor.js` | Check authoring capability and CLI availability |
| `scripts/masthead-endpoint-matrix.js` | Register authoring reads/writes correctly |
| `scripts/masthead-endpoint-matrix-smoke.js` | Smoke bridge allow/deny behavior for authoring routes |
| `CONTEXT.md` | Add authoring-run/module/bundle vocabulary |
| `README.md` | Describe the installed agent authoring loop |
| `openwiki/logbook-and-workbench.md` | Update code and flow map |
| `docs/reference/enrichment.md` | Replace legacy CLI runbook and remove `bug_fix_trace` |
| `docs/reference/daemon-api.md` | Document authoring endpoints |
| `docs/reference/mcp-tools.md` | Reaffirm read-only MCP and full-body search |
| `docs/acceptance/workbench-v1-evidence.md` | Record daemon-owned authoring evidence |
| `docs/acceptance/workbench-ops-complete-evidence.md` | Record long-session operational proof |
| `docs/acceptance/product-release-gate.md` | Add long-session authoring release gate |

---

## Test Fixture Contracts

Code snippets below use these test-only helpers. Define them locally in the named test file (or import the existing repository helper where noted); do not add production abstractions for them.

```ts
type TestHttpResponse = { status: number; body: any };
type PublishFixtureInput = {
  kind: WorkbenchArtifactKind;
  title: string;
  body: Record<string, unknown>;
};

declare function testDb(): Promise<MastheadDatabase>; // open a migrated in-memory/temp database
declare function testDatabaseId(db: MastheadDatabase): string; // read its canonical database identity
declare function seedSession(db: MastheadDatabase, input: { sessionId: string; project?: string }): void;
declare function seedSessionWithRedactedEvidence(db: MastheadDatabase, sessionId: string): void;
declare function seedLongSession(db: MastheadDatabase, sessionId: string, itemCount: number): void;

declare function validBundle(runId: string, sessionIds: string[]): WorkbenchAuthoringBundle;
declare function validBundle(run: WorkbenchAuthoringRunDto): WorkbenchAuthoringBundle;
declare function validAuthoringBundle(): WorkbenchAuthoringBundle;
declare function validValidationInput(
  bundle: WorkbenchAuthoringBundle
): WorkbenchAuthoringValidationInput;
declare function invalidBundle(runId: string, evidenceRevision: string): WorkbenchAuthoringBundle;
declare function receiptFor(runId: string): WorkbenchAuthoringReceipt;

declare function readyAuthoringDb(): Promise<MastheadDatabase>; // one selected session with usable redacted evidence
declare function readySessionDb(): Promise<MastheadDatabase>; // compile-ready pipeline state before optional resolution
declare function submittedAuthoringDb(): Promise<MastheadDatabase>; // accepted runbook+dossier bundle ready to finish
declare function expireAuthoringClaims(db: MastheadDatabase, runId: string): void;

declare function testDaemon(): Promise<MastheadDaemon>; // real daemon over a temp migrated database
declare function listen(daemon: MastheadDaemon): Promise<string>;
declare function getJson(baseUrl: string, path: string): Promise<TestHttpResponse>;
declare function postJson(baseUrl: string, path: string, body: unknown): Promise<TestHttpResponse>;
declare function publishFixtureArtifact(db: MastheadDatabase, input: PublishFixtureInput): SessionArtifactRecord;

declare function queueSession(sessionId: string): WorkbenchQueueSessionDto;
declare function renderWorkbenchController(): void;
declare function latest(): UseWorkbenchControllerResult;
declare const authoringCapabilitiesDeferred: {
  resolve(value: WorkbenchAuthoringCapabilitiesDto | undefined): void;
};
```

`seedSessionWithRedactedEvidence()` inserts only canonical redacted message/tool/file/checkpoint/signal columns. `seedLongSession()` inserts exactly `itemCount` unique ordered rows and places the decisive outcome plus a successful verification after item 480 when `itemCount >= 500`. Bundle fixtures must satisfy every V2 field/claim-evidence rule unless their name is `invalidBundle`.

---

### Task 1: Add authoring contracts and durable run storage

**Files:**
- Create: `src/shared/workbenchAuthoring.ts`
- Create: `src/daemon/db/migrations/019_workbench_authoring_runs.sql`
- Create: `src/daemon/db/workbenchAuthoringRepository.ts`
- Create: `src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts`
- Modify: `src/daemon/db/schema.ts`

**Interfaces:**
- Produces: `WorkbenchAuthoringCapabilitiesDto`, `WorkbenchAuthoringRunDto`, `WorkbenchAuthoringBundle`, `WorkbenchAuthoringFinding`, `WorkbenchAuthoringReceipt`, `createWorkbenchAuthoringRun()`, `getWorkbenchAuthoringRun()`, `findReusableWorkbenchAuthoringRun()`, `resetWorkbenchAuthoringRunEvidence()`, `saveWorkbenchAuthoringSubmission()`, `completeWorkbenchAuthoringRun()`.
- Consumes: existing `MastheadDatabase`, `workbench_claims`, `sessions`, and artifact-kind vocabulary.

- [ ] **Step 1: Write repository and migration tests**

Add tests that migrate a temporary database, seed two sessions and claims, create one run, reload it, save a revision-needed submission, save a ready submission, complete it, and verify a second completion returns the same receipt.

```ts
test("persists an idempotent multi-session authoring run", async () => {
  const db = await testDb();
  seedSession(db, { sessionId: "session:a", project: "Masthead" });
  seedSession(db, { sessionId: "session:b", project: "Masthead" });
  const claims = claimWorkbenchSessions(db, {
    claimedBy: "codex",
    expiresAt: "2026-07-10T12:15:00.000Z",
    sessionIds: ["session:a", "session:b"]
  }).claims;

  const created = createWorkbenchAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    evidenceRevision: "evidence:1",
    runId: "authoring:1",
    sessions: claims.map((claim, ordinal) => ({
      claimId: claim.claimId,
      ordinal,
      sessionId: claim.sessionId
    }))
  });

  expect(created).toMatchObject({
    runId: "authoring:1",
    status: "open",
    sessionIds: ["session:a", "session:b"]
  });

  saveWorkbenchAuthoringSubmission(db, {
    bundle: validBundle("authoring:1", ["session:a", "session:b"]),
    evidenceRevision: "evidence:1",
    findings: [],
    runId: "authoring:1",
    status: "ready_to_finish"
  });

  const receipt = receiptFor("authoring:1");
  expect(completeWorkbenchAuthoringRun(db, { receipt, runId: "authoring:1" })).toEqual(receipt);
  expect(completeWorkbenchAuthoringRun(db, { receipt, runId: "authoring:1" })).toEqual(receipt);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts
```

Expected: FAIL because migration 019 and `workbenchAuthoringRepository.ts` do not exist.

- [ ] **Step 3: Add the shared contracts**

Define the transport contract exactly once:

```ts
export type WorkbenchAutomaticArtifactKind = "runbook" | "adr" | "incident_timeline";
export type WorkbenchAuthoredArtifactKind = "session_dossier" | WorkbenchAutomaticArtifactKind;
export type WorkbenchAuthoringRunStatus = "open" | "needs_revision" | "ready_to_finish" | "completed";

export type WorkbenchClaimEvidence = {
  path: string;
  evidenceRefs: string[];
};

export type WorkbenchAuthoringCapabilitiesDto = {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  transport: "daemon_http";
  command: string;
  databaseId: string;
  operations: ["open", "status", "evidence", "submit", "finish"];
  bundleVersion: "workbench-authoring-v1";
  evidencePolicy: "all_canonical_redacted_evidence";
};

export type WorkbenchSessionPackageDraft = {
  sessionId: string;
  enrichment: Record<string, unknown>;
  dossier: Record<string, unknown>;
};

export type WorkbenchArtifactDraft = {
  kind: WorkbenchAutomaticArtifactKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  output: Record<string, unknown>;
};

export type WorkbenchNotApplicableDecision = {
  sessionId: string;
  kind: WorkbenchAutomaticArtifactKind;
  reason: string;
  evidenceRefs: string[];
};

export type WorkbenchContributionDecision = {
  sessionId: string;
  kind: WorkbenchAutomaticArtifactKind;
  publishedArtifactId: string;
};

export type WorkbenchAuthoringBundle = {
  bundleVersion: "workbench-authoring-v1";
  runId: string;
  evidenceRevision: string;
  sessionPackages: WorkbenchSessionPackageDraft[];
  artifacts: WorkbenchArtifactDraft[];
  notApplicable: WorkbenchNotApplicableDecision[];
  contributions: WorkbenchContributionDecision[];
};

export type WorkbenchAuthoringFinding = {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
  sessionId?: string;
  artifactKind?: "session_enrichment" | WorkbenchAuthoredArtifactKind;
};

export type WorkbenchAuthoringReceipt = {
  runId: string;
  completedAt: string;
  publishedArtifactIds: string[];
  resolvedSessionIds: string[];
  notApplicable: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind }>;
  contributions: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind; artifactId: string }>;
};

export type WorkbenchAuthoringRunDto = {
  runId: string;
  actorId: string;
  databaseId: string;
  status: WorkbenchAuthoringRunStatus;
  evidenceRevision: string;
  sessionIds: string[];
  claimIds: string[];
  claimsExpireAt: string;
  claimStatus: "active" | "expired" | "conflicted" | "released";
  findings: WorkbenchAuthoringFinding[];
  bundle?: WorkbenchAuthoringBundle;
  receipt?: WorkbenchAuthoringReceipt;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
```

- [ ] **Step 4: Add migration 019**

```sql
CREATE TABLE workbench_authoring_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  bundle_json TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (status IN ('open', 'needs_revision', 'ready_to_finish', 'completed'))
);

CREATE TABLE workbench_authoring_run_sessions (
  run_id TEXT NOT NULL REFERENCES workbench_authoring_runs(run_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES workbench_claims(claim_id),
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (run_id, session_id)
);

CREATE INDEX idx_workbench_authoring_run_status
  ON workbench_authoring_runs(status, updated_at DESC);

CREATE INDEX idx_workbench_authoring_run_session
  ON workbench_authoring_run_sessions(session_id, run_id);

UPDATE workbench_session_state
SET runbook_status = CASE
      WHEN runbook_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'runbook'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN runbook_status = 'satisfied' THEN 'applied'
      ELSE runbook_status
    END,
    adr_status = CASE
      WHEN adr_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'adr'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN adr_status = 'satisfied' THEN 'applied'
      ELSE adr_status
    END,
    incident_timeline_status = CASE
      WHEN incident_timeline_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'incident_timeline'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN incident_timeline_status = 'satisfied' THEN 'applied'
      ELSE incident_timeline_status
    END;
```

Register version 19 in `schema.ts` and add both new tables to `criticalTables`.

- [ ] **Step 5: Implement the repository**

The repository must serialize only at the database edge, return typed DTOs, preserve session order, and return the stored receipt when completion is retried.

```ts
export function findReusableWorkbenchAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): WorkbenchAuthoringRunDto | undefined;

export function resetWorkbenchAuthoringRunEvidence(
  db: MastheadDatabase,
  input: { evidenceRevision: string; runId: string; updatedAt: string }
): WorkbenchAuthoringRunDto;
```

`findReusableWorkbenchAuthoringRun()` must compare the exact ordered-normalized session set, not merely any overlap. `resetWorkbenchAuthoringRunEvidence()` sets `status = 'open'`, clears `bundle_json`, resets `findings_json = '[]'`, updates the evidence revision, and preserves a completed run unchanged.

```ts
export function completeWorkbenchAuthoringRun(
  db: MastheadDatabase,
  input: { runId: string; receipt: WorkbenchAuthoringReceipt }
): WorkbenchAuthoringReceipt {
  const existing = getWorkbenchAuthoringRun(db, input.runId);
  if (!existing) throw new Error(`authoring_run_not_found:${input.runId}`);
  if (existing.receipt) return existing.receipt;

  db.prepare(
    `UPDATE workbench_authoring_runs
     SET status = 'completed', receipt_json = ?, completed_at = ?, updated_at = ?
     WHERE run_id = ?`
  ).run(
    JSON.stringify(input.receipt),
    input.receipt.completedAt,
    input.receipt.completedAt,
    input.runId
  );
  return getWorkbenchAuthoringRun(db, input.runId)!.receipt!;
}
```

- [ ] **Step 6: Run schema and repository tests**

Run:

```bash
npm test -- --run \
  src/daemon/db/__tests__/schema.test.ts \
  src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/workbenchAuthoring.ts src/daemon/db/migrations/019_workbench_authoring_runs.sql src/daemon/db/workbenchAuthoringRepository.ts src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts src/daemon/db/schema.ts
git commit -m "feat: add durable Workbench authoring runs"
```

---

### Task 2: Replace bounded packets with a complete redacted evidence catalog

**Files:**
- Create: `src/workbench/authoring/evidenceCatalog.ts`
- Create: `src/workbench/authoring/__tests__/evidenceCatalog.test.ts`
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `src/daemon/db/sessionTranscriptRepository.ts`
- Modify: `src/shared/sessionTranscript.ts`
- Modify: `src/daemon/db/__tests__/sessionTranscriptRepository.test.ts`

**Interfaces:**
- Produces: `getAuthoringEvidenceManifest(db, sessionIds)`, `getAuthoringEvidencePage(db, query)`, `authoringEvidenceRevision(db, sessionIds)`, and an ordered `iterateSessionTranscriptItems()` repository primitive.
- Consumes: canonical redacted transcript rows only: `messages.text_redacted`, `tool_results.output_redacted`, file effects, checkpoints, and runtime signals.

- [ ] **Step 1: Write a long-session failing test**

Seed 500 ordered canonical items. Put the only final outcome and successful verification after item 480.

```ts
test("pages every redacted item and can retrieve the final outcome first", async () => {
  const db = await testDb();
  seedLongSession(db, "session:long", 500);

  const manifest = getAuthoringEvidenceManifest(db, ["session:long"]);
  expect(manifest.sessions[0]).toMatchObject({
    sessionId: "session:long",
    totalItems: 500
  });

  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = getAuthoringEvidencePage(db, {
      cursor,
      limit: 75,
      order: "asc",
      sessionId: "session:long"
    });
    page.items.forEach((item) => seen.add(item.itemId));
    cursor = page.nextCursor;
  } while (cursor);
  expect(seen.size).toBe(500);

  const latest = getAuthoringEvidencePage(db, {
    limit: 25,
    order: "desc",
    query: "final outcome",
    sessionId: "session:long"
  });
  expect(latest.items[0]?.text).toContain("final outcome");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
npm test -- --run src/workbench/authoring/__tests__/evidenceCatalog.test.ts
```

Expected: FAIL because the evidence catalog does not exist.

- [ ] **Step 3: Extend transcript paging without changing default callers**

Add `order?: "asc" | "desc"` to `SessionTranscriptQuery`. Generate the SQL direction from the closed union, never from an arbitrary string:

```ts
const direction = query.order === "desc" ? "DESC" : "ASC";
const rows = db
  .prepare(
    `SELECT itemId, sessionId, kind, role, label, text, observedAt, sourceRefJson, status, exitCode, toolName
     FROM (${parts.map((part) => part.sql).join(" UNION ALL ")})
     ORDER BY observedAt ${direction}, itemId ${direction}
     LIMIT ? OFFSET ?`
  )
  .all(...parts.flatMap((part) => part.params), limit, offset) as TranscriptRow[];
```

Keep existing numeric cursor behavior so existing MCP and UI callers remain compatible.

- [ ] **Step 4: Add evidence DTOs**

```ts
export type WorkbenchAuthoringEvidenceManifest = {
  evidenceRevision: string;
  sessions: Array<{
    sessionId: string;
    totalItems: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    coverage: {
      messages: number;
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      toolResults: number;
      fileEffects: number;
      checkpoints: number;
      runtimeSignals: number;
    };
    kindCounts: Array<{ kind: string; count: number }>;
    warnings: string[];
  }>;
};

export type WorkbenchAuthoringEvidencePage = {
  evidenceRevision: string;
  sessionId: string;
  total: number;
  items: SessionTranscriptItem[];
  nextCursor?: string;
};
```

- [ ] **Step 5: Implement manifest, revision, and paging**

The revision must be deterministic for the selected session set and change when any canonical redacted item identity, ordering field, content, status, or exit code changes—not only when the count changes. Add an uncapped ordered iterator in `sessionTranscriptRepository.ts`; do not construct the revision from the paginated public API.

```ts
export function authoringEvidenceRevision(db: MastheadDatabase, sessionIds: string[]): string {
  const hash = createHash("sha256");
  for (const sessionId of normalizedSessionIds(sessionIds)) {
    hash.update(`${JSON.stringify({ sessionId })}\n`);
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      hash.update(`${JSON.stringify({
        exitCode: item.exitCode,
        itemId: item.itemId,
        kind: item.kind,
        observedAt: item.observedAt,
        role: item.role,
        status: item.status,
        text: item.text,
        toolName: item.toolName
      })}\n`);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

export function getAuthoringEvidencePage(
  db: MastheadDatabase,
  query: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    query?: string;
    order?: "asc" | "desc";
  }
): WorkbenchAuthoringEvidencePage {
  const result = getSessionTranscript(db, {
    cursor: query.cursor,
    kind: query.kind,
    limit: Math.max(1, Math.min(query.limit ?? 100, 250)),
    order: query.order,
    q: query.query,
    sessionId: query.sessionId
  });
  return {
    evidenceRevision: authoringEvidenceRevision(db, [query.sessionId]),
    items: result.items,
    nextCursor: result.nextCursor,
    sessionId: query.sessionId,
    total: result.total
  };
}
```

The Task 4 run-evidence wrapper replaces the page's single-session revision with the current revision for the run's full selected session set, so every page can be compared directly with `run.evidenceRevision`.

Do not read `source_policies`, raw payload blobs, or unredacted columns anywhere in this module.

- [ ] **Step 6: Run evidence and transcript repository tests**

```bash
npm test -- --run \
  src/daemon/db/__tests__/sessionTranscriptRepository.test.ts \
  src/workbench/authoring/__tests__/evidenceCatalog.test.ts
```

Expected: PASS, including 500 unique items and descending final-outcome retrieval.

- [ ] **Step 7: Commit**

```bash
git add src/shared/workbenchAuthoring.ts src/shared/sessionTranscript.ts src/daemon/db/sessionTranscriptRepository.ts src/daemon/db/__tests__/sessionTranscriptRepository.test.ts src/workbench/authoring/evidenceCatalog.ts src/workbench/authoring/__tests__/evidenceCatalog.test.ts
git commit -m "feat: expose complete Workbench evidence catalog"
```

---

### Task 3: Define the V2 artifact bundle and deterministic quality findings

**Files:**
- Create: `src/workbench/authoring/authoringSchemas.ts`
- Create: `src/workbench/authoring/authoringValidation.ts`
- Create: `src/workbench/authoring/__tests__/authoringValidation.test.ts`
- Modify: `src/workbench/types.ts`

**Interfaces:**
- Produces: `getAuthoringBundleSchema()`, `validateAuthoringBundle(input)`, `WorkbenchAuthoringValidationInput`, and V2 outputs with `claimEvidence`.
- Consumes: `WorkbenchAuthoringBundle`, selected session IDs, indexed redacted evidence metadata, and existing published artifacts.

- [ ] **Step 1: Write failing validation tests**

Cover one valid bundle and the important invalid cases.

```ts
test("rejects uncited claims and easy unsupported N/A decisions", () => {
  const bundle = validAuthoringBundle();
  bundle.sessionPackages[0]!.dossier.claimEvidence = [];
  bundle.notApplicable[0] = {
    evidenceRefs: [],
    kind: "adr",
    reason: "No ADR.",
    sessionId: "session:a"
  };

  const result = validateAuthoringBundle({
    bundle,
    coverageWarningsBySession: new Map(),
    evidenceByRef: new Map([
      ["message:a:1", { exitCode: undefined, kind: "message", sessionId: "session:a", status: undefined }],
      ["tool_result:a:2", { exitCode: 0, kind: "tool_result", sessionId: "session:a", status: "completed" }]
    ]),
    publishedArtifacts: [],
    selectedSessionIds: ["session:a"]
  });

  expect(result.ok).toBe(false);
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "missing_claim_evidence", path: "sessionPackages[0].dossier.claimEvidence" }),
      expect.objectContaining({ code: "weak_not_applicable_reason", path: "notApplicable[0].reason" }),
      expect.objectContaining({ code: "not_applicable_without_evidence", path: "notApplicable[0].evidenceRefs" })
    ])
  );
});

test("requires every automatic kind to resolve exactly once", () => {
  const bundle = validAuthoringBundle();
  bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "incident_timeline");

  const result = validateAuthoringBundle(validValidationInput(bundle));

  expect(result.findings).toContainEqual(
    expect.objectContaining({
      code: "unresolved_automatic_kind",
      artifactKind: "incident_timeline",
      sessionId: "session:a"
    })
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --run src/workbench/authoring/__tests__/authoringValidation.test.ts
```

Expected: FAIL because the authoring schema and validator do not exist.

- [ ] **Step 3: Add V2 grounding to every authored output**

Import the shared claim-evidence contract from `src/shared/workbenchAuthoring.ts`, then define a V2-only grounded envelope. Do not add the field to the existing V1 output types:

```ts
import type { WorkbenchClaimEvidence } from "../shared/workbenchAuthoring.ts";

export type WorkbenchGroundedOutput = {
  title: string;
  confidence: WorkbenchConfidence;
  evidenceRefs: string[];
  claimEvidence: WorkbenchClaimEvidence[];
  missingEvidence: string[];
};

export type SessionEnrichmentOutputV2 = SessionEnrichmentOutput & WorkbenchGroundedOutput;
```

Use JSON-style property paths such as `decision`, `fixSteps[0]`, and `verification[1]`. The validator must confirm the path exists and every ref belongs to the artifact's declared provenance evidence.

Define validation evidence metadata explicitly so rules such as “passed verification” do not infer semantics from an ID string:

```ts
export type WorkbenchValidationEvidence = {
  sessionId: string;
  kind: SessionTranscriptItem["kind"];
  status?: string;
  exitCode?: number;
};

export type WorkbenchAuthoringValidationInput = {
  bundle: WorkbenchAuthoringBundle;
  selectedSessionIds: string[];
  evidenceByRef: Map<string, WorkbenchValidationEvidence>;
  coverageWarningsBySession: Map<string, string[]>;
  publishedArtifacts: SessionArtifactRecord[];
};
```

- [ ] **Step 4: Implement the bundle schema**

The schema must require:

- one package per selected session;
- one enrichment and one dossier per package;
- `claimEvidence` on every authored output;
- explicit provenance on every optional artifact;
- evidence-backed reasons for N/A;
- an existing published artifact ID for contribution.

Export `getAuthoringBundleSchema()` so `open` can return the exact contract to agents.

Build V2 output schemas without mutating the existing V1 registry:

```ts
export function getWorkbenchAuthoringOutputSchema(kind: WorkbenchOutputKind): WorkbenchJsonSchema {
  const v1 = getWorkbenchSchema(kind);
  return {
    ...v1,
    properties: {
      ...v1.properties,
      claimEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "evidenceRefs"],
          properties: {
            path: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } }
          }
        }
      }
    },
    required: [...v1.required, "claimEvidence"],
    title: `${v1.title}V2`
  };
}
```

- [ ] **Step 5: Implement deterministic findings**

Use field-addressed findings and closed codes:

```ts
const MIN_TITLE_LENGTH = 12;
const MIN_SUMMARY_LENGTH = 40;
const MIN_NA_REASON_LENGTH = 24;

function validateRequiredText(
  findings: WorkbenchAuthoringFinding[],
  value: unknown,
  path: string,
  minimum: number
): void {
  if (typeof value !== "string" || value.trim().length < minimum) {
    findings.push({
      code: "insufficient_specificity",
      message: `${path} must contain at least ${minimum} non-whitespace characters.`,
      path,
      severity: "error"
    });
  }
}
```

Required rules:

- reject empty required strings and claim-bearing arrays;
- reject generic titles and duplicate title/summary text;
- require claim evidence for decisions, outcomes, fixes, root cause, verification, and timeline events;
- require at least two distinct refs for `high` confidence;
- reject `high` confidence for a session with sparse-coverage warnings and require at least one `missingEvidence` entry in its enrichment/dossier;
- require a passed verification ref for high-confidence runbooks;
- require multi-session join rationale and reject the existing weak-join patterns;
- require every provenance session to be selected and the seed session to be present; publishing resolves the seed as `published` and every other provenance session as `contributed`;
- require N/A reason length and at least one reviewed evidence ref;
- verify contribution points to a current published artifact of the same kind containing that session;
- reject an automatic kind resolved more than once;
- warnings do not block submit; errors do.

- [ ] **Step 6: Keep legacy V1 validation readable but route new authoring to V2**

Keep `getWorkbenchSchema()` and `validateWorkbenchOutput()` behavior unchanged for V1 callers. New authoring code must call only `getWorkbenchAuthoringOutputSchema()`/`validateAuthoringBundle()` and store `schemaVersion: "<kind>-v2"`.

- [ ] **Step 7: Run validation suites**

```bash
npm test -- --run \
  src/workbench/__tests__/schemas.test.ts \
  src/workbench/__tests__/validation.test.ts \
  src/workbench/authoring/__tests__/authoringValidation.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/workbench/types.ts src/workbench/authoring/authoringSchemas.ts src/workbench/authoring/authoringValidation.ts src/workbench/authoring/__tests__/authoringValidation.test.ts
git commit -m "feat: add grounded artifact bundle validation"
```

---

### Task 4: Implement the daemon-owned open and submit operations

**Files:**
- Create: `src/workbench/authoring/authoringService.ts`
- Create: `src/workbench/authoring/__tests__/authoringService.test.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/workbench/transcriptWorkflow.ts`
- Modify: `src/workbench/qualityPrecheck.ts`

**Interfaces:**
- Produces: `openAuthoringRun()`, `getAuthoringRunStatus()`, `WorkbenchAuthoringRunStatusResult`, `getAuthoringRunEvidence()`, `submitAuthoringBundle()`, `renewOrReacquireAuthoringClaimsInTransaction()`.
- Consumes: Task 1 repository, Task 2 evidence catalog, Task 3 validation, claims, Workbench state, and canonical evidence coverage.

- [ ] **Step 1: Write failing open/submit tests**

```ts
test("opens selected sessions without a privacy permission gate", async () => {
  const db = await testDb();
  seedSessionWithRedactedEvidence(db, "session:a");

  const opened = openAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  });

  expect(opened.run.status).toBe("open");
  expect(opened.run.sessionIds).toEqual(["session:a"]);
  expect(opened.evidence.sessions[0]?.totalItems).toBeGreaterThan(0);
  expect(opened.contract.automaticKinds).toEqual(["runbook", "adr", "incident_timeline"]);
  expect(opened.contract).not.toHaveProperty("permissionRequired");
  expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
    qualityStatus: "passed",
    transcriptStatus: "available"
  });
});

test("refuses the wrong daemon database before claiming sessions", async () => {
  const db = await testDb();
  seedSessionWithRedactedEvidence(db, "session:a");

  expect(() => openAuthoringRun(db, {
    actorId: "codex",
    databaseId: "different-database",
    sessionIds: ["session:a"]
  })).toThrow("database_identity_mismatch");
  expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get())
    .toEqual({ count: 0 });
});

test("stores findings without applying artifacts", async () => {
  const db = await readyAuthoringDb();
  const opened = openAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  });
  const result = submitAuthoringBundle(db, {
    bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
    runId: opened.run.runId
  });

  expect(result.accepted).toBe(false);
  expect(result.run.status).toBe("needs_revision");
  expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifacts").get()).toEqual({ count: 0 });
});

test("reuses the same run and claims when open is retried", async () => {
  const db = await readyAuthoringDb();
  const input = {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  };

  const first = openAuthoringRun(db, input);
  const second = openAuthoringRun(db, input);

  expect(second.run.runId).toBe(first.run.runId);
  expect(db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_claims WHERE released_at IS NULL"
  ).get()).toEqual({ count: 1 });
});

test("submit reacquires an expired lease and refuses another actor's live claim", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
  const db = await readyAuthoringDb();
  const opened = openAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  });
  expireAuthoringClaims(db, opened.run.runId);

  const renewed = submitAuthoringBundle(db, {
    bundle: validBundle(opened.run.runId, ["session:a"]),
    runId: opened.run.runId
  });
  expect(Date.parse(renewed.run.claimsExpireAt)).toBeGreaterThan(Date.now());

  const conflictedDb = await readyAuthoringDb();
  const conflictedRun = openAuthoringRun(conflictedDb, {
    actorId: "codex",
    databaseId: testDatabaseId(conflictedDb),
    sessionIds: ["session:a"]
  });
  expireAuthoringClaims(conflictedDb, conflictedRun.run.runId);
  claimWorkbenchSessions(conflictedDb, {
    claimedBy: "other-agent",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sessionIds: ["session:a"]
  });
  expect(() => submitAuthoringBundle(conflictedDb, {
    bundle: validBundle(conflictedRun.run.runId, ["session:a"]),
    runId: conflictedRun.run.runId
  }))
    .toThrow("authoring_claim_conflict:session:a");
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- --run src/workbench/authoring/__tests__/authoringService.test.ts
```

Expected: FAIL because `authoringService.ts` does not exist.

- [ ] **Step 3: Add caller-owned pipeline transition primitives**

Refactor existing transition functions so wrappers may still own their transactions while the authoring module can compose them:

```ts
export function markWorkbenchTranscriptAvailableInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): void {
  const now = new Date().toISOString();
  ensureWorkbenchSessionState(db, input.sessionId);
  db.prepare(
    `UPDATE workbench_session_state
     SET transcript_status = 'available', updated_at = ?
     WHERE session_id = ?`
  ).run(now, input.sessionId);
  insertWorkbenchActivity(db, {
    activityId: stableRecordId("workbench_activity", [input.sessionId, "authoring_evidence_ready"]),
    actor: input.actor,
    details: { source: "canonical_redacted_evidence" },
    eventAt: now,
    eventType: "authoring_evidence_ready",
    sessionId: input.sessionId,
    summary: "Canonical redacted evidence ready for authoring"
  });
}
```

Add the remaining transaction-free primitives with these exact signatures:

```ts
export function markWorkbenchQualityPassedInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): void;

export function claimWorkbenchSessionsInTransaction(
  db: MastheadDatabase,
  input: { claimedBy: string; expiresAt: string; sessionIds: string[] }
): WorkbenchClaimBatch;

export function renewOrReacquireAuthoringClaimsInTransaction(
  db: MastheadDatabase,
  input: { actorId: string; expiresAt: string; runId: string }
): WorkbenchAuthoringRunDto;
```

The renewal primitive uses a 60-minute lease: it renews claims still owned by the run, replaces an expired claim when the session is otherwise unclaimed, updates the run-session `claim_id`, and throws `authoring_claim_conflict:<sessionId>` when another actor owns a live claim. Preserve existing exported wrappers for UI compatibility.

- [ ] **Step 4: Implement `openAuthoringRun()`**

Inside one `BEGIN IMMEDIATE` transaction:

1. normalize and verify every selected session;
2. compare the required input `databaseId` with `getOrCreateDatabaseIdentity(db)` and fail `database_identity_mismatch` before claiming anything;
3. find the newest run for the same database, actor, and exact normalized session set;
4. return that run unchanged when completed or when its evidence revision is current;
5. when reusable evidence changed, clear its bundle/findings, set the new revision/status `open`, and retain/reacquire its claims so the agent can restart cleanly;
6. ensure each Workbench state exists when no reusable run exists;
7. inspect canonical redacted coverage directly;
8. mark transcript available when canonical evidence exists;
9. run the deterministic capture-quality precheck; treat zero usable redacted text as `missing_canonical_evidence`, otherwise mark quality passed and return sparse-coverage warnings for the authoring validator;
10. claim all eligible sessions for 60 minutes;
11. create the database-bound authoring run and run-session rows;
12. record `authoring_opened` Activity;
13. return the run, evidence manifest, V2 bundle schema, current artifacts, and one agent guidance contract.

If a selected session has zero canonical evidence, return `missing_canonical_evidence`; do not return a privacy or permission error.

The authoring path never invokes the explicit UI `quality_fail`/Not Added transition. Sparse evidence must lower confidence, populate `missingEvidence`, and usually justify optional-kind N/A decisions; it does not make the copied handoff interactive.

Run reuse is the recovery path for a lost CLI response and for `evidence_revision_changed`: the agent repeats open with the same actor/session set, receives the existing or reset run ID, and restarts paging. Overlapping but non-identical session sets still follow normal claim-conflict rules.

```ts
export function openAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAuthoringRunResult;

export type OpenAuthoringRunResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidence: WorkbenchAuthoringEvidenceManifest;
  bundleSchema: Record<string, unknown>;
  contract: {
    contractVersion: "workbench-authoring-v1";
    sessionPackageRequired: true;
    automaticKinds: ["runbook", "adr", "incident_timeline"];
    completion: "publish_and_resolve";
    evidencePolicy: "all_canonical_redacted_evidence";
  };
  currentArtifacts: SessionArtifactRecord[];
};
```

- [ ] **Step 5: Implement read-only status and evidence delegation**

`getAuthoringRunStatus()` reports the earliest `claimsExpireAt`, whether the run still owns every live claim, and whether the current full-session revision still equals `run.evidenceRevision`. `getAuthoringRunEvidence()` rejects session IDs outside the run and returns `evidence_revision_changed` before paging when the run is stale. Both operations are side-effect free so GET routes remain safe through the read-only worktree bridge. The recovery instruction for a changed revision is to repeat open with the same actor/session set. Submit and finish perform renewal or reacquisition; a conflicting owner produces a stable conflict instead of partial ownership.

```ts
export type WorkbenchAuthoringRunStatusResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidenceStatus: "current" | "changed";
};
```

- [ ] **Step 6: Implement `submitAuthoringBundle()`**

Submission must:

1. reject a completed run;
2. reject mismatched `runId`;
3. renew or safely reacquire every run claim;
4. compare bundle, stored, and current evidence revisions;
5. build known evidence-ref sets for the declared provenance sessions;
6. call `validateAuthoringBundle()`;
7. store the bundle and findings;
8. set `needs_revision` when errors exist, otherwise `ready_to_finish`;
9. write no artifact or enrichment rows.

```ts
export type SubmitAuthoringBundleResult = {
  ok: true;
  accepted: boolean;
  findings: WorkbenchAuthoringFinding[];
  run: WorkbenchAuthoringRunDto;
};
```

- [ ] **Step 7: Run the authoring service tests**

```bash
npm test -- --run \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

Expected: PASS and zero artifacts after both accepted and rejected submissions.

- [ ] **Step 8: Commit**

```bash
git add src/workbench/authoring/authoringService.ts src/workbench/authoring/__tests__/authoringService.test.ts src/daemon/db/workbenchPipelineRepository.ts src/workbench/transcriptWorkflow.ts src/workbench/qualityPrecheck.ts
git commit -m "feat: open and validate daemon-owned authoring runs"
```

---

### Task 5: Make finish atomic, published-only, and idempotent

**Files:**
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/workbench/authoring/__tests__/authoringService.test.ts`
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/__tests__/sessionArtifactRepository.test.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`
- Modify: `src/workbench/applySessionEnrichment.ts`
- Modify: `src/workbench/applyArtifact.ts`

**Interfaces:**
- Produces: `finishAuthoringRun(db, { runId })`, caller-owned apply/publish primitives, `applied` versus `published` optional states.
- Consumes: an accepted Task 4 submission with an unchanged evidence revision.

- [ ] **Step 1: Write failing atomicity and resolution tests**

```ts
test("does not resolve an applied optional artifact", async () => {
  const db = await readySessionDb();
  markWorkbenchArtifactApplied(db, {
    actor: { kind: "agent", id: "test" },
    artifactKind: "runbook",
    sessionId: "session:a"
  });
  publishWorkbenchSession(db, {
    actor: { kind: "agent", id: "test" },
    sessionId: "session:a"
  });

  expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
    resolutionStatus: "compile_ready",
    runbookStatus: "applied"
  });
});

test("finishes once and publishes the complete bundle atomically", async () => {
  const db = await submittedAuthoringDb();
  const first = finishAuthoringRun(db, { runId: "authoring:1" });
  const second = finishAuthoringRun(db, { runId: "authoring:1" });

  expect(second).toEqual(first);
  expect(first.publishedArtifactIds).toHaveLength(2);
  expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
    resolutionStatus: "automatic_resolved",
    runbookStatus: "published",
    adrStatus: "not_applicable",
    incidentTimelineStatus: "not_applicable",
    sessionPackageStatus: "published"
  });
  expect(
    db.prepare(
      "SELECT COUNT(*) AS count FROM session_artifacts WHERE status = 'current' AND publication_status = 'published'"
    ).get()
  ).toEqual({ count: 2 });
});

test("rolls back every write when visibility verification fails", async () => {
  const db = await submittedAuthoringDb();
  expect(() =>
    finishAuthoringRun(db, {
      runId: "authoring:1",
      verifyPublished: () => false
    })
  ).toThrow("authoring_finish_visibility_failed");
  expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifacts").get()).toEqual({ count: 0 });
  expect(getWorkbenchAuthoringRun(db, "authoring:1")?.status).toBe("ready_to_finish");
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- --run \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

Expected: FAIL because optional statuses still conflate apply and completion and finish is absent.

- [ ] **Step 3: Refactor artifact/enrichment writes for caller-owned transactions**

Create transaction-free primitives:

```ts
export function applySessionArtifactInTransaction(
  db: MastheadDatabase,
  input: SessionArtifactInput
): SessionArtifactRecord;

export function applySessionEnrichmentInTransaction(
  db: MastheadDatabase,
  options: { sessionId: string; output: SessionEnrichmentOutput }
): ApplySessionEnrichmentResult;
```

Keep existing wrappers that start/commit their own transaction for compatibility. The authoring module must call only the `InTransaction` forms.

- [ ] **Step 4: Split optional pipeline states**

Use:

```ts
export type WorkbenchOptionalKindStatus =
  | "unknown"
  | "required"
  | "applied"
  | "published"
  | "not_applicable"
  | "contributed";
```

Rename `markWorkbenchArtifactSatisfied()` to a compatibility wrapper and add:

```ts
export function markWorkbenchArtifactAppliedInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; artifactKind: WorkbenchArtifactKind; sessionId: string }
): void;

export function markWorkbenchArtifactPublishedInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; artifactKind: WorkbenchAutomaticKind; sessionId: string; artifactId: string }
): void;

export function markContributionSatisfactionForProvenanceInTransaction(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    artifactKind: WorkbenchAutomaticKind;
    provenanceSessionIds: string[];
    publishedArtifactId: string;
    seedSessionId: string;
  }
): void;
```

`isOptionalKindResolved()` must return true only for `published`, `not_applicable`, and `contributed`.

`markContributionSatisfactionForProvenanceInTransaction()` must skip `seedSessionId`; it writes `contributed` only for the remaining provenance sessions.

The legacy `bug_fix_trace_status` compatibility column still has its migration-017 CHECK constraint. When updating a runbook state, map `unknown → unknown`, `required/applied → required`, `published/contributed → satisfied`, and `not_applicable → not_applicable`; never write the new literals into that legacy column. Add a repository test for every mapping.

- [ ] **Step 5: Implement one-transaction finish**

`finishAuthoringRun()` must:

1. start `BEGIN IMMEDIATE` before reading mutable run/evidence state;
2. reload the run and return the stored receipt after committing the no-op transaction when already complete;
3. require `ready_to_finish`;
4. renew or safely reacquire every run claim, failing on partial/conflicting ownership;
5. require unchanged evidence revision inside the transaction;
6. apply every session enrichment and dossier with V2 schema versions;
7. apply every optional artifact;
8. publish every dossier and optional artifact;
9. write `published` for each optional artifact's seed session, `contributed` for its other selected provenance sessions, and the bundle's explicit N/A/existing-artifact contribution decisions;
10. mark session package published;
11. verify every new artifact is current, published, retrievable by Logbook ID, and has expected provenance;
12. require every selected session to be `automatic_resolved`;
13. release every run claim;
14. write Activity and a single receipt;
15. commit;
16. roll back all rows on any failure.

The only Logbook-visible writes are published `session_artifacts`; the session itself remains provenance/Workbench state.

```ts
export function finishAuthoringRun(
  db: MastheadDatabase,
  input: {
    runId: string;
    verifyPublished?: (artifactId: string) => boolean;
  }
): WorkbenchAuthoringReceipt {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const run = requireAuthoringRunForFinish(db, input.runId);
    if (run.receipt) {
      db.exec("COMMIT;");
      return run.receipt;
    }
    if (run.status !== "ready_to_finish") {
      throw new Error(`authoring_run_not_ready:${run.status}`);
    }
    renewOrReacquireAuthoringClaimsInTransaction(db, run);
    assertEvidenceRevisionUnchanged(db, run);
    const receipt = finishInsideTransaction(db, run, input.verifyPublished);
    completeWorkbenchAuthoringRun(db, { receipt, runId: run.runId });
    db.exec("COMMIT;");
    return receipt;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
```

- [ ] **Step 6: Run focused persistence and pipeline tests**

```bash
npm test -- --run \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/workbench/__tests__/applySessionEnrichment.test.ts \
  src/workbench/__tests__/applyArtifact.test.ts \
  src/daemon/db/__tests__/sessionArtifactRepository.test.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

Expected: PASS, including rollback, retry, and applied-not-resolved tests.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/authoring/authoringService.ts src/workbench/authoring/__tests__/authoringService.test.ts src/workbench/applySessionEnrichment.ts src/workbench/applyArtifact.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/workbenchPipelineRepository.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
git commit -m "feat: atomically finish published artifact bundles"
```

---

### Task 6: Expose the authoring seam through daemon HTTP and a thin CLI

**Files:**
- Create: `src/daemon/workbenchAuthoringApi.ts`
- Create: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Create: `src/cli/authoringClient.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/worktreeConnector.ts`
- Modify: `src/core/__tests__/worktreeConnector.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/daemon/healthService.ts`
- Modify: `src/daemon/settingsService.ts`
- Modify: `src/daemon/__tests__/healthService.test.ts`
- Modify: `fixtures/protocol/current-health.json`
- Modify: `src/core/__tests__/daemonCompatibility.test.ts`
- Modify: `src/core/__tests__/viteConnectorManager.test.ts`
- Modify: `src/cli/workbench.ts`
- Modify: `src/cli/mastheadctl.ts`
- Modify: `src/cli/output.ts`
- Modify: `src/cli/__tests__/mastheadctl.test.ts`
- Modify: `src/daemon/__tests__/workbenchApi.test.ts`

**Interfaces:**
- Produces HTTP: `GET /workbench/authoring/capabilities`, `POST /workbench/authoring/runs`, `GET /workbench/authoring/runs/:runId`, `GET /workbench/authoring/runs/:runId/evidence`, `POST /workbench/authoring/runs/:runId/submit`, `POST /workbench/authoring/runs/:runId/finish`.
- Produces CLI: `open`, `status`, `evidence`, `submit`, `finish`, `capabilities`.
- Consumes: Task 4/5 service only; CLI never imports SQLite repositories.

- [ ] **Step 1: Write failing HTTP contract tests**

```ts
test("runs the complete authoring HTTP lifecycle", async () => {
  const daemon = await testDaemon();
  const baseUrl = await listen(daemon);
  seedSessionWithRedactedEvidence(daemon.database, "session:a");

  const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
  expect(capabilities.body).toMatchObject({
    capability: "artifact_authoring",
    command: expect.any(String),
    databaseId: testDatabaseId(daemon.database),
    operations: ["open", "status", "evidence", "submit", "finish"]
  });

  const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
    actorId: "codex",
    databaseId: capabilities.body.databaseId,
    sessionIds: ["session:a"]
  });
  expect(opened.status).toBe(201);

  const evidence = await getJson(
    baseUrl,
    `/workbench/authoring/runs/${opened.body.run.runId}/evidence?sessionId=session%3Aa&order=desc&limit=25`
  );
  expect(evidence.status).toBe(200);

  const submitted = await postJson(
    baseUrl,
    `/workbench/authoring/runs/${opened.body.run.runId}/submit`,
    validBundle(opened.body.run)
  );
  expect(submitted.body.accepted).toBe(true);

  const finished = await postJson(
    baseUrl,
    `/workbench/authoring/runs/${opened.body.run.runId}/finish`,
    {}
  );
  expect(finished.body.receipt.resolvedSessionIds).toEqual(["session:a"]);
});
```

- [ ] **Step 2: Write failing CLI adapter tests**

Start a real test daemon and invoke `runMastheadCli()` with `MASTHEAD_DAEMON_URL`.

```ts
test("uses daemon-owned authoring commands without --db", async () => {
  const daemon = await testDaemon();
  const baseUrl = await listen(daemon);
  seedSessionWithRedactedEvidence(daemon.database, "session:a");

  const opened = await runMastheadCli(
    [
      "workbench", "open",
      "--database-id", testDatabaseId(daemon.database),
      "--session", "session:a",
      "--json"
    ],
    { env: { MASTHEAD_DAEMON_URL: baseUrl } }
  );

  expect(opened.exitCode).toBe(0);
  expect(JSON.parse(opened.stdout)).toMatchObject({
    ok: true,
    run: { sessionIds: ["session:a"], status: "open" }
  });
  expect(opened.stderr).toBe("");
});
```

- [ ] **Step 3: Run and verify failure**

```bash
npm test -- --run \
  src/daemon/__tests__/workbenchAuthoringApi.test.ts \
  src/cli/__tests__/mastheadctl.test.ts
```

Expected: FAIL because the endpoints and new commands do not exist.

- [ ] **Step 4: Add a small HTTP adapter module**

`workbenchAuthoringApi.ts` returns a transport result instead of writing the response itself:

```ts
export type WorkbenchAuthoringHttpResult = {
  status: number;
  body: unknown;
};

export async function routeWorkbenchAuthoringRequest(
  context: { authoringCommand: string; db: MastheadDatabase },
  request: { method: string; url: URL; body?: unknown }
): Promise<WorkbenchAuthoringHttpResult | undefined>;

export function isWorkbenchAuthoringPath(pathname: string): boolean;

export function getWorkbenchAuthoringBodyLimit(
  pathname: string,
  defaultLimitBytes: number
): number;
```

Use 201 for open; 200 for reads, accepted submissions, revision-needed submissions, and finish; 400 for malformed JSON/request envelopes; 404 for unknown runs; and 409 for state, claim, or evidence-revision conflicts. Deterministic authoring findings are domain results (`accepted: false`), not transport failures. Allow a 5 MiB submit body; all other requests use the daemon default limit.

The capabilities route must build `WorkbenchAuthoringCapabilitiesDto` from the running daemon, `getOrCreateDatabaseIdentity(db)`, and the injected authoritative launcher command; it must never be a CLI-local constant.

Add `"artifact_authoring"` to `MastheadCapability`, `REQUIRED_CLIENT_CAPABILITIES`, `healthService.ts`, `settingsService.ts`, and every canonical compatible-health fixture. The health-service, daemon-compatibility, and Vite connector tests must assert the capability is advertised and required.

- [ ] **Step 5: Delegate from `server.ts`**

Call the route module before the legacy Workbench routes. Guard body consumption with the exported path matcher so unrelated POST routes retain their request bodies:

```ts
if (isWorkbenchAuthoringPath(url.pathname)) {
  const authoringResponse = await routeWorkbenchAuthoringRequest(
    {
      authoringCommand: process.env.MASTHEAD_CLI_COMMAND ?? "mastheadctl",
      db: database
    },
    {
      body: request.method === "POST"
        ? await optionalJsonBody(
            request,
            getWorkbenchAuthoringBodyLimit(url.pathname, DEFAULT_BODY_LIMIT_BYTES)
          )
        : undefined,
      method: request.method ?? "GET",
      url
    }
  );
  if (authoringResponse) {
    sendJson(
      request,
      response,
      config.allowedOrigins,
      authoringResponse.status,
      authoringResponse.body
    );
    return;
  }
}
```

Extend the method-aware bridge matcher:

```ts
if (/^\/workbench\/authoring\/(?:capabilities|runs\/[^/]+(?:\/evidence)?)$/.test(pathname)) {
  return method === "GET";
}
```

Add bridge tests proving capabilities/status/evidence GETs pass while open/submit/finish POSTs return false.

- [ ] **Step 6: Implement the CLI HTTP client**

```ts
export class MastheadAuthoringClient {
  constructor(private readonly baseUrl: string) {}

  capabilities() {
    return this.request("GET", "/workbench/authoring/capabilities");
  }

  open(input: { actorId: string; databaseId: string; sessionIds: string[] }) {
    return this.request("POST", "/workbench/authoring/runs", input);
  }

  status(runId: string) {
    return this.request(
      "GET",
      `/workbench/authoring/runs/${encodeURIComponent(runId)}`
    );
  }

  evidence(runId: string, query: URLSearchParams) {
    return this.request(
      "GET",
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence?${query.toString()}`
    );
  }

  submit(runId: string, bundle: WorkbenchAuthoringBundle) {
    return this.request(
      "POST",
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`,
      bundle
    );
  }

  finish(runId: string) {
    return this.request(
      "POST",
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`,
      {}
    );
  }
}
```

Default to `MASTHEAD_DAEMON_URL || http://127.0.0.1:17373`. Return structured `daemon_unavailable`, HTTP status, code, and response body on failure.

- [ ] **Step 7: Make the four commands primary**

Support:

```text
mastheadctl workbench open --database-id <id> --session <id> [--session <id>] --json
mastheadctl workbench status --run <run-id> --json
mastheadctl workbench evidence --run <run-id> --session <id> [--cursor <cursor>] [--limit 100] [--order asc|desc] [--kind all|user|assistant|tools|checkpoints|files|signals] [--query <text>] --json
mastheadctl workbench submit --run <run-id> --file <bundle.json> --json
mastheadctl workbench finish --run <run-id> --json
mastheadctl workbench capabilities --json
```

Submission findings are a successful transport response even when `accepted: false`; the agent must be able to revise without treating findings as a crashed command. Finish before acceptance exits 1 with structured `run_not_ready`.

`capabilities` always calls the daemon. `open` first fetches capabilities and refuses locally with `database_identity_mismatch` when `--database-id` differs, then sends the same ID so the daemon enforces the boundary again.

Move low-level direct-database authoring commands out of primary help. Preserve `wipe-published --db --confirm` only as an explicitly documented maintenance command. Do not use direct-database apply/publish/N/A commands in any dogfood or handoff.

- [ ] **Step 8: Catch top-level CLI failures**

```ts
async function main(): Promise<void> {
  try {
    const result = await runMastheadCli(process.argv.slice(2), { env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: "unhandled_cli_error", message }
    })}\\n`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 9: Run HTTP, CLI, and existing Workbench API tests**

```bash
npm test -- --run \
  src/daemon/__tests__/workbenchAuthoringApi.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/daemon/__tests__/healthService.test.ts \
  src/core/__tests__/daemonCompatibility.test.ts \
  src/core/__tests__/viteConnectorManager.test.ts \
  src/core/__tests__/worktreeConnector.test.ts \
  src/electron/__tests__/protocol.test.ts \
  src/cli/__tests__/mastheadctl.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/daemon/workbenchAuthoringApi.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/daemon/server.ts src/daemon/__tests__/workbenchApi.test.ts src/core/worktreeConnector.ts src/core/__tests__/worktreeConnector.test.ts src/shared/protocol.ts src/daemon/healthService.ts src/daemon/settingsService.ts src/daemon/__tests__/healthService.test.ts fixtures/protocol/current-health.json src/core/__tests__/daemonCompatibility.test.ts src/core/__tests__/viteConnectorManager.test.ts src/cli/authoringClient.ts src/cli/workbench.ts src/cli/mastheadctl.ts src/cli/output.ts src/cli/__tests__/mastheadctl.test.ts
git commit -m "feat: expose daemon-owned artifact authoring CLI"
```

---

### Task 7: Install the CLI and update the automatic handoff

**Files:**
- Create: `src/electron/cliLauncher.ts`
- Create: `src/electron/__tests__/cliLauncher.test.ts`
- Modify: `src/electron/main.ts`
- Modify: `scripts/install-electron-dev-launcher.js`
- Modify: `scripts/prepare-electron-resources.js`
- Modify: `scripts/masthead-electron-packaged-smoke.js`
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

**Interfaces:**
- Produces: `resolveMastheadCliLaunchTarget()`, `installMastheadCliLauncher()`, `getWorkbenchAuthoringCapabilities()`, and handoff protocol `masthead.workbench.authoring/v1`.
- Consumes: packaged Node at `resources/daemon/node`, packaged CLI at `resources/daemon/dist/src/cli/mastheadctl.js`, selected Workbench session IDs, and daemon capabilities resolved from `activeProjectionUrl`.

- [ ] **Step 1: Write failing launcher tests**

```ts
test("writes a packaged launcher using the bundled Node runtime", async () => {
  const home = await mkdtemp(join(tmpdir(), "masthead-cli-home-"));
  const target = resolveMastheadCliLaunchTarget({
    homeDir: home,
    isPackaged: true,
    platform: "linux",
    resourcesPath: "/opt/Masthead/resources"
  });

  expect(target).toEqual({
    cliEntry: "/opt/Masthead/resources/daemon/dist/src/cli/mastheadctl.js",
    launcherPath: join(home, ".local", "bin", "mastheadctl"),
    nodePath: "/opt/Masthead/resources/daemon/node"
  });

  await installMastheadCliLauncher(target);
  const body = await readFile(target.launcherPath, "utf8");
  expect(body).toContain("resources/daemon/node");
  expect(body).toContain("mastheadctl.js");
});
```

- [ ] **Step 2: Write failing handoff tests**

```ts
test("generates an unattended authoring-v1 request without changing quality policy", () => {
  const handoff = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    databaseId: "database:test",
    sessions: [queueSession("session:a")]
  });

  expect(handoff).toContain("masthead.workbench.authoring/v1");
  expect(handoff).toContain("complete this request end to end without pausing for routine approval");
  expect(handoff).toContain("use all available canonical redacted session evidence");
  expect(handoff).toContain("produce the strongest justified artifacts");
  expect(handoff).toContain('"sessionIds":["session:a"]');
  expect(handoff).toContain('"databaseId":"database:test"');
  expect(handoff).toContain('"command":"/home/test/.local/bin/mastheadctl"');
  expect(handoff).not.toContain("permission");
  expect(handoff).not.toContain("be conservative");
  expect(handoff).not.toContain("--db");
});

test("does not generate a copied handoff before daemon capabilities load", async () => {
  authoringCapabilitiesDeferred.resolve(undefined);
  renderWorkbenchController();
  await waitFor(() => expect(latest().sessions).toHaveLength(1));

  expect(latest().handoffText).toBe("");
  expect(latest().canRun("copy_agent_prompt")).toBe(false);
});
```

- [ ] **Step 3: Run and verify failure**

```bash
npm test -- --run \
  src/electron/__tests__/cliLauncher.test.ts \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts
```

Expected: FAIL because the launcher and authoring-v1 handoff do not exist.

- [ ] **Step 4: Implement launcher resolution and atomic installation**

Write POSIX and Windows launchers with quoted absolute paths. Write to a temporary sibling, chmod 0755 on POSIX, then rename over the previous launcher.

```ts
export type MastheadCliLaunchTarget = {
  launcherPath: string;
  nodePath: string;
  cliEntry: string;
};

export function resolveMastheadCliLaunchTarget(input: {
  homeDir: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  devNodePath?: string;
  devProjectDir?: string;
}): MastheadCliLaunchTarget;

export async function installMastheadCliLauncher(
  target: MastheadCliLaunchTarget
): Promise<void>;
```

- [ ] **Step 5: Wire development and packaged installation**

- `install-electron-dev-launcher.js` writes `~/.local/bin/mastheadctl` pointing at the current checkout's Node and built CLI.
- `main.ts` resolves and installs the packaged launcher before spawning the bundled daemon, then passes its absolute path as `MASTHEAD_CLI_COMMAND` to the daemon environment.
- Launcher installation failure logs a concise diagnostic but does not prevent Masthead from opening.
- `prepare-electron-resources.js` fails if the copied CLI entry or bundled Node is missing.
- Packaged smoke uses a temporary HOME, reads the absolute command reported by capabilities, invokes it, and asserts it reaches the packaged daemon.

- [ ] **Step 6: Replace the handoff body**

Fetch capabilities from the same connector base as the Workbench queue and bind them into the generated handoff:

```ts
export async function getWorkbenchAuthoringCapabilities(
  activeProjectionUrl: string,
  options: { signal?: AbortSignal } = {}
): Promise<WorkbenchAuthoringCapabilitiesDto> {
  const url = new URL(activeProjectionUrl);
  url.pathname = "/workbench/authoring/capabilities";
  url.search = "";
  return getJson<WorkbenchAuthoringCapabilitiesDto>(url, options);
}

const capabilitiesPromise = getWorkbenchAuthoringCapabilities(activeProjectionUrl, {
  signal: options.signal
}).catch(() => undefined);

const [response, activityResponse, notAdded, capabilities] = await Promise.all([
  getWorkbenchSessions(activeProjectionUrl, {
    limit: pageSize,
    offset: pageIndex * pageSize,
    signal: options.signal
  }),
  getWorkbenchActivity(activeProjectionUrl, { limit: 30, signal: options.signal }),
  getWorkbenchNotAddedSummary(activeProjectionUrl, { signal: options.signal }),
  capabilitiesPromise
]);
setAuthoringCapabilities(capabilities);

const handoffText = useMemo(
  () => authoringCapabilities
    ? buildWorkbenchHandoff({
        authoringCommand: authoringCapabilities.command,
        databaseId: authoringCapabilities.databaseId,
        sessions: handoffSessions
      })
    : "",
  [authoringCapabilities, handoffSessions]
);
```

Append a compact machine-readable request without shell commands:

```ts
const request = {
  protocol: "masthead.workbench.authoring/v1",
  databaseId: input.databaseId,
  completion: "publish_and_resolve",
  evidencePolicy: "all_canonical_redacted_evidence",
  authoringTool: {
    kind: "cli",
    command: input.authoringCommand,
    capability: "artifact_authoring"
  },
  sessionIds: input.sessions.map((session) => session.sessionId)
};
```

The prose must instruct the agent to use the installed Masthead Workbench authoring interface, verify the capability/database identity before opening, gather as much evidence as needed, revise deterministic findings automatically, publish, resolve every automatic kind, and report results only after completion. The handoff may identify the installed command but must not embed a terminal recipe or any direct-database flags. `useWorkbenchController` must fetch capabilities through `daemonClient`, pass both `databaseId` and `command` to `buildWorkbenchHandoff()`, and keep `copy_agent_prompt` disabled when capabilities are absent rather than emitting an unbound request.

- [ ] **Step 7: Run launcher, handoff, and Electron tests**

```bash
npm test -- --run \
  src/electron/__tests__/cliLauncher.test.ts \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx
npm run test:electron
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/electron/cliLauncher.ts src/electron/__tests__/cliLauncher.test.ts src/electron/main.ts scripts/install-electron-dev-launcher.js scripts/prepare-electron-resources.js scripts/masthead-electron-packaged-smoke.js src/ui/workbench/workbenchHandoff.ts src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/daemonClient.ts src/app/workbench/useWorkbenchController.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx
git commit -m "feat: install Masthead authoring CLI"
```

---

### Task 8: Index full artifact bodies and render complete artifacts

**Files:**
- Create: `src/daemon/db/migrations/020_artifact_body_search.sql`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/__tests__/sessionArtifactRepository.test.ts`
- Modify: `src/daemon/db/logbookArtifactRepository.ts`
- Modify: `src/mcp/__tests__/tools.test.ts`
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/workbench/authoring/__tests__/authoringService.test.ts`
- Modify: `src/ui/logbook/LogbookInspector.tsx`
- Modify: `src/ui/logbook/__tests__/LogbookInspector.test.tsx`

**Interfaces:**
- Produces: `indexSessionArtifactSearch()`, full-body `searchPublishedArtifactCapsules()`, complete kind-specific inspector sections.
- Consumes: current published artifact body JSON and existing Logbook/MCP search queries.

- [ ] **Step 1: Write failing full-body search tests**

```ts
test("finds a published artifact by a body-only phrase", async () => {
  const db = await testDb();
  const artifact = publishFixtureArtifact(db, {
    kind: "runbook",
    title: "Repair cache lock",
    body: {
      rootCause: "orphaned flock descriptor after worker cancellation",
      fixSteps: ["Close the inherited descriptor before retrying."]
    }
  });

  const result = searchPublishedArtifactCapsules(db, {
    q: "orphaned flock descriptor"
  });

  expect(result.artifacts.map((entry) => entry.artifactId)).toEqual([artifact.artifactId]);
});
```

Add the same assertion through `searchArtifactsTool()`.

Also finish an accepted authoring run, assert every receipt artifact is in FTS, inject a failure after indexing but before receipt completion, and assert the transaction rolls back both artifact and FTS rows.

- [ ] **Step 2: Write failing inspector tests for hidden fields**

Assert session dossier decisions/files/tools/lessons/missing evidence, runbook preconditions/commands/files/root cause/environment/prevention/risks, ADR affected paths/supersedes, and incident root cause/contributing factors/prevention/status are rendered.

- [ ] **Step 3: Run and verify failure**

```bash
npm test -- --run \
  src/daemon/db/__tests__/sessionArtifactRepository.test.ts \
  src/mcp/__tests__/tools.test.ts \
  src/ui/logbook/__tests__/LogbookInspector.test.tsx
```

Expected: FAIL on the body-only phrase and omitted inspector sections.

- [ ] **Step 4: Add migration 020**

```sql
CREATE VIRTUAL TABLE session_artifact_search USING fts5(
  artifact_id UNINDEXED,
  title,
  summary,
  highlight,
  project,
  body
);

INSERT INTO session_artifact_search (
  artifact_id, title, summary, highlight, project, body
)
SELECT
  artifact_id,
  COALESCE(title, ''),
  COALESCE(summary, ''),
  COALESCE(highlight, ''),
  COALESCE(project_label, ''),
  content_json
FROM session_artifacts
WHERE status = 'current' AND publication_status = 'published';
```

Register migration 20 and include `session_artifact_search` in critical virtual tables.

- [ ] **Step 5: Maintain and query the index**

On apply/supersede/publish, reindex every affected old and new artifact ID so superseded rows disappear and only current published rows remain. `finishAuthoringRun()` must call the transaction-free index primitive before visibility verification and receipt completion, keeping FTS changes inside the same `BEGIN IMMEDIATE` transaction.

```ts
export function indexSessionArtifactSearch(db: MastheadDatabase, artifactId: string): void {
  db.prepare("DELETE FROM session_artifact_search WHERE artifact_id = ?").run(artifactId);
  db.prepare(
    `INSERT INTO session_artifact_search (artifact_id, title, summary, highlight, project, body)
     SELECT artifact_id, COALESCE(title, ''), COALESCE(summary, ''),
            COALESCE(highlight, ''), COALESCE(project_label, ''), content_json
     FROM session_artifacts
     WHERE artifact_id = ? AND status = 'current' AND publication_status = 'published'`
  ).run(artifactId);
}
```

Sanitize user text into quoted FTS terms before `MATCH`; an empty sanitized query falls back to the unfiltered artifact list.

- [ ] **Step 6: Render every first-class body field**

Keep kind-specific readable sections; do not fall back to raw JSON for known kinds. Add small helpers for object arrays:

```tsx
<ListSection label="Evidence" values={stringArrayField(record, "evidenceRefs")} />
<ClaimEvidenceSection values={claimEvidenceField(record)} />
<ListSection label="Missing evidence" values={stringArrayField(record, "missingEvidence")} />
<ListSection label="Provenance sessions" values={stringArrayField(record, "provenanceSessionIds")} />
<TextSection label="Join rationale" value={stringField(record, "joinRationale")} />
<TextSection label="Signature" value={stringField(record, "signatureKey")} />

<ListSection label="Key decisions" values={stringArrayField(record, "keyDecisions")} />
<ObjectListSection label="Files touched" values={record.filesTouched} primary="label" secondary="role" />
<ObjectListSection label="Commands and tools" values={record.commandsAndTools} primary="label" secondary="purpose" />
<ListSection label="Lessons learned" values={stringArrayField(record, "lessonsLearned")} />
```

Render the remaining kinds with explicit field mappings:

```tsx
// runbook-v2
<ObjectSection label="Problem signature" value={record.problemSignature} />
<ListSection label="Preconditions" values={record.preconditions} />
<ListSection label="Reproduction" values={record.reproSteps} />
<ListSection label="Dead ends" values={record.deadEnds} />
<ListSection label="Fix steps" values={record.fixSteps} />
<ListSection label="Commands" values={record.commands} />
<ListSection label="Changed files" values={record.changedFiles} />
<ListSection label="Validation checks" values={record.validationChecks} />
<ListSection label="Environment" values={record.environmentRequirements} />
<TextSection label="Root cause" value={record.rootCause} />
<ListSection label="Prevention" values={record.preventionNotes} />
<ListSection label="Risks and gaps" values={record.risksOrGaps} />

// adr-v2
<TextSection label="Status" value={record.status} />
<TextSection label="Context" value={record.context} />
<TextSection label="Decision" value={record.decision} />
<ListSection label="Alternatives" values={record.alternatives} />
<ListSection label="Consequences" values={record.consequences} />
<ListSection label="Affected paths" values={record.affectedPaths} />
<ListSection label="Supersedes" values={record.supersedes} />

// incident_timeline-v2
<TextSection label="Symptom" value={record.symptom} />
<TextSection label="Impact" value={record.impact} />
<TimelineSection events={record.timeline} />
<TextSection label="Root cause" value={record.rootCause} />
<ListSection label="Contributing factors" values={record.contributingFactors} />
<ListSection label="Remediation" values={record.remediation} />
<ListSection label="Prevention" values={record.prevention} />
<TextSection label="Status" value={record.status} />
```

Each helper returns `null` for absent optional V1 fields so historical bodies remain readable without raw-JSON fallback.

- [ ] **Step 7: Run search and inspector tests**

```bash
npm test -- --run \
  src/daemon/db/__tests__/schema.test.ts \
  src/daemon/db/__tests__/sessionArtifactRepository.test.ts \
  src/mcp/__tests__/tools.test.ts \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/ui/logbook/__tests__/LogbookInspector.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/db/migrations/020_artifact_body_search.sql src/daemon/db/schema.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/logbookArtifactRepository.ts src/mcp/__tests__/tools.test.ts src/workbench/authoring/authoringService.ts src/workbench/authoring/__tests__/authoringService.test.ts src/ui/logbook/LogbookInspector.tsx src/ui/logbook/__tests__/LogbookInspector.test.tsx
git commit -m "feat: search and render complete artifact bodies"
```

---

### Task 9: Prove the real automatic loop and align durable documentation

**Files:**
- Modify: `scripts/dogfood-workbench-v1.js`
- Modify: `scripts/dogfood-workbench-ops.js`
- Modify: `scripts/masthead-doctor.js`
- Modify: `scripts/masthead-endpoint-matrix.js`
- Modify: `scripts/masthead-endpoint-matrix-smoke.js`
- Create: `docs/adr/0012-daemon-owned-artifact-authoring.md`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `openwiki/logbook-and-workbench.md`
- Modify: `docs/reference/enrichment.md`
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/acceptance/workbench-v1-evidence.md`
- Modify: `docs/acceptance/workbench-ops-complete-evidence.md`
- Modify: `docs/acceptance/product-release-gate.md`

**Interfaces:**
- Produces: one temp-database Source → Workbench authoring → Logbook → MCP receipt using only daemon-owned commands.
- Consumes: all previous tasks.

- [ ] **Step 1: Rewrite the dogfood around a long session**

Start a real temporary daemon, seed more than 500 canonical redacted items, place the decisive outcome and verification after item 480, then execute the built CLI with `MASTHEAD_DAEMON_URL`.

Required receipt:

```json
{
  "ok": true,
  "databaseIdentityMatched": true,
  "evidence": {
    "totalItems": 500,
    "uniqueItemsRead": 500,
    "lateOutcomeObserved": true
  },
  "submission": {
    "accepted": true,
    "artifactsBeforeFinish": 0
  },
  "finish": {
    "publishedArtifacts": 2,
    "resolvedSessions": 1,
    "runbook": "published",
    "adr": "not_applicable",
    "incidentTimeline": "not_applicable",
    "idempotentRetry": true
  },
  "reuse": {
    "logbookBodySearch": true,
    "mcpArtifactRead": true
  }
}
```

Fetch the database ID from the real capabilities command and pass it to open. The dossier or runbook must cite at least one evidence ref after item 480 so the test fails if authoring regresses to the first 80 items.

- [ ] **Step 2: Strengthen ops dogfood invariants**

Add assertions that:

- submit does not create artifact rows;
- applied optional status is not automatic resolution;
- finish publishes every created artifact;
- every receipt artifact appears in `GET /logbook/artifacts/:id`;
- daemon restart preserves one run receipt and one current artifact per lineage;
- `search_artifacts` finds a body-only phrase.

- [ ] **Step 3: Update Doctor and endpoint policy**

Doctor must verify:

- daemon health includes `artifact_authoring`;
- the capabilities-reported command is executable (absolute path) or resolvable on `PATH` (bare command);
- installed `mastheadctl workbench capabilities --json` reaches the same database identity;
- open/evidence/submit/finish definitions are present;
- MCP still lists only read-only tools.

Endpoint matrix must classify:

- GET authoring capabilities/status/evidence as side-effect-free canonical reads allowed through the read-only worktree bridge;
- POST open/submit/finish as mutations blocked by the bridge and allowed only against the primary daemon.

- [ ] **Step 4: Add ADR 0012**

Record:

- daemon owns the authoring seam;
- CLI is an adapter;
- one quality behavior for handoff and directed work;
- all canonical redacted evidence is available;
- submit is non-mutating;
- finish is atomic and idempotent;
- optional resolution is published/N/A/contributed only;
- MCP remains read-only;
- correction tools are future scope.

- [ ] **Step 5: Update product vocabulary and references**

Add exact definitions for:

- **Authoring module**
- **Authoring run**
- **Artifact bundle**
- **Authoring finding**
- **Evidence manifest**
- **Automatic completion report**

Remove `bug_fix_trace` from live agent guidance and use `runbook`, `adr`, and `incident_timeline`.

Replace the old CLI cookbook with the four-operation authoring flow. State explicitly that users see a plain-language handoff, not commands.

- [ ] **Step 6: Run the focused dogfood**

```bash
npm run build:daemon
node scripts/dogfood-workbench-v1.js
node scripts/dogfood-workbench-ops.js
npm run doctor
```

Expected: all receipts print `"ok": true`; Doctor reports authoring capability and installed CLI ready.

- [ ] **Step 7: Run the full release gate**

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run check:endpoint-matrix
npm run typecheck
npm test -- --run
npm run build
npm run smoke:electron
npm run smoke:electron:packaged
```

Expected:

- no dev citations;
- product/surface/endpoint contracts pass;
- TypeScript passes;
- all Vitest files pass;
- production and daemon builds pass;
- Electron development and packaged smokes pass;
- packaged smoke proves the installed CLI uses bundled Node and reaches the packaged daemon.

- [ ] **Step 8: Review the final diff against scope**

Run:

```bash
git diff --check
git status --short
rg -n "bug_fix_trace|permission_needed|transcript permission" \
  src/cli src/workbench/authoring src/ui/workbench \
  docs/reference/enrichment.md openwiki/logbook-and-workbench.md
```

Expected:

- `git diff --check` has no output;
- only planned files are changed;
- no live authoring guidance uses `bug_fix_trace` or a privacy-permission gate;
- compatibility-only database vocabulary may remain solely in migrations and explicitly deprecated code.

- [ ] **Step 9: Commit**

```bash
git add scripts/dogfood-workbench-v1.js scripts/dogfood-workbench-ops.js scripts/masthead-doctor.js scripts/masthead-endpoint-matrix.js scripts/masthead-endpoint-matrix-smoke.js docs/adr/0012-daemon-owned-artifact-authoring.md CONTEXT.md README.md openwiki/logbook-and-workbench.md docs/reference/enrichment.md docs/reference/daemon-api.md docs/reference/mcp-tools.md docs/acceptance/workbench-v1-evidence.md docs/acceptance/workbench-ops-complete-evidence.md docs/acceptance/product-release-gate.md
git commit -m "docs: prove daemon-owned artifact authoring"
```

---

## Final Acceptance Checklist

- [ ] Normal agent authoring uses daemon HTTP only; no CLI authoring command opens SQLite.
- [ ] Installed development and packaged CLIs report the daemon's database identity.
- [ ] Copied handoff embeds the capabilities-reported CLI command, not a guessed path.
- [ ] Handoff and `open` use the same database identity and reject a different daemon before any claim or artifact write.
- [ ] Handoff says unattended completion and uses the same quality policy as directed work.
- [ ] Handoff includes no shell recipe and no privacy-permission question.
- [ ] Evidence manifest counts match canonical tables.
- [ ] Ascending and descending pagination expose every evidence item.
- [ ] Submission writes findings/run state but no enrichment or artifact rows.
- [ ] Finish rolls back completely on any failed invariant.
- [ ] Finish retry returns the same receipt and creates no duplicates.
- [ ] Open retry for the same actor/exact session set returns one run and one live claim per session.
- [ ] Applied optional artifacts do not count as resolved.
- [ ] Every automatic kind is published, N/A, or contributed.
- [ ] Every published receipt artifact is visible in Logbook detail and artifact-primary MCP.
- [ ] No session row appears as a Logbook entry.
- [ ] Body-only phrases are searchable.
- [ ] Logbook renders every first-class body field.
- [ ] Existing V1 artifact bodies remain readable.
- [ ] MCP remains read-only.
- [ ] Future Logbook improve/rewrite/remove tools are not implemented in this plan.
