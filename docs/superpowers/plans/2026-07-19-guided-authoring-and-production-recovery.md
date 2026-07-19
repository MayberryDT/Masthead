# Guided Authoring and Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Masthead's unsafe bulk V3 authoring path with instance-bound, evidence-guided authoring campaigns that produce grounded enriched dossiers and reusable optional artifacts, keep Logbook and Workbench coherent after external writes, and safely invalidate the 3,230 polluted production dossiers without deleting canonical session evidence or audit history.

**Architecture:** Introduce `workbench-authoring-v4` as a deep daemon-owned guided-authoring module. A Workbench selection creates a durable request; Masthead groups it into bounded assignments, leads the agent through complete evidence inspection and progressive editorial review, requires typed claim support and opportunity dispositions, stages a three-session canary for operator approval, and publishes one accepted assignment atomically. `mastheadctl` remains a thin HTTP adapter but is bound to one daemon manifest and exposes only the next valid workflow action. A separate revision feed keeps active UI surfaces fresh, while a narrow hash-locked recovery path preserves V3 audit records and returns only the incident's sessions to Workbench.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, SQLite, daemon HTTP, Electron/Vite, `mastheadctl`, Node.js acceptance scripts.

## Global Constraints

- Masthead remains local-first and harness-neutral; the daemon owns all authoring writes and MCP remains artifact-primary and read-only.
- Logbook contains published artifacts only. Sessions remain capture, Workbench, provenance, and evidence units.
- Preserve the existing canonical dossier structure and renderer. The agent supplies durable enrichment; the daemon rebuilds the dossier snapshot.
- V1, V2, and V3 authoring records remain immutable audit history. New authoring uses `workbench-authoring-v4`; legacy mutation routes fail with `authoring_contract_retired`.
- A guided assignment contains at most 12 sessions. The first assignment contains at most 3 sessions and cannot publish before explicit operator approval.
- Optional runbooks, ADRs, and incident timelines remain zero-or-more judgments. High-signal opportunities require an evidence-backed disposition, but Masthead never manufactures blanket not-applicable artifacts.
- The agent must traverse every canonical evidence page for every assignment session before submission can become ready to finish.
- Every substantive enrichment and optional-artifact claim carries an exact canonical evidence reference and verbatim excerpt.
- A Workbench handoff contains an opaque request ID and one instance-bound start command. It never contains the entire selection or asks the agent to partition sessions.
- Development and production never rewrite the same CLI launcher. Every authoring mutation verifies daemon URL, database ID, build SHA, and instance manifest identity.
- Do not mutate production data during implementation or rehearsal. Production invalidation requires a fresh exact audit, one verified sibling backup, explicit Tyler authorization at execution time, the installed production daemon stopped, and a hash-locked recovery receipt.
- Preserve exactly one active production database and at most one sibling backup. Never retain multiple production bundles or recovery snapshots.
- Do not republish the full recovered selection until the isolated rehearsal, automated corpus gate, installed production smoke, and human-reviewed production canary all pass.

---

## File Structure

### New files

- `docs/adr/0015-guided-authoring-campaigns.md` — authoritative V4 campaign, guidance, canary, and instance-identity decision.
- `src/shared/guidedAuthoring.ts` — V4 request, assignment, evidence coverage, next-action, draft, disposition, review, and receipt DTOs.
- `src/daemon/db/migrations/031_guided_authoring.sql` — durable requests, assignments, memberships, evidence access, and operator review state.
- `src/daemon/db/guidedAuthoringRepository.ts` — transactional persistence for the V4 state machine.
- `src/daemon/db/__tests__/guidedAuthoringRepository.test.ts` — repository transition and rollback tests.
- `src/workbench/authoring/guidedAuthoringPolicy.ts` — assignment sizing, canary selection, evidence questions, and kind-specific reuse rubrics.
- `src/workbench/authoring/guidedAuthoringQuality.ts` — V4 grounding, delta, protocol-leak, duplicate, completion, and opportunity-disposition validation.
- `src/workbench/authoring/guidedAuthoringService.ts` — deep authoring module used by HTTP and tests.
- `src/workbench/authoring/__fixtures__/failedV3TemplateCampaign.ts` — exact adversarial shape of the 3,230-dossier failure.
- `src/workbench/authoring/__tests__/guidedAuthoringQuality.test.ts` — adversarial and positive quality tests.
- `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts` — request-to-receipt state-machine tests.
- `src/daemon/guidedAuthoringApi.ts` — V4 HTTP adapter.
- `src/cli/guidedAuthoring.ts` — `mastheadctl workbench author` adapter.
- `src/app/workbench/AuthoringCanaryReview.tsx` — compact Workbench Activity-rail review for staged canary drafts.
- `src/app/workbench/__tests__/AuthoringCanaryReview.test.tsx` — approve/reject behavior and copy tests.
- `src/daemon/db/migrations/032_data_revisions.sql` — monotonic Workbench and Logbook revisions.
- `src/daemon/db/dataRevisionRepository.ts` — revision reads and transaction-safe increments.
- `src/app/useMastheadDataRevisions.ts` — cheap active-surface revision polling.
- `src/daemon/db/migrations/033_artifact_first_summary.sql` — covering index for the artifact-native Logbook summary.
- `scripts/masthead-authoring-perf-probe.js` — startup and endpoint latency probe against an isolated database copy.
- `src/daemon/db/v3TemplateRecovery.ts` — narrow incident audit, backup proof, invalidation, and rollback transaction.
- `src/daemon/db/__tests__/v3TemplateRecovery.test.ts` — exact-target and rollback tests.
- `docs/acceptance/guided-authoring-production-canary.md` — signed rehearsal, install, recovery, canary, and rollout evidence.

### Primary modified files

- `CONTEXT.md`, `prd.md`, `openwiki/logbook-and-workbench.md`, `docs/reference/daemon-api.md`, `docs/reference/mcp-tools.md` — current V4 product and protocol contract.
- `src/shared/workbenchAuthoring.ts`, `src/workbench/authoring/authoringSchemas.ts` — retain legacy audit types while making V4 current.
- `src/workbench/authoring/advisorySuggestions.ts`, `artifactCandidates.ts`, `artifactQuality.ts`, `authoringService.ts` — reuse detector and publication internals behind the V4 module; retire V3 mutations.
- `src/daemon/db/workbenchAuthoringRepository.ts`, `workbenchPipelineRepository.ts`, `sessionArtifactRepository.ts` — V4 assignment linkage, publication, revision bumps, and recovery state reset.
- `src/daemon/workbenchAuthoringApi.ts`, `server.ts`, `healthService.ts`, `settingsService.ts` — advertise and route V4; reject V3 mutations.
- `src/cli/workbenchAuthoring.ts`, `authoringClient.ts`, `mastheadctl.ts`, `workbenchMaintenance.ts` — guided commands, fail-closed identity, and recovery commands.
- `src/electron/cliLauncher.ts`, `main.ts`, and focused tests — per-instance launcher and manifest ownership.
- `src/app/daemonClient.ts`, `src/app/workbench/useWorkbenchController.ts`, `src/ui/workbench/workbenchHandoff.ts`, `src/ui/workbench/WorkbenchPanel.tsx` — durable request creation, final prompt, canary review, revision refresh, and selection pruning.
- `src/app/logbook/useLogbookController.ts`, `src/app/logbook/__tests__/useLogbookController.test.tsx` — revision-keyed cache invalidation.
- `src/daemon/db/logbookSummaryRepository.ts`, `src/daemon/db/__tests__/logbookSummaryRepository.test.ts` — artifact-native summary with no full-history evidence joins.
- `scripts/dogfood-durable-artifacts.js`, `src/workbench/authoring/durableArtifactCorpusAcceptance.ts`, `docs/acceptance/durable-artifact-gate.md`, `docs/acceptance/product-release-gate.md` — V4 adversarial, reuse, canary, identity, freshness, and latency gates.

---

### Task 0: Restore a trustworthy green baseline for V1 recovery

**Files:**
- Modify: `src/cli/__tests__/authoringCli.test.ts`
- Modify only if the failing test proves production duplication: `src/daemon/databaseBackup.ts`
- Modify only if the failing test proves production duplication: `src/daemon/db/sessionArtifactRepository.ts`

**Interfaces:**
- Consumes: the existing failed-V1 recovery audit, prepare, invalidate, and restore commands.
- Produces: focused recovery tests that preserve the exact 1,283-dossier population assertion without running the complete population audit roughly twelve times in one 120-second test.

- [ ] **Step 1: Preserve the existing reproducible failure as RED**

Run:

```bash
npx vitest run src/cli/__tests__/authoringCli.test.ts -t "keeps failed V1 recovery audit and prepare dry"
```

Expected: FAIL at the 120-second timeout while consuming CPU in repeated `verifyRecoveryDatabase()` and `auditFailedV1Generation()` calls.

- [ ] **Step 2: Split population proof from refusal branches**

Keep one focused test with the exact 1,283-dossier fixture that proves audit and prepare identify the historical generation. Move confirmation, hash, identity, altered-population, invalidation, idempotency, and restore branches into independent tests whose fixtures contain the smallest generation that exercises the same invariant. Each test creates and removes its own temporary database and backup.

- [ ] **Step 3: Remove repeated verification only when the prepared receipt already proves unchanged bytes**

If the focused tests show production code repeats full audit and integrity verification within one exclusive maintenance command, thread the immutable prepared receipt through that command and re-audit only after active or backup bytes change. Keep `PRAGMA integrity_check` at backup creation, promotion, and final restore verification. Do not cache audit results across commands or trust a receipt without verifying its database ID, file SHA-256, byte size, audit hash, and maximum age.

- [ ] **Step 4: Run the complete CLI authoring suite**

Run:

```bash
npx vitest run src/cli/__tests__/authoringCli.test.ts
```

Expected: all 46 tests PASS without increasing any timeout.

- [ ] **Step 5: Run the full baseline outside loopback sandboxing**

Run `npm test -- --run` with loopback/process access. Expected: 291 test files and 2,337 tests PASS.

- [ ] **Step 6: Commit the baseline repair**

```bash
git add src/cli/__tests__/authoringCli.test.ts src/daemon/databaseBackup.ts src/daemon/db/sessionArtifactRepository.ts
git commit -m "test: bound v1 recovery verification"
```

---

### Task 1: Lock the incident and V4 product contract

**Files:**
- Create: `docs/adr/0015-guided-authoring-campaigns.md`
- Modify: `docs/adr/0014-agent-led-enriched-artifact-authoring.md`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `design.md`
- Modify: `prd.md`
- Modify: `openwiki/quickstart.md`
- Modify: `openwiki/logbook-and-workbench.md`
- Modify: `docs/reference/daemon-api.md`
- Modify: `src/workbench/__tests__/productContract.test.ts`

**Interfaces:**
- Consumes: ADR 0014's agent-led enrichment decision and ADR 0013's complete-evidence, claim-support, duplicate-prevention, and canonical-rendering safeguards.
- Produces: authoritative V4 vocabulary and invariants for every later task.

- [ ] **Step 1: Write the failing product-contract assertions**

Add this test to `src/workbench/__tests__/productContract.test.ts`:

```ts
test("documents guided V4 authoring and retires V3 writes", async () => {
  const active = await Promise.all([
    "CONTEXT.md",
    "README.md",
    "design.md",
    "prd.md",
    "openwiki/quickstart.md",
    "openwiki/logbook-and-workbench.md",
    "docs/reference/daemon-api.md",
    "docs/adr/0015-guided-authoring-campaigns.md"
  ].map((path) => readFile(resolve(path), "utf8")));
  const text = active.join("\n");

  expect(text).toContain("workbench-authoring-v4");
  expect(text).toContain("guided authoring request");
  expect(text).toContain("three-session canary");
  expect(text).toContain("operator approval");
  expect(text).toContain("instance-bound launcher");
  expect(text).toContain("high-signal opportunities require an evidence-backed disposition");
  expect(text).toContain("V1, V2, and V3 remain audit-only");
  expect(text).not.toContain("the agent must partition them");
});
```

- [ ] **Step 2: Run the contract test and verify the expected failure**

Run:

```bash
npx vitest run src/workbench/__tests__/productContract.test.ts
```

Expected: FAIL because ADR 0015 and the V4 vocabulary do not exist.

- [ ] **Step 3: Write ADR 0015 with the exact decision**

The decision section must contain these statements verbatim:

```markdown
1. A Workbench selection creates one durable guided authoring request; the copied handoff contains only its request ID and instance-bound start command.
2. The daemon groups the request into assignments of at most 12 sessions using strong artifact-opportunity joins first and dossier-only groups second.
3. The first assignment is a canary of at most 3 sessions. Its accepted draft remains staged until an operator approves it from Workbench.
4. The CLI returns one required next action at every state and records complete canonical evidence traversal before a draft may become publishable.
5. Every substantive dossier and optional-artifact claim carries typed verbatim claim support. High-signal opportunities require an evidence-backed authored, dismissed, merged, or changed-kind disposition.
6. V4 rejects protocol narration, unsupported completion, negligible enrichment, and materially duplicated templates across the request.
7. Finish publishes one accepted assignment atomically and releases the next assignment. V1, V2, and V3 remain audit-only.
8. Authoring launchers are instance-bound and every mutation verifies daemon URL, database ID, build SHA, and manifest identity.
```

Mark ADR 0014 as superseded by ADR 0015. Preserve it as implementation history; do not leave it marked Accepted and current alongside the incompatible V4 decision.

- [ ] **Step 4: Update active documentation**

Use these exact definitions in `CONTEXT.md`, `README.md`, `design.md`, `prd.md`, and OpenWiki:

```text
Guided authoring request = the durable Workbench selection and campaign policy.
Assignment = one daemon-grouped authoring unit containing at most 12 sessions.
Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.
Opportunity disposition = authored, dismissed, merged, or changed kind, with evidence-backed rationale.
Canary = the first staged assignment of at most 3 sessions, reviewed by an operator before publication.
Next action = the single command Masthead requires from the agent at the current assignment state.
```

Document V3 routes as audit-only and `authoring_contract_retired` for mutation attempts. Replace the existing V3 product-contract assertion instead of adding a contradictory second assertion. Replace OpenWiki's claim that the handoff never includes a CLI recipe with the narrower rule that it includes one instance-bound start command and no multi-step recipe or session list.

- [ ] **Step 5: Run the focused contract checks**

Run:

```bash
npx vitest run src/workbench/__tests__/productContract.test.ts
npm run check:product-contract
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add docs/adr/0015-guided-authoring-campaigns.md docs/adr/0014-agent-led-enriched-artifact-authoring.md CONTEXT.md README.md design.md prd.md openwiki/quickstart.md openwiki/logbook-and-workbench.md docs/reference/daemon-api.md src/workbench/__tests__/productContract.test.ts
git commit -m "docs: define guided authoring campaigns"
```

---

### Task 2: Define the V4 guided-authoring interface and schema

**Files:**
- Create: `src/shared/guidedAuthoring.ts`
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `src/workbench/authoring/authoringSchemas.ts`
- Create: `src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts`

**Interfaces:**
- Consumes: `DurableSessionEnrichment`, `WorkbenchArtifactDraft`, `WorkbenchClaimSupport`, and legacy authoring DTOs.
- Produces: `GuidedAuthoringCapabilitiesDto`, `GuidedAuthoringRequestDto`, `GuidedAuthoringAssignmentDto`, `GuidedAuthoringBundleV4`, `GuidedAuthoringReviewDto`, and `GuidedAuthoringReceiptDto`.

- [ ] **Step 1: Write failing schema tests**

Create `src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts` with these cases:

```ts
import { describe, expect, test } from "vitest";
import { parseGuidedAuthoringBundleV4 } from "../authoringSchemas";

describe("guided authoring V4 schema", () => {
  test("accepts supported enrichment and an evidence-backed opportunity dismissal", () => {
    expect(parseGuidedAuthoringBundleV4(validGuidedBundle())).toMatchObject({
      bundleVersion: "workbench-authoring-v4",
      assignmentId: "assignment:one"
    });
  });

  test.each([
    ["session claim support", (bundle: any) => { bundle.sessionEnrichments[0].claimSupport = []; }],
    ["opportunity disposition", (bundle: any) => { bundle.opportunityDispositions = []; }],
    ["evidence revision", (bundle: any) => { bundle.evidenceRevision = ""; }]
  ])("rejects missing %s", (_label, mutate) => {
    const bundle = validGuidedBundle();
    mutate(bundle);
    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });
});
```

The fixture must include one session enrichment, supports for `/sessionTitle/text`, `/sessionSummary/text`, `/sessionDossier/purpose`, `/sessionDossier/outcome`, and `/sessionDossier/keyWork/0`, plus one dismissed opportunity with a reason and evidence reference.

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts
```

Expected: FAIL because the V4 types and parser do not exist.

- [ ] **Step 3: Add the V4 DTOs**

Define these public types in `src/shared/guidedAuthoring.ts`:

```ts
export const GUIDED_AUTHORING_POLICY_VERSION = "guided-authoring-v1" as const;
export type GuidedAuthoringRequestStatus =
  | "open"
  | "awaiting_canary_approval"
  | "active"
  | "completed"
  | "cancelled";
export type GuidedAuthoringAssignmentStatus =
  | "investigating"
  | "drafting"
  | "needs_revision"
  | "ready_to_finish"
  | "staged_canary"
  | "completed";
export type GuidedAuthoringNextActionKind =
  | "inspect"
  | "save"
  | "revise"
  | "await_operator"
  | "finish"
  | "claim_next"
  | "complete";

export type GuidedAuthoringNextAction = {
  kind: GuidedAuthoringNextActionKind;
  command: string;
  reason: string;
};

export type GuidedOpportunityDisposition = {
  opportunityId: string;
  disposition: "authored" | "dismissed" | "merged" | "changed_kind";
  rationale: string;
  evidenceRefs: string[];
  artifactKind?: "runbook" | "adr" | "incident_timeline";
  mergedIntoOpportunityId?: string;
};

export type GuidedSessionEnrichmentDraft = {
  sessionId: string;
  enrichment: DurableSessionEnrichment;
  claimSupport: WorkbenchClaimSupport[];
};

export type GuidedAuthoringBundleV4 = {
  bundleVersion: "workbench-authoring-v4";
  assignmentId: string;
  evidenceRevision: string;
  sessionEnrichments: GuidedSessionEnrichmentDraft[];
  opportunityDispositions: GuidedOpportunityDisposition[];
  artifacts: WorkbenchArtifactDraft[];
};
```

Add `purpose`, `outcome`, `blocker`, `continuation`, and `reuse` to `WorkbenchClaimSupport["supportKind"]`. Retain V1-V3 types solely for audit reads.

- [ ] **Step 4: Define capabilities and next-action responses**

Add:

```ts
export type GuidedAuthoringCapabilitiesDto = {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  bundleVersion: "workbench-authoring-v4";
  policyVersion: "guided-authoring-v1";
  command: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  maxSessionsPerAssignment: 12;
  canarySessions: 3;
  operations: ["start", "inspect", "save", "review", "finish"];
};
```

The schema must reject additional properties, empty rationale/evidence arrays, dispositions without their conditional fields, and session support paths that do not begin with `/sessionTitle`, `/sessionSummary`, or `/sessionDossier`.

- [ ] **Step 5: Run schema and type checks**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts src/workbench/authoring/__tests__/authoringSchemas.test.ts
npm run typecheck
```

Expected: PASS with legacy schemas unchanged and V4 current.

- [ ] **Step 6: Commit the interface**

```bash
git add src/shared/guidedAuthoring.ts src/shared/workbenchAuthoring.ts src/workbench/authoring/authoringSchemas.ts src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts
git commit -m "feat: define guided authoring v4 contract"
```

---

### Task 3: Persist guided requests, assignments, evidence access, and reviews

**Files:**
- Create: `src/daemon/db/migrations/031_guided_authoring.sql`
- Modify: `src/daemon/db/schema.ts`
- Create: `src/daemon/db/guidedAuthoringRepository.ts`
- Create: `src/daemon/db/__tests__/guidedAuthoringRepository.test.ts`

**Interfaces:**
- Consumes: V4 DTO statuses and `MastheadDatabase`.
- Produces: `createGuidedAuthoringRequest`, `createGuidedAssignment`, `recordGuidedEvidenceAccess`, `storeGuidedDraftReview`, `recordCanaryDecision`, and `completeGuidedAssignment`.

- [ ] **Step 1: Write repository transition tests**

Cover these exact transitions:

```ts
test("persists request membership and a three-session canary atomically", () => {
  const request = createGuidedAuthoringRequest(db, requestInput(14));
  const assignment = createGuidedAssignment(db, assignmentInput(request.requestId, 3, true));
  expect(request.sessionCount).toBe(14);
  expect(assignment.sessionIds).toHaveLength(3);
  expect(assignment.canary).toBe(true);
});

test("records evidence refs idempotently", () => {
  recordGuidedEvidenceAccess(db, accessInput("message:a:1"));
  recordGuidedEvidenceAccess(db, accessInput("message:a:1"));
  expect(listGuidedEvidenceAccess(db, "assignment:one")).toHaveLength(1);
});

test("rejects illegal stage transitions without partial writes", () => {
  expect(() => completeGuidedAssignment(db, "assignment:one", receipt()))
    .toThrow("guided_assignment_not_ready");
  expect(getGuidedAssignment(db, "assignment:one")?.status).toBe("investigating");
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run:

```bash
npx vitest run src/daemon/db/__tests__/guidedAuthoringRepository.test.ts
```

Expected: FAIL because migration 031 and the repository do not exist.

- [ ] **Step 3: Add migration 031**

Use these tables and constraints:

```sql
CREATE TABLE guided_authoring_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  build_sha TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','awaiting_canary_approval','active','completed','cancelled')),
  canary_approved_at TEXT,
  canary_approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE guided_authoring_request_sessions (
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  group_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','assigned','completed','excluded')),
  excluded_reason TEXT,
  PRIMARY KEY (request_id, session_id)
);

CREATE TABLE guided_authoring_assignments (
  assignment_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating','drafting','needs_revision','ready_to_finish','staged_canary','completed')),
  canary INTEGER NOT NULL CHECK (canary IN (0,1)),
  evidence_revision TEXT NOT NULL,
  draft_json TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (request_id, ordinal)
);

CREATE TABLE guided_authoring_assignment_sessions (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, session_id)
);

CREATE TABLE guided_authoring_evidence_access (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  evidence_ref TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, session_id, evidence_ref)
);

CREATE TABLE guided_authoring_operator_reviews (
  request_id TEXT PRIMARY KEY REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  notes TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX idx_guided_request_status ON guided_authoring_requests(status, updated_at DESC);
CREATE INDEX idx_guided_request_sessions_state ON guided_authoring_request_sessions(request_id, state, ordinal);
CREATE INDEX idx_guided_assignment_request ON guided_authoring_assignments(request_id, ordinal);
```

- [ ] **Step 4: Implement the repository as transaction-owning operations**

Export these exact signatures:

```ts
export function createGuidedAuthoringRequest(
  db: MastheadDatabase,
  input: CreateGuidedAuthoringRequestInput
): GuidedAuthoringRequestDto;
export function createGuidedAssignment(
  db: MastheadDatabase,
  input: CreateGuidedAssignmentInput
): GuidedAuthoringAssignmentDto;
export function recordGuidedEvidenceAccess(
  db: MastheadDatabase,
  input: { assignmentId: string; sessionId: string; evidenceRefs: string[] }
): void;
export function storeGuidedDraftReview(
  db: MastheadDatabase,
  input: { assignmentId: string; draft: GuidedAuthoringBundleV4; findings: WorkbenchAuthoringFinding[] }
): GuidedAuthoringAssignmentDto;
export function recordCanaryDecision(
  db: MastheadDatabase,
  input: { requestId: string; assignmentId: string; decision: "approved" | "rejected"; notes: string; reviewedBy: string }
): GuidedAuthoringRequestDto;
```

Each state-changing function uses `BEGIN IMMEDIATE`, validates the current state before writing, commits once, and rolls back on every exception.

- [ ] **Step 5: Run repository and migration tests**

Run:

```bash
npx vitest run src/daemon/db/__tests__/guidedAuthoringRepository.test.ts src/daemon/db/__tests__/schema.test.ts
```

Expected: PASS, including migration from schema 30 and fresh-database creation.

- [ ] **Step 6: Commit persistence**

```bash
git add src/daemon/db/migrations/031_guided_authoring.sql src/daemon/db/schema.ts src/daemon/db/guidedAuthoringRepository.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts
git commit -m "feat: persist guided authoring state"
```

---

### Task 4: Make CLI launchers instance-bound and fail closed

**Files:**
- Modify: `src/electron/cliLauncher.ts`
- Modify: `src/electron/main.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/electron/__tests__/cliLauncher.test.ts`
- Modify: `src/electron/__tests__/mainCliLauncher.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`

**Interfaces:**
- Consumes: Electron instance data directory, daemon base URL, database ID, build SHA, and PID.
- Produces: `MastheadInstanceManifest`, per-instance launcher path, and `assertAuthoringIdentity()` before every mutation.

- [ ] **Step 1: Write failing collision and mismatch tests**

Add tests proving:

```ts
test("production and dev resolve different launcher paths", () => {
  const production = resolveMastheadCliLaunchTarget({ instanceDir: "/state/masthead-production", ...base });
  const development = resolveMastheadCliLaunchTarget({ instanceDir: "/state/masthead-dev", ...base });
  expect(production.launcherPath).toBe("/state/masthead-production/bin/mastheadctl");
  expect(development.launcherPath).toBe("/state/masthead-dev/bin/mastheadctl");
});

test("refuses a mutation when the manifest database differs", async () => {
  server.capabilities.databaseId = "database:other";
  await expect(client.open({ actorId: "codex", databaseId: "database:expected", sessionIds: ["session:a"] }))
    .rejects.toMatchObject({ code: "database_identity_mismatch" });
  expect(server.mutationCount).toBe(0);
});
```

- [ ] **Step 2: Run focused launcher tests and verify failure**

Run:

```bash
npx vitest run src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/cli/__tests__/authoringCli.test.ts
```

Expected: FAIL because every instance still targets `~/.local/bin/mastheadctl`.

- [ ] **Step 3: Define and write the instance manifest**

Add:

```ts
export type MastheadInstanceManifest = {
  schemaVersion: 1;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  pid: number;
  instanceDir: string;
  updatedAt: string;
};
```

Write it atomically to `<instanceDir>/masthead-instance.json`. Place the launcher at `<instanceDir>/bin/mastheadctl`; the wrapper passes `MASTHEAD_INSTANCE_MANIFEST` to the CLI and never embeds another instance's URL.

- [ ] **Step 4: Verify identity before every authoring mutation**

Implement this client method and call it before request creation, start, save, canary decisions, and finish. Offline recovery commands verify the database and backup identities directly because the target daemon must be stopped:

```ts
async assertAuthoringIdentity(expected: {
  databaseId: string;
  buildSha: string;
}): Promise<GuidedAuthoringCapabilitiesDto> {
  const actual = await this.capabilities();
  if (actual.databaseId !== expected.databaseId) throw identityError("database_identity_mismatch", expected.databaseId, actual.databaseId);
  if (actual.buildSha !== expected.buildSha) throw identityError("build_identity_mismatch", expected.buildSha, actual.buildSha);
  return actual;
}
```

Remove Electron startup writes to the shared global launcher. If `~/.local/bin/mastheadctl` already exists, leave it untouched and never advertise it in capabilities.

- [ ] **Step 5: Run launcher, packaged-command, and doctor tests**

Run:

```bash
npx vitest run src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/electron/__tests__/packagedCliCommand.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
```

Expected: PASS; tests prove simultaneous dev and production manifests cannot overwrite each other.

- [ ] **Step 6: Commit instance binding**

```bash
git add src/electron/cliLauncher.ts src/electron/main.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
git commit -m "fix: bind authoring cli to one masthead instance"
```

---

### Task 5: Plan evidence-related assignments and stage a canary

**Files:**
- Create: `src/workbench/authoring/guidedAuthoringPolicy.ts`
- Create: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/workbench/authoring/advisorySuggestions.ts`
- Modify: `src/workbench/authoring/artifactCandidates.ts`
- Create: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`

**Interfaces:**
- Consumes: `getArtifactSuggestions`, canonical evidence manifests, V4 repository operations, and request session membership.
- Produces: `createGuidedRequest()` and `startGuidedAssignment()` with strong-join grouping, dossier-only fallback groups, and a deterministic three-session canary.

- [ ] **Step 1: Write failing assignment-planning tests**

Add these cases:

```ts
test("keeps a strong multi-session opportunity in one bounded assignment", () => {
  const plan = planGuidedAssignments(selection(18), suggestions(sharedAdrAcross("a", "b", "c")));
  expect(plan.groups.find((group) => group.opportunityIds.length > 0)?.sessionIds)
    .toEqual(["session:a", "session:b", "session:c"]);
  expect(plan.groups.every((group) => group.sessionIds.length <= 12)).toBe(true);
});

test("uses dossier-only groups for sessions without strong joins", () => {
  const plan = planGuidedAssignments(selection(5), []);
  expect(plan.groups.flatMap((group) => group.sessionIds)).toEqual(selectionIds(5));
  expect(plan.groups.flatMap((group) => group.opportunityIds)).toEqual([]);
});

test("chooses a diverse canary with at most three sessions", () => {
  const plan = planGuidedAssignments(diverseSelection(), diverseSuggestions());
  expect(plan.canary.sessionIds.length).toBeLessThanOrEqual(3);
  expect(new Set(plan.canary.coverageClasses)).toEqual(new Set(["artifact_signal", "tool_heavy", "ordinary"]));
});
```

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
```

Expected: FAIL because the policy and service modules do not exist.

- [ ] **Step 3: Implement deterministic assignment planning**

Export:

```ts
export function planGuidedAssignments(
  sessions: GuidedPlanningSession[],
  opportunities: WorkbenchArtifactSuggestionDto[]
): GuidedAssignmentPlan;
```

The implementation must:

```text
1. Normalize each strong suggestion signature into one opportunity group.
2. Reject a proposed group above 12 sessions rather than truncating provenance.
3. Prevent one session from appearing in two assignments; attach secondary opportunities to its chosen group.
4. Place remaining sessions into stable dossier-only groups ordered by original selection ordinal.
5. Choose the canary from artifact-signal, tool-heavy, and ordinary coverage classes when available.
6. Preserve every selected compile-ready session exactly once.
```

- [ ] **Step 4: Return an editorial brief and one next action**

`startGuidedAssignment()` must return:

```ts
{
  assignment,
  editorialBrief: {
    objective: "Produce grounded knowledge reusable without reopening raw session evidence.",
    sessions: canonicalBaselines,
    opportunities,
    rubrics: GUIDED_ARTIFACT_RUBRICS,
    evidenceQuestions: GUIDED_EVIDENCE_QUESTIONS
  },
  nextAction: {
    kind: "inspect",
    command: `${command} workbench author inspect --assignment ${assignment.assignmentId} --json`,
    reason: "Every session still has unread canonical evidence."
  }
}
```

- [ ] **Step 5: Run planning and detector tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/advisorySuggestions.test.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts
```

Expected: PASS with every selection member assigned exactly once.

- [ ] **Step 6: Commit campaign planning**

```bash
git add src/workbench/authoring/guidedAuthoringPolicy.ts src/workbench/authoring/guidedAuthoringService.ts src/workbench/authoring/advisorySuggestions.ts src/workbench/authoring/artifactCandidates.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
git commit -m "feat: plan guided authoring assignments"
```

---

### Task 6: Guide complete evidence inspection

**Files:**
- Modify: `src/workbench/authoring/guidedAuthoringPolicy.ts`
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/daemon/db/guidedAuthoringRepository.ts`
- Modify: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`

**Interfaces:**
- Consumes: `getAuthoringEvidencePage`, evidence manifests, and the evidence-access repository.
- Produces: `inspectGuidedAssignment()` with sequential unread pages, coverage, editorial questions, and a deterministic next action.

- [ ] **Step 1: Write failing evidence-coverage tests**

```ts
test("does not permit drafting after first and last message sampling", () => {
  inspectGuidedAssignment(db, inspectInput({ cursor: undefined, limit: 1 }));
  inspectGuidedAssignment(db, inspectInput({ order: "desc", limit: 1 }));
  const review = reviewGuidedAssignment(db, "assignment:one");
  expect(review.nextAction.kind).toBe("inspect");
  expect(review.coverage[0]).toMatchObject({ accessedItems: 2, complete: false, totalItems: 8 });
});

test("moves to save only after every canonical evidence item was returned", () => {
  inspectAllPages(db, "assignment:one", "session:a");
  expect(reviewGuidedAssignment(db, "assignment:one").nextAction.kind).toBe("save");
});
```

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts -t "evidence"
```

Expected: FAIL because inspection is not tracked.

- [ ] **Step 3: Implement sequential inspection with a coverage ledger**

Export:

```ts
export function inspectGuidedAssignment(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    sessionId?: string;
    cursor?: string;
    limit?: number;
  }
): GuidedInspectionDto;
```

Default to the first session with unread evidence, ascending canonical order, and 100 items. Record only refs actually returned. Reject `query`, `kind`, and descending inspection as completion-bearing operations; those remain supplementary reads and do not advance complete-evidence coverage.

- [ ] **Step 4: Return tailored editorial questions**

For each session return these unresolved questions until its draft contains supported answers:

```ts
export const GUIDED_EVIDENCE_QUESTIONS = [
  "What did the user actually ask for?",
  "What concrete work was performed?",
  "What changed or was produced?",
  "Which decisions were made and why?",
  "What verification ran and what did it prove?",
  "What failed, remained blocked, or stayed unresolved?",
  "What knowledge could another person reuse without this transcript?"
] as const;
```

When all sessions reach `accessedItems === totalItems`, return `nextAction.kind = "save"`; otherwise return the exact next unread cursor.

- [ ] **Step 5: Run service tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
```

Expected: PASS, including stale evidence revision rejection and idempotent repeated page reads.

- [ ] **Step 6: Commit guided inspection**

```bash
git add src/workbench/authoring/guidedAuthoringPolicy.ts src/workbench/authoring/guidedAuthoringService.ts src/daemon/db/guidedAuthoringRepository.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
git commit -m "feat: guide complete authoring evidence inspection"
```

---

### Task 7: Enforce grounded enrichment and reusable artifact quality

**Files:**
- Create: `src/workbench/authoring/guidedAuthoringQuality.ts`
- Create: `src/workbench/authoring/__fixtures__/failedV3TemplateCampaign.ts`
- Create: `src/workbench/authoring/__tests__/guidedAuthoringQuality.test.ts`
- Modify: `src/workbench/authoring/artifactQuality.ts`
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`

**Interfaces:**
- Consumes: V4 bundles, canonical pre-enrichment dossiers, evidence-by-ref, request-wide accepted drafts, evidence coverage, and opportunity definitions.
- Produces: `validateGuidedAuthoringDraft()` and structured field-specific findings.

- [ ] **Step 1: Encode the exact incident as an adversarial fixture**

`failedV3TemplateCampaign.ts` must generate 12 dossiers with these properties:

```ts
export const FAILED_V3_SUMMARY_PREFIX = "Canonical evidence records this request:";

export function failedV3TemplateBundle(input: FailedV3TemplateInput): GuidedAuthoringBundleV4 {
  return {
    bundleVersion: "workbench-authoring-v4",
    assignmentId: input.assignmentId,
    evidenceRevision: input.evidenceRevision,
    sessionEnrichments: input.sessions.map((session) => ({
      sessionId: session.sessionId,
      enrichment: deterministicTemplateEnrichment(session),
      claimSupport: sampledFirstAndLastSupports(session)
    })),
    opportunityDispositions: input.opportunities.map((opportunity) => ({
      opportunityId: opportunity.opportunityId,
      disposition: "dismissed",
      rationale: "No reusable artifact was identified.",
      evidenceRefs: opportunity.evidenceRefs.slice(0, 1)
    })),
    artifacts: []
  };
}
```

Include protocol/setup text, empty decisions, completed summaries with unknown verification, and normalized template duplication.

- [ ] **Step 2: Write failing adversarial and positive tests**

```ts
test("rejects the production bulk-template failure shape", () => {
  const result = validateGuidedAuthoringDraft(failedInput());
  expect(result.accepted).toBe(false);
  expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
    "incomplete_evidence_inspection",
    "protocol_leakage",
    "negligible_enrichment_delta",
    "duplicate_session_template",
    "unsupported_completion",
    "unsupported_opportunity_dismissal"
  ]));
});

test("accepts a specific dossier and no optional artifact when evidence is genuinely sparse", () => {
  expect(validateGuidedAuthoringDraft(sparseButHonestInput())).toMatchObject({ accepted: true, findings: [] });
});
```

- [ ] **Step 3: Run the quality tests and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringQuality.test.ts
```

Expected: FAIL because V4 quality validation does not exist.

- [ ] **Step 4: Implement exact grounding and enrichment checks**

Export:

```ts
export function validateGuidedAuthoringDraft(
  input: GuidedAuthoringValidationInput
): { accepted: boolean; findings: WorkbenchAuthoringFinding[] };
```

Require:

```text
- Every assignment session has one enrichment and complete evidence coverage.
- Every substantive field path resolves in the submitted enrichment.
- Every support excerpt is at least 20 normalized characters and occurs verbatim in the referenced canonical evidence owned by that session.
- Title, summary, purpose, outcome, every key-work item, every decision, every blocker, verification narrative, and continuation claims have support when present.
- A completed summary cannot use unknown verification; missing verification must be stated explicitly in the summary and dossier warnings.
- Normalized title, summary, and dossier prose must add session-specific information beyond the canonical baseline.
- Request-wide normalized five-token shingles above 0.82 Jaccard similarity produce duplicate_session_template.
- Protocol terms, machine requests, plugin recommendations, AGENTS instructions, and authoring commands produce protocol_leakage.
- Every high-signal opportunity has exactly one disposition; dismissal and changed-kind rationales must cite evidence that supports the judgment.
```

- [ ] **Step 5: Encode independent-reuse rubrics**

Add these mandatory quality matrices:

```ts
export const GUIDED_ARTIFACT_RUBRICS = {
  runbook: ["trigger", "preconditions", "performed steps", "expected results", "verification", "failure or rollback handling"],
  adr: ["durable decision", "context", "alternatives actually considered", "consequences", "reversal conditions"],
  incident_timeline: ["symptoms or impact", "ordered events", "root cause", "contributing factors", "remediation", "recovery verification"]
} as const;
```

Reuse existing typed optional-artifact schemas and claim-support validation; add a finding when a draft requires reopening raw evidence to understand or execute it.

- [ ] **Step 6: Run focused and corpus quality tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringQuality.test.ts src/workbench/authoring/__tests__/authoringValidation.test.ts src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts
```

Expected: PASS; the failed template fixture is rejected and the sparse honest case passes.

- [ ] **Step 7: Commit quality enforcement**

```bash
git add src/workbench/authoring/guidedAuthoringQuality.ts src/workbench/authoring/__fixtures__/failedV3TemplateCampaign.ts src/workbench/authoring/__tests__/guidedAuthoringQuality.test.ts src/workbench/authoring/artifactQuality.ts src/workbench/authoring/guidedAuthoringService.ts
git commit -m "feat: enforce guided authoring quality"
```

---

### Task 8: Stage canaries and publish accepted assignments atomically

**Files:**
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/daemon/db/guidedAuthoringRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`
- Modify: `src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts`

**Interfaces:**
- Consumes: accepted V4 drafts, canary decisions, existing enrichment application, dossier snapshot, optional-artifact publication, and Workbench claims.
- Produces: `saveGuidedDraft`, `reviewGuidedAssignment`, `approveGuidedCanary`, `rejectGuidedCanary`, and `finishGuidedAssignment` with immutable receipts.

- [ ] **Step 1: Write failing canary and atomicity tests**

```ts
test("stages an accepted canary without publishing", () => {
  saveCompleteValidDraft(db, "assignment:canary");
  expect(reviewGuidedAssignment(db, "assignment:canary").status).toBe("staged_canary");
  expect(searchLogbookArtifacts(db, {}).total).toBe(0);
});

test("publishes the approved canary and releases the next assignment", () => {
  approveGuidedCanary(db, approvalInput());
  const receipt = finishGuidedAssignment(db, "assignment:canary");
  expect(receipt.publishedArtifactIds.length).toBeGreaterThan(0);
  expect(getGuidedRequest(db, receipt.requestId)?.status).toBe("active");
  expect(startGuidedAssignment(db, receipt.requestId).assignment.ordinal).toBe(1);
});

test("rolls back enrichment, artifacts, revisions, session state, and receipt together", () => {
  injectPublicationFailure("after_optional_artifacts");
  expect(() => finishGuidedAssignment(db, "assignment:one")).toThrow("injected_publication_failure");
  expect(publicationCounts(db)).toEqual(beforeCounts);
});
```

- [ ] **Step 2: Run focused service tests and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts -t "canary|atomic"
```

Expected: FAIL because V4 staging and finish do not exist.

- [ ] **Step 3: Implement staged canary review**

`saveGuidedDraft()` stores accepted canary drafts as `staged_canary`. `approveGuidedCanary()` requires `reviewedBy`, nonempty notes, matching request and assignment IDs, and current evidence revision. Rejection stores the review and changes the assignment to `needs_revision` without publishing.

- [ ] **Step 4: Implement one-transaction finish**

Within one `BEGIN IMMEDIATE` transaction:

```text
1. Revalidate request, assignment, manifest identity, evidence revision, complete inspection, accepted findings, and canary approval.
2. Apply each session's durable enrichment, with source and policy version stamped by the daemon.
3. Rebuild and stage each canonical dossier snapshot.
4. Stage optional artifacts and provenance.
5. Publish all staged artifacts.
6. Mark assignment sessions completed and reset their Workbench claims/state.
7. Store the immutable assignment receipt.
8. Mark the request completed only when no pending request sessions remain.
```

Return the stored receipt unchanged on finish retry.

- [ ] **Step 5: Run acceptance and rollback tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts src/workbench/authoring/__tests__/authoringService.test.ts
```

Expected: PASS with no partial Logbook or Workbench state after injected failures.

- [ ] **Step 6: Commit staged publication**

```bash
git add src/workbench/authoring/guidedAuthoringService.ts src/workbench/authoring/authoringService.ts src/daemon/db/guidedAuthoringRepository.ts src/daemon/db/workbenchPipelineRepository.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts
git commit -m "feat: stage and publish guided authoring assignments"
```

---

### Task 9: Expose only the guided workflow through HTTP and CLI

**Files:**
- Create: `src/daemon/guidedAuthoringApi.ts`
- Create: `src/cli/guidedAuthoring.ts`
- Modify: `src/daemon/workbenchAuthoringApi.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/healthService.ts`
- Modify: `src/daemon/settingsService.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/cli/mastheadctl.ts`
- Modify: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`

**Interfaces:**
- Consumes: the V4 deep module and instance identity.
- Produces: request, start, inspect, save, review, canary-decision, and finish routes plus `mastheadctl workbench author` commands.

- [ ] **Step 1: Write failing route and CLI tests**

Require this command flow:

```bash
mastheadctl workbench author start --request request:one --json
mastheadctl workbench author inspect --assignment assignment:one --json
mastheadctl workbench author save --assignment assignment:one --file draft.json --json
mastheadctl workbench author review --assignment assignment:one --json
mastheadctl workbench author finish --assignment assignment:one --json
```

Add tests that every successful JSON response contains exactly one `nextAction`, and that legacy `open`, `submit`, and `finish` mutations return `authoring_contract_retired` for V3.

- [ ] **Step 2: Run API and CLI tests and verify failure**

Run:

```bash
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts
```

Expected: FAIL because V4 routes and nested CLI commands do not exist.

- [ ] **Step 3: Add the HTTP routes**

Route these exact operations:

```text
POST /workbench/authoring/requests
POST /workbench/authoring/requests/:requestId/start
GET  /workbench/authoring/assignments/:assignmentId/inspect
POST /workbench/authoring/assignments/:assignmentId/draft
GET  /workbench/authoring/assignments/:assignmentId/review
POST /workbench/authoring/requests/:requestId/canary-decision
POST /workbench/authoring/assignments/:assignmentId/finish
```

The read-only bridge permits capabilities, request status, inspect, and review; it rejects request creation, draft save, canary decisions, and finish.

- [ ] **Step 4: Add nested CLI dispatch and next-action rendering**

`runGuidedAuthoringCli(args, options)` parses the subcommand after `author`, verifies the manifest before mutations, prints human-readable guidance by default, and returns the exact DTO under `--json`. It must not provide a command that accepts multiple request IDs, assignment IDs, or a session list.

- [ ] **Step 5: Retire unsafe V3 mutations**

Capabilities advertise only:

```ts
operations: ["start", "inspect", "save", "review", "finish"]
bundleVersion: "workbench-authoring-v4"
policyVersion: "guided-authoring-v1"
```

Keep V1-V3 status and receipt reads for audit. Return HTTP 409 with `{ code: "authoring_contract_retired" }` before opening or mutating a V3 run.

- [ ] **Step 6: Run API, CLI, bridge, and doctor tests**

Run:

```bash
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts src/core/__tests__/viteConnectorManager.test.ts
```

Expected: PASS with a complete V4 operation contract and no V3 write path.

- [ ] **Step 7: Commit adapters**

```bash
git add src/daemon/guidedAuthoringApi.ts src/cli/guidedAuthoring.ts src/daemon/workbenchAuthoringApi.ts src/daemon/server.ts src/daemon/healthService.ts src/daemon/settingsService.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/cli/mastheadctl.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts
git commit -m "feat: expose guided authoring workflow"
```

---

### Task 10: Create durable requests, copy the final prompt, and review canaries in Workbench

**Files:**
- Modify: `design.md`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Create: `src/app/workbench/AuthoringCanaryReview.tsx`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Create: `src/app/workbench/__tests__/AuthoringCanaryReview.test.tsx`

**Interfaces:**
- Consumes: V4 capabilities, request creation, staged-canary review, and the Workbench selection.
- Produces: `copyAgentPrompt(): Promise<string>` and an operator-only canary approve/reject action.

- [ ] **Step 1: Write failing handoff and controller tests**

```ts
test("creates a durable request before returning the copied prompt", async () => {
  const result = renderController({ selected: ["session:a", "session:b"] });
  const prompt = await result.current.copyAgentPrompt();
  expect(api.createGuidedAuthoringRequest).toHaveBeenCalledWith(expect.objectContaining({
    sessionIds: ["session:a", "session:b"]
  }));
  expect(prompt).toContain("request:one");
  expect(prompt).not.toContain("session:a");
  expect(prompt).not.toContain("partition");
});

test("requires notes when rejecting a canary", async () => {
  render(<AuthoringCanaryReview review={stagedReview()} onApprove={vi.fn()} onReject={reject} />);
  await user.click(screen.getByRole("button", { name: "Reject canary" }));
  expect(reject).not.toHaveBeenCalled();
  expect(screen.getByText("Add review notes before rejecting this canary.")).toBeVisible();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npx vitest run src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/workbench/__tests__/AuthoringCanaryReview.test.tsx
```

Expected: FAIL because Copy Agent Prompt is synchronous and no canary review exists.

- [ ] **Step 3: Replace the handoff with the approved prompt**

`buildWorkbenchHandoff()` must produce this exact prose with request-specific values interpolated:

```text
Complete Masthead guided authoring request REQUEST_ID using the exact authoring command in the machine request.

You are acting as a knowledge editor. Produce grounded, specific knowledge that a future person or agent can reuse without reopening raw session evidence. Throughput is subordinate to quality.

Begin by running the supplied start command, then follow Masthead's returned nextAction until it issues an immutable completion receipt. Do not create a bulk-authoring script, loop over session IDs, sample only the first or last messages, or construct batches outside the guided workflow.

For every session, establish the actual purpose, work, outcome, decisions, verification, unresolved work, and reuse value from canonical evidence. Do not infer completion from a final assistant message.

For every knowledge opportunity, author a self-contained runbook, ADR, or incident timeline only when the evidence supports independent reuse. Otherwise record the evidence-backed reason for dismissing, merging, or changing its kind.

Stop and report the blocker if evidence is insufficient, instance identity differs, or Masthead rejects the draft. Report publication only from the immutable finish receipt.
```

The machine request contains `protocol`, `bundleVersion`, `policyVersion`, `requestId`, `databaseId`, `buildSha`, and one absolute `startCommand`; it contains no session IDs.

- [ ] **Step 4: Make Copy Agent Prompt create the request first**

Replace derived `handoffText` with:

```ts
copyAgentPrompt: async () => {
  const request = await createGuidedAuthoringRequest(activeProjectionUrl, {
    databaseId: capabilities.databaseId,
    buildSha: capabilities.buildSha,
    sessionIds: agentPromptSessionIds
  });
  return buildWorkbenchHandoff({ capabilities, request });
}
```

`WorkbenchPanel` awaits the text, copies it, and only then reports success. Failed request creation must not place stale prompt text on the clipboard.

- [ ] **Step 5: Add compact canary review to the Activity rail**

Follow `design.md`: render dossier and optional-artifact draft capsules, claim-support excerpts, duplicate/quality findings, and Approve/Reject controls inside the existing Activity rail. Approval requires one confirmation click; rejection requires notes. Do not add a Logbook bulk control or a new top-level surface.

- [ ] **Step 6: Run UI tests and responsive surface inspection**

Run:

```bash
npx vitest run src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/workbench/__tests__/AuthoringCanaryReview.test.tsx
npm run check:surface-contract
```

Then run Masthead on a non-Electron worktree port with `MASTHEAD_UI_PORT=5180 npm run dev`, inspect Workbench in the in-app Browser at desktop, tablet, and narrow mobile widths, and confirm the review remains inside the Activity rail without clipping or horizontal page overflow.

- [ ] **Step 7: Commit Workbench guidance**

```bash
git add design.md src/app/daemonClient.ts src/app/workbench/useWorkbenchController.ts src/ui/workbench/workbenchHandoff.ts src/ui/workbench/WorkbenchPanel.tsx src/app/workbench/AuthoringCanaryReview.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/workbench/__tests__/AuthoringCanaryReview.test.tsx
git commit -m "feat: guide authoring from workbench"
```

---

### Task 11: Refresh Logbook and Workbench from daemon revisions

**Files:**
- Create: `src/daemon/db/migrations/032_data_revisions.sql`
- Create: `src/daemon/db/dataRevisionRepository.ts`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Create: `src/app/useMastheadDataRevisions.ts`
- Modify: `src/app/logbook/useLogbookController.ts`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: focused controller and daemon tests.

**Interfaces:**
- Consumes: all successful Logbook/Workbench mutations.
- Produces: `GET /data/revisions`, `bumpDataRevision()`, and revision-keyed controller reloads.

- [ ] **Step 1: Write failing revision and stale-selection tests**

```ts
test("increments Logbook and Workbench revisions in the publication transaction", () => {
  const before = getDataRevisions(db);
  finishValidGuidedAssignment(db);
  expect(getDataRevisions(db)).toEqual({
    logbook: before.logbook + 1,
    workbench: before.workbench + 1
  });
});

test("evicts an empty Logbook cache when the daemon revision changes", async () => {
  api.searchLogbook.mockResolvedValueOnce({ sessions: [], total: 0 }).mockResolvedValueOnce(publishedPage());
  const view = renderLogbookController();
  await publishExternallyAndAdvanceRevision(view);
  expect(view.result.current.loadState).toMatchObject({ state: "ready", total: 1 });
});

test("removes published sessions from Workbench selection", async () => {
  const view = renderSelectedWorkbench(["session:a"]);
  api.getWorkbenchSessions.mockResolvedValue(queueWithout("session:a"));
  await advanceWorkbenchRevision(view);
  expect(view.result.current.selectedSessionIds).toEqual(new Set());
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx vitest run src/app/logbook/__tests__/useLogbookController.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx src/daemon/__tests__/workbenchAuthoringApi.test.ts
```

Expected: FAIL because external daemon writes do not invalidate either controller.

- [ ] **Step 3: Add monotonic revisions**

Migration 032:

```sql
CREATE TABLE masthead_data_revisions (
  scope TEXT PRIMARY KEY CHECK (scope IN ('logbook','workbench')),
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO masthead_data_revisions(scope, revision, updated_at) VALUES
  ('logbook', 0, CURRENT_TIMESTAMP),
  ('workbench', 0, CURRENT_TIMESTAMP);
```

Export `getDataRevisions(db)` and `bumpDataRevisionInTransaction(db, scope)`. Publication and recovery bump both scopes inside their existing transaction. Workbench-only mutations bump Workbench.

- [ ] **Step 4: Add the cheap revision endpoint and active polling hook**

`GET /data/revisions` returns:

```json
{"ok":true,"logbook":42,"workbench":87}
```

`useMastheadDataRevisions` polls every 2 seconds only while the window is visible and one of those surfaces is active. It aborts on unmount and applies exponential backoff up to 30 seconds after failures.

- [ ] **Step 5: Key caches and selection to revisions**

Include `logbookRevision` in `LogbookPageCacheRequest`; clear detail selection when the selected artifact disappears. On Workbench refresh, resolve selected IDs against the complete current queue and replace both selection sets with only still-present IDs. Never preserve a published session merely because it was selected before the reload.

- [ ] **Step 6: Run controller and endpoint tests**

Run:

```bash
npx vitest run src/app/logbook/__tests__/useLogbookController.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx src/daemon/__tests__/dataApi.test.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
```

Expected: PASS; external CLI publication appears without restarting Masthead.

- [ ] **Step 7: Commit revision refresh**

```bash
git add src/daemon/db/migrations/032_data_revisions.sql src/daemon/db/dataRevisionRepository.ts src/daemon/db/schema.ts src/workbench/authoring/guidedAuthoringService.ts src/daemon/db/workbenchPipelineRepository.ts src/daemon/server.ts src/app/daemonClient.ts src/app/useMastheadDataRevisions.ts src/app/logbook/useLogbookController.ts src/app/workbench/useWorkbenchController.ts src/app/logbook/__tests__/useLogbookController.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx
git commit -m "fix: refresh artifact surfaces from daemon revisions"
```

---

### Task 12: Remove the full-history Logbook summary scan and add latency gates

**Files:**
- Create: `src/daemon/db/migrations/033_artifact_first_summary.sql`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/db/logbookSummaryRepository.ts`
- Modify: `src/daemon/db/__tests__/logbookSummaryRepository.test.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `docs/reference/daemon-api.md`
- Create: `scripts/masthead-authoring-perf-probe.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: published artifact rows and data revisions.
- Produces: artifact-native `LogbookSummaryDto` and `npm run probe:authoring-perf`.

- [ ] **Step 1: Write the failing artifact-summary test**

```ts
test("summarizes published artifacts without scanning messages or tools", () => {
  publishArtifact(db, dossier("session:a"));
  publishArtifact(db, runbook("session:a"));
  const plan = db.prepare("EXPLAIN QUERY PLAN " + LOGBOOK_ARTIFACT_SUMMARY_SQL).all();
  expect(getLogbookSummary(db)).toEqual({
    artifacts: 2,
    byKind: { session_dossier: 1, runbook: 1, adr: 0, incident_timeline: 0 },
    projects: 1,
    earliestPublishedAt: expect.any(String),
    latestPublishedAt: expect.any(String)
  });
  expect(JSON.stringify(plan)).not.toMatch(/messages|tool_calls|file_effects/);
});
```

- [ ] **Step 2: Run the repository test and verify failure**

Run:

```bash
npx vitest run src/daemon/db/__tests__/logbookSummaryRepository.test.ts
```

Expected: FAIL because the current summary joins published sessions to all message, tool-call, file-effect, model, and runtime rows.

- [ ] **Step 3: Replace the legacy DTO and query**

Use this DTO:

```ts
export type LogbookSummaryDto = {
  artifacts: number;
  byKind: Record<"session_dossier" | "runbook" | "adr" | "incident_timeline", number>;
  projects: number;
  earliestPublishedAt?: string;
  latestPublishedAt?: string;
};
```

Query only `session_artifacts WHERE status = 'current' AND publication_status = 'published'`, using the existing publication/kind/published-at index. Migration 033 adds `idx_session_artifacts_current_published_project` on `(status, publication_status, project_label, published_at)`.

- [ ] **Step 4: Add an isolated latency probe**

`scripts/masthead-authoring-perf-probe.js` accepts either `--db-copy` or `--fixture-sessions`. The fixture form creates an isolated database under `mkdtemp`, seeds the requested number of representative sessions and artifacts, starts an isolated daemon, warms each endpoint once, then performs five measured reads. It fails unless:

```text
daemon health ready <= 10,000 ms
GET /data/revisions p95 <= 50 ms
GET /logbook/artifacts?limit=50 p95 <= 500 ms
GET /logbook/summary p95 <= 250 ms
GET /workbench/sessions?limit=100 p95 <= 500 ms
```

Add `"probe:authoring-perf": "npm run build:daemon && node scripts/masthead-authoring-perf-probe.js"` to `package.json`.

- [ ] **Step 5: Run summary and isolated performance tests**

Run:

```bash
npx vitest run src/daemon/db/__tests__/logbookSummaryRepository.test.ts src/daemon/__tests__/endpointMatrix.test.ts
npm run probe:authoring-perf -- --fixture-sessions 10000
```

Expected: PASS against the generated 10,000-session fixture; the probe deletes only the temporary directory it created on success. Task 14 separately uses `--db-copy` against the isolated production rehearsal.

- [ ] **Step 6: Commit performance work**

```bash
git add src/daemon/db/migrations/033_artifact_first_summary.sql src/daemon/db/schema.ts src/daemon/db/logbookSummaryRepository.ts src/daemon/db/__tests__/logbookSummaryRepository.test.ts src/app/daemonClient.ts docs/reference/daemon-api.md scripts/masthead-authoring-perf-probe.js package.json
git commit -m "perf: make logbook summary artifact native"
```

---

### Task 13: Add a narrow, reversible V3 template-generation recovery

**Files:**
- Create: `src/daemon/db/v3TemplateRecovery.ts`
- Create: `src/daemon/db/__tests__/v3TemplateRecovery.test.ts`
- Modify: `src/cli/workbenchMaintenance.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `docs/acceptance/guided-authoring-production-canary.md`

**Interfaces:**
- Consumes: completed V3 bundles/receipts, published artifacts, enrichment rows, request-independent Workbench state, exact backup evidence, and data revisions.
- Produces: `auditFailedV3TemplateGeneration`, `prepareFailedV3TemplateRecovery`, and `invalidateFailedV3TemplateGeneration` plus hash-locked CLI receipts.

- [ ] **Step 1: Write exact-target and rollback tests**

```ts
test("audits only the known V3 template generation", () => {
  seedFailedV3Generation(db, { runs: 270, dossiers: 3230 });
  seedUnrelatedGoodV3Run(db);
  const audit = auditFailedV3TemplateGeneration(db);
  expect(audit).toMatchObject({
    contractVersion: "workbench-authoring-v3",
    runCount: 270,
    dossierCount: 3230,
    optionalArtifactCount: 0,
    allSummariesUseIncidentPrefix: true,
    allDecisionsEmpty: true,
    allVerificationUnknown: true
  });
  expect(audit.runIds).not.toContain("run:good");
});

test("invalidates artifacts, preserves runs, and returns sessions to Workbench atomically", () => {
  const prepared = prepareFailedV3TemplateRecovery(dbPath);
  const receipt = invalidateFailedV3TemplateGeneration(db, prepared.audit, prepared.backup);
  expect(receipt).toMatchObject({ invalidatedArtifacts: 3230, preservedRuns: 270, resetSessions: 3230 });
  expect(countCompletedV3Runs(db)).toBe(271);
  expect(countCurrentIncidentDossiers(db)).toBe(0);
  expect(countIncidentSessionsOnPublishPath(db)).toBe(3230);
});

test("rolls back every row when the audit or backup hash differs", () => {
  expect(() => invalidateFailedV3TemplateGeneration(db, alteredAudit(), validBackup()))
    .toThrow("v3_template_recovery_audit_mismatch");
  expect(recoveryCounts(db)).toEqual(beforeCounts);
});
```

- [ ] **Step 2: Run recovery tests and verify failure**

Run:

```bash
npx vitest run src/daemon/db/__tests__/v3TemplateRecovery.test.ts
```

Expected: FAIL because the narrow recovery module does not exist.

- [ ] **Step 3: Implement a deterministic audit fingerprint**

The audit must include sorted run IDs, artifact IDs, session IDs, bundle hashes, receipt hashes, created/completed time bounds, actor IDs, schema versions, summary-prefix count, empty-decision count, unknown-verification count, optional-artifact count, and database ID. Compute `auditHash` from canonical JSON. Refuse an empty target, any optional artifact, any non-V3 run, or any dossier that does not match the incident fingerprint.

- [ ] **Step 4: Prepare exactly one verified backup**

`prepareFailedV3TemplateRecovery(dbPath)` removes older sibling `masthead.sqlite.backup-*` files, creates `masthead.sqlite.backup-current` through SQLite backup, verifies `PRAGMA integrity_check`, database ID, audit hash, byte size, and SHA-256, then returns immutable backup evidence. It never modifies the active database.

- [ ] **Step 5: Invalidate inside one transaction**

For exact incident artifacts only:

```text
- set status = superseded and publication_status = invalidated;
- delete their search index rows but preserve artifact bodies and provenance;
- restore pre-incident durable enrichment when available, otherwise remove only enrichment revisions stamped by the incident runs;
- reset Workbench publication, enrichment, dossier, optional-artifact, next-action, and claim state to the publish path;
- release incident claims with reason failed_v3_template_generation_recovery;
- preserve all V3 run bundles and receipts unchanged;
- bump Logbook and Workbench data revisions;
- write one durable recovery activity and receipt.
```

- [ ] **Step 6: Add audit, prepare, and invalidate CLI commands**

```bash
mastheadctl workbench audit-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --json
mastheadctl workbench prepare-v3-template-recovery --db /home/tyler/.config/masthead-production/masthead.sqlite --receipt /tmp/masthead-v3-recovery-prepared.json --json
mastheadctl workbench invalidate-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --prepared-receipt /tmp/masthead-v3-recovery-prepared.json --confirm --json
```

The invalidate command refuses a running daemon PID for the target database and refuses a prepared receipt older than 30 minutes.

- [ ] **Step 7: Run recovery and maintenance tests**

Run:

```bash
npx vitest run src/daemon/db/__tests__/v3TemplateRecovery.test.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/cli/__tests__/authoringCli.test.ts
```

Expected: PASS with exact count assertions, backup proof, idempotent repeat receipt, and injected rollback coverage.

- [ ] **Step 8: Commit recovery tooling**

```bash
git add src/daemon/db/v3TemplateRecovery.ts src/daemon/db/__tests__/v3TemplateRecovery.test.ts src/cli/workbenchMaintenance.ts src/cli/workbenchAuthoring.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/db/workbenchPipelineRepository.ts docs/acceptance/guided-authoring-production-canary.md
git commit -m "fix: add narrow v3 template recovery"
```

---

### Task 14: Close the release gates and rehearse on an isolated production copy

**Files:**
- Modify: `scripts/dogfood-durable-artifacts.js`
- Modify: `src/workbench/authoring/durableArtifactCorpusAcceptance.ts`
- Modify: `src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts`
- Modify: `docs/acceptance/durable-artifact-gate.md`
- Modify: `docs/acceptance/product-release-gate.md`
- Modify: `docs/acceptance/guided-authoring-production-canary.md`

**Interfaces:**
- Consumes: V4 guided workflow, adversarial fixture, instance manifests, revision refresh, latency probe, and recovery tooling.
- Produces: one machine-readable gate report and one signed rehearsal record.

- [ ] **Step 1: Extend the corpus report**

Add these exact metrics and hard requirements:

```ts
type GuidedAuthoringGateReport = {
  failedV3TemplateRejected: boolean;
  completeEvidenceCoverage: number;
  sessionClaimSupportCoverage: number;
  optionalClaimSupportCoverage: number;
  opportunityDispositionCoverage: number;
  duplicateSessionTemplateCount: number;
  protocolLeakCount: number;
  unsupportedCompletionCount: number;
  artifactOnlyReusePassRate: number;
  canaryPublishedBeforeApprovalCount: number;
  identityMismatchMutationCount: number;
};
```

Pass conditions are `true`, `1.0`, or `0` as appropriate. No metric is advisory.

- [ ] **Step 2: Write failing gate tests**

Add table tests that each single degraded metric fails with a unique code, including `failed_v3_template_not_rejected`, `session_claim_support_below_1`, `opportunity_disposition_below_1`, `duplicate_session_template_detected`, `canary_bypassed`, and `identity_mismatch_mutated`.

- [ ] **Step 3: Run the gate tests and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts
```

Expected: FAIL until the new report fields and failure codes exist.

- [ ] **Step 4: Extend dogfood through the real V4 interface**

The dogfood script must create a request, inspect every evidence page, save and revise a canary, prove no pre-approval publication, approve it, finish it, complete remaining assignments, run artifact-only reuse tasks, and verify revision changes. It must use the HTTP/CLI interface rather than importing service internals.

- [ ] **Step 5: Run the full local release gate**

Run:

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm test -- --run
npm run build
npm run check:endpoint-matrix
npm run smoke
npm run dogfood:durable-artifacts
```

Expected: every command PASS and the dogfood report satisfies every hard metric.

- [ ] **Step 6: Rehearse recovery on an isolated copy**

Copy the production database through SQLite backup into `/tmp/masthead-guided-recovery-rehearsal.sqlite`, run the audit, prepare, invalidate, integrity, revision, Workbench, Logbook, and latency checks against that copy, then delete only the `/tmp` rehearsal database and its `/tmp` backup after the signed results are written to `docs/acceptance/guided-authoring-production-canary.md`.

- [ ] **Step 7: Commit the release gates**

```bash
git add scripts/dogfood-durable-artifacts.js src/workbench/authoring/durableArtifactCorpusAcceptance.ts src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts docs/acceptance/durable-artifact-gate.md docs/acceptance/product-release-gate.md docs/acceptance/guided-authoring-production-canary.md
git commit -m "test: gate guided authoring recovery"
```

---

### Task 15: Install, recover production, and approve a real canary

**Files:**
- Modify after each verified operation: `docs/acceptance/guided-authoring-production-canary.md`
- No product source changes are allowed during this task.

**Interfaces:**
- Consumes: the exact release commit, packaged production bundle, instance-bound production CLI, prepared recovery receipt, and Workbench canary review.
- Produces: installed-build identity proof, recovery receipt, production canary approval, and rollout authorization record.

- [ ] **Step 1: Stop unless execution-time authority is explicit**

Before any production mutation, obtain Tyler's explicit approval for the exact scope: install the verified build, stop the production daemon, create one backup, invalidate the audited 3,230 V3 dossier artifacts, reset those sessions to Workbench, restart, and publish only the reviewed canary. Approval to implement this plan does not authorize this step.

- [ ] **Step 2: Install and verify the packaged build**

Use the repository's production installer. Confirm the installed app version, build SHA, database ID, manifest path, and instance-bound command in the acceptance record. Remove every old production bundle after the `current` symlink points to the verified build.

- [ ] **Step 3: Prove the production CLI identity before stopping**

Run:

```bash
/home/tyler/.config/masthead-production/bin/mastheadctl workbench capabilities --json
```

Require the production database ID, installed build SHA, `workbench-authoring-v4`, `guided-authoring-v1`, and manifest `/home/tyler/.config/masthead-production/masthead-instance.json`.

- [ ] **Step 4: Stop production and prepare recovery**

Stop the installed production daemon through the supported application lifecycle. Then run:

```bash
/home/tyler/.config/masthead-production/bin/mastheadctl workbench prepare-v3-template-recovery --db /home/tyler/.config/masthead-production/masthead.sqlite --receipt /tmp/masthead-v3-recovery-prepared.json --json
```

Require audit counts of exactly 270 V3 runs, 3,230 dossier artifacts, 3,230 sessions, and zero optional artifacts, plus successful active and backup integrity checks.

- [ ] **Step 5: Invalidate the exact audited generation**

Run:

```bash
/home/tyler/.config/masthead-production/bin/mastheadctl workbench invalidate-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --prepared-receipt /tmp/masthead-v3-recovery-prepared.json --confirm --json
```

Require the immutable receipt to report 3,230 invalidated artifacts, 270 preserved runs, 3,230 reset sessions, zero unrelated artifacts changed, and both data revisions incremented.

- [ ] **Step 6: Restart and verify coherent surfaces**

Start production normally. Without another restart, require Logbook to remove the invalidated dossiers and Workbench to show the recovered sessions within one revision-poll interval. Verify no stale 3,230-item selection remains and all five latency budgets pass against production read endpoints.

- [ ] **Step 7: Publish only the production canary**

From Workbench, select the three signed canary sessions recorded in the acceptance document, copy the V4 prompt, complete guided inspection and draft review, inspect the staged dossier and optional-artifact drafts in the Activity rail, and approve only if every item is specific, grounded, independently reusable where applicable, and free of repeated template language.

- [ ] **Step 8: Hold the full rollout for explicit approval**

Record the canary request ID, assignment ID, artifact IDs, human review notes, artifact-only reuse results, revisions, and endpoint timings. Do not release the remaining recovered sessions until Tyler explicitly approves full campaign continuation from this evidence.

---

## Self-Review Checklist

- [ ] Every diagnosed failure has a task: unsafe orchestration, weak enrichment validation, poor artifact guidance, arbitrary batching, CLI instance collision, stale Logbook cache, stale Workbench selection, slow legacy summary, and polluted production data.
- [ ] V4 types, command names, route names, status names, and policy versions are consistent across tasks.
- [ ] V1-V3 audit history and canonical session evidence are preserved.
- [ ] Sparse evidence and legitimate zero-optional-artifact outcomes remain valid.
- [ ] Production mutation is isolated to Task 15 and requires fresh explicit authority.
- [ ] The exact failed generation is rejected by tests before recovery tooling can ship.
- [ ] The plan contains no unresolved implementation decisions.
