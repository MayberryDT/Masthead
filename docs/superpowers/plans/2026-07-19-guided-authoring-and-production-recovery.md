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
- Create: `src/shared/instanceIdentity.ts`
- Modify: `src/shared/guidedAuthoring.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `fixtures/protocol/current-health.json`
- Modify: `src/electron/cliLauncher.ts`
- Modify: `src/electron/daemonLauncher.ts`
- Modify: `src/electron/main.ts`
- Modify: `src/daemon/main.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/healthService.ts`
- Modify: `src/daemon/workbenchAuthoringApi.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `scripts/masthead-live-dev.js`
- Modify: `scripts/masthead-doctor.js`
- Modify: `scripts/masthead-production.js`
- Modify: `scripts/masthead-production.d.ts`
- Create: `scripts/masthead-production-activation-rehearsal.js`
- Modify: `package.json`
- Modify: `docs/reference/production-cold-activation.md`
- Create: `src/shared/__tests__/instanceIdentity.test.ts`
- Modify: `src/core/__tests__/daemonCompatibility.test.ts`
- Create: `src/core/__tests__/liveDevLauncher.test.ts`
- Modify: `src/electron/__tests__/cliLauncher.test.ts`
- Modify: `src/electron/__tests__/daemonLauncher.test.ts`
- Modify: `src/electron/__tests__/mainCliLauncher.test.ts`
- Modify: `src/daemon/__tests__/healthService.test.ts`
- Modify: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`
- Modify: `src/electron/__tests__/productionLauncher.test.ts`
- Create: `src/electron/__tests__/fixtures/productionActivationCrashChild.mjs`
- Modify: `src/daemon/__tests__/doctorAuthoring.test.ts`

**Interfaces:**
- Consumes: Electron instance data directory, daemon base URL, database ID, build SHA, PID, and a fresh per-daemon instance nonce.
- Produces: `MastheadInstanceManifest`, per-instance launcher path, `GuidedAuthoringExpectedIdentity`, stable-request binding and current-instance guard primitives, identity-bearing current capabilities, and a crash-recoverable staged production-installation receipt plus activation journal that is activated only after the old daemon stops.

- [ ] **Step 1: Write failing launcher, identity, restart-policy, and stage-only tests**

Add tests proving:

```ts
test("production and dev resolve different launcher paths", () => {
  const production = resolveMastheadCliLaunchTarget({ instanceDir: "/state/masthead-production", ...base });
  const development = resolveMastheadCliLaunchTarget({ instanceDir: "/state/masthead-dev", ...base });
  expect(production.launcherPath).toBe("/state/masthead-production/bin/mastheadctl");
  expect(development.launcherPath).toBe("/state/masthead-dev/bin/mastheadctl");
});

test("installs the instance launcher before spawn and waits for the daemon-owned manifest", async () => {
  const events: string[] = [];
  await startLiveConnector(input, origins, children, lifecycleRecording(events));
  expect(events).toEqual(["install-launcher", "spawn", "daemon-bind", "daemon-write-manifest", "compatible-health"]);
});

test("npm run dev prepares the instance launcher before a non-Electron primary spawn", async () => {
  const events = await runLiveDevPrimaryWithLifecycleRecorder();
  expect(events).toEqual(["install-launcher", "spawn-daemon", "compatible-health", "start-ui"]);
  expect(await readManifest()).toMatchObject({ instanceId: events.health.runtime.daemonInstanceId });
});

test("the daemon removes only the manifest owned by its instance nonce", async () => {
  await daemon.close();
  await expect(access(instanceManifestPath)).rejects.toMatchObject({ code: "ENOENT" });
  await writeManifestFor("instance:new");
  await oldDaemon.close();
  expect(await readManifest()).toMatchObject({ instanceId: "instance:new" });
});

test.each([
  ["baseUrl", "base_url_identity_mismatch"],
  ["databaseId", "database_identity_mismatch"],
  ["buildSha", "build_identity_mismatch"],
  ["instanceManifest", "manifest_identity_mismatch"],
  ["instanceId", "instance_identity_mismatch"]
])("the mutation guard rejects a mismatched %s", (field, code) => {
  expect(() => assertGuidedAuthoringExpectedIdentity(currentIdentity(), changedIdentity(field)))
    .toThrow(expect.objectContaining({ code }));
});

test("allows a new daemon nonce only when the persisted request binding is otherwise stable", () => {
  expect(() => assertStableGuidedRequestBinding(requestCreatedBy("instance:old"), currentIdentity("instance:new")))
    .not.toThrow();
  expect(requestCreatedBy("instance:old").creationInstanceId).toBe("instance:old");
});

test("stages a production bundle and launcher without activating or touching live state", async () => {
  const previousCurrent = await readlink(currentPath);
  const previousLauncher = await readFile(activeInstanceLauncherPath, "utf8");
  const result = await stageProductionInstallation({
    sourceBundlePath,
    openDatabase: forbiddenDatabaseOpen,
    launch: forbiddenLaunch,
    probe: forbiddenProbe,
    cleanupBundles: forbiddenCleanup
  });
  expect(result).toMatchObject({ launched: false, databaseOpened: false, staged: true });
  expect(await readlink(result.currentPath)).toBe(previousCurrent);
  expect(await readFile(activeInstanceLauncherPath, "utf8")).toBe(previousLauncher);
  expect(await readFile(result.stagedInstanceLauncherPath, "utf8")).toContain("masthead-instance.json");
  await expect(access(result.instanceManifestPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("filesystem activation installs the staged target without runtime or database side effects", async () => {
  const receipt = await stageProductionInstallation(stageInput());
  const result = await activateStagedProductionInstallation(receipt, {
    openDatabase: forbiddenDatabaseOpen,
    runMaintenance: forbiddenMaintenance,
    launch: forbiddenLaunch,
    probe: forbiddenProbe,
    writeManifest: forbiddenManifestWrite
  });
  expect(result).toMatchObject({ activated: true, launched: false, databaseOpened: false });
  expect(await realpath(currentPath)).toBe(receipt.target);
  expect(await readFile(activeInstanceLauncherPath, "utf8")).toContain("masthead-instance.json");
  await expect(access(receipt.instanceManifestPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["current", "instance-launcher", "lifecycle-launcher", "desktop", "activation-commit"])(
  "recovers an activation process crash after %s before another lifecycle command runs",
  async (crashAfter) => {
    const receipt = await stageInChildProcess();
    await runActivationCrashChild(receipt.receiptPath, crashAfter);
    const recovered = await runProductionCliInNewProcess(["activate", "--receipt", receipt.receiptPath, "--json"]);
    expect(recovered.recovery).toMatchObject({ mixedSurface: false, journalRecovered: true });
    await expectEveryActiveSurfaceToMatchOneAttestedGeneration();
  }
);

test("serializes stage, activate, finalize, start, stop, and install through one lifecycle lease", async () => {
  const contenders = await raceProductionLifecycleCommands();
  expect(contenders.filter(({ enteredCriticalSection }) => enteredCriticalSection)).toHaveLength(1);
  await expectEveryActiveSurfaceToMatchOneAttestedGeneration();
});

test("finalize requires exact active bytes and one matching live daemon that owns the manifest guard", async () => {
  const receipt = await activateAndStartStagedProduction();
  await expect(finalizeWithFakeManifest(receipt)).rejects.toThrow("production_startup_proof_invalid");
  await expect(finalizeWithMissingWriterGuard(receipt)).rejects.toThrow("production_startup_guard_missing");
  await expect(finalizeStagedProductionInstallation(receipt)).resolves.toMatchObject({ finalized: true });
  expect(await versionedProductionBundles()).toEqual([receipt.target]);
});
```

The tests in this task are deliberately primitive-level. Request creation, `start`, `save`, canary decisions, and `finish` do not all exist until Tasks 5, 8, and 9, so their end-to-end safe-restart and zero-write identity-swap proofs belong there. Task 4 proves the shared predicates and lifecycle ordering those later tests must call.

- [ ] **Step 2: Run focused launcher tests and verify failure**

Run:

```bash
npx vitest run src/shared/__tests__/instanceIdentity.test.ts src/core/__tests__/daemonCompatibility.test.ts src/core/__tests__/liveDevLauncher.test.ts src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/daemonLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/daemon/__tests__/healthService.test.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/electron/__tests__/productionLauncher.test.ts
```

Expected: FAIL because every instance still targets `~/.local/bin/mastheadctl`, `npm run dev` does not prepare an instance launcher, health and current capabilities do not carry complete instance identity, the daemon does not own manifest publication/removal, and production installation has no independently callable stage-only operation.

- [ ] **Step 3: Define one canonical identity module and its two comparison rules**

Create `src/shared/instanceIdentity.ts` and keep parsing, normalization, and comparison in this one deep module:

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

export type GuidedAuthoringExpectedIdentity = Pick<
  MastheadInstanceManifest,
  "baseUrl" | "databaseId" | "buildSha" | "instanceId"
> & { instanceManifest: string };

export function assertGuidedAuthoringExpectedIdentity(
  actual: GuidedAuthoringExpectedIdentity,
  expected: GuidedAuthoringExpectedIdentity
): void;

export function assertStableGuidedRequestBinding(
  request: Pick<GuidedAuthoringRequestDto,
    "baseUrl" | "databaseId" | "buildSha" | "instanceManifest" | "creationInstanceId"
  >,
  current: GuidedAuthoringExpectedIdentity
): void;
```

Normalize the base URL without a trailing slash and require absolute canonical instance-directory, manifest, launcher, runtime, and CLI-entry paths. `assertGuidedAuthoringExpectedIdentity()` compares all five current fields and returns the exact mismatch codes from Step 1. `assertStableGuidedRequestBinding()` compares only base URL, database ID, build SHA, and canonical manifest path; `creationInstanceId` is immutable audit evidence and is intentionally ignored for safe-restart authorization. Export `GuidedAuthoringExpectedIdentity` from the shared contract rather than redefining it in clients or services.

- [ ] **Step 4: Make launcher and manifest publication a two-phase lifecycle**

Generate the existing cryptographically random `daemonInstanceId` once per daemon process and expose it, the daemon PID, bound base URL, database ID, build SHA, canonical manifest path, and absolute instance launcher path through `MastheadHealthDto` and the current authoring capabilities context. Update `src/shared/protocol.ts`, the current-health fixture, and compatibility tests so a daemon missing or contradicting these identity fields is malformed rather than compatible. The current `WorkbenchAuthoringCapabilitiesDto` may temporarily carry these identity fields for V3; Task 9 replaces its operation contract with `GuidedAuthoringCapabilitiesDto` but preserves the identity fields unchanged.

Resolve `<instanceDir>/bin/mastheadctl` and `<instanceDir>/masthead-instance.json` before daemon spawn. Atomically install the instance launcher before spawn so `MASTHEAD_CLI_COMMAND` is an absolute path the daemon can advertise, but make the wrapper export only `MASTHEAD_INSTANCE_MANIFEST`; it must not embed `MASTHEAD_DAEMON_URL`, copy identity values, or touch `~/.local/bin/mastheadctl`.

The daemon owns the live manifest lifecycle. After its server has bound and the same complete runtime identity returned by health is available, `src/daemon/main.ts` atomically writes the manifest before the daemon is considered compatible. On graceful shutdown it removes the manifest only when the file still contains its own `instanceId`, so a stopping old process cannot delete a replacement daemon's manifest. Electron never writes or removes the live manifest: `startLiveConnector()` installs the launcher before spawn, waits for compatible health, and verifies the daemon-owned manifest exactly matches that health before returning. An already-running compatible daemon must already own a matching manifest.

Remove the Electron-ready write to the shared global launcher. Apply the same pre-spawn launcher contract in `scripts/masthead-live-dev.js` for primary and isolated-primary `npm run dev` starts, passing the absolute instance launcher and manifest paths to the daemon before spawn and verifying the daemon-owned manifest after compatible health. Bridge mode neither installs a launcher nor writes a manifest because it is not a writable primary instance. Cover Electron and non-Electron primary startup, safe restart replacement, nonce-conditional shutdown cleanup, and launcher/manifest mismatch. If `~/.local/bin/mastheadctl` already exists, leave it untouched and never advertise it in health or capabilities.

- [ ] **Step 5: Bind the client to the manifest and expose the reusable mutation guard**

The CLI loads and validates `MASTHEAD_INSTANCE_MANIFEST`, derives its daemon URL from that file, and verifies the current capabilities before a mutation. It must reload the manifest for every later mutation so a safe daemon restart uses the new current `instanceId`; it must never cache `creationInstanceId` as the expected runtime nonce. Offline recovery commands remain exempt from daemon capabilities because their target daemon must be stopped, and instead verify active-database and backup identities directly.

Implement the early-feedback method now:

```ts
async assertAuthoringIdentity(expected: GuidedAuthoringExpectedIdentity): Promise<WorkbenchAuthoringCapabilitiesDto> {
  const actual = await this.capabilities();
  assertGuidedAuthoringExpectedIdentity(identityFromCapabilities(actual), expected);
  return actual;
}
```

Also export the server-side guard primitive that accepts `GuidedAuthoringExpectedIdentity` and the immutable current daemon identity. Update `scripts/masthead-doctor.js` to reject a command, manifest, health response, or current V3 capability DTO whose identity fields disagree. Do not claim that Task 4 has authorized nonexistent V4 mutations: the client capabilities check is fast feedback only, and the guard is not effective until Tasks 8 and 9 invoke it immediately at each service mutation boundary before the first database write.

- [ ] **Step 6: Add a crash-recoverable staged production lifecycle**

Export `stageProductionInstallation()` and type it in `scripts/masthead-production.d.ts`. It copies the candidate into an immutable versioned target, verifies the packaged manifest and pinned digest after the copy, validates the packaged CLI entry, and writes a staged instance-launcher file plus an immutable receipt containing the source digest, target, previous current target, production root, production instance/data directory, canonical database path, production port and base URL, resolved shared lifecycle-lease path, canonical manifest destination, active launcher destination, staged launcher path, build SHA, random staging nonce, exact pre-activation snapshots, and hashes plus modes for every staged and active surface. The receipt also attests the rollback bundle's release version, build SHA, manifest digest, and resolved target path. Stage never opens the application database; database ID is bound later by recovery/start proof, but every independent phase has enough immutable path and endpoint identity to acquire the same lease and reject a different database, port, or rollback generation.

Use one external production lifecycle lease for `stage`, `activate`, `finalize`, `start`, `stop`, and both normal and cold `install`; no command may use a private activation lock or enter its filesystem critical section outside that lease. The lease is coordination state outside the application database and is the only lease staging may acquire. Staging returns `{ staged: true, launched: false, databaseOpened: false }` and must not open or migrate the application database, acquire its writer/maintenance ownership leases, change `current`, replace the active instance launcher or desktop entry, create a live manifest, delete any bundle, spawn Masthead, or probe health. Keep the staged launcher outside the active `<instanceDir>/bin/mastheadctl` destination so the still-running old daemon retains its launcher until activation.

Persist a separate activation journal beside the receipt before the first filesystem mutation. The journal records the receipt hash, old and candidate targets, exact rollback snapshots, every intended/completed surface transition, and one durable `activation_committed` point. Before each mutation, fsync the intent; after it, re-attest the resulting bytes and fsync completion. Every lifecycle command first recovers a pending journal under the shared lease. A journal without the durable commit point restores `current` and every active surface to the exact old attestation, verifies that no mixed generation remains, and exits without continuing from stale command configuration; rerunning `activate` then starts from the clean staged receipt. A committed journal rolls forward by verifying the candidate `current` target and every active attestation. Abrupt process death must therefore be recoverable in a fresh process after every mutation boundary, rather than only through an in-process `catch` block.

Export `activateStagedProductionInstallation(receipt)` as an offline filesystem-transition operation and expose `stage --bundle ...`, `activate --receipt ...`, and `finalize --receipt ...` as independent operational CLI commands whose JSON output includes the receipt, journal, recovery state, and exact build identity. Under the shared lifecycle lease and before its first filesystem mutation, activation repeats the offline proof itself: the recorded production process/start identity is gone, the health endpoint is unreachable, the recorded port is unoccupied, the application database writer/ownership sentinel is absent, and the live manifest is absent. A caller-side stop check alone never authorizes activation, and a stale receipt for another path/port/lease is rejected. Activation then revalidates the immutable receipt, candidate and rollback-bundle digests/releases, previous-current binding, and unchanged old active surface before the journaled transition switches `current` and installs the staged instance launcher and production desktop surface. It retains the previous bundle, receipt, journal, and staged attestations as the rollback generation. It must not open or mutate the application database, run maintenance, spawn Masthead, write a live instance manifest, or perform final disk-hygiene deletion; its health/port/process/writer checks are read-only fail-closed liveness proof. `transitionProduction()` may compose stage, stop/offline proof, activation, database maintenance, start, and finalize as separately journaled operations, but Task 15 uses the split commands so activation cannot access production data before the explicit recovery commands.

`finalizeStagedProductionInstallation(receipt)` runs under the same lifecycle lease and only after the activation commit. It re-verifies the candidate bundle digest and release identity, `current`, and the exact bytes plus modes of the active instance launcher, lifecycle launcher, and desktop entry. It then requires a fresh post-activation manifest and compatible health response with identical build SHA, database ID, base URL, instance directory, canonical manifest and authoring-command paths, PID, and instance nonce; strict process inspection must bind that PID/start identity and executable/argv/environment to the current candidate. Prove the canonical manifest-writer guard is actively held at the final boundary, and fail closed if the daemon exits, health changes, the guard becomes acquirable, or any active byte changes during proof. Only after that exact live proof may finalization delete the rollback bundle and stale helper artifacts, remove the staged files, journal, and receipt, and assert that `current` plus exactly one versioned production bundle remain. Finalization itself is idempotently recoverable after process death and must never accept manifest-shaped JSON written by a test or unrelated process as startup proof. Document the three commands and rerun-after-crash behavior in `docs/reference/production-cold-activation.md`.

- [ ] **Step 7: Run identity, launcher, packaged-command, doctor, and production tests**

Run:

```bash
npx vitest run src/shared/__tests__/instanceIdentity.test.ts src/core/__tests__/daemonCompatibility.test.ts src/core/__tests__/liveDevLauncher.test.ts src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/daemonLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/electron/__tests__/packagedCliCommand.test.ts src/electron/__tests__/productionLauncher.test.ts src/daemon/__tests__/healthService.test.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
npm run rehearse:production-activation
```

Expected: PASS; tests prove simultaneous dev and production launchers cannot overwrite each other, Electron and `npm run dev` install launchers before primary spawn, the daemon alone publishes and conditionally removes its manifest after bind, health/protocol/current-capability/doctor checks expose one matching canonical identity, the pure guard rejects every current-identity mismatch, and the stable-binding predicate permits only a nonce/PID change across restart. Production tests spawn a real child and terminate it after every activation and finalization mutation boundary, then recover from a new process and prove the surface is wholly old or wholly committed candidate. Multi-process races prove all lifecycle commands share one lease, startup cannot continue from a rolled-back stale configuration, fake/stale/mismatched manifests and missing or changed writer guards cannot authorize cleanup, active-byte drift blocks finalization, and a crash during finalization can be retried to exactly one bundle with no receipt, journal, staged file, or stale helper left. `scripts/masthead-production-activation-rehearsal.js` repeats the operational CLI sequence and crash matrix against its own temporary home, production root, data directory, database, manifest, and dynamic port, refuses every live production path, and cleans up in `finally`; `package.json` exposes it as `rehearse:production-activation`. Tasks 8 and 9 add the zero-database-write and end-to-end request-continuation proofs once their service operations and HTTP routes exist.

- [ ] **Step 8: Commit instance binding and the crash-safe staged lifecycle**

```bash
git add src/shared/instanceIdentity.ts src/shared/guidedAuthoring.ts src/shared/protocol.ts src/shared/workbenchAuthoring.ts fixtures/protocol/current-health.json src/shared/__tests__/instanceIdentity.test.ts src/core/__tests__/daemonCompatibility.test.ts src/core/__tests__/liveDevLauncher.test.ts src/electron/cliLauncher.ts src/electron/daemonLauncher.ts src/electron/main.ts src/daemon/main.ts src/daemon/server.ts src/daemon/healthService.ts src/daemon/workbenchAuthoringApi.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts scripts/masthead-live-dev.js scripts/masthead-doctor.js scripts/masthead-production.js scripts/masthead-production.d.ts scripts/masthead-production-activation-rehearsal.js package.json docs/reference/production-cold-activation.md src/electron/__tests__/cliLauncher.test.ts src/electron/__tests__/daemonLauncher.test.ts src/electron/__tests__/mainCliLauncher.test.ts src/daemon/__tests__/healthService.test.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/electron/__tests__/productionLauncher.test.ts src/electron/__tests__/fixtures/productionActivationCrashChild.mjs src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts
git commit -m "fix: bind authoring and harden production activation"
```

---

### Task 5: Plan evidence-related assignments and stage a canary

**Files:**
- Create: `src/workbench/authoring/guidedAuthoringPolicy.ts`
- Create: `src/workbench/authoring/guidedAuthoringPreflight.ts`
- Create: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/workbench/authoring/advisorySuggestions.ts`
- Modify: `src/workbench/authoring/artifactCandidates.ts`
- Create: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`
- Modify: `src/workbench/authoring/__tests__/advisorySuggestions.test.ts`
- Modify: `src/workbench/authoring/__tests__/artifactCandidates.test.ts`

**Interfaces:**
- Consumes: `getArtifactSuggestions`, canonical evidence manifests, V4 repository operations, and request session membership.
- Produces: `createGuidedRequest()` and `startGuidedAssignment()` with strong-join grouping, dossier-only fallback groups, and a deterministic three-session canary.

- [ ] **Step 1: Write failing assignment-planning tests**

Add these cases:

```ts
test("keeps a strong multi-session opportunity in one bounded assignment", () => {
  const plan = planGuidedAssignments(selection(18), suggestions(sharedAdrAcross("a", "b", "c")));
  expect(plan.groups.find((group) => group.opportunityIds.length > 0)).toMatchObject({
    coverageClasses: ["artifact_signal", "artifact_signal", "artifact_signal"],
    sessionIds: ["session:a", "session:b", "session:c"]
  });
  expect(plan.groups.every((group) => group.sessionIds.length <= 12)).toBe(true);
});

test("uses dossier-only groups for sessions without strong joins", () => {
  const plan = planGuidedAssignments(selection(5), []);
  expect([...plan.groups.flatMap((group) => group.sessionIds)].sort()).toEqual(selectionIds(5).sort());
  expect(plan.groups.flatMap((group) => group.opportunityIds)).toEqual([]);
});

test("chooses a diverse canary with at most three sessions", () => {
  const plan = planGuidedAssignments(diverseSelection(), diverseSuggestions());
  expect(plan.canary.sessionIds.length).toBeLessThanOrEqual(3);
  expect(new Set(plan.canary.coverageClasses)).toEqual(new Set(["artifact_signal", "tool_heavy", "ordinary"]));
});

test("classifies the tool-heavy boundary explicitly", () => {
  expect(classifyPlanningSession(planningSession({ toolCallCount: 49 }), false)).toBe("ordinary");
  expect(classifyPlanningSession(planningSession({ toolCallCount: 50 }), false)).toBe("tool_heavy");
  expect(classifyPlanningSession(planningSession({ toolCallCount: 50 }), true)).toBe("artifact_signal");
});

test.each([4, 12])("does not split a %i-session strong opportunity to manufacture a canary", (size) => {
  expect(() => planGuidedAssignments(selectionInsideOneStrongOpportunity(size), oneStrongOpportunity(size)))
    .toThrow("guided_canary_not_constructible");
});

test.each([4, 12])("uses an unjoined dossier session as canary without splitting a %i-session strong group", (size) => {
  const plan = planGuidedAssignments(selection(size + 1), oneStrongOpportunity(size));
  expect(plan.canary.sessionIds).toEqual([`session:${size}`]);
  expect(plan.groups.find(({ opportunityIds }) => opportunityIds.length === 1)?.sessionIds)
    .toEqual(selectionIds(size));
});

test("constructs a dossier canary when the request has no opportunities", () => {
  const plan = planGuidedAssignments(selection(5), []);
  expect(plan.canary).toMatchObject({
    opportunityIds: [],
    sessionIds: ["session:0", "session:1", "session:2"]
  });
});

test("rejects an over-limit strong group without persisting a partial request", () => {
  expect(() => createGuidedRequest(db, guidedRequestInput(selectionInsideOneStrongOpportunity(13))))
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

test("is stable across opportunity, provenance, and evidence-ref input order", () => {
  const forward = planGuidedAssignments(selection(8), stableSuggestions("forward"));
  expect(forward).toEqual(planGuidedAssignments(selection(8), stableSuggestions("reverse")));
  expect(forward.opportunities.map(({ opportunityId }) => opportunityId))
    .toEqual([...forward.opportunities.map(({ opportunityId }) => opportunityId)].sort());
  expect(forward.groups.every(({ opportunityIds }) =>
    opportunityIds.join("\n") === [...opportunityIds].sort().join("\n")))
    .toBe(true);
});

test("assigns every selected session and opportunity exactly once", () => {
  const plan = planGuidedAssignments(selection(18), mixedSuggestions());
  expect(occurrenceCounts(plan.groups.flatMap(({ sessionIds }) => sessionIds)))
    .toEqual(Object.fromEntries(selectionIds(18).map((id) => [id, 1])));
  expect(occurrenceCounts(plan.groups.flatMap(({ opportunityIds }) => opportunityIds)))
    .toEqual(Object.fromEntries(plan.opportunities.map(({ opportunityId }) => [opportunityId, 1])));
  expect(plan.groups.every(({ sessionIds }) => sessionIds.length <= 12)).toBe(true);
});

test("returns the persisted current plan after later-assignment detector evidence changes", async () => {
  const created = createGuidedRequest(db, guidedRequestInput(selectionIds(6)));
  const before = startGuidedAssignment(db, {
    command: "/instance/bin/mastheadctl",
    requestId: created.request.requestId
  });
  changeLaterAssignmentDetectorEvidence(db);
  expect(startGuidedAssignment(db, {
    command: "/instance/bin/mastheadctl",
    requestId: created.request.requestId
  }).editorialBrief.opportunities).toEqual(before.editorialBrief.opportunities);
});

test("refuses a stale canonical baseline when current-assignment evidence changes", async () => {
  const created = createGuidedRequest(db, guidedRequestInput(selectionIds(6)));
  changeCurrentAssignmentEvidence(db, created.request.currentAssignmentId!);
  expect(() => startGuidedAssignment(db, {
    command: "/instance/bin/mastheadctl",
    requestId: created.request.requestId
  })).toThrow("guided_assignment_evidence_changed");
});

test("rejects non-compile-ready selection membership before any guided write", async () => {
  markSelectionSessionQualityUnchecked(db, "session:2");
  expect(() => createGuidedRequest(db, guidedRequestInput(selectionIds(6))))
    .toThrow("authoring_session_not_compile_ready:session:2");
  expect(guidedRequestCounts(db)).toEqual(emptyGuidedRequestCounts());
});

test("rolls back the complete aggregate after an injected persistence failure", async () => {
  injectGuidedPersistenceFailure(db, "after_opportunities");
  expect(() => createGuidedRequest(db, guidedRequestInput(selectionIds(9))))
    .toThrow("injected_guided_request_failure");
  expect(guidedRequestCounts(db)).toEqual(emptyGuidedRequestCounts());
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
export const GUIDED_TOOL_HEAVY_CALL_THRESHOLD = 50;

export type GuidedCoverageClass = "artifact_signal" | "tool_heavy" | "ordinary";

export type GuidedPlanningSession = {
  sessionId: string;
  ordinal: number;
  toolCallCount: number;
};

export type NormalizedGuidedOpportunity = {
  opportunityId: string;
  suggestedKind: WorkbenchAutomaticArtifactKind;
  signalStrength: "high" | "medium";
  summary: string;
  signatureKey?: string;
  evidenceRefs: string[];
  provenanceSessionIds: string[];
};

export type GuidedAssignmentGroup = {
  groupKey: string;
  sessionIds: string[];
  opportunityIds: string[];
  /** One entry per sessionId, in the same order. */
  coverageClasses: GuidedCoverageClass[];
};

export type GuidedAssignmentPlan = {
  opportunities: NormalizedGuidedOpportunity[];
  groups: GuidedAssignmentGroup[];
  canary: GuidedAssignmentGroup;
};

export function classifyPlanningSession(
  session: GuidedPlanningSession,
  ownsSingletonOpportunity: boolean
): GuidedCoverageClass;

export function planGuidedAssignments(
  sessions: GuidedPlanningSession[],
  opportunities: WorkbenchArtifactSuggestionDto[]
): GuidedAssignmentPlan;

export const GUIDED_EVIDENCE_QUESTIONS = [
  "What did the user actually ask for?",
  "What concrete work was performed?",
  "What changed or was produced?",
  "Which decisions were made and why?",
  "What verification ran and what did it prove?",
  "What failed, remained blocked, or stayed unresolved?",
  "What knowledge could another person reuse without this transcript?"
] as const;

export const GUIDED_ARTIFACT_RUBRICS = {
  runbook: ["trigger", "preconditions", "performed steps", "expected results", "verification", "failure or rollback handling"],
  adr: ["durable decision", "context", "alternatives actually considered", "consequences", "reversal conditions"],
  incident_timeline: ["symptoms or impact", "ordered events", "root cause", "contributing factors", "remediation", "recovery verification"]
} as const;
```

The implementation must:

```text
1. Reject duplicate, blank, noncontiguous, or out-of-selection input rather than silently deduplicating it; preserve original selection ordinal for every later ordering decision.
2. Normalize suggestion provenance by selection ordinal and normalize evidence refs lexicographically. A suggestion with two or more provenance sessions is a strong join; singleton suggestions remain attached medium-signal opportunities but do not join assignments.
3. Derive `opportunityId` with `stableRecordId("guided-opportunity", [kind, signatureKey ?? suggestionId, ...provenanceSessionIds, ...evidenceRefs])`. Multi-session strong opportunities are `high`; singleton opportunities are `medium`. Do not include mutable summary prose or caller iteration order in the signature.
4. Build a disjoint-set union over selected session IDs and union every multi-session strong opportunity before checking size. Overlapping A-B-C and C-D-E opportunities form one five-session component containing both opportunities.
5. Reject the entire request before persistence when any complete connected component exceeds 12 sessions. Never truncate provenance, split the component, or place a session in two assignments.
6. Turn each accepted strong component into one assignment group, ordered internally by selection ordinal, and attach all strong opportunities plus singleton opportunities owned by its sessions. Every strong-component member has coverage class `artifact_signal`, aligned one-for-one with `sessionIds`.
7. Classify the remaining fallback pool with priority `artifact_signal` when a session owns a singleton suggestion, otherwise `tool_heavy` when `toolCallCount >= GUIDED_TOOL_HEAVY_CALL_THRESHOLD`, otherwise `ordinary`. `coverageClasses` has one entry per `sessionId` in the same order.
8. Choose the canary as the complete strong group of at most three whose lowest selection ordinal is earliest when one exists. Otherwise construct one dedicated fallback canary of up to three sessions, preferring one each in fixed class order `artifact_signal`, `tool_heavy`, `ordinary`, then filling remaining slots by selection ordinal. Remove those sessions and their singleton opportunities from the fallback pool before chunking the rest into stable groups of at most 12.
9. Sort normalized `plan.opportunities` and every group's `opportunityIds` lexicographically by `opportunityId`. Derive every finished group's `groupKey` with `stableRecordId("guided-group", [...sessionIds, ...opportunityIds])` after both arrays are normalized. Opportunity input order, provenance order, and evidence-ref order must not change opportunity IDs, group keys, or the plan.
10. A four- through twelve-session strong component is not itself a legal canary. If a fallback session exists, use the fallback canary and retain the strong component intact; reject with `guided_canary_not_constructible` only when every selected session is trapped in strong groups larger than three. A zero-opportunity request always has a dossier-only canary of up to three sessions.
11. Put the chosen complete strong group or dedicated fallback canary at assignment ordinal zero without changing its membership or stable key. Assert every selected compile-ready session and normalized opportunity appears exactly once and every group is at most 12.
12. Persist the normalized opportunity definitions and complete assignment plan with the request in the one Task 3 transaction; never regenerate them when starting, inspecting, or reviewing an assignment.
```

- [ ] **Step 4: Preserve unbounded advisory membership without changing historical V2 candidates**

`groupCandidateSeeds()` currently slices a strong-signature group to 12 before
`getArtifactSuggestions()` can see it. Split the detector paths with an explicit internal member-limit
option: advisory suggestion detection is unbounded so the planner can reject a 13-session component,
while persisted V2 candidate reconciliation retains its historical 12-member cap and existing audit
behavior. Add detector tests proving the advisory path returns all 13 normalized provenance members,
selection order does not change its suggestion ID, and `discoverArtifactCandidates()` still persists
only the first deterministic 12.

```ts
test("exposes every strong-signature member to guided planning while V2 remains capped", () => {
  const selected = seedStrongSignatureSessions(db, 13);
  const suggestion = getArtifactSuggestions(db, selected).find(isSharedSignature)!;
  expect(suggestion.provenanceSessionIds).toEqual([...selected].sort());
  expect(suggestion.provenanceSessionIds).toHaveLength(13);
  expect(getArtifactSuggestions(db, [...selected].reverse()).find(isSharedSignature)?.suggestionId)
    .toBe(suggestion.suggestionId);
  expect(discoverArtifactCandidates(db, selected).find(isSharedSignature)?.provenanceSessionIds)
    .toEqual([...selected].sort().slice(0, 12));
});
```

- [ ] **Step 5: Preflight the complete selection and persist one immutable aggregate**

Create a V4-scoped `assertGuidedSelectionCompileReady()` helper in
`guidedAuthoringPreflight.ts`. It checks every selected session exists, remains on `publish_path`, has
an available/imported transcript, passed quality, and has usable canonical redacted evidence. Do not
export the private V3 helpers from the legacy `authoringService.ts` or couple guided planning to a V3
run.

Export the exact preflight contract:

```ts
export type GuidedCompileReadySession = {
  sessionId: string;
  ordinal: number;
  dossier: SessionDossierDto;
  evidence: WorkbenchAuthoringEvidenceManifest["sessions"][number];
};

export type GuidedSelectionPreflightResult = {
  sessions: GuidedCompileReadySession[];
  manifest: WorkbenchAuthoringEvidenceManifest;
};

export function assertGuidedSelectionCompileReady(
  db: MastheadDatabase,
  sessionIds: string[]
): GuidedSelectionPreflightResult;
```

Preflight rejects a blank ID first, then the first duplicate ID, then visits sessions in caller order and returns the first missing, non-publish-path, unavailable-transcript, unchecked/failed-quality, or unusable-evidence failure. It reads the canonical evidence manifest once, maps its summaries back into caller order, and returns the dossiers and measured tool-call counts consumed by planning; `createGuidedRequest()` must not repeat those reads or invent a second preflight path.

Export these exact service contracts:

```ts
export type CreateGuidedRequestInput = {
  actorId: string;
  command: string;
  currentIdentity: GuidedAuthoringExpectedIdentity;
  sessionIds: string[];
};

export type CreateGuidedRequestResult = {
  request: GuidedAuthoringRequestDto;
  nextAction: GuidedAuthoringNextAction & { kind: "claim_next" };
};

export function createGuidedRequest(
  db: MastheadDatabase,
  input: CreateGuidedRequestInput
): CreateGuidedRequestResult;

export type StartGuidedAssignmentResult = {
  assignment: GuidedAuthoringAssignmentDto;
  editorialBrief: {
    objective: "Produce grounded knowledge reusable without reopening raw session evidence.";
    sessions: SessionDossierDto[];
    opportunities: GuidedAuthoringOpportunityRecord[];
    rubrics: typeof GUIDED_ARTIFACT_RUBRICS;
    evidenceQuestions: typeof GUIDED_EVIDENCE_QUESTIONS;
  };
  nextAction: GuidedAuthoringNextAction & { kind: "inspect" };
};

export function startGuidedAssignment(
  db: MastheadDatabase,
  input: { requestId: string; command: string }
): StartGuidedAssignmentResult;
```

`createGuidedRequest()` validates and measures the entire selection, calls
`getArtifactSuggestions()` once, and computes the request ID, complete plan, stable assignment IDs,
and every assignment-wide `authoringEvidenceRevision` before calling the single Task 3
`createGuidedAuthoringRequest()` transaction. Map `currentIdentity.instanceId` to immutable
`creationInstanceId`; Task 9 adds the expected-versus-current mutation guard at the route boundary.
An abort trigger after opportunity insertion must leave every Task 3 guided table empty.

Build each `GuidedPlanningSession.toolCallCount` from the canonical evidence manifest's
`coverage.toolCalls`; no detector-specific count or production-sampling label participates in canary
classification. After putting the canary first, order remaining strong and fallback groups by their
lowest original selection ordinal.

Use `guided-request:${randomUUID()}` for the durable request ID and
`stableRecordId("guided-assignment", [requestId, groupKey])` for assignment IDs. The request is a new
campaign identity, while opportunity IDs, group keys, and assignment membership remain deterministic
inside that request.

The successful create response returns exactly one `claim_next` action whose command is
`${command} workbench author start --request ${request.requestId} --json` and whose reason is
`"The canary assignment is ready to start."`.

- [ ] **Step 6: Return a persisted-plan editorial brief and one next action**

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

`startGuidedAssignment()` is read-only in Task 5; Task 9 adds current-instance guards and ownership or
claim behavior at the public mutation boundary. It reads `currentAssignmentId`, bounded membership,
and opportunity IDs from Task 3 state, filters the persisted request opportunities, and never invokes
the detector or planner. Before returning current canonical dossier baselines, it requires
`authoringEvidenceRevision(db, assignment.sessionIds) === assignment.evidenceRevision`; assignment
evidence revision is the baseline-drift boundary, and Task 6 owns advancing it after a changed-evidence
inspection. A detector-output change that does not change canonical assignment evidence must not alter
the persisted editorial brief.

- [ ] **Step 7: Run planning and detector tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/advisorySuggestions.test.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts
```

Expected: PASS with every selection member and normalized opportunity assigned exactly once, stable
signatures and group keys, unbounded advisory membership, capped historical V2 candidates, legal
dossier and diverse canaries, atomic aggregate rollback, and persisted-plan-only start behavior.

- [ ] **Step 8: Commit campaign planning**

```bash
git add src/workbench/authoring/guidedAuthoringPolicy.ts src/workbench/authoring/guidedAuthoringPreflight.ts src/workbench/authoring/guidedAuthoringService.ts src/workbench/authoring/advisorySuggestions.ts src/workbench/authoring/artifactCandidates.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/advisorySuggestions.test.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts
git commit -m "feat: plan guided authoring assignments"
```

---

### Task 6: Guide complete evidence inspection

**Files:**
- Modify: `src/shared/guidedAuthoring.ts`
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/daemon/db/guidedAuthoringRepository.ts`
- Modify: `src/daemon/db/__tests__/guidedAuthoringRepository.test.ts`
- Modify: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`

**Interfaces:**
- Consumes: `getAuthoringEvidencePage`, evidence manifests, and the evidence-access repository.
- Produces: `inspectGuidedAssignment()` and read-only `reviewGuidedAssignment()` with sequential unread pages, revisioned coverage, supplementary previews, editorial questions, and one deterministic next action.

- [ ] **Step 1: Write failing evidence-coverage tests**

```ts
test("does not permit drafting after first and last message sampling", () => {
  inspectGuidedAssignment(db, inspectInput({ cursor: undefined, limit: 1 }));
  const supplementary = inspectGuidedAssignment(db, inspectInput({ order: "desc", limit: 1 }));
  const review = reviewGuidedAssignment(db, reviewInput("assignment:one"));
  expect(supplementary.progressRecorded).toBe(false);
  expect(review.nextAction.kind).toBe("inspect");
  expect(review.coverage[0]).toMatchObject({ accessedItems: 1, complete: false, totalItems: 8 });
});

test("moves to save only after every canonical evidence item was returned", () => {
  inspectAllAssignmentPages(db, "assignment:one");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:one")).nextAction.kind).toBe("save");
});

test("invalidates assignment-wide coverage when another member's evidence changes", () => {
  inspectAllAssignmentPages(db, "assignment:one");
  const previousRevision = getGuidedAssignment(db, "assignment:one")!.evidenceRevision;
  appendCanonicalEvidence(db, "session:b");
  expect(() => inspectGuidedAssignment(db, inspectInput({ sessionId: "session:a" })))
    .toThrow("evidence_revision_changed");
  expect(getGuidedAssignment(db, "assignment:one")!.evidenceRevision).not.toBe(previousRevision);
  expect(reviewGuidedAssignment(db, reviewInput("assignment:one")).coverage.every(({ accessedItems, complete }) =>
    accessedItems === 0 && !complete
  )).toBe(true);
  expect(listGuidedEvidenceAccess(db, "assignment:one", previousRevision).length).toBeGreaterThan(0);
});

test.each([
  { query: "verification" },
  { kind: "tools" as const },
  { order: "desc" as const }
])("keeps $query$kind$order supplementary reads out of coverage", (supplementary) => {
  const before = reviewGuidedAssignment(db, reviewInput("assignment:one"));
  const inspected = inspectGuidedAssignment(db, inspectInput(supplementary));
  expect(inspected.progressRecorded).toBe(false);
  expect(inspected.coverage).toEqual(before.coverage);
  expect(listGuidedEvidenceAccess(db, "assignment:one")).toEqual([]);
});

test("keeps assignment-wide and session-only evidence revisions distinct", () => {
  const inspected = inspectGuidedAssignment(db, inspectInput({ limit: 1 }));
  expect(inspected.evidenceRevision).toBe(authoringEvidenceRevision(db, ["session:a", "session:b"]));
  expect(inspected.evidence.evidenceRevision).toBe(authoringEvidenceRevision(db, [inspected.sessionId]));
  expect(inspected.evidenceRevision).not.toBe(inspected.evidence.evidenceRevision);
  expect(inspected.coverage.every(({ evidenceRevision }) =>
    evidenceRevision === inspected.evidenceRevision
  )).toBe(true);
  expect(listGuidedEvidenceAccess(db, "assignment:one").every(({ evidenceRevision }) =>
    evidenceRevision === inspected.evidenceRevision
  )).toBe(true);
});

test("returns the exact first unread cursor even after an explicit skipped page", () => {
  inspectGuidedAssignment(db, inspectInput({ cursor: "4", limit: 1, sessionId: "session:a" }));
  expect(reviewGuidedAssignment(db, reviewInput("assignment:one")).nextAction).toEqual({
    kind: "inspect",
    command: "masthead workbench author inspect --assignment assignment:one --session session:a --cursor 0 --json",
    reason: "Session session:a still has unread canonical evidence."
  });
});

test("chooses the earliest incomplete member in persisted assignment order", () => {
  seedAssignmentMembership(db, "assignment:one", ["session:z", "session:a"]);
  inspectAllSessionPages(db, "assignment:one", "session:z");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:one")).nextAction.command)
    .toContain("--session session:a --cursor 0");
});

test("derives unread offsets from canonical observedAt/itemId order, not lexical item IDs", () => {
  seedTranscriptItems(db, "session:a", [
    { itemId: "item:z", observedAt: "2026-07-19T10:00:00.000Z" },
    { itemId: "item:a", observedAt: "2026-07-19T10:01:00.000Z" }
  ]);
  const inspected = inspectGuidedAssignment(db, inspectInput({ sessionId: "session:a", limit: 1 }));
  expect(inspected.evidence.items[0]?.itemId).toBe("item:z");
  expect(inspected.nextAction.command).toContain("--session session:a --cursor 1");
});

test.each(["", " ", "NaN", "-1", "1.5", "9007199254740992", "999"])(
  "rejects invalid cursor %j for completion and supplementary reads",
  (cursor) => {
    expect(() => inspectGuidedAssignment(db, inspectInput({ cursor })))
      .toThrow("guided_inspection_cursor_invalid");
    expect(() => inspectGuidedAssignment(db, inspectInput({ cursor, query: "verification" })))
      .toThrow("guided_inspection_cursor_invalid");
    expect(listGuidedEvidenceAccess(db, "assignment:one")).toEqual([]);
  }
);

test("repeated explicit page reads are idempotent", () => {
  const input = inspectInput({ cursor: "0", limit: 2, sessionId: "session:a" });
  const first = inspectGuidedAssignment(db, input);
  const repeated = inspectGuidedAssignment(db, input);
  expect(repeated.coverage).toEqual(first.coverage);
});

test("serializes default inspectors across two WAL connections before page selection", async () => {
  const fixture = await openSharedWalWorkerFixture({ timeoutMs: 2_000 });
  const workerA = fixture.spawnInspectionWorker({ pauseAfterSelection: true });
  await fixture.waitForMessage(workerA, "page_selected", { timeoutMs: 2_000 });
  const workerB = fixture.spawnInspectionWorker({ pauseAfterSelection: false });
  await fixture.waitForMessage(workerB, "transaction_attempted", { timeoutMs: 2_000 });
  await expect(fixture.waitForMessage(workerB, "page_selected", { timeoutMs: 100 }))
    .rejects.toThrow("bounded_timeout");
  fixture.releaseWithAtomics(workerA);
  const committed = await fixture.waitForMessage(workerA, "committed", { timeoutMs: 2_000 });
  const secondSelected = await fixture.waitForMessage(workerB, "page_selected", { timeoutMs: 2_000 });
  expect(secondSelected.sequence).toBeGreaterThan(committed.sequence);
  const [first, second] = await fixture.collectResults(workerA, workerB);
  expect(first.evidence.items[0]?.itemId).not.toBe(second.evidence.items[0]?.itemId);
  expect(second.coverage[0]?.accessedItems).toBe(2);
});

test("refuses nested inspection so revision reset cannot be rolled back by an outer caller", () => {
  db.exec("BEGIN IMMEDIATE");
  try {
    expect(() => inspectGuidedAssignment(db, inspectInput({ limit: 1 })))
      .toThrow("guided_inspection_requires_top_level_transaction");
  } finally {
    db.exec("ROLLBACK");
  }
  expect(listGuidedEvidenceAccess(db, "assignment:one")).toEqual([]);
});

test.each(["query", "kind", "order"])("supplementary %s does not change revision, status, or access rows", (mode) => {
  const before = getGuidedAssignment(db, "assignment:one");
  inspectGuidedAssignment(db, supplementaryInspectInput(mode));
  expect(getGuidedAssignment(db, "assignment:one")).toEqual(before);
  expect(listGuidedEvidenceAccess(db, "assignment:one")).toEqual([]);
});

test.each(["staged_canary", "ready_to_finish", "completed"] as const)(
  "does not reset a %s assignment during inspection",
  (status) => {
    setAssignmentStatus(db, "assignment:one", status);
    appendCanonicalEvidence(db, "session:b");
    expect(() => inspectGuidedAssignment(db, inspectInput({}))).toThrow("guided_assignment_evidence_locked");
    expect(getGuidedAssignment(db, "assignment:one")?.status).toBe(status);
  }
);

test("rejects stale-revision evidence access in the repository", () => {
  expect(() => recordGuidedEvidenceAccess(db, evidenceAccess({ evidenceRevision: "stale" })))
    .toThrow("guided_evidence_revision_mismatch");
  expect(listGuidedEvidenceAccess(db, "assignment:one")).toEqual([]);
});

test("advances evidence revision by compare-and-swap and preserves old audit rows", () => {
  recordGuidedEvidenceAccess(db, evidenceAccess({ evidenceRevision: "evidence:old" }));
  const advanced = advanceGuidedAssignmentEvidenceRevision(db, {
    assignmentId: "assignment:one",
    expectedEvidenceRevision: "evidence:old",
    nextEvidenceRevision: "evidence:new"
  });
  expect(advanced).toMatchObject({
    acceptedDraftRevision: undefined,
    currentDraftRevision: 2,
    evidenceRevision: "evidence:new",
    status: "investigating"
  });
  expect(listGuidedEvidenceAccess(db, "assignment:one", "evidence:old")).toHaveLength(1);
  expect(() => advanceGuidedAssignmentEvidenceRevision(db, {
    assignmentId: "assignment:one",
    expectedEvidenceRevision: "evidence:old",
    nextEvidenceRevision: "evidence:newer"
  })).toThrow("guided_evidence_revision_conflict");
});

test("keeps review read-only when live evidence is newer than the assignment revision", () => {
  const stored = getGuidedAssignment(db, "assignment:one")!;
  appendCanonicalEvidence(db, "session:b");
  const reviewed = reviewGuidedAssignment(db, reviewInput("assignment:one"));
  expect(reviewed.evidenceRevision).not.toBe(stored.evidenceRevision);
  expect(reviewed.coverage.every(({ accessedItems, complete }) => accessedItems === 0 && !complete))
    .toBe(true);
  expect(reviewed.nextAction.kind).toBe("inspect");
  expect(getGuidedAssignment(db, "assignment:one")).toEqual(stored);
});

test("hides stale draft data after revision reset and leaves every question unresolved", () => {
  storeRejectedDraftAtCurrentEvidence(db, "assignment:one");
  const oldDraftRevision = getGuidedAssignment(db, "assignment:one")!.currentDraftRevision;
  appendCanonicalEvidence(db, "session:b");
  expect(() => inspectGuidedAssignment(db, inspectInput({ limit: 1 })))
    .toThrow("evidence_revision_changed");
  const reviewed = reviewGuidedAssignment(db, reviewInput("assignment:one"));
  expect(reviewed).toMatchObject({
    draftRevision: undefined,
    draft: undefined,
    findings: [],
    editorialQuestions: GUIDED_EVIDENCE_QUESTIONS
  });
  expect(listGuidedDraftReviews(db, "assignment:one").map(({ revision }) => revision))
    .toContain(oldDraftRevision);
});
```

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts -t "evidence"
```

Expected: FAIL because inspection is not tracked.

- [ ] **Step 3: Implement sequential inspection with a coverage ledger**

Export:

```ts
export type GuidedInspectionDto = {
  assignmentId: string;
  /** Assignment-wide revision over every assignment member. */
  evidenceRevision: string;
  sessionId: string;
  /** Its evidenceRevision is session-only and is never compared with the assignment revision. */
  evidence: WorkbenchAuthoringEvidencePage;
  progressRecorded: boolean;
  editorialQuestions: string[];
  coverage: GuidedEvidenceCoverageDto[];
  nextAction: GuidedAuthoringNextAction;
};

export type GuidedAuthoringReviewDto = {
  requestId: string;
  assignmentId: string;
  status: GuidedAuthoringAssignmentStatus;
  evidenceRevision: string;
  draftRevision?: number;
  draft?: GuidedAuthoringBundleV4;
  findings: WorkbenchAuthoringFinding[];
  editorialQuestions: string[];
  coverage: GuidedEvidenceCoverageDto[];
  operatorReviews: GuidedAuthoringOperatorReviewDto[];
  nextAction: GuidedAuthoringNextAction;
};

export function inspectGuidedAssignment(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    command: string;
    sessionId?: string;
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    query?: string;
    order?: SessionTranscriptOrder;
  }
): GuidedInspectionDto;

export function reviewGuidedAssignment(
  db: MastheadDatabase,
  input: { assignmentId: string; command: string }
): GuidedAuthoringReviewDto;
```

Task 6 adds that `editorialQuestions: string[]` member in the shared DTO scope. In both inspection and
review responses, every `GuidedEvidenceCoverageDto.evidenceRevision` is the assignment-wide revision
over all assignment members. It is the same revision stored on access rows and must never be populated
from the selected page's session-only `evidence.evidenceRevision`.

- [ ] **Step 4: Bind access rows to the current assignment revision**

`recordGuidedEvidenceAccessInTransaction()` must select the owning assignment's
`evidence_revision` and reject an input revision that does not match it with
`guided_evidence_revision_mismatch`. Add transaction-owning and composable revision-advance helpers:

```ts
export function advanceGuidedAssignmentEvidenceRevision(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): GuidedAuthoringAssignmentDto;

export function advanceGuidedAssignmentEvidenceRevisionInTransaction(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): GuidedAuthoringAssignmentDto;
```

The update is a compare-and-swap on `assignment_id`, `expectedEvidenceRevision`, and a status in
`investigating`, `drafting`, or `needs_revision`. It sets the fresh evidence revision, resets status to
`investigating`, clears `accepted_draft_revision`, and preserves `current_draft_revision`, draft-review
rows, and older evidence-access rows as append-only audit history. A stale expected revision fails
with `guided_evidence_revision_conflict`. `staged_canary`, `ready_to_finish`, and `completed` fail with
`guided_assignment_evidence_locked`; Task 8 owns invalidating staged or approved work safely.

- [ ] **Step 5: Serialize progress and commit revision advancement before throwing**

The public `inspectGuidedAssignment()` is deliberately non-composable and always owns one
`withImmediateTransaction()`. It must assert `!db.isTransaction` before doing any work and fail with
`guided_inspection_requires_top_level_transaction` if a caller tries to nest it; do not export an
inspection `*InTransaction` variant. This ensures its revision-reset sentinel always reaches a real
commit before the public error is thrown. Inside its owned transaction, reload the assignment and
membership, compute `authoringEvidenceRevision(db, assignment.sessionIds)` before the page read, read
the page, compute the same assignment-wide revision again, record access through only repository
`*InTransaction` helpers, and compute coverage. Never compare the page's session-only
`evidence.evidenceRevision` with the assignment-wide revision.

If either assignment-wide check differs from stored/current state, advance the assignment through the
CAS helper and return a private `{ changedRevision: true }` sentinel from the transaction callback.
Only after `withImmediateTransaction()` commits may the public service throw
`evidence_revision_changed`; throwing inside the callback would roll back the required revision reset.
No evidence refs from the rejected page are recorded.

`BEGIN IMMEDIATE` serializes progress writers. Prove this with two worker threads or child processes,
each opening its own `DatabaseSync` connection to the same temporary WAL database. Use IPC plus an
`Atomics` barrier to pause worker A after page selection and before commit, start worker B, and apply
bounded timeouts to every signal so a broken lock cannot deadlock the test runner. B must report its
transaction attempt but no page selection before A's committed signal; after release, its page-selected
IPC sequence must be later than A's commit, and it must reload coverage and choose the next unread
page. Two synchronous connections driven on one JavaScript thread or a same-connection sequential test
is insufficient. An
explicit repeat uses `INSERT OR IGNORE` and does not double-count. A concurrent evidence writer either
lands before the lock and is found by the first hash, or waits until commit and is found on the next
inspection; the after-read hash remains a required defensive check.

- [ ] **Step 6: Compute revisioned coverage and exact unread cursors**

The inspection response contains one bounded evidence page, assignment membership identity,
assignment-wide revision, current-revision coverage, `progressRecorded`, unresolved questions, and
one next action. It never embeds the full request selection.

Use `getAuthoringEvidenceManifest()` for current totals, then restore assignment membership order
because the catalog sorts session IDs. For each member, filter access rows by the exact current
assignment-wide revision, stamp that revision into `GuidedEvidenceCoverageDto.evidenceRevision`,
count distinct refs, and set `complete` only when `totalItems > 0` and
`accessedItems === totalItems`. Build the unread sequence with
`iterateSessionTranscriptItems(db, { sessionId, order: "asc" })`, whose canonical key is
`(observedAt, itemId)`, and choose the offset of the first returned item whose `itemId` has no access
row. Never sort item IDs alone, and do not assume `accessedItems` is the next cursor because explicit
reads can leave holes.

Default to the first incomplete assignment session, its first unread offset, ascending canonical
order, and 100 items. Validate every supplied cursor before deciding whether the read is completion
bearing or supplementary. It must be a nonblank, whitespace-free decimal string representing a
nonnegative safe integer within that session's canonical unfiltered range; blank/whitespace, `NaN`,
negative, fractional, overflow, and out-of-range values all fail with
`guided_inspection_cursor_invalid`. Never inherit `sessionTranscriptRepository`'s invalid-cursor-to-zero
behavior. Record exactly the returned `itemId` values. Explicit skipped or repeated valid pages may
record their refs, but the next action always returns to the earliest hole, so sampling cannot
manufacture completion.

A read is completion-bearing only when `order` is absent/`asc`, `kind` is absent/`all`, and `query` is
absent/blank. Filtered, searched, or descending reads return evidence with
`progressRecorded: false`, never insert access rows, and leave assignment status and revision
unchanged when evidence is current. They still return coverage and the canonical first-unread next
action. If assignment evidence has changed, the same serialized revision-reset rule applies before a
supplementary page can be trusted.

The read-only `reviewGuidedAssignment()` never advances a revision and remains bridge-safe. When live
evidence differs from stored state for `investigating`, `drafting`, or `needs_revision`, it reports the
live assignment-wide revision with zero current coverage and an inspect next action; the next
progress-bearing inspect performs the durable reset. For stale `staged_canary` or `ready_to_finish`,
review must not return an inspect action that Task 6 is guaranteed to reject. It returns the existing
`await_operator` or `finish` action; that Task 8 mutation performs the locked invalidation, commits,
throws `evidence_revision_changed`, and the following review returns inspect. A `completed` assignment
remains immutable and returns its idempotent historical completion state even if canonical evidence is
later appended.

After a reset, review exposes `draftRevision`, `draft`, and `findings` only when the selected
draft-review row's `evidence_revision` exactly equals the assignment's current evidence revision.
Older rows remain queryable history but contribute no current draft, findings, resolved questions, or
next-action decision; all Task 5 questions remain unresolved until a current-revision draft exists.

- [ ] **Step 7: Return exact next actions and the Task 5 questions**

When coverage is incomplete, return:

```ts
{
  kind: "inspect",
  command: `${command} workbench author inspect --assignment ${assignmentId} --session ${sessionId} --cursor ${firstUnreadOffset} --json`,
  reason: `Session ${sessionId} still has unread canonical evidence.`
}
```

Always include the numeric first-unread cursor, including `--cursor 0`, so the returned command is
an exact, replayable continuation rather than relying on a CLI default. When every assignment
session is complete, return:

```ts
{
  kind: "save",
  command: `${command} workbench author save --assignment ${assignmentId} --file <draft.json> --json`,
  reason: "Every assignment session has complete canonical evidence coverage."
}
```

Use `GUIDED_EVIDENCE_QUESTIONS` from `guidedAuthoringPolicy.ts`; do not redefine or fork the list in
the inspection service. Task 6 always returns the full list because validated persisted draft fields
do not exist yet; Task 8 filters resolved questions after save/review has structured findings.

- [ ] **Step 8: Run service and repository tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts
```

Expected: PASS with assignment-wide before/after revision checks, committed reset-before-throw,
revision-filtered audit history, stale-access refusal, exact first-unread cursors, idempotent repeats,
two-connection WAL serialization before page selection, nested-inspection refusal, validation of every
completion and supplementary cursor, nonrecording supplementary reads, assignment-wide coverage/access
revision labels, session-versus-assignment revision separation, stale-draft hiding, unresolved-question
preservation, canonical `(observedAt,itemId)` unread offsets with nonlexical IDs, and staged/completed
reset refusal.

- [ ] **Step 9: Commit guided inspection**

```bash
git add src/shared/guidedAuthoring.ts src/workbench/authoring/guidedAuthoringService.ts src/daemon/db/guidedAuthoringRepository.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts
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

- [ ] **Step 5: Enforce the Task 5 independent-reuse rubrics**

Consume `GUIDED_ARTIFACT_RUBRICS` from `guidedAuthoringPolicy.ts`; do not redefine the matrix in the
quality module. Reuse existing typed optional-artifact schemas and claim-support validation, enforce
every rubric entry for the relevant kind, and add a finding when a draft requires reopening raw
evidence to understand or execute it.

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
- Modify: `src/shared/guidedAuthoring.ts`
- Create: `src/daemon/db/migrations/032_guided_enrichment_provenance.sql`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/db/enrichmentRepository.ts`
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/daemon/db/guidedAuthoringRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/daemon/db/__tests__/schema.test.ts`
- Modify: `src/daemon/db/__tests__/enrichmentRepository.test.ts`
- Modify: `src/daemon/db/__tests__/guidedAuthoringRepository.test.ts`
- Modify: `src/workbench/authoring/__tests__/guidedAuthoringService.test.ts`
- Modify: `src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts`

**Interfaces:**
- Consumes: accepted V4 drafts, canary decisions, existing enrichment application, dossier snapshot, optional-artifact publication, and Workbench claims.
- Produces: `saveGuidedDraft`, `reviewGuidedAssignment`, `approveGuidedCanary`, `rejectGuidedCanary`, and `finishGuidedAssignment` with immutable receipts.

Export these exact object-input service contracts; do not retain positional overloads:

```ts
export type GuidedMutationIdentityInput = {
  expectedIdentity: GuidedAuthoringExpectedIdentity;
  currentIdentity: GuidedAuthoringExpectedIdentity;
};

export type SaveGuidedDraftInput = GuidedMutationIdentityInput & {
  assignmentId: string;
  command: string;
  draft: GuidedAuthoringBundleV4;
};

export type GuidedCanaryDecisionInput = GuidedMutationIdentityInput & {
  requestId: string;
  assignmentId: string;
  draftRevision: number;
  evidenceRevision: string;
  command: string;
  notes: string;
  reviewedBy: string;
};

export type FinishGuidedAssignmentInput = GuidedMutationIdentityInput & {
  assignmentId: string;
  command: string;
};

export type FinishGuidedAssignmentResult = {
  receipt: GuidedAuthoringReceiptDto;
  nextAction: GuidedAuthoringNextAction & { kind: "claim_next" | "complete" };
};

export function saveGuidedDraft(
  db: MastheadDatabase,
  input: SaveGuidedDraftInput
): GuidedAuthoringReviewDto;
export function approveGuidedCanary(
  db: MastheadDatabase,
  input: GuidedCanaryDecisionInput
): GuidedAuthoringReviewDto;
export function rejectGuidedCanary(
  db: MastheadDatabase,
  input: GuidedCanaryDecisionInput
): GuidedAuthoringReviewDto;
export function finishGuidedAssignment(
  db: MastheadDatabase,
  input: FinishGuidedAssignmentInput
): FinishGuidedAssignmentResult;
```

- [ ] **Step 1: Write failing canary and atomicity tests**

```ts
test("stages an accepted canary without publishing", () => {
  saveCompleteValidDraft(db, "assignment:canary");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:canary")).status).toBe("staged_canary");
  expect(searchLogbookArtifacts(db, {}).total).toBe(0);
});

test("approval alone writes review state but no enrichment, publication, or Workbench completion", () => {
  saveCompleteValidCanary(db);
  const before = publicationBoundaryCounts(db);
  approveGuidedCanary(db, approvalInput());
  expect(publicationBoundaryCounts(db)).toEqual(before);
  expect(searchLogbookArtifacts(db, {}).total).toBe(0);
});

test("stores typed guided provenance for every finished enrichment row", () => {
  const { receipt } = finishReadyAssignment(db);
  expect(listGuidedEnrichmentProvenance(db, receipt.assignmentId)).toEqual(
    expect.arrayContaining(receipt.sessionIds.flatMap((sessionId) =>
      expectedGuidedProvenanceForSession(receipt, sessionId)
    ))
  );
});

test("associates one stable identical enrichment with two guided assignments", () => {
  const first = finishAssignmentWithIdenticalEnrichment(db, "request:one", "assignment:one");
  const second = finishAssignmentWithIdenticalEnrichment(db, "request:two", "assignment:two");
  expect(second.enrichmentId).toBe(first.enrichmentId);
  expect(listGuidedEnrichmentProvenanceByEnrichment(db, first.enrichmentId)
    .map(({ assignmentId }) => assignmentId).sort())
    .toEqual(["assignment:one", "assignment:two"]);
});

test("publishes the approved canary and releases the next assignment", () => {
  approveGuidedCanary(db, approvalInput());
  const result = finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:canary" }));
  expect(result.receipt.publishedArtifacts.length).toBeGreaterThan(0);
  expect(result.nextAction.kind).toBe("claim_next");
  expect(getGuidedRequest(db, result.receipt.requestId)?.status).toBe("active");
  expect(startGuidedAssignment(db, {
    requestId: result.receipt.requestId,
    command: "masthead"
  }).assignment.ordinal).toBe(1);
});

test.each([
  "after_enrichment",
  "after_dossier_staging",
  "after_optional_staging",
  "after_artifact_publish",
  "after_session_claim_reset",
  "after_receipt_insert",
  "after_request_or_next_assignment_transition"
] as const)("rolls back the entire finish boundary at %s", (failurePoint) => {
  injectPublicationFailure(failurePoint);
  const before = publicationCounts(db);
  expect(() => finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:one" })))
    .toThrow("injected_publication_failure");
  expect(publicationCounts(db)).toEqual(before);
});

test("rejects a manifest swap at the mutation boundary", () => {
  const input = finishInput({ expectedIdentity: identityFromPreviousCapabilities() });
  rotateDaemonInstanceIdentity();
  expect(() => finishGuidedAssignment(db, input)).toThrow("instance_identity_mismatch");
  expect(publicationCounts(db)).toEqual(beforeCounts);
});

test.each(["save", "approve", "reject", "finish"])(
  "%s invokes the current-instance guard before its first database mutation",
  (operation) => {
    const before = guidedAuthoringCounts(db);
    rotateDaemonInstanceIdentity();
    expect(() => invokeGuidedMutation(operation, identityFromPreviousCapabilities()))
      .toThrow("instance_identity_mismatch");
    expect(guidedAuthoringCounts(db)).toEqual(before);
  }
);

test.each(["save", "approve", "reject", "finish"] as const)(
  "refuses nested public %s before validation or mutation",
  (operation) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => invokeValidGuidedMutation(db, operation))
        .toThrow("guided_authoring_public_mutation_requires_top_level_transaction");
    } finally {
      db.exec("ROLLBACK");
    }
  }
);

test("cannot let an outer transaction roll back locked revision invalidation", () => {
  seedApprovedCanaryWithChangedEvidence(db);
  const before = getGuidedAssignment(db, "assignment:canary")!;
  db.exec("BEGIN IMMEDIATE");
  try {
    expect(() => finishGuidedAssignment(db, finishInput({ assignmentId: before.assignmentId })))
      .toThrow("guided_authoring_public_mutation_requires_top_level_transaction");
  } finally {
    db.exec("ROLLBACK");
  }
  expect(getGuidedAssignment(db, before.assignmentId)).toEqual(before);
  expect(() => finishGuidedAssignment(db, finishInput({ assignmentId: before.assignmentId })))
    .toThrow("evidence_revision_changed");
  expect(getGuidedAssignment(db, before.assignmentId)).toMatchObject({
    acceptedDraftRevision: undefined,
    status: "investigating"
  });
});

test.each(["staged_canary", "ready_to_finish"] as const)(
  "invalidates %s against changed evidence before accepting another mutation",
  (status) => {
    setAcceptedAssignmentStatus(db, status);
    const oldRevision = getGuidedAssignment(db, "assignment:one")!.evidenceRevision;
    appendCanonicalEvidence(db, "session:a");
    expect(() => invokeNextGuidedMutation(db, status)).toThrow("evidence_revision_changed");
    expect(getGuidedAssignment(db, "assignment:one")).toMatchObject({
      acceptedDraftRevision: undefined,
      status: "investigating"
    });
    expect(listGuidedDraftReviews(db, "assignment:one").some(({ evidenceRevision }) =>
      evidenceRevision === oldRevision
    )).toBe(true);
  }
);

test("locked revision invalidation is one exact status/revision CAS", () => {
  const before = getGuidedAssignment(db, "assignment:one")!;
  expect(() => withImmediateTransaction(db, () =>
    invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
      assignmentId: before.assignmentId,
      expectedStatus: "ready_to_finish",
      expectedEvidenceRevision: "stale",
      nextEvidenceRevision: "evidence:new"
    })
  )).toThrow("guided_evidence_revision_conflict");
  expect(getGuidedAssignment(db, before.assignmentId)).toEqual(before);
});

test("historical approval does not lock a fresh evidence revision", () => {
  seedApprovedCanaryRevision(db, { draftRevision: 1, evidenceRevision: "evidence:old" });
  seedFreshInvestigatingRevision(db, { currentDraftRevision: 1, evidenceRevision: "evidence:new" });
  expect(() => storeGuidedDraftReview(db, freshRevisionDraft())).not.toThrow();
});

test.each([
  ["staged_canary", "await_operator"],
  ["ready_to_finish", "finish"]
] as const)("does not direct stale locked %s review to inspect", (status, nextKind) => {
  setAcceptedAssignmentStatus(db, status);
  appendCanonicalEvidence(db, "session:a");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:one")).nextAction.kind).toBe(nextKind);
});

test("keeps stale approved canary on finish until finish commits its invalidation", () => {
  saveCompleteValidCanary(db);
  approveGuidedCanary(db, approvalInput());
  appendCanonicalEvidence(db, "session:a");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:canary")).nextAction.kind).toBe("finish");
  expect(() => finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:canary" })))
    .toThrow("evidence_revision_changed");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:canary"))).toMatchObject({
    draft: undefined,
    findings: [],
    nextAction: { kind: "inspect" }
  });
});

test("resumes fresh authoring after changed evidence invalidates an approved canary", () => {
  saveCompleteValidCanary(db);
  approveGuidedCanary(db, approvalInput());
  appendCanonicalEvidence(db, "session:a");
  expect(() => finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:canary" })))
    .toThrow("evidence_revision_changed");
  expect(reviewGuidedAssignment(db, reviewInput("assignment:canary")).nextAction.kind).toBe("inspect");
  inspectAllAssignmentPages(db, "assignment:canary");
  const revised = saveGuidedDraft(db, saveInput({ draft: freshCurrentRevisionDraft() }));
  expect(revised.draft?.evidenceRevision).toBe(getGuidedAssignment(db, "assignment:canary")!.evidenceRevision);
  expect(revised.status).toBe("staged_canary");
});

test("completed finish retry returns the immutable receipt and terminal next action", () => {
  const first = finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:last" }));
  appendCanonicalEvidence(db, "session:last");
  const retry = finishGuidedAssignment(db, finishInput({ assignmentId: "assignment:last" }));
  expect(retry.receipt).toEqual(first.receipt);
  expect(retry.nextAction).toEqual({
    kind: "complete",
    command: "",
    reason: "The guided authoring request is complete."
  });
});

test.each([
  ["rejected_save", "revise", "masthead workbench author save --assignment assignment:one --file <revised-draft.json> --json", "The saved draft has blocking structured findings to resolve."],
  ["staged_canary", "await_operator", "masthead workbench author review --assignment assignment:one --json", "The canary draft is staged and awaiting operator approval."],
  ["accepted_or_approved", "finish", "masthead workbench author finish --assignment assignment:one --json", "The accepted assignment is ready for atomic publication."],
  ["nonfinal_finish", "claim_next", "masthead workbench author start --request request:one --json", "The next guided assignment is ready to start."],
  ["final_finish", "complete", "", "The guided authoring request is complete."]
] as const)("returns the exact %s next action", (state, kind, command, reason) => {
  expect(nextActionForFixtureState(db, state)).toEqual({ kind, command, reason });
});
```

- [ ] **Step 2: Run focused service tests and verify failure**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts -t "canary|atomic|identity|guard|revision"
```

Expected: FAIL because V4 staging and finish do not exist.

- [ ] **Step 3: Implement staged canary review**

`saveGuidedDraft()` appends a draft/review revision and stores accepted canary drafts as `staged_canary`; it changes the request to `awaiting_canary_approval`. `approveGuidedCanary()` requires `reviewedBy`, nonempty notes, matching request and assignment IDs, the exact accepted draft revision, and current evidence revision. Rejection appends an operator review, changes the assignment to `needs_revision`, and returns the request to `open` without publishing. A later revision and approval append new rows rather than overwriting either rejection or draft history.

Use this mutation/status matrix; reject every unlisted transition before any operation-specific write:

| Operation | Legal starting state | Required current state | Result |
| --- | --- | --- | --- |
| `save` | `investigating`, `drafting`, `needs_revision` | Complete coverage at the exact assignment evidence revision | Blocking findings append a review and produce `needs_revision`; accepted canaries produce `staged_canary` plus request `awaiting_canary_approval`; accepted non-canaries produce `ready_to_finish`. |
| `approve` | `staged_canary` | Request awaits approval; decision names the exact accepted draft revision and its current evidence revision | Append approval only; keep `staged_canary` and publish nothing. |
| `reject` | `staged_canary` | Same exact current draft/evidence binding as approval | Append rejection, set `needs_revision`, clear accepted draft and canary approval fields, and set request `open`. |
| `finish` | `ready_to_finish` | Accepted draft and complete coverage match current evidence | Publish atomically. |
| `finish` | `staged_canary` | Exact accepted draft/evidence revision has an approval | Publish atomically. |
| completed `finish` retry | `completed` | Expected/current identity and stored request binding still pass | Return the immutable stored receipt without revalidating later evidence or writing anything. |

Return these exact next actions from save, decision, review, and finish results:

```ts
const revise = {
  kind: "revise",
  command: `${command} workbench author save --assignment ${assignmentId} --file <revised-draft.json> --json`,
  reason: "The saved draft has blocking structured findings to resolve."
};
const awaitOperator = {
  kind: "await_operator",
  command: `${command} workbench author review --assignment ${assignmentId} --json`,
  reason: "The canary draft is staged and awaiting operator approval."
};
const finish = {
  kind: "finish",
  command: `${command} workbench author finish --assignment ${assignmentId} --json`,
  reason: "The accepted assignment is ready for atomic publication."
};
const claimNext = {
  kind: "claim_next",
  command: `${command} workbench author start --request ${requestId} --json`,
  reason: "The next guided assignment is ready to start."
};
const complete = {
  kind: "complete",
  command: "",
  reason: "The guided authoring request is complete."
};
```

Rejected saves and operator rejections return `revise`; accepted canary saves return
`awaitOperator`; accepted non-canary saves and approvals return `finish`; successful nonfinal finish
returns `claimNext`; final finish and every completed retry return `complete`. Review derives the same
single action from persisted state and never invents an alternate command or reason.

Task 6 deliberately refuses to reset `ready_to_finish`, `staged_canary`, or approved work during an
inspection. Before save, approval, rejection, or finish accepts existing draft state, Task 8 recomputes
the assignment-wide evidence revision inside its serialized mutation boundary. When it changed,
call this separate locked-state CAS rather than weakening Task 6's helper:

```ts
export function invalidateLockedGuidedAssignmentEvidenceInTransaction(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedStatus: "staged_canary" | "ready_to_finish";
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): { assignment: GuidedAuthoringAssignmentDto; request: GuidedAuthoringRequestDto };
```

Its assignment update compares assignment ID, exact locked status, expected evidence revision, and
non-null accepted draft in one statement. It sets the fresh evidence revision, status
`investigating` and `accepted_draft_revision = NULL`, while preserving `current_draft_revision` and
all draft-review, operator-review, and evidence-access rows. The repository does not rewrite old
draft `findings_json`; review's exact-current-revision join makes those findings invisible. Commit this
invalidation and only then throw
`evidence_revision_changed`. Canary invalidation also clears `canary_approved_at` and
`canary_approved_by` and returns the request to `open`; invalidating a non-canary
`ready_to_finish` assignment leaves its active request `active`. Use the same changed-sentinel
commit-before-throw pattern as Task 6; never roll the invalidation back with the error. An old
approved operator review locks only its exact draft and evidence revision, so a fresh revision may
be drafted and reviewed without deleting history.

The repository query that detects an existing approval must join the operator review to its draft
review and block only when both `draft_revision` and that draft row's `evidence_revision` equal the
assignment's currently accepted draft and current evidence revision. Historical approvals remain
audit-only and cannot deadlock the first fresh-revision save or later operator decision.

Except for an already-completed finish retry, every save/approve/reject/finish transaction recomputes
the assignment-wide evidence revision before applying the status matrix. A changed
`investigating`/`drafting`/`needs_revision` assignment uses Task 6's ordinary in-transaction CAS; a
changed `staged_canary`/`ready_to_finish` assignment uses the locked CAS above. Both return the private
changed sentinel, commit, and throw afterward. `completed` is never revision-reset by later evidence.

After a draft has structured validation findings, `reviewGuidedAssignment()` filters
`GUIDED_EVIDENCE_QUESTIONS` only when supported persisted fields resolve the corresponding question.
Until then it continues returning the complete Task 5 list established by Task 6.

Review selects a draft row only with `draft_reviews.evidence_revision = assignments.evidence_revision`.
If no such row exists, it returns no `draftRevision` or `draft`, empty findings, and the complete
question list even though `current_draft_revision` still points at preserved history. Add locked-state
tests for stale `staged_canary`, stale approved `staged_canary`, stale `ready_to_finish`, and immutable
`completed`: the first three expose their current non-inspect action until an allowed Task 8 mutation
commits invalidation, after which review returns inspect with stale draft/findings hidden; completed
keeps its stored receipt/history and terminal action.

Every public write service receives `expectedIdentity` and immutable `currentIdentity` through the
exact object inputs above. `saveGuidedDraft()`, `approveGuidedCanary()`, `rejectGuidedCanary()`, and
`finishGuidedAssignment()` are non-composable transaction owners: each first asserts
`!db.isTransaction` and throws
`guided_authoring_public_mutation_requires_top_level_transaction` before lookup, validation, identity
checks, or writes. Do not expose public `*InTransaction` variants; only private/repository helpers are
composable. This guarantees a changed-revision sentinel commits in the public transaction before its
error and cannot be captured inside an outer transaction that later rolls it back. After the top-level
assertion, each service calls `assertStableGuidedRequestBinding()` and
`assertGuidedAuthoringExpectedIdentity(input.expectedIdentity, input.currentIdentity)` immediately
before their owned transaction or first repository write; request lookup, validation, and review
computation may happen first, but no durable state may change before both guards succeed. A safe
restart may change only the current nonce and PID while the request's creation nonce remains unchanged
audit evidence.

- [ ] **Step 4: Store structured enrichment provenance and implement one-transaction finish**

Add a shared structured record rather than encoding guided provenance into `provider`, `model`,
`prompt_version`, activity details, or another string field:

```ts
export type GuidedEnrichmentProvenance = {
  enrichmentId: string;
  requestId: string;
  assignmentId: string;
  sessionId: string;
  draftRevision: number;
  evidenceRevision: string;
  policyVersion: "guided-authoring-v1";
  source: "guided_authoring";
  appliedAt: string;
};

export function recordGuidedEnrichmentProvenanceInTransaction(
  db: MastheadDatabase,
  input: GuidedEnrichmentProvenance
): void;
export function listGuidedEnrichmentProvenance(
  db: MastheadDatabase,
  assignmentId: string
): GuidedEnrichmentProvenance[];
export function listGuidedEnrichmentProvenanceByEnrichment(
  db: MastheadDatabase,
  enrichmentId: string
): GuidedEnrichmentProvenance[];
```

Migration `032_guided_enrichment_provenance.sql` creates
`guided_authoring_enrichment_provenance` as an association/event table, not enrichment ownership.
Use `PRIMARY KEY (enrichment_id, assignment_id)`, a foreign key from `enrichment_id` to
`session_enrichments`, and the composite foreign key
`(assignment_id, request_id, session_id)` to
`guided_authoring_assignment_sessions(assignment_id, request_id, session_id)`. Keep positive
`draft_revision`, nonblank revision checks, and constrained policy/source literals. A stable
enrichment row may therefore be reused by later assignments while each assignment receives its own
immutable provenance association. Extend the schema registry and migration tests. The enrichment
repository accepts a `GuidedEnrichmentProvenance` object and inserts one association for each generated
or reused enrichment ID inside the caller's transaction; the existing provider/model fields remain
ordinary enrichment metadata, never the authoritative request/assignment provenance. Repository tests
must round-trip every field, prove rollback with the enrichment rows, and reuse one identical stable
enrichment ID across two requests/assignments without a uniqueness conflict.

Within one `BEGIN IMMEDIATE` transaction:

```text
1. Revalidate request and assignment, then immediately before `BEGIN IMMEDIATE` call `assertStableGuidedRequestBinding()` and `assertGuidedAuthoringExpectedIdentity()` against the immutable current daemon identity. The request's creation nonce is audit-only, while the mutation envelope must contain the current nonce reloaded by the client. Only after both guards succeed may the service verify evidence revision, complete inspection, accepted draft revision/findings, and canary approval inside the transaction.
2. Apply each session's durable enrichment and write the structured provenance row for every generated enrichment ID with request ID, assignment ID, session ID, accepted draft revision, evidence revision, source, policy version, and applied time stamped by the daemon.
3. Rebuild and stage each canonical dossier snapshot.
4. Stage optional artifacts and provenance.
5. Publish all staged artifacts.
6. Mark assignment sessions completed and reset their Workbench claims/state.
7. Store the immutable assignment receipt.
8. Mark the request completed only when no pending request sessions remain.
```

Return the stored receipt unchanged on finish retry.

The outer service owns the one `BEGIN IMMEDIATE` and calls only transaction-composable repository/publication helpers; no helper may open a nested transaction. On approved-canary finish the request becomes `active`; on final-assignment finish it becomes `completed`. Idempotent retries may look up the stored receipt before attempting a new transition, but must still invoke both identity guards before returning it. They verify the request's stable binding and the retry envelope against the current daemon; the receipt's historical publication instance nonce and the request's creation nonce need not equal a safely restarted daemon's current nonce.

- [ ] **Step 5: Run acceptance and rollback tests**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts src/workbench/authoring/__tests__/authoringService.test.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts src/daemon/db/__tests__/enrichmentRepository.test.ts src/daemon/db/__tests__/schema.test.ts
```

Expected: PASS with no partial enrichment, provenance, Logbook, Workbench, receipt, request, or next-assignment state after any injected failure; approval alone publishes nothing; locked revision invalidation commits before its error; historical approvals do not block a fresh current-revision draft; stale drafts/findings never reappear; and completed retries return the original receipt.

- [ ] **Step 6: Commit staged publication**

```bash
git add src/shared/guidedAuthoring.ts src/daemon/db/migrations/032_guided_enrichment_provenance.sql src/daemon/db/schema.ts src/daemon/db/enrichmentRepository.ts src/workbench/authoring/guidedAuthoringService.ts src/workbench/authoring/authoringService.ts src/daemon/db/guidedAuthoringRepository.ts src/daemon/db/workbenchPipelineRepository.ts src/daemon/db/__tests__/schema.test.ts src/daemon/db/__tests__/enrichmentRepository.test.ts src/daemon/db/__tests__/guidedAuthoringRepository.test.ts src/workbench/authoring/__tests__/guidedAuthoringService.test.ts src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts
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
- Modify: `src/workbench/authoring/guidedAuthoringService.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/cli/mastheadctl.ts`
- Modify: `src/core/worktreeConnector.ts`
- Modify: `scripts/masthead-doctor.js`
- Modify: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Modify: `src/daemon/__tests__/doctorAuthoring.test.ts`
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

Add tests that every successful agent workflow command response contains exactly one `nextAction`, every mutation rejects an expected identity swapped after capabilities with zero writes, a stably bound request continues after a daemon restart by reloading the same manifest's new current nonce, pending-canary discovery survives a simulated renderer restart, and legacy `open`, `submit`, and `finish` mutations return `authoring_contract_retired` for V3. Treat progress-recording `inspect` as a mutation even though its route uses `GET`: it must execute the same current-instance and stable-request guards before recording evidence access.

Add an endpoint-matrix test that the worktree bridge forwards only non-mutating authoring reads and rejects everything that records progress or writes state:

```ts
expect(bridgeAllows("GET", "/workbench/authoring/capabilities")).toBe(true);
expect(bridgeAllows("GET", "/workbench/authoring/requests/request%3Aone")).toBe(true);
expect(bridgeAllows("GET", "/workbench/authoring/canaries/pending")).toBe(true);
expect(bridgeAllows("GET", "/workbench/authoring/assignments/assignment%3Aone/review")).toBe(true);
expect(bridgeAllows("GET", "/workbench/authoring/assignments/assignment%3Aone/inspect")).toBe(false);
expect(allGuidedAuthoringPostRoutes.every((path) => !bridgeAllows("POST", path))).toBe(true);
```

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

The read-only bridge forwards only authoring operations that cannot record progress: capabilities, request status, pending-canary discovery, assignment review, and the existing audit-only run status/context/evidence-preview reads. It must reject progress-recording assignment `inspect` even though that route uses `GET`, and it must reject request creation, start/claim, draft save, canary decisions, finish, and every other authoring `POST`. Remove the current bridge exception for authoring suggestions rather than treating a `POST` as a forwarded preview. Update the method-aware matcher in `src/core/worktreeConnector.ts`, its focused tests, and the endpoint matrix in the same task; do not rely on `viteConnectorManager` tests to cover route authorization.

- [ ] **Step 4: Add nested CLI dispatch and next-action rendering**

`runGuidedAuthoringCli(args, options)` parses the subcommand after `author`, reloads and verifies the manifest before every mutation, includes `GuidedAuthoringExpectedIdentity` in each `POST` body, and sends the same five fields in canonical authoring-identity headers for progress-recording `GET inspect`. It prints human-readable guidance by default and returns the exact DTO under `--json`. The preliminary capabilities check is fast feedback only. Each route passes the envelope and immutable current daemon identity into the service, and each service invokes `assertGuidedAuthoringExpectedIdentity()` plus `assertStableGuidedRequestBinding()` immediately before its first database mutation. Request creation has no persisted request binding yet, so it invokes only the current-identity guard; start, inspect, save, canary decisions, and finish invoke both. It must not provide a command that accepts multiple request IDs, assignment IDs, or a session list.

For safe restart, request creation persists the original `creationInstanceId`, while each later command rereads the same canonical manifest and sends its new current `instanceId`. End-to-end tests restart the daemon with unchanged base URL, database ID, build SHA, and manifest path, require `start` to succeed, and require the stored creation nonce to remain unchanged. Changing any stable field or sending the previous nonce must fail before a write.

- [ ] **Step 5: Retire unsafe V3 mutations**

Capabilities advertise only:

```ts
operations: ["start", "inspect", "save", "review", "finish"]
bundleVersion: "workbench-authoring-v4"
policyVersion: "guided-authoring-v1"
```

Keep V1-V3 status and receipt reads for audit. Return HTTP 409 with `{ code: "authoring_contract_retired" }` before opening or mutating a V3 run.

Update Doctor in the same cutover so it validates the exact `GuidedAuthoringCapabilitiesDto`: V4 bundle version, guided policy version, ordered `start/inspect/save/review/finish` operations, instance command, base URL, database ID, build SHA, canonical manifest path, and current instance ID. The temporary identity-bearing V3 compatibility check introduced in Task 4 must not survive as the installed health gate after V4 becomes current.

- [ ] **Step 6: Run API, CLI, bridge, and doctor tests**

Run:

```bash
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/daemon/__tests__/doctorAuthoring.test.ts src/core/__tests__/worktreeConnector.test.ts src/daemon/__tests__/endpointMatrix.test.ts
```

Expected: PASS with a complete V4 operation contract, no V3 write path, zero writes after every identity swap, safe restart continuity with the historical creation nonce preserved, and no bridge route that can record inspection progress or mutate authoring state.

- [ ] **Step 7: Commit adapters**

```bash
git add src/daemon/guidedAuthoringApi.ts src/cli/guidedAuthoring.ts src/daemon/workbenchAuthoringApi.ts src/daemon/server.ts src/daemon/healthService.ts src/daemon/settingsService.ts src/workbench/authoring/guidedAuthoringService.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/cli/mastheadctl.ts src/core/worktreeConnector.ts scripts/masthead-doctor.js src/daemon/__tests__/workbenchAuthoringApi.test.ts src/daemon/__tests__/doctorAuthoring.test.ts src/cli/__tests__/authoringCli.test.ts src/core/__tests__/worktreeConnector.test.ts src/daemon/__tests__/endpointMatrix.test.ts
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

Before any production mutation, obtain Tyler's explicit approval for the exact scope: stage and activate the verified build, stop and restart the production daemon, create one backup, invalidate the audited 3,230 V3 dossier artifacts, reset those sessions to Workbench, finalize the verified installation by deleting the rollback bundle, and publish only the reviewed canary. Approval to implement this plan does not authorize this step.

- [ ] **Step 2: Stage and verify the packaged build without launching it**

First run `npm run rehearse:production-activation -- --bundle <absolute-packaged-bundle>` and require its full crash-boundary, restart-recovery, finalization, and lease-race matrix to pass in isolated temporary paths; this rehearsal must refuse the live production root, data directory, database, and manifest. Then use the repository's operational `stage --bundle ... --bundle-digest ... --data-dir /home/tyler/.config/masthead-production --db-path /home/tyler/.config/masthead-production/masthead.sqlite --port 17373 --production-root /home/tyler/.local/share/masthead-production --json` command. Record the rehearsal result, immutable receipt path, activation-journal path, resolved lifecycle-lease path, database path, port/base URL, candidate and rollback bundle release/digest identities, package version, build SHA, future launcher target, expected production manifest path, and signed release commit from verified bundle files. Staging may acquire only the external production lifecycle lease; it must not start the new daemon, open the production database, change `current`, rewrite an active launcher, or delete the old bundle.

- [ ] **Step 3: Stop production and activate the filesystem while offline**

Run the supported `stop` command, which shares the same external lifecycle lease as stage and activation, and verify the exact production process set, health endpoint, port, application-database ownership, and live manifest are absent before activation. Run `activate --receipt <absolute-receipt-path> --json`; under that same resolved lease it must independently repeat every process, health, port, writer-ownership, and manifest absence check before mutation, recover any interrupted journal first, then commit one completely attested filesystem generation or restore the old generation and require a clean rerun. Record the durable activation commit and verify that `current`, `/home/tyler/.config/masthead-production/bin/mastheadctl`, the lifecycle launcher, and desktop entry all name the staged bundle, while the instance launcher exports only `/home/tyler/.config/masthead-production/masthead-instance.json`. Confirm the build SHA from the bundle, receipt, journal, and active bytes without opening the application database, running maintenance, launching Masthead, or generating the live manifest. Activation must retain the old bundle, receipt, journal, and staged attestations as the rollback generation; disk-hygiene deletion happens only after Step 7 proves the new daemon. The production manifest must remain absent while production is offline.

If stage, stop, activation, either recovery command, start, or finalization is interrupted, do not inspect or repair the active files by hand. Rerun the same supported lifecycle command so it acquires the shared lease and recovers the durable activation journal first; record the recovery result and re-prove the expected boundary before continuing.

- [ ] **Step 4: Prepare recovery before any new-daemon database access**

With production still stopped after filesystem activation, run:

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

Start production normally for the first time on the recovered database. `start` must acquire the shared lifecycle lease and recover or refuse any incomplete activation journal before using its configuration. Require the daemon to publish `/home/tyler/.config/masthead-production/masthead-instance.json` only after it binds with complete health identity, then run `/home/tyler/.config/masthead-production/bin/mastheadctl workbench capabilities --json` and require the production database ID, installed build SHA, `workbench-authoring-v4`, `guided-authoring-v1`, canonical manifest path, production base URL, and the same fresh runtime `instanceId`. Strictly bind the manifest and health PID/start identity, executable, arguments, environment, active launcher bytes, and held canonical manifest-writer guard to the activated bundle. Without another restart, require Logbook to remove the invalidated dossiers and Workbench to show the recovered sessions within one revision-poll interval. Verify no stale 3,230-item selection remains and all five latency budgets pass against production read endpoints. Keep the rollback bundle and staged lifecycle evidence until this entire proof passes.

- [ ] **Step 7: Finalize the verified installation and prove disk hygiene**

Run `finalize --receipt <absolute-receipt-path> --json`. Finalization must acquire the shared lifecycle lease, re-attest the candidate bundle and every active launcher/desktop byte, repeat the exact live health, manifest, process, and held-writer-guard proof from Step 6, and refuse fake manifest-shaped JSON or any identity drift. Only then may it delete the rollback bundle and stale helper artifacts and remove the staged files, activation journal, and receipt. Require `current` to resolve to the verified candidate, exactly one versioned production bundle to remain under `/home/tyler/.local/share/masthead-production/`, no staged/receipt/journal/helper artifact to remain, and production health plus capabilities to retain the same daemon identity after cleanup.

- [ ] **Step 8: Publish only the production canary**

From Workbench, select the three signed canary sessions recorded in the acceptance document, copy the V4 prompt, complete guided inspection and draft review, inspect the staged dossier and optional-artifact drafts in the Activity rail, and approve only if every item is specific, grounded, independently reusable where applicable, and free of repeated template language. Do not begin the canary while two bundles remain or before the finalization evidence in Step 7 is recorded.

- [ ] **Step 9: Hold the full rollout for explicit approval**

Record the staged receipt and activation-journal hashes, any crash-recovery result, finalization receipt, one-bundle disk inventory, daemon identity proof, canary request ID, assignment ID, artifact IDs, human review notes, artifact-only reuse results, revisions, and endpoint timings. Do not release the remaining recovered sessions until Tyler explicitly approves full campaign continuation from this evidence.

---

## Self-Review Checklist

- [ ] Every diagnosed failure has a task: unsafe orchestration, weak enrichment validation, poor artifact guidance, arbitrary batching, CLI instance collision, stale Logbook cache, stale Workbench selection, slow legacy summary, and polluted production data.
- [ ] V4 types, command names, route names, status names, and policy versions are consistent across tasks.
- [ ] V1-V3 audit history and canonical session evidence are preserved.
- [ ] Sparse evidence and legitimate zero-optional-artifact outcomes remain valid.
- [ ] Production mutation is isolated to Task 15 and requires fresh explicit authority.
- [ ] The exact failed generation is rejected by tests before recovery tooling can ship.
- [ ] The plan contains no unresolved implementation decisions.
