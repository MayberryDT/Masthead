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
- Persist the request's normalized opportunity set and assignment membership before authoring begins. Never recompute disposition obligations from mutable suggestions after a request starts.
- A Workbench handoff contains an opaque request ID and one instance-bound start command. It never contains the entire selection or asks the agent to partition sessions.
- Development and production never rewrite the same CLI launcher. A request is durably bound to its database ID, build SHA, canonical manifest path, and base URL; its creation-time daemon nonce is audit metadata only. Every mutation reads the current manifest and carries its current per-daemon nonce, which the daemon verifies at the mutation boundary, so a restart with unchanged stable binding is safe while a database/build/manifest/base-URL change fails closed and requires a new request.
- Do not mutate production data during implementation or rehearsal. Production invalidation requires a fresh exact audit, one verified sibling backup, explicit Tyler authorization at execution time, the installed production daemon stopped, and a hash-locked recovery receipt.
- Every implementation fixture, rehearsal, dogfood run, pre-production model canary, and performance probe creates its own temporary database, manifest, and dynamically allocated daemon port; it refuses the live production database path and live production manifest identity and cleans up in `finally` on success or failure. The explicitly authorized Task 15 production canary is the sole exception and remains bounded by its separate approval gate.
- Preserve exactly one active production database and at most one sibling backup. Never retain multiple production bundles or recovery snapshots.
- A successful V3 invalidation remains reversible through a tested hash-locked restore command until the production canary is accepted.
- Do not republish the full recovered selection until the isolated rehearsal, automated corpus gate, installed production smoke, and human-reviewed production canary all pass.

---

## File Structure

### New files

- `docs/adr/0015-guided-authoring-campaigns.md` — authoritative V4 campaign, guidance, canary, and instance-identity decision.
- `src/shared/guidedAuthoring.ts` — V4 request, assignment, evidence coverage, next-action, draft, disposition, review, and receipt DTOs.
- `src/daemon/db/migrations/031_guided_authoring.sql` — durable requests, opportunities, assignments, memberships, revisioned drafts, evidence access, and append-only operator review state.
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
- `src/core/__tests__/mastheadAuthoringPerfProbe.test.ts` — probe isolation, refusal, cleanup, port, and subprocess lifecycle tests.
- `scripts/masthead-guided-agent-canary.js` — fail-closed isolated fixture and manifest harness for a fresh-model acceptance canary.
- `src/workbench/authoring/__tests__/guidedAgentCanaryHarness.test.ts` — launch-package privacy, live-instance refusal, and cleanup tests.
- `src/daemon/db/v3TemplateRecovery.ts` — narrow incident audit, backup proof, invalidation, and rollback transaction.
- `src/daemon/db/__tests__/v3TemplateRecovery.test.ts` — exact-target and rollback tests.
- `docs/acceptance/guided-authoring-v3-incident-contract.json` — reviewed counts, actor/time bounds, schema/policy values, and population hashes for the one recoverable incident.
- `docs/acceptance/guided-authoring-production-canary.md` — signed rehearsal, install, recovery, canary, and rollout evidence.

### Primary modified files

- `CONTEXT.md`, `prd.md`, `openwiki/logbook-and-workbench.md`, `docs/reference/daemon-api.md`, `docs/reference/mcp-tools.md` — current V4 product and protocol contract.
- `src/shared/workbenchAuthoring.ts`, `src/workbench/authoring/authoringSchemas.ts` — retain legacy audit types while making V4 current.
- `src/workbench/authoring/advisorySuggestions.ts`, `artifactCandidates.ts`, `artifactQuality.ts`, `authoringService.ts` — reuse detector and publication internals behind the V4 module; retire V3 mutations.
- `src/daemon/db/workbenchAuthoringRepository.ts`, `workbenchPipelineRepository.ts`, `sessionArtifactRepository.ts` — V4 assignment linkage, publication, centralized revision bumps, and recovery state reset.
- `src/daemon/workbenchAuthoringApi.ts`, `server.ts`, `healthService.ts`, `settingsService.ts` — advertise and route V4; reject V3 mutations.
- `src/cli/workbenchAuthoring.ts`, `authoringClient.ts`, `mastheadctl.ts`, `workbenchMaintenance.ts` — guided commands, fail-closed identity, and recovery commands.
- `src/electron/cliLauncher.ts`, `main.ts`, and focused tests — per-instance launcher and manifest ownership.
- `src/app/daemonClient.ts`, `src/app/workbench/useWorkbenchController.ts`, `src/ui/workbench/workbenchHandoff.ts`, `src/ui/workbench/WorkbenchPanel.tsx` — durable request creation, final prompt, canary review, revision refresh, and selection pruning.
- `src/app/logbook/useLogbookController.ts`, `src/app/logbook/__tests__/useLogbookController.test.tsx` — revision-keyed cache invalidation.
- `src/daemon/db/logbookSummaryRepository.ts`, `src/daemon/db/__tests__/logbookSummaryRepository.test.ts` — artifact-native summary with no full-history evidence joins.
- `scripts/dogfood-durable-artifacts.js`, `scripts/masthead-guided-agent-canary.js`, `src/workbench/authoring/durableArtifactCorpusAcceptance.ts`, `docs/acceptance/durable-artifact-gate.md`, `docs/acceptance/product-release-gate.md` — V4 adversarial, fresh-agent, reuse, canary, identity, freshness, and latency gates.

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
- Modify: `openwiki/data-and-integrations.md`
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/reference/enrichment.md`
- Modify: `docs/reference/session-dossier.md`
- Modify: `docs/reference/artifact-first-logbook-cutover.md`
- Modify: `docs/acceptance/product-release-gate.md`
- Modify: `docs/acceptance/durable-artifact-production-canary.md`
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
    "openwiki/data-and-integrations.md",
    "docs/reference/enrichment.md",
    "docs/reference/session-dossier.md",
    "docs/reference/artifact-first-logbook-cutover.md",
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

Document V3 routes as audit-only and `authoring_contract_retired` for mutation attempts. Replace the existing V3 product-contract assertion instead of adding a contradictory second assertion. Replace OpenWiki's claim that the handoff never includes a CLI recipe with the narrower rule that it includes one instance-bound start command and no multi-step recipe or session list. Update the active enrichment, session-dossier, cutover, and data/integrations references so none advertises V1 or V3 writes as current. Add a supersession banner and unchecked V4 gates to the two acceptance records; preserve their signed V3 evidence as history instead of rewriting it as V4 evidence.

Document the fail-closed planning boundary: Masthead never splits a strong opportunity merely to manufacture the three-session canary. It uses a complete strong group of at most three or diverse dossier-only sessions; if every selected session belongs to larger strong groups, request creation returns `guided_canary_not_constructible` and persists nothing.

- [ ] **Step 5: Run the focused contract checks**

Run:

```bash
npx vitest run src/workbench/__tests__/productContract.test.ts
npm run check:product-contract
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add docs/adr/0015-guided-authoring-campaigns.md docs/adr/0014-agent-led-enriched-artifact-authoring.md CONTEXT.md README.md design.md prd.md openwiki/quickstart.md openwiki/logbook-and-workbench.md openwiki/data-and-integrations.md docs/reference/daemon-api.md docs/reference/enrichment.md docs/reference/session-dossier.md docs/reference/artifact-first-logbook-cutover.md docs/acceptance/product-release-gate.md docs/acceptance/durable-artifact-production-canary.md src/workbench/__tests__/productContract.test.ts
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
    ["opportunity dispositions field", (bundle: any) => { delete bundle.opportunityDispositions; }],
    ["evidence revision", (bundle: any) => { bundle.evidenceRevision = ""; }]
  ])("rejects missing %s", (_label, mutate) => {
    const bundle = validGuidedBundle();
    mutate(bundle);
    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });
});

test("accepts an empty disposition array when the assignment has no opportunities", () => {
  const bundle = validGuidedBundle({ opportunities: [] });
  bundle.opportunityDispositions = [];
  expect(parseGuidedAuthoringBundleV4(bundle)).toMatchObject({ opportunityDispositions: [] });
});
```

The main fixture must include one session enrichment, supports for `/sessionTitle/text`, `/sessionSummary/text`, `/sessionDossier/purpose`, `/sessionDossier/outcome`, and `/sessionDossier/keyWork/0`, plus one dismissed opportunity with a reason and evidence reference. `opportunityDispositions` is always a required array, but it may be empty exactly when the assignment has no persisted opportunities; the parser rejects an omitted or malformed field, while Task 7 validates completeness against the assignment's opportunity set.

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
  artifactDraftId?: string;
  mergedIntoOpportunityId?: string;
};

export type GuidedArtifactDraft = WorkbenchArtifactDraft & {
  draftId: string;
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
  artifacts: GuidedArtifactDraft[];
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
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  instanceId: string;
  maxSessionsPerAssignment: 12;
  canarySessions: 3;
  operations: ["start", "inspect", "save", "review", "finish"];
};

export type GuidedAuthoringRequestDto = {
  requestId: string;
  actorId: string;
  policyVersion: "guided-authoring-v1";
  status: GuidedAuthoringRequestStatus;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  creationInstanceId: string;
  sessionCount: number;
  completedSessionCount: number;
  assignmentCount: number;
  currentAssignmentId?: string;
  canaryAssignmentId: string;
  canaryApprovedAt?: string;
  canaryApprovedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type GuidedAuthoringAssignmentDto = {
  assignmentId: string;
  requestId: string;
  ordinal: number;
  status: GuidedAuthoringAssignmentStatus;
  canary: boolean;
  evidenceRevision: string;
  sessionIds: string[];
  opportunityIds: string[];
  currentDraftRevision: number;
  acceptedDraftRevision?: number;
  findings: WorkbenchAuthoringFinding[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type GuidedEvidenceCoverageDto = {
  sessionId: string;
  evidenceRevision: string;
  accessedItems: number;
  totalItems: number;
  complete: boolean;
};

export type GuidedAuthoringOperatorReviewDto = {
  reviewId: string;
  draftRevision: number;
  decision: "approved" | "rejected";
  notes: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type GuidedAuthoringReviewDto = {
  requestId: string;
  assignmentId: string;
  status: GuidedAuthoringAssignmentStatus;
  evidenceRevision: string;
  draftRevision?: number;
  draft?: GuidedAuthoringBundleV4;
  findings: WorkbenchAuthoringFinding[];
  coverage: GuidedEvidenceCoverageDto[];
  operatorReviews: GuidedAuthoringOperatorReviewDto[];
  nextAction: GuidedAuthoringNextAction;
};

export type GuidedPublishedArtifactDto = {
  draftId?: string;
  artifactId: string;
  kind: "session_dossier" | "runbook" | "adr" | "incident_timeline";
  sessionIds: string[];
};

export type GuidedAuthoringReceiptDto = {
  receiptVersion: "guided-authoring-receipt-v1";
  requestId: string;
  assignmentId: string;
  evidenceRevision: string;
  draftRevision: number;
  sessionIds: string[];
  opportunityIds: string[];
  publishedArtifacts: GuidedPublishedArtifactDto[];
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  publicationInstanceId: string;
  completedAt: string;
};
```

Request responses expose counts and the current assignment but not the selected session list; assignment responses expose only their bounded membership. Review responses may embed the latest staged draft because Workbench must render the canary after a renderer restart. Receipts are immutable publication evidence and never contain `nextAction`; the service computes the current next action separately so a safe daemon restart does not rewrite historical receipts.

The schema must reject additional properties, empty rationale/evidence arrays, duplicate artifact draft IDs, and session support paths that do not begin with `/sessionTitle`, `/sessionSummary`, or `/sessionDossier`. An `authored` or `changed_kind` disposition requires `artifactDraftId` and `artifactKind`, which must resolve to exactly one submitted artifact of the same kind; a `merged` disposition requires `mergedIntoOpportunityId`; a `dismissed` disposition forbids artifact linkage. Missing or malformed `opportunityDispositions` is invalid, but an empty array is schema-valid because zero-opportunity assignments are legitimate.

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
- Consumes: V4 DTO statuses, one precomputed immutable assignment/opportunity plan, expected instance identity, and `MastheadDatabase`.
- Produces: `createGuidedAuthoringRequest`, transaction-composable `*InTransaction` repository operations, stable opportunity reads, append-only draft/review history, evidence access, canary decisions, and assignment completion.

- [ ] **Step 1: Write repository transition tests**

Cover these exact transitions:

```ts
test("persists request membership and a three-session canary atomically", () => {
  const request = createGuidedAuthoringRequest(db, requestInputWithPlan(14));
  const assignment = getGuidedAssignments(db, request.requestId)[0]!;
  expect(request.sessionCount).toBe(14);
  expect(assignment.sessionIds).toHaveLength(3);
  expect(assignment.canary).toBe(true);
  expect(listGuidedOpportunities(db, request.requestId)).toEqual(expectedStableOpportunities());
});

test("rolls back request membership, opportunities, assignments, and canary together", () => {
  injectGuidedRequestFailure("after_opportunities");
  expect(() => createGuidedAuthoringRequest(db, requestInputWithPlan(14)))
    .toThrow("injected_guided_request_failure");
  expect(guidedRequestCounts(db)).toEqual(emptyGuidedRequestCounts());
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

test("preserves reject, revised draft, and approval as append-only history", () => {
  storeGuidedDraftReview(db, reviewedDraft(1));
  recordCanaryDecision(db, rejectedDecision(1));
  storeGuidedDraftReview(db, reviewedDraft(2));
  recordCanaryDecision(db, approvedDecision(2));
  expect(listGuidedOperatorReviews(db, "assignment:one").map(({ decision, draftRevision }) => ({ decision, draftRevision })))
    .toEqual([{ decision: "rejected", draftRevision: 1 }, { decision: "approved", draftRevision: 2 }]);
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
  creation_instance_id TEXT NOT NULL,
  instance_manifest TEXT NOT NULL,
  base_url TEXT NOT NULL,
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

CREATE TABLE guided_authoring_opportunities (
  opportunity_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  suggested_kind TEXT NOT NULL CHECK (suggested_kind IN ('runbook','adr','incident_timeline')),
  signal_strength TEXT NOT NULL CHECK (signal_strength IN ('high','medium')),
  summary TEXT NOT NULL,
  signature_key TEXT,
  evidence_refs_json TEXT NOT NULL,
  provenance_session_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, opportunity_id)
);

CREATE TABLE guided_authoring_assignments (
  assignment_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating','drafting','needs_revision','ready_to_finish','staged_canary','completed')),
  canary INTEGER NOT NULL CHECK (canary IN (0,1)),
  evidence_revision TEXT NOT NULL,
  current_draft_revision INTEGER NOT NULL DEFAULT 0,
  accepted_draft_revision INTEGER,
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (request_id, ordinal),
  UNIQUE (assignment_id, request_id)
);

CREATE TABLE guided_authoring_assignment_sessions (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, session_id),
  UNIQUE (assignment_id, request_id, session_id),
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, session_id) REFERENCES guided_authoring_request_sessions(request_id, session_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_assignment_opportunities (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, opportunity_id),
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, opportunity_id) REFERENCES guided_authoring_opportunities(request_id, opportunity_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_evidence_access (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, session_id, evidence_revision, evidence_ref),
  FOREIGN KEY (assignment_id, request_id, session_id) REFERENCES guided_authoring_assignment_sessions(assignment_id, request_id, session_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_draft_reviews (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  evidence_revision TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, revision)
);

CREATE TABLE guided_authoring_operator_reviews (
  review_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  draft_revision INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  notes TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id, draft_revision) REFERENCES guided_authoring_draft_reviews(assignment_id, revision)
);

CREATE INDEX idx_guided_request_status ON guided_authoring_requests(status, updated_at DESC);
CREATE INDEX idx_guided_request_sessions_state ON guided_authoring_request_sessions(request_id, state, ordinal);
CREATE INDEX idx_guided_assignment_request ON guided_authoring_assignments(request_id, ordinal);
CREATE INDEX idx_guided_opportunity_request ON guided_authoring_opportunities(request_id, opportunity_id);
CREATE INDEX idx_guided_operator_review_assignment ON guided_authoring_operator_reviews(assignment_id, reviewed_at, review_id);
```

- [ ] **Step 4: Implement the repository as transaction-owning operations**

Export these exact signatures:

```ts
export function createGuidedAuthoringRequest(
  db: MastheadDatabase,
  input: CreateGuidedAuthoringRequestInput
): GuidedAuthoringRequestDto;
export function createGuidedAuthoringRequestInTransaction(
  db: MastheadDatabase,
  input: CreateGuidedAuthoringRequestInput
): GuidedAuthoringRequestDto;
export function recordGuidedEvidenceAccess(
  db: MastheadDatabase,
  input: { assignmentId: string; requestId: string; sessionId: string; evidenceRevision: string; evidenceRefs: string[] }
): void;
export function storeGuidedDraftReview(
  db: MastheadDatabase,
  input: { assignmentId: string; draft: GuidedAuthoringBundleV4; findings: WorkbenchAuthoringFinding[] }
): GuidedAuthoringAssignmentDto;
export function recordCanaryDecision(
  db: MastheadDatabase,
  input: { requestId: string; assignmentId: string; draftRevision: number; decision: "approved" | "rejected"; notes: string; reviewedBy: string }
): GuidedAuthoringRequestDto;
```

`CreateGuidedAuthoringRequestInput` contains the complete deterministic plan: request sessions, normalized opportunity definitions, every assignment membership, assignment-opportunity membership, and the canary ordinal. Creation validates every assignment session belongs to the same request, appears exactly once, no assignment exceeds 12 sessions, the first assignment is the only canary and has at most three sessions, and every opportunity membership resolves inside the same request.

The request stores `creation_instance_id` only for provenance. Later mutations compare the request's stable database/build/manifest/base-URL binding with the current daemon and independently verify the mutation envelope's current `instanceId`; they never require the current nonce to equal `creation_instance_id` after a safe daemon restart.

Every state-changing repository operation has a public transaction-owning wrapper and an exported or module-visible `*InTransaction` variant. Public wrappers use `BEGIN IMMEDIATE`, validate before writing, commit once, and roll back on every exception. Task 5 uses the atomic request-plan creation operation; Task 8 composes only the `*InTransaction` variants inside its single publication transaction, so nested `BEGIN` calls are forbidden.

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
- Modify: `scripts/masthead-production.js`
- Modify: `src/electron/__tests__/cliLauncher.test.ts`
- Modify: `src/electron/__tests__/mainCliLauncher.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`
- Modify: `src/electron/__tests__/productionLauncher.test.ts`

**Interfaces:**
- Consumes: Electron instance data directory, daemon base URL, database ID, build SHA, PID, and a fresh per-daemon instance nonce.
- Produces: `MastheadInstanceManifest`, per-instance launcher path, `GuidedAuthoringExpectedIdentity`, and fail-closed client plus daemon-bound mutation identity.

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

test.each([
  ["base URL", "base_url_identity_mismatch"],
  ["build SHA", "build_identity_mismatch"],
  ["manifest path", "manifest_identity_mismatch"],
  ["instance nonce", "instance_identity_mismatch"]
])("refuses a mutation when the %s differs", async (_label, code) => {
  server.swapIdentityAfterCapabilities(_label);
  await expect(client.mutate(validMutation())).rejects.toMatchObject({ code });
  expect(server.mutationCount).toBe(0);
});

test("stages a production bundle and instance launcher without starting or opening the database", async () => {
  const previousCurrent = await readlink(currentPath);
  const result = await stageProduction({ launch: false, openDatabase: forbiddenDatabaseOpen });
  expect(result).toMatchObject({ launched: false, databaseOpened: false, staged: true });
  expect(await readlink(result.currentPath)).toBe(previousCurrent);
  expect(await readFile(result.instanceLauncherPath, "utf8")).toContain("masthead-instance.json");
});

test("continues a stably bound request after a safe daemon restart", async () => {
  const request = await client.createRequest(currentIdentity());
  restartDaemonWithNewInstanceId();
  await expect(client.start(request.requestId)).resolves.toMatchObject({ assignment: expect.any(Object) });
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
  instanceId: string;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  pid: number;
  instanceDir: string;
  updatedAt: string;
};
```

Generate a cryptographically random `instanceId` for every daemon process, write the manifest atomically to `<instanceDir>/masthead-instance.json`, and publish the same ID plus the canonical manifest path and base URL in capabilities. Place the launcher at `<instanceDir>/bin/mastheadctl`; the wrapper passes `MASTHEAD_INSTANCE_MANIFEST` to the CLI and never embeds another instance's URL.

Add a production installer staged/no-launch mode that copies and verifies the packaged bundle and prepares its instance launcher without changing `current`, deleting the old bundle, spawning Masthead, probing the daemon, opening SQLite, or generating a live instance manifest. After the old daemon stops, the existing activation operation atomically switches `current`, installs the staged launcher, and performs disk-hygiene cleanup. This staged mode is the only installation mode Task 15 may use before the old daemon stops.

- [ ] **Step 4: Verify identity before every authoring mutation**

Implement this client method and call it before request creation, start, save, canary decisions, and finish. Offline recovery commands verify the database and backup identities directly because the target daemon must be stopped:

```ts
async assertAuthoringIdentity(expected: {
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  instanceId: string;
}): Promise<GuidedAuthoringCapabilitiesDto> {
  const actual = await this.capabilities();
  if (actual.baseUrl !== expected.baseUrl) throw identityError("base_url_identity_mismatch", expected.baseUrl, actual.baseUrl);
  if (actual.databaseId !== expected.databaseId) throw identityError("database_identity_mismatch", expected.databaseId, actual.databaseId);
  if (actual.buildSha !== expected.buildSha) throw identityError("build_identity_mismatch", expected.buildSha, actual.buildSha);
  if (actual.instanceManifest !== expected.instanceManifest) throw identityError("manifest_identity_mismatch", expected.instanceManifest, actual.instanceManifest);
  if (actual.instanceId !== expected.instanceId) throw identityError("instance_identity_mismatch", expected.instanceId, actual.instanceId);
  return actual;
}
```

Define `GuidedAuthoringExpectedIdentity` with those five fields and include it in every authoring mutation request. The client performs the early capabilities check for fast feedback, but Tasks 8 and 9 must pass the envelope to the service and verify it again immediately before database mutation; a capabilities check is never authorization by itself. Remove Electron startup writes to the shared global launcher. If `~/.local/bin/mastheadctl` already exists, leave it untouched and never advertise it in capabilities.

- [ ] **Step 5: Run launcher, packaged-command, and doctor tests**

Run:

```bash
npx vitest run src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/electron/__tests__/packagedCliCommand.test.ts src/electron/__tests__/productionLauncher.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
```

Expected: PASS; tests prove simultaneous dev and production manifests cannot overwrite each other, a manifest swapped after the preliminary capabilities read still produces zero mutations, and a request with unchanged database/build/manifest/base binding continues after restart using the new current `instanceId`.

- [ ] **Step 6: Commit instance binding**

```bash
git add src/electron/cliLauncher.ts src/electron/main.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts scripts/masthead-production.js src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/electron/__tests__/productionLauncher.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
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

test.each([4, 12])("does not split a %i-session strong opportunity to manufacture a canary", (size) => {
  expect(() => planGuidedAssignments(selectionInsideOneStrongOpportunity(size), oneStrongOpportunity(size)))
    .toThrow("guided_canary_not_constructible");
});

test("rejects an over-limit strong group without persisting a partial request", () => {
  expect(() => createGuidedRequest(db, selectionInsideOneStrongOpportunity(13)))
    .toThrow("guided_opportunity_group_too_large");
  expect(guidedRequestCounts(db)).toEqual(emptyGuidedRequestCounts());
});

test("unions overlapping strong opportunities before applying the assignment limit", () => {
  const plan = planGuidedAssignments(selection(6), suggestionsAcross(["a", "b", "c"], ["c", "d", "e"]));
  expect(plan.groups.find(({ opportunityIds }) => opportunityIds.length === 2)?.sessionIds)
    .toEqual(["session:a", "session:b", "session:c", "session:d", "session:e"]);
});

test("rejects an overlapping strong-opportunity connected component above twelve", () => {
  expect(() => planGuidedAssignments(selection(13), chainedOverlappingSuggestions(13)))
    .toThrow("guided_opportunity_group_too_large");
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
1. Normalize strong suggestion signatures, build the session-opportunity graph, and union every overlapping strong opportunity into one connected component.
2. Reject the entire request before persistence when any connected component exceeds 12 sessions rather than truncating provenance or placing one session in two assignments.
3. Turn each accepted connected component into one assignment group and attach all of its opportunities.
4. Place remaining sessions into stable dossier-only groups ordered by original selection ordinal.
5. Choose the canary as one complete strong group of at most three sessions when available; otherwise choose up to three diverse dossier-only sessions that belong to no larger strong group.
6. If every selected session belongs to strong groups larger than three, reject the request with `guided_canary_not_constructible`; never split a strong opportunity or duplicate a session to manufacture a canary.
7. Preserve every selected compile-ready session exactly once for every accepted plan.
8. Persist the normalized opportunity definitions and complete assignment plan with the request in the one Task 3 transaction; never regenerate them when starting or reviewing an assignment.
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

`createGuidedRequest()` computes the plan before opening a write transaction, then passes the complete immutable plan to `createGuidedAuthoringRequest()`. `startGuidedAssignment()` reads the already-persisted next assignment and opportunities. An injected persistence failure leaves no request, membership, opportunity, assignment, or canary rows.

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
  expect(review.coverage[0]).toMatchObject({ accessedItems: 1, complete: false, totalItems: 8 });
});

test("moves to save only after every canonical evidence item was returned", () => {
  inspectAllPages(db, "assignment:one", "session:a");
  expect(reviewGuidedAssignment(db, "assignment:one").nextAction.kind).toBe("save");
});

test("invalidates assignment-wide coverage when another member's evidence changes", () => {
  inspectAllPages(db, "assignment:one", "session:a");
  appendCanonicalEvidence(db, "session:b");
  expect(() => inspectGuidedAssignment(db, inspectInput({ sessionId: "session:a" })))
    .toThrow("evidence_revision_changed");
  expect(reviewGuidedAssignment(db, "assignment:one").coverage.every(({ complete }) => !complete)).toBe(true);
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

Default to the first session with unread evidence, ascending canonical order, and 100 items. Record only refs actually returned. Reject `query`, `kind`, and descending inspection as completion-bearing operations; those remain supplementary reads and do not advance complete-evidence coverage. The assignment stores one revision over all assignment sessions, while an evidence page reports its session revision. Before and after every page read, recompute and compare the assignment-wide revision; never compare a session-only page revision directly with the multi-session assignment revision. If any member changes, reject the read, advance the assignment to the fresh revision, and compute current coverage only from access rows carrying that revision. Preserve older revision rows as audit history, but never count them toward current completion.

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

test("accepts supported CLI and prompt work when that is the session's actual subject", () => {
  expect(validateGuidedAuthoringDraft(supportedMastheadProtocolWork())).toMatchObject({ accepted: true, findings: [] });
});

test("rejects blanket copied opportunity dismissals even when each cites one real ref", () => {
  const result = validateGuidedAuthoringDraft(repeatedGenericDismissals());
  expect(result.findings.map(({ code }) => code)).toContain("unsupported_opportunity_dismissal");
});

test("requires every authored disposition to resolve to one matching artifact draft", () => {
  const result = validateGuidedAuthoringDraft(authoredDispositionWithMissingDraft());
  expect(result.findings.map(({ code }) => code)).toContain("invalid_opportunity_artifact_link");
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
- Unsupported copied machine-request prose, instruction boilerplate, plugin recommendations, AGENTS directives, and authoring commands produce `protocol_leakage`; the detector must not reject supported sessions whose actual user-requested work is to design or debug those protocols.
- Every persisted high-signal opportunity has exactly one disposition. `authored` and `changed_kind` resolve to exactly one matching artifact draft; `merged` resolves to another persisted opportunity whose final disposition produces an artifact; dismissal and changed-kind rationales cite signal-specific evidence that supports the judgment.
- Generic or materially duplicated dismissal rationales across distinct opportunities fail even when they each cite a real ref. Kind-specific tests must prove one supported dismissal and one unsupported blanket dismissal for runbook, ADR, and incident signals.
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

test("rejects a manifest swap at the mutation boundary", () => {
  const input = finishInput({ expectedIdentity: identityFromPreviousCapabilities() });
  rotateDaemonInstanceIdentity();
  expect(() => finishGuidedAssignment(db, input)).toThrow("instance_identity_mismatch");
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

`saveGuidedDraft()` appends a draft/review revision and stores accepted canary drafts as `staged_canary`; it changes the request to `awaiting_canary_approval`. `approveGuidedCanary()` requires `reviewedBy`, nonempty notes, matching request and assignment IDs, the exact accepted draft revision, and current evidence revision. Rejection appends an operator review, changes the assignment to `needs_revision`, and returns the request to `open` without publishing. A later revision and approval append new rows rather than overwriting either rejection or draft history.

- [ ] **Step 4: Implement one-transaction finish**

Within one `BEGIN IMMEDIATE` transaction:

```text
1. Revalidate request and assignment; compare the request's persisted base URL/database/build/manifest binding with the daemon; compare the mutation envelope's current instance nonce with the daemon's current nonce; treat the request's creation nonce as audit-only; then verify evidence revision, complete inspection, accepted draft revision/findings, and canary approval.
2. Apply each session's durable enrichment, with request ID, assignment ID, source, and policy version stamped by the daemon so later recovery can identify the exact authoring provenance.
3. Rebuild and stage each canonical dossier snapshot.
4. Stage optional artifacts and provenance.
5. Publish all staged artifacts.
6. Mark assignment sessions completed and reset their Workbench claims/state.
7. Store the immutable assignment receipt.
8. Mark the request completed only when no pending request sessions remain.
```

Return the stored receipt unchanged on finish retry.

The outer service owns the one `BEGIN IMMEDIATE` and calls only transaction-composable repository/publication helpers; no helper may open a nested transaction. On approved-canary finish the request becomes `active`; on final-assignment finish it becomes `completed`. Idempotent retries look up the stored receipt before attempting a new transition, verify its request and stable binding, and verify the retry envelope against the current daemon; the receipt's historical publication instance nonce need not equal a restarted daemon's current nonce.

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
- Modify: `src/core/worktreeConnector.ts`
- Modify: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`
- Modify: `src/core/__tests__/worktreeConnector.test.ts`
- Modify: `src/daemon/__tests__/endpointMatrix.test.ts`

**Interfaces:**
- Consumes: the V4 deep module and instance identity.
- Produces: request creation/status, pending-canary discovery, start, inspect, save, review, canary-decision, and finish routes plus `mastheadctl workbench author` commands and method-aware read-only bridge rules.

- [ ] **Step 1: Write failing route and CLI tests**

Require this command flow:

```bash
mastheadctl workbench author start --request request:one --json
mastheadctl workbench author inspect --assignment assignment:one --json
mastheadctl workbench author save --assignment assignment:one --file draft.json --json
mastheadctl workbench author review --assignment assignment:one --json
mastheadctl workbench author finish --assignment assignment:one --json
```

Add tests that every successful agent workflow command response contains exactly one `nextAction`, every mutation rejects an expected identity swapped after capabilities with zero writes, pending-canary discovery survives a simulated renderer restart, and legacy `open`, `submit`, and `finish` mutations return `authoring_contract_retired` for V3.

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
GET  /workbench/authoring/requests/:requestId
GET  /workbench/authoring/canaries/pending
POST /workbench/authoring/requests/:requestId/start
GET  /workbench/authoring/assignments/:assignmentId/inspect
POST /workbench/authoring/assignments/:assignmentId/draft
GET  /workbench/authoring/assignments/:assignmentId/review
POST /workbench/authoring/requests/:requestId/canary-decision
POST /workbench/authoring/assignments/:assignmentId/finish
```

The read-only bridge permits capabilities, request status, pending-canary discovery, inspect, and review; it rejects request creation, start/claim, draft save, canary decisions, and finish. Update the method-aware matcher in `src/core/worktreeConnector.ts`, its focused tests, and the endpoint matrix in the same task; do not rely on `viteConnectorManager` tests to cover route authorization.

- [ ] **Step 4: Add nested CLI dispatch and next-action rendering**

`runGuidedAuthoringCli(args, options)` parses the subcommand after `author`, verifies the manifest before mutations, includes `GuidedAuthoringExpectedIdentity` in the mutation body, prints human-readable guidance by default, and returns the exact DTO under `--json`. Every mutation handler compares that envelope with the daemon's current base URL, database ID, build SHA, canonical manifest path, and instance nonce immediately before calling the service. It must not provide a command that accepts multiple request IDs, assignment IDs, or a session list.

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
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts src/core/__tests__/worktreeConnector.test.ts src/daemon/__tests__/endpointMatrix.test.ts
```

Expected: PASS with a complete V4 operation contract and no V3 write path.

- [ ] **Step 7: Commit adapters**

```bash
git add src/daemon/guidedAuthoringApi.ts src/cli/guidedAuthoring.ts src/daemon/workbenchAuthoringApi.ts src/daemon/server.ts src/daemon/healthService.ts src/daemon/settingsService.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/cli/mastheadctl.ts src/core/worktreeConnector.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/core/__tests__/worktreeConnector.test.ts src/daemon/__tests__/endpointMatrix.test.ts
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

test("rediscovers a staged canary after the controller remounts", async () => {
  api.listPendingGuidedCanaries.mockResolvedValue([stagedReview()]);
  const view = renderController();
  await waitFor(() => expect(view.result.current.pendingCanaryReviews).toHaveLength(1));
  expect(view.result.current.pendingCanaryReviews[0]?.assignmentId).toBe("assignment:canary");
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
    expectedIdentity: identityFromCapabilities(capabilities),
    databaseId: capabilities.databaseId,
    buildSha: capabilities.buildSha,
    sessionIds: agentPromptSessionIds
  });
  return buildWorkbenchHandoff({ capabilities, request });
}
```

`WorkbenchPanel` awaits the text, copies it, and only then reports success. Failed request creation must not place stale prompt text on the clipboard.

Do not rely on the in-memory response from Copy Agent Prompt to find the review later. On Workbench mount and Activity-rail refresh, load `GET /workbench/authoring/canaries/pending`; after Task 11, a Workbench revision change also reloads it. Approve and reject calls include the full expected identity envelope, the request ID, assignment ID, and exact draft revision. A renderer or application restart must rediscover the same staged canary from daemon state.

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
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/dataLifecycleRepository.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/worktreeConnector.ts`
- Modify: `src/app/daemonClient.ts`
- Create: `src/app/useMastheadDataRevisions.ts`
- Modify: `src/app/logbook/useLogbookController.ts`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/daemon/db/__tests__/sessionArtifactRepository.test.ts`
- Modify: `src/daemon/db/__tests__/dataLifecycleRepository.test.ts`
- Modify: `src/core/__tests__/worktreeConnector.test.ts`
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

test("increments Logbook revision for direct artifact publication", () => {
  const before = getDataRevisions(db);
  publishSessionArtifact(db, appliedArtifactId);
  expect(getDataRevisions(db).logbook).toBe(before.logbook + 1);
});

test("increments both revisions for scoped data deletion", () => {
  const before = getDataRevisions(db);
  deleteSessionData(db, ["session:a"]);
  expect(getDataRevisions(db)).toEqual({ logbook: before.logbook + 1, workbench: before.workbench + 1 });
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

Export `getDataRevisions(db)` and `bumpDataRevisionInTransaction(db, scope)`. Each logical operation increments a scope at most once even when it publishes several artifacts. Guided publication and recovery bump both scopes inside their existing transaction; draft staging, canary rejection/approval, claims, and other Workbench-only mutations bump Workbench. Direct artifact publication bumps Logbook, and data lifecycle deletion bumps every scope whose rows changed. Cover the low-level publication and lifecycle paths so revision correctness does not depend on every caller remembering an extra bump.

- [ ] **Step 4: Add the cheap revision endpoint and active polling hook**

`GET /data/revisions` returns:

```json
{"ok":true,"logbook":42,"workbench":87}
```

`useMastheadDataRevisions` polls every 2 seconds only while the window is visible and one of those surfaces is active. It aborts on unmount and applies exponential backoff up to 30 seconds after failures.

Add `GET /data/revisions` to the method-aware read-only worktree bridge and its endpoint matrix. Secondary worktrees must be able to observe revisions but must still be unable to invoke any revision-changing route.

- [ ] **Step 5: Key caches and selection to revisions**

Include `logbookRevision` in `LogbookPageCacheRequest`; clear detail selection when the selected artifact disappears. On Workbench refresh, resolve selected IDs against the complete current queue and replace both selection sets with only still-present IDs. Never preserve a published session merely because it was selected before the reload.

- [ ] **Step 6: Run controller and endpoint tests**

Run:

```bash
npx vitest run src/app/logbook/__tests__/useLogbookController.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx src/daemon/__tests__/dataApi.test.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/__tests__/dataLifecycleRepository.test.ts src/core/__tests__/worktreeConnector.test.ts
```

Expected: PASS; external CLI publication appears without restarting Masthead.

- [ ] **Step 7: Commit revision refresh**

```bash
git add src/daemon/db/migrations/032_data_revisions.sql src/daemon/db/dataRevisionRepository.ts src/daemon/db/schema.ts src/workbench/authoring/guidedAuthoringService.ts src/daemon/db/workbenchPipelineRepository.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/db/dataLifecycleRepository.ts src/daemon/server.ts src/core/worktreeConnector.ts src/app/daemonClient.ts src/app/useMastheadDataRevisions.ts src/app/logbook/useLogbookController.ts src/app/workbench/useWorkbenchController.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/__tests__/dataLifecycleRepository.test.ts src/core/__tests__/worktreeConnector.test.ts src/app/logbook/__tests__/useLogbookController.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx
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
- Create: `src/core/__tests__/mastheadAuthoringPerfProbe.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: published artifact rows, data revisions, and an explicitly isolated fixture or database-copy path.
- Produces: artifact-native `LogbookSummaryDto` and a fail-closed, self-cleaning `npm run probe:authoring-perf`.

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

- [ ] **Step 2a: Write failing probe-isolation tests**

Cover dynamic port allocation, refusal of `/home/tyler/.config/masthead-production/masthead.sqlite` and the live production manifest, subprocess termination after a measured-endpoint failure, and temporary database/manifest cleanup after both success and failure. Use injected spawn/probe adapters; the test must never launch or inspect the real production daemon.

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

`scripts/masthead-authoring-perf-probe.js` accepts either `--db-copy` or `--fixture-sessions`. The fixture form creates an isolated database under `mkdtemp`; the copy form requires a regular non-symlink database outside the live production directory and creates its own temporary working copy before daemon startup. Both forms allocate an unused loopback port, write a temporary manifest, seed or migrate only the working database, reject any live production manifest/base URL, and register `finally` cleanup that terminates the child and removes every database sidecar, manifest, and temporary directory even when warmup or measurement fails. The probe warms each endpoint once, then performs five measured reads. It fails unless:

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
npx vitest run src/daemon/db/__tests__/logbookSummaryRepository.test.ts src/daemon/__tests__/endpointMatrix.test.ts src/core/__tests__/mastheadAuthoringPerfProbe.test.ts
npm run probe:authoring-perf -- --fixture-sessions 10000
```

Expected: PASS against the generated 10,000-session fixture; the probe deletes only the temporary resources it created, on success or failure. Task 14 separately uses `--db-copy` against the isolated production rehearsal and the probe makes another disposable working copy rather than starting a daemon on the rehearsal file itself.

- [ ] **Step 6: Commit performance work**

```bash
git add src/daemon/db/migrations/033_artifact_first_summary.sql src/daemon/db/schema.ts src/daemon/db/logbookSummaryRepository.ts src/daemon/db/__tests__/logbookSummaryRepository.test.ts src/app/daemonClient.ts docs/reference/daemon-api.md scripts/masthead-authoring-perf-probe.js src/core/__tests__/mastheadAuthoringPerfProbe.test.ts package.json
git commit -m "perf: make logbook summary artifact native"
```

---

### Task 13: Add a narrow, reversible V3 template-generation recovery

**Files:**
- Create: `src/daemon/db/v3TemplateRecovery.ts`
- Create: `src/daemon/db/__tests__/v3TemplateRecovery.test.ts`
- Modify: `src/cli/workbenchMaintenance.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/daemon/databaseBackup.ts`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/db/__tests__/schema.test.ts`
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Create: `docs/acceptance/guided-authoring-production-canary.md`

**Interfaces:**
- Consumes: completed V3 bundles/receipts, published artifacts, bundle-derived enrichment fingerprints, request-independent Workbench state, exact backup evidence, exclusive database maintenance, and data revisions.
- Produces: `auditFailedV3TemplateGeneration`, `prepareFailedV3TemplateRecovery`, `invalidateFailedV3TemplateGeneration`, and `restoreFailedV3TemplateRecovery` plus hash-locked CLI receipts.

- [ ] **Step 1: Write exact-target and rollback tests**

```ts
test("audits only the known V3 template generation", () => {
  seedFailedV3Generation(db, { runs: 270, dossiers: 3230 });
  seedUnrelatedGoodV3Run(db);
  const audit = auditFailedV3TemplateGeneration(db, fixtureIncidentContract());
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

test("invalidates artifacts, preserves runs, and returns sessions to Workbench atomically", async () => {
  const prepared = await prepareFailedV3TemplateRecovery(dbPath, fixtureIncidentContract());
  const receipt = await invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(dbPath, prepared, ownership);
  expect(receipt).toMatchObject({ invalidatedArtifacts: 3230, preservedRuns: 270, resetSessions: 3230 });
  expect(countCompletedV3Runs(db)).toBe(271);
  expect(countCurrentIncidentDossiers(db)).toBe(0);
  expect(countIncidentSessionsOnPublishPath(db)).toBe(3230);
});

test("rolls back every row when the audit or backup hash differs", async () => {
  await expect(invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(dbPath, alteredPreparedReceipt(), ownership))
    .rejects.toThrow("v3_template_recovery_audit_mismatch");
  expect(recoveryCounts(db)).toEqual(beforeCounts);
});

test("fails closed when an incident enrichment row cannot be linked uniquely", async () => {
  seedAmbiguousIdenticalPreIncidentEnrichment(db);
  await expect(prepareFailedV3TemplateRecovery(dbPath, fixtureIncidentContract()))
    .rejects.toThrow("v3_template_recovery_enrichment_ambiguous");
  expect(recoveryCounts(db)).toEqual(beforeCounts);
});

test("restores the verified pre-invalidation snapshot after a successful invalidation", async () => {
  const prepared = await prepareFailedV3TemplateRecovery(dbPath, fixtureIncidentContract());
  await invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(dbPath, prepared, ownership);
  const restored = await restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(dbPath, prepared, ownership);
  expect(restored.auditHash).toBe(prepared.audit.auditHash);
  expect(recoveryCounts(openDatabase(dbPath))).toEqual(beforeCounts);
});
```

- [ ] **Step 2: Run recovery tests and verify failure**

Run:

```bash
npx vitest run src/daemon/db/__tests__/v3TemplateRecovery.test.ts
```

Expected: FAIL because the narrow recovery module does not exist.

- [ ] **Step 3: Implement a deterministic audit fingerprint**

The audit must include sorted run IDs, artifact IDs, session IDs, bundle hashes, receipt hashes, created/completed time bounds, actor IDs, schema versions, summary-prefix count, empty-decision count, unknown-verification count, optional-artifact count, bundle-derived enrichment fingerprints, and database ID. Compute `auditHash` from canonical JSON. The recovery API also requires a reviewed incident contract containing exactly 270 runs, 3,230 dossiers, 3,230 distinct sessions, zero optional artifacts, the V3 schema/policy, incident summary prefix, empty-decision and unknown-verification counts, actor/time bounds, and hashes of the sorted run/artifact/session ID lists. Refuse an empty, smaller, larger, mixed, or merely similar target before returning an audit; a hash derived from arbitrary matching rows is not sufficient authorization. Task 13 tests use a fixture contract, Task 14 writes the production contract only after read-only rehearsal review, and Task 15 must use that exact committed contract hash.

- [ ] **Step 4: Prepare exactly one verified backup**

`prepareFailedV3TemplateRecovery(dbPath, incidentContract)` first acquires the existing exclusive-maintenance ownership used by V1 recovery and refuses a live owner, symlink, sidecar ambiguity, or stale manifest PID. It removes older sibling `masthead.sqlite.backup-*` files, creates `masthead.sqlite.backup-current` through SQLite backup, verifies `PRAGMA integrity_check`, database ID, exact incident audit hash, byte size, and SHA-256, then returns immutable backup evidence. It never modifies the active database and releases ownership on every exit.

- [ ] **Step 5: Invalidate inside one transaction**

The audit and backup reader must operate on the pre-V4 production schema without opening the normal migrating daemon. Add an explicit `applyPendingMigrationsInTransaction(db)` path in `schema.ts` that assumes an existing transaction and never commits or opens a nested transaction. After validating the unchanged active bytes and verified backup, the exclusive invalidation transaction calls that path for migrations 031–033 when needed, rechecks that the logical incident audit is unchanged, then performs the exact incident mutations below. Schema tests prove all pending migrations and invalidation roll back together after an injected post-migration failure; migration failure leaves the pre-migration backup restorable.

For exact incident artifacts only:

```text
- set status = superseded and publication_status = invalidated;
- delete their search index rows but preserve artifact bodies and provenance;
- derive the three expected incident enrichment content fingerprints for every session from its immutable V3 bundle and match them against provider/model/prompt/time metadata; abort if an incident row is missing, shared, or ambiguous, restore one unambiguous stale pre-incident predecessor when present, and otherwise remove the incident row and leave enrichment missing rather than inventing a predecessor;
- reset Workbench publication, enrichment, dossier, optional-artifact, next-action, and claim state to the publish path;
- release incident claims with reason failed_v3_template_generation_recovery;
- preserve all V3 run bundles and receipts unchanged;
- bump Logbook and Workbench data revisions;
- write one durable recovery activity and receipt.
```

Store the immutable invalidation receipt in the stable recovery activity keyed by audit hash. An idempotent repeat returns that stored receipt only after verifying its database ID, audit hash, artifact IDs, revision outcome, and backup evidence; it must not treat an empty post-invalidation audit as success by itself.

- [ ] **Step 6: Add audit, prepare, invalidate, and restore CLI commands**

```bash
mastheadctl workbench audit-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --incident-contract docs/acceptance/guided-authoring-v3-incident-contract.json --json
mastheadctl workbench prepare-v3-template-recovery --db /home/tyler/.config/masthead-production/masthead.sqlite --incident-contract docs/acceptance/guided-authoring-v3-incident-contract.json --receipt /tmp/masthead-v3-recovery-prepared.json --json
mastheadctl workbench invalidate-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --prepared-receipt /tmp/masthead-v3-recovery-prepared.json --confirm --json
mastheadctl workbench restore-v3-template-recovery --db /home/tyler/.config/masthead-production/masthead.sqlite --prepared-receipt /tmp/masthead-v3-recovery-prepared.json --confirm --json
```

Prepare receipts authorize invalidation for at most 30 minutes; after that, invalidation requires a fresh prepare against unchanged active bytes. A successfully verified invalidation receipt keeps restore authorized against the unchanged sibling backup until the production canary is accepted, regardless of the prepare age. Restore refuses a changed backup or database identity, stages the verified backup, checks integrity/database/audit/hash before promotion, atomically promotes it, verifies the restored active database, retains the one sibling backup, and returns an immutable restore receipt. The acceptance record explicitly closes restore eligibility only after canary acceptance; if authorization metadata must be renewed before then, renewal re-verifies the existing backup bytes and invalidation receipt without modifying active data.

- [ ] **Step 7: Run recovery and maintenance tests**

Run:

```bash
npx vitest run src/daemon/db/__tests__/v3TemplateRecovery.test.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/__tests__/schema.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/databaseBackup.test.ts
```

Expected: PASS with exact incident constants, enrichment ambiguity refusal, exclusive ownership, backup proof, idempotent repeat receipt, successful invalidate-then-restore, and injected rollback coverage.

- [ ] **Step 8: Commit recovery tooling**

```bash
git add src/daemon/db/v3TemplateRecovery.ts src/daemon/db/__tests__/v3TemplateRecovery.test.ts src/cli/workbenchMaintenance.ts src/cli/workbenchAuthoring.ts src/daemon/databaseBackup.ts src/daemon/db/schema.ts src/daemon/db/__tests__/schema.test.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/db/workbenchPipelineRepository.ts docs/acceptance/guided-authoring-production-canary.md
git commit -m "fix: add narrow v3 template recovery"
```

---

### Task 14: Close the release gates and rehearse on an isolated production copy

**Files:**
- Create after the read-only rehearsal audit: `docs/acceptance/guided-authoring-v3-incident-contract.json`
- Modify: `scripts/dogfood-durable-artifacts.js`
- Create: `scripts/masthead-guided-agent-canary.js`
- Modify: `package.json`
- Create: `src/workbench/authoring/__tests__/guidedAgentCanaryHarness.test.ts`
- Modify: `src/workbench/authoring/durableArtifactCorpusAcceptance.ts`
- Modify: `src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts`
- Modify: `docs/acceptance/durable-artifact-gate.md`
- Modify: `docs/acceptance/product-release-gate.md`
- Modify: `docs/acceptance/guided-authoring-production-canary.md`

**Interfaces:**
- Consumes: V4 guided workflow, adversarial fixture, isolated instance manifests, revision refresh, latency probe, recovery/restore tooling, and one fresh model agent that receives only the copied handoff.
- Produces: one machine-readable deterministic gate report, one real-agent canary report, and one signed rehearsal record.

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

Add harness tests that its launch package contains one request ID and instance-bound start command but no session IDs or fixture answers, refuses the live production database/manifest, allocates a non-production port, and terminates/removes all temporary state after injected startup, agent, and gate failures.

- [ ] **Step 3: Run the gate tests and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts src/workbench/authoring/__tests__/guidedAgentCanaryHarness.test.ts
```

Expected: FAIL until the new report fields and failure codes exist.

- [ ] **Step 4: Extend dogfood through the real V4 interface**

The dogfood script must create its own temporary database, dynamically allocated daemon port, and temporary instance manifest, refuse the live production database and manifest, and register child/database cleanup in `finally`. Through HTTP/CLI it creates a request, inspects every evidence page, saves and revises a canary, proves no pre-approval publication, approves it, finishes it, completes remaining assignments, runs artifact-only reuse tasks, and verifies revision changes. It must not import service internals or use a default Masthead URL.

- [ ] **Step 4a: Run a real fresh-agent canary against the isolated interface**

`scripts/masthead-guided-agent-canary.js` creates a nine-session representative isolated fixture covering artifact-signal, tool-heavy, ordinary, sparse, and deliberately tempting-template cases. It starts a daemon on a dynamic port, creates a request through the public API, obtains the exact Workbench handoff, and emits a machine-readable launch package. Give that package to a fresh model agent with no implementation-plan, fixture-answer, database, or service-internal context; the agent may use only the instance-bound CLI and the returned `nextAction` commands.

Require the agent to inspect all evidence, submit its own draft, respond to structured revision findings, stage and finish only after an operator approves the canary, and complete the remaining assignments. Record draft revision count, finding codes, accepted artifact IDs, artifact-only reuse results, duplicate/protocol/unsupported-completion counts, and a human review of specificity and independent reuse. The canary fails if the agent cannot complete the workflow, needs an out-of-band session list or batching instruction, produces the known deterministic template, receives unbounded generic dismissal findings, or passes only because the harness supplied authored content. Add `"canary:guided-agent": "npm run build:daemon && node scripts/masthead-guided-agent-canary.js"` to `package.json`.

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

Expected: every command PASS and the dogfood report satisfies every hard metric. Task 14 is not complete until the separate fresh-agent canary report from Step 4a also passes and its human review is signed; deterministic fixtures alone do not prove the handoff guides a model effectively.

- [ ] **Step 6: Rehearse recovery on an isolated copy**

Copy the production database read-only through SQLite backup into a uniquely created `/tmp` rehearsal directory and produce the proposed incident contract from the complete read-only population. Review its exact counts, actor/time/schema boundaries, and sorted population hashes, then write `docs/acceptance/guided-authoring-v3-incident-contract.json`; rerun the audit using that file before any rehearsal mutation. Run prepare, invalidate, integrity, revision, Workbench, Logbook, and latency checks against the copy, then run the hash-locked restore and prove the original rehearsal counts and audit return. Write success or failure evidence without raw IDs, transcript text, or artifact bodies—the contract stores population hashes rather than the raw ID lists—and remove the rehearsal database, backup, sidecars, prepared receipt, manifest, and directory in `finally` after the acceptance record is flushed. Never leave the production copy behind because a rehearsal check failed.

- [ ] **Step 7: Commit the release gates**

```bash
git add scripts/dogfood-durable-artifacts.js scripts/masthead-guided-agent-canary.js package.json src/workbench/authoring/durableArtifactCorpusAcceptance.ts src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts src/workbench/authoring/__tests__/guidedAgentCanaryHarness.test.ts docs/acceptance/durable-artifact-gate.md docs/acceptance/product-release-gate.md docs/acceptance/guided-authoring-v3-incident-contract.json docs/acceptance/guided-authoring-production-canary.md
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

- [ ] **Step 2: Stage and verify the packaged build without launching it**

Use the repository's production installer in its no-launch/staged mode. Copy and verify the package version, build SHA, future launcher target, expected production manifest path, and signed release commit from bundle files without starting the new daemon, opening the production database, changing `current`, rewriting the active launcher, or deleting the old bundle.

- [ ] **Step 3: Stop production and prove the offline CLI target**

Stop the old installed production daemon through the supported application lifecycle and verify no owner remains. Only then atomically switch `current` to the staged bundle, install the staged instance launcher, verify that `/home/tyler/.config/masthead-production/bin/mastheadctl` resolves into that bundle and exports only `/home/tyler/.config/masthead-production/masthead-instance.json`, and remove every other production bundle as required by disk hygiene. Confirm the staged build SHA in offline maintenance mode. Do not start the new daemon merely to obtain capabilities before the recovery backup exists; the prepare command acquires and releases exclusive maintenance itself.

- [ ] **Step 4: Prepare recovery before any new-daemon database access**

With production still stopped, run:

```bash
/home/tyler/.config/masthead-production/bin/mastheadctl workbench prepare-v3-template-recovery --db /home/tyler/.config/masthead-production/masthead.sqlite --incident-contract docs/acceptance/guided-authoring-v3-incident-contract.json --receipt /tmp/masthead-v3-recovery-prepared.json --json
```

Require audit counts of exactly 270 V3 runs, 3,230 dossier artifacts, 3,230 sessions, and zero optional artifacts, plus successful active and backup integrity checks. Preparation reads the pre-V4 schema without migrating or modifying the active database; the one retained sibling is therefore a pre-new-build, pre-invalidation recovery point.

- [ ] **Step 5: Invalidate the exact audited generation**

Run:

```bash
/home/tyler/.config/masthead-production/bin/mastheadctl workbench invalidate-v3-template-generation --db /home/tyler/.config/masthead-production/masthead.sqlite --prepared-receipt /tmp/masthead-v3-recovery-prepared.json --confirm --json
```

Require the immutable receipt to report 3,230 invalidated artifacts, 270 preserved runs, 3,230 reset sessions, zero unrelated artifacts changed, and both data revisions incremented.

Invalidation must retain exclusive ownership, validate the unchanged prepared bytes, apply migrations 031–033 and the recovery in one transaction, and leave production stopped. If any migration, audit, or invalidation check fails, use the supported restore command if active bytes changed, record the failure, and do not start the new daemon.

- [ ] **Step 6: Restart and verify coherent surfaces**

Start production normally for the first time on the recovered database. Now run `/home/tyler/.config/masthead-production/bin/mastheadctl workbench capabilities --json` and require the production database ID, installed build SHA, `workbench-authoring-v4`, `guided-authoring-v1`, canonical manifest path, production base URL, and the fresh runtime `instanceId`. Without another restart, require Logbook to remove the invalidated dossiers and Workbench to show the recovered sessions within one revision-poll interval. Verify no stale 3,230-item selection remains and all five latency budgets pass against production read endpoints.

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
