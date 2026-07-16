# Restore Agent-Led Artifact Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Masthead's original Workbench flow: the user selects sessions and copies one agent prompt; the agent enriches every selected session and chooses any useful optional artifacts; Masthead validates and atomically publishes only enriched results.

**Architecture:** Introduce a selection-scoped `workbench-authoring-v3` bundle while retaining the stable daemon HTTP protocol identifier. A bounded authoring run contains selected sessions, complete paginated canonical evidence, canonical dossier context, and nonbinding artifact suggestions. The agent submits required per-session enrichment plus zero or more agent-chosen runbooks, ADRs, or incident timelines. Finish applies enrichment first, rebuilds the original canonical dossier from enriched data, validates all optional artifacts, and publishes the complete accepted result atomically. Candidate V2 data remains audit history but no longer drives UI, capabilities, run opening, or publication.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, SQLite, daemon HTTP API, `mastheadctl`, Electron/Vite.

## Global Constraints

- Do not publish any session dossier until current durable agent enrichment exists for that session.
- Preserve the original `SessionDossierDto` structure and `SessionDossierContent` rendering; do not introduce a second dossier presentation.
- The agent enriches session knowledge; the daemon renders the final dossier snapshot from canonical session data plus that enrichment.
- Optional artifacts are zero-or-more agent decisions. Deterministic signals are suggestions only and cannot gate, require, or select an artifact kind.
- Restore the exact user-facing action name **Copy Agent Prompt**.
- Remove **Author candidate**, the candidate dropdown/band, and **Publish canonical dossiers** from Workbench.
- Logbook remains published-artifact-only; Workbench remains session-selection and agent-handoff.
- MCP remains read-only and artifact-primary.
- Keep evidence pagination, database identity checks, claims, claim support, provenance validation, duplicate detection, atomic finish, and idempotent receipts.
- Retain historical V1/V2 runs and candidate rows for audit. Do not migrate them into V3 and do not delete production data.
- Limit one V3 authoring run to 12 sessions. A copied request may contain more selections; the agent must partition them into bounded runs and complete every selected session exactly once.
- Do not run a full production rehearsal. Verification uses focused fixtures and a small isolated database.

---

## File Structure

### New files

- `docs/adr/0014-agent-led-enriched-artifact-authoring.md` — accepted product and architecture decision superseding candidate-driven authoring portions of ADR 0013.
- `src/workbench/authoring/advisorySuggestions.ts` — read-only adapter that maps existing detector results into explicitly nonbinding agent suggestions without candidate claims or publication semantics.
- `src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts` — end-to-end contract test for enrichment-first dossiers and agent-chosen optional artifacts.
- `src/workbench/authoring/__tests__/authoringSchemas.test.ts` — focused V3 schema/parser tests.

### Primary modified files

- `CONTEXT.md`, `design.md`, `prd.md`, `README.md`, `openwiki/quickstart.md`, `openwiki/logbook-and-workbench.md` — restore the product vocabulary and workflow.
- `src/shared/workbenchAuthoring.ts` — V3 DTOs, capabilities, suggestions, bundles, and receipts.
- `src/workbench/authoring/authoringSchemas.ts` — V3 JSON schema and parser.
- `src/workbench/authoring/authoringValidation.ts` — require grounded enrichment, allow zero-or-more optional artifacts, and remove candidate gating/N/A obligations.
- `src/workbench/authoring/authoringService.ts` — selection-scoped V3 open/submit/finish and enrichment-first dossier publication.
- `src/workbench/authoring/dossierSnapshot.ts` — require current enrichment before producing a publishable dossier snapshot.
- `src/daemon/workbenchAuthoringApi.ts`, `src/cli/workbenchAuthoring.ts`, `src/cli/authoringClient.ts` — expose V3 selection runs and advisory suggestions.
- `src/daemon/server.ts`, `src/app/daemonClient.ts` — remove the standalone canonical-dossier publication endpoint/client.
- `src/app/workbench/useWorkbenchController.ts` — restore selection-driven handoff state and remove candidate loading.
- `src/ui/workbench/workbenchHandoff.ts` — restore a session-selection prompt with exact machine request and advisory language.
- `src/ui/workbench/WorkbenchPanel.tsx`, `src/styles/masthead.css` — restore the Copy Agent Prompt control and delete candidate UI.
- Existing focused tests beside each modified module — lock down the restored contract.

---

### Task 1: Lock the restored product contract

**Files:**
- Create: `docs/adr/0014-agent-led-enriched-artifact-authoring.md`
- Modify: `CONTEXT.md`
- Modify: `design.md`
- Modify: `prd.md`
- Modify: `openwiki/quickstart.md`
- Modify: `openwiki/logbook-and-workbench.md`
- Modify: `src/workbench/__tests__/productContract.test.ts`

**Interfaces:**
- Consumes: ADR 0011's artifact-first Logbook decision and ADR 0013's original dossier/evidence improvements.
- Produces: the authoritative V3 vocabulary used by every later task.

- [ ] **Step 1: Write the failing product-contract test**

Replace candidate-driven assertions in `src/workbench/__tests__/productContract.test.ts` with exact requirements:

```ts
test("documents agent-led enrichment and optional artifact judgment", async () => {
  const paths = [
    "CONTEXT.md",
    "design.md",
    "prd.md",
    "README.md",
    "openwiki/quickstart.md",
    "openwiki/logbook-and-workbench.md",
    "docs/adr/0014-agent-led-enriched-artifact-authoring.md"
  ];
  const activeDocs = (await Promise.all(
    paths.map((path) => readFile(resolve(path), "utf8"))
  )).join("\n");
  const normalized = activeDocs.replace(/\s+/g, " ");

  expect(activeDocs).toContain("Copy Agent Prompt");
  expect(activeDocs).toContain("workbench-authoring-v3");
  expect(activeDocs).toContain("suggestions are nonbinding");
  expect(activeDocs).toContain("nothing enters Logbook until enrichment is current");
  expect(activeDocs).toContain("zero or more optional artifacts");
  expect(activeDocs).toContain("canonical dossier structure");
  expect(normalized).not.toMatch(/Author candidate/i);
  expect(normalized).not.toMatch(/Publish canonical dossiers/i);
  expect(normalized).not.toMatch(/one candidate group/i);
  expect(normalized).not.toMatch(/artifact candidate.*required/i);
});
```

- [ ] **Step 2: Run the product-contract test and confirm it fails**

Run:

```bash
npx vitest run src/workbench/__tests__/productContract.test.ts
```

Expected: FAIL because active docs still require candidate-driven V2 authoring and the current Workbench labels.

- [ ] **Step 3: Write ADR 0014 with explicit responsibility boundaries**

The ADR decision section must state:

```markdown
1. Users select sessions and copy one disposable agent prompt.
2. The agent must enrich each selected session before its dossier can publish.
3. The daemon rebuilds the original canonical dossier after enrichment; agents do not replace its presentation.
4. The agent may create zero or more runbooks, ADRs, or incident timelines from the selected evidence.
5. Deterministic analysis may offer nonbinding suggestions, including canonical-rendering cues, but cannot require or prohibit an artifact kind.
6. V3 finish validates and publishes enrichment-derived dossiers and optional artifacts atomically.
7. V1 and V2 runs remain audit-only and are never reused by V3.
```

Explicitly supersede ADR 0013's independent canonical-dossier publication and candidate-required V2 authoring. Preserve ADR 0013's evidence, claim-support, duplicate-prevention, and original-rendering findings.

- [ ] **Step 4: Update active product language**

Make these exact vocabulary changes across the listed docs:

```text
Copy Agent Prompt = copies a disposable request for the selected sessions.
Artifact suggestion = a nonbinding detector hint supplied privately to the agent.
Agent-led authoring = agent enriches selected sessions and chooses useful artifacts.
Enriched dossier = original canonical dossier structure rendered after current durable enrichment.
Publication = atomic admission of validated enriched artifacts into Logbook.
```

Mark plans under `docs/superpowers/plans/` as implementation history as before; do not make this plan the product source of truth.

- [ ] **Step 5: Run the product-contract test and confirm it passes**

Run:

```bash
npx vitest run src/workbench/__tests__/productContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add docs/adr/0014-agent-led-enriched-artifact-authoring.md CONTEXT.md design.md prd.md openwiki/quickstart.md openwiki/logbook-and-workbench.md src/workbench/__tests__/productContract.test.ts
git commit -m "docs: restore agent-led artifact authoring contract"
```

---

### Task 2: Define the selection-scoped V3 authoring contract

**Files:**
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `src/workbench/authoring/authoringSchemas.ts`
- Modify: `src/workbench/types.ts`
- Modify: `src/workbench/authoring/__tests__/authoringValidation.test.ts`
- Create: `src/workbench/authoring/__tests__/authoringSchemas.test.ts`

**Interfaces:**
- Consumes: `DurableSessionEnrichment`, `WorkbenchArtifactDraft`, and `WorkbenchClaimSupport`.
- Produces: `WorkbenchAuthoringBundleV3`, `WorkbenchArtifactSuggestionDto`, V3 capabilities, and `WorkbenchAuthoringReceiptV3`.

- [ ] **Step 1: Write failing V3 schema tests**

Add tests proving that V3:

```ts
const bundle: WorkbenchAuthoringBundleV3 = {
  bundleVersion: "workbench-authoring-v3",
  runId: "authoring:v3",
  evidenceRevision: "evidence:v3",
  sessionEnrichments: [{
    sessionId: "session:a",
    enrichment: durableEnrichment("Restore agent-led authoring")
  }],
  artifacts: []
};

expect(parseAuthoringBundleV3(bundle)).toEqual(bundle);
expect(() => parseAuthoringBundleV3({ ...bundle, sessionDossiers: [] }))
  .toThrow("unexpected_authoring_bundle_property:sessionDossiers");
expect(() => parseAuthoringBundleV3({ ...bundle, candidateId: "candidate:a" }))
  .toThrow("unexpected_authoring_bundle_property:candidateId");
```

Also test zero optional artifacts, multiple different optional kinds, and rejection of `notApplicable`, `contributions`, and authored dossier bodies.

- [ ] **Step 2: Run the focused schema tests and confirm they fail**

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/authoringSchemas.test.ts src/workbench/authoring/__tests__/authoringValidation.test.ts
```

Expected: FAIL because V3 types and parser do not exist.

- [ ] **Step 3: Add the V3 DTOs**

Add these interfaces to `src/shared/workbenchAuthoring.ts`:

```ts
export type WorkbenchArtifactSuggestionDto = {
  suggestionId: string;
  kind: WorkbenchAutomaticArtifactKind;
  summary: string;
  provenanceSessionIds: string[];
  evidenceRefs: string[];
  signatureKey?: string;
  advisory: true;
};

export type WorkbenchSessionEnrichmentDraft = {
  sessionId: string;
  enrichment: DurableSessionEnrichment;
};

export type WorkbenchAuthoringBundleV3 = {
  bundleVersion: "workbench-authoring-v3";
  runId: string;
  evidenceRevision: string;
  sessionEnrichments: WorkbenchSessionEnrichmentDraft[];
  artifacts: WorkbenchArtifactDraft[];
};

export type WorkbenchAuthoringReceiptV3 = WorkbenchAuthoringReceiptBase & {
  contractVersion: "workbench-authoring-v3";
  dossierArtifactIds: string[];
  optionalArtifacts: Array<{
    artifactId: string;
    kind: WorkbenchAutomaticArtifactKind;
    provenanceSessionIds: string[];
  }>;
};
```

Import `DurableSessionEnrichment` from `src/shared/sessionEnrichment.ts`. Extend stored bundle/run/receipt unions with V3; do not change the serialized shapes of V1 or V2 audit records.

- [ ] **Step 4: Change advertised capabilities to V3**

The current capability branch must become:

```ts
{
  bundleVersion: "workbench-authoring-v3";
  operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"];
  evidencePolicy: "selected_session_canonical_evidence";
  maxSessionsPerRun: 12;
  suggestionsAreBinding: false;
}
```

Keep `protocol: "masthead.workbench.authoring/v1"` stable so installed clients still identify the same transport family.

- [ ] **Step 5: Add the V3 JSON schema and parser**

Implement `getAuthoringBundleV3Schema()` and `parseAuthoringBundleV3()` in `authoringSchemas.ts`. The schema must:

- require one enrichment for each bundle entry;
- allow `artifacts: []`;
- reuse `getWorkbenchAuthoringOutputV2Schema(kind)` so optional artifacts retain verbatim `claimSupport`;
- forbid dossier bodies, candidate IDs, N/A decisions, and contribution decisions;
- reject unknown properties.

- [ ] **Step 6: Run the focused tests**

```bash
npx vitest run src/workbench/authoring/__tests__/authoringSchemas.test.ts src/workbench/authoring/__tests__/authoringValidation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the V3 contract**

```bash
git add src/shared/workbenchAuthoring.ts src/workbench/types.ts src/workbench/authoring/authoringSchemas.ts src/workbench/authoring/__tests__/authoringSchemas.test.ts src/workbench/authoring/__tests__/authoringValidation.test.ts
git commit -m "feat: define selection-scoped authoring v3"
```

---

### Task 3: Convert deterministic candidates into nonbinding suggestions

**Files:**
- Create: `src/workbench/authoring/advisorySuggestions.ts`
- Create: `src/workbench/authoring/__tests__/advisorySuggestions.test.ts`
- Modify: `src/workbench/authoring/artifactCandidates.ts`
- Modify: `src/workbench/authoring/__tests__/artifactCandidates.test.ts`

**Interfaces:**
- Consumes: existing candidate signal extraction and grouping functions.
- Produces: `getArtifactSuggestions(db, sessionIds): WorkbenchArtifactSuggestionDto[]`.

- [ ] **Step 1: Write failing advisory-behavior tests**

Cover all four required behaviors:

```ts
test("maps detector output to explicitly nonbinding suggestions", () => {
  const suggestions = getArtifactSuggestions(db, ["session:fixed"]);
  expect(suggestions[0]).toMatchObject({ kind: "runbook", advisory: true });
});

test("returns no suggestion without positive evidence", () => {
  expect(getArtifactSuggestions(db, ["session:chat-only"])).toEqual([]);
});

test("does not claim, dismiss, or mutate candidate status", () => {
  const before = candidateAuditRows(db);
  getArtifactSuggestions(db, ["session:fixed"]);
  expect(candidateAuditRows(db)).toEqual(before);
});

test("does not prevent an agent-selected kind missing from suggestions", () => {
  const suggestions = getArtifactSuggestions(db, ["session:decision"]);
  expect(suggestions.every((item) => item.kind !== "runbook")).toBe(true);
  expect(validateV3Bundle(agentSelectedRunbookBundle()).ok).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/workbench/authoring/__tests__/advisorySuggestions.test.ts
```

Expected: FAIL because the advisory adapter does not exist.

- [ ] **Step 3: Implement the read-only adapter**

Extract a pure `detectArtifactSuggestionSeeds(db, sessionIds)` function from the current detector's signal extraction/grouping path. Both historical V2 reconciliation and the new adapter may consume those seeds, but the pure function must perform no candidate-table writes. `getArtifactSuggestions` maps the seeds to the new DTO with `advisory: true`; it must not call candidate claim, dismissal, proposal, publication, or reconciliation mutations. Use a stable suggestion ID derived from kind, provenance, signature, and evidence revision solely for deduplication; the ID must never be accepted as an authoring gate.

- [ ] **Step 4: Preserve V2 candidate records as audit-only**

Add module comments and tests declaring that `artifactCandidates.ts` exists for historical V2 audit/recovery. New V3 service and UI imports must not depend on `WorkbenchArtifactCandidateDto`.

- [ ] **Step 5: Run the focused detector tests**

```bash
npx vitest run src/workbench/authoring/__tests__/advisorySuggestions.test.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit advisory suggestions**

```bash
git add src/workbench/authoring/advisorySuggestions.ts src/workbench/authoring/artifactCandidates.ts src/workbench/authoring/__tests__/advisorySuggestions.test.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts
git commit -m "refactor: make artifact detection advisory"
```

---

### Task 4: Validate enrichment-first bundles without candidate gates

**Files:**
- Modify: `src/workbench/authoring/authoringValidation.ts`
- Modify: `src/workbench/authoring/artifactQuality.ts`
- Modify: `src/workbench/authoring/__tests__/authoringValidation.test.ts`
- Modify: `src/workbench/authoring/__tests__/artifactQuality.test.ts`

**Interfaces:**
- Consumes: `WorkbenchAuthoringBundleV3`, canonical evidence indexed by ref, selected run sessions.
- Produces: `validateAuthoringBundleV3(input): WorkbenchAuthoringValidationResult`.

- [ ] **Step 1: Write failing V3 validation tests**

Add assertions for:

```ts
expect(validateV3(validEnrichmentOnlyBundle())).toMatchObject({ ok: true });
expect(codes(validateV3(bundleMissingEnrichment("session:a"))))
  .toContain("missing_session_enrichment");
expect(codes(validateV3(bundleWithUngroundedEnrichment())))
  .toContain("unknown_evidence_ref");
expect(validateV3(bundleWithAgentSelectedArtifactNotSuggested()).ok).toBe(true);
expect(codes(validateV3(bundleWithUnsupportedArtifactClaim())))
  .toContain("unsupported_claim_excerpt");
expect(codes(validateV3(bundleWithWeakMultiSessionJoin())))
  .toContain("weak_join");
expect(codes(validateV3(bundleWithProtocolLeakage())))
  .toContain("authoring_protocol_leakage");
```

Also require exactly one enrichment per selected session and forbid enrichments for sessions outside the run.

- [ ] **Step 2: Run the validation tests and confirm they fail**

```bash
npx vitest run src/workbench/authoring/__tests__/authoringValidation.test.ts src/workbench/authoring/__tests__/artifactQuality.test.ts
```

Expected: FAIL because current validation either requires candidate V2 or legacy N/A resolution.

- [ ] **Step 3: Implement V3 enrichment validation**

Validate `DurableSessionEnrichment` with the existing session-enrichment schema. Every title, summary, and dossier enrichment evidence ref must resolve to canonical evidence in the same session. Require meaningful title/summary quality and preserve sparse-coverage warnings, but do not generate an artifact solely to silence a warning.

- [ ] **Step 4: Reuse optional-artifact quality gates without nomination checks**

For each submitted optional artifact, retain:

- exact selected-session provenance;
- seed-in-provenance;
- verbatim claim support;
- strong multi-session join rationale;
- kind-specific required evidence;
- duplicate/signature checks;
- protocol-leakage checks;
- secret redaction checks.

Delete the condition that an artifact kind must equal a candidate kind or carry a candidate ID. Do not add any replacement detector gate.

- [ ] **Step 5: Run the focused tests**

```bash
npx vitest run src/workbench/authoring/__tests__/authoringValidation.test.ts src/workbench/authoring/__tests__/artifactQuality.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit validation**

```bash
git add src/workbench/authoring/authoringValidation.ts src/workbench/authoring/artifactQuality.ts src/workbench/authoring/__tests__/authoringValidation.test.ts src/workbench/authoring/__tests__/artifactQuality.test.ts
git commit -m "feat: validate agent-led enriched artifact bundles"
```

---

### Task 5: Implement atomic enrichment-first publication

**Files:**
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/workbench/authoring/dossierSnapshot.ts`
- Modify: `src/daemon/db/workbenchAuthoringRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/workbench/authoring/__tests__/authoringService.test.ts`
- Modify: `src/workbench/authoring/__tests__/dossierSnapshot.test.ts`

**Interfaces:**
- Consumes: V3 bundle validated in Task 4.
- Produces: `openAgentLedAuthoringRun`, V3 submit, V3 atomic finish, enriched canonical dossier artifacts.

- [ ] **Step 1: Write failing service tests for the publication invariant**

Add tests proving:

```ts
test("refuses to snapshot a dossier without current durable enrichment", () => {
  expect(() => buildPublishedEnrichedDossierSnapshot(rawDossier))
    .toThrow("session_dossier_requires_current_enrichment");
});

test("applies enrichment before rendering and publishing the original dossier", () => {
  const receipt = finishV3(enrichmentOnlyBundle());
  const body = getPublishedArtifact(receipt.dossierArtifactIds[0]).content;
  expect(body.identity.title).toBe("Agent-enriched title");
  expect(body.durableEnrichment.sessionSummary.text).toBe("Agent-enriched summary");
  expect(body.snapshotVersion).toBe("canonical-session-dossier-v1");
});

test("publishes zero optional artifacts when the agent finds none", () => {
  expect(finishV3(enrichmentOnlyBundle()).optionalArtifacts).toEqual([]);
});

test("publishes agent-selected optional artifacts without a candidate", () => {
  expect(finishV3(bundleWithRunbookAndAdr()).optionalArtifacts.map((item) => item.kind))
    .toEqual(["runbook", "adr"]);
});
```

Also test rollback after each mutation boundary: enrichment apply, dossier creation, optional artifact creation, publication, pipeline update, claim release, activity, and receipt persistence.

Add an audit-compatibility test proving V1/V2 run status remains readable while submit and finish return `authoring_contract_audit_only`; otherwise a historical candidate run could still publish an unenriched dossier through the old path.

- [ ] **Step 2: Run the service tests and confirm they fail**

```bash
npx vitest run src/workbench/authoring/__tests__/authoringService.test.ts src/workbench/authoring/__tests__/dossierSnapshot.test.ts
```

Expected: FAIL because current V2 finish publishes canonical dossiers before agent enrichment and requires one candidate artifact.

- [ ] **Step 3: Implement bounded session-selection runs**

Add:

```ts
export function openAgentLedAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAuthoringRunResult
```

Normalize IDs, require 1–12 unique sessions, verify database identity, require each session on the Workbench publish path, pin the exact evidence revision, and claim the sessions. Idempotently reuse only V3 runs with the same actor, database, session set, and evidence revision. Never reuse V1/V2 runs.

- [ ] **Step 4: Make V3 submit candidate-independent**

`submitAuthoringBundle` must dispatch by run contract version. The V3 branch calls `validateAuthoringBundleV3` with selected sessions and canonical evidence. It must not load or assert a candidate row.

- [ ] **Step 5: Make V3 finish enrichment-first and atomic**

Inside one `withImmediateTransaction`:

```ts
for (const draft of bundle.sessionEnrichments) {
  applySessionEnrichmentInTransaction(db, {
    sessionId: draft.sessionId,
    output: draft.enrichment
  });
}

for (const sessionId of run.sessionIds) {
  const dossier = requireCurrentEnrichedDossier(db, sessionId);
  publishCanonicalDossierSnapshotInTransaction(db, dossier, run.actorId);
}

for (const artifact of bundle.artifacts) {
  applyAndPublishOptionalArtifactInTransaction(db, artifact, run.actorId);
}
```

Then update Workbench states, index Logbook, release claims, record activity, and persist one V3 receipt. A retry returns the identical receipt.

- [ ] **Step 6: Remove independent dossier publication as an active service path**

Delete or make unreachable `publishCanonicalDossiers` as a public Workbench action. Keep only internal helpers used from V3 finish and explicit recovery tooling. Recovery helpers must be clearly named and unavailable through normal UI/API routes.

- [ ] **Step 7: Run service tests**

```bash
npx vitest run src/workbench/authoring/__tests__/authoringService.test.ts src/workbench/authoring/__tests__/dossierSnapshot.test.ts src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit atomic publication**

```bash
git add src/workbench/authoring/authoringService.ts src/workbench/authoring/dossierSnapshot.ts src/daemon/db/workbenchAuthoringRepository.ts src/daemon/db/workbenchPipelineRepository.ts src/workbench/authoring/__tests__/authoringService.test.ts src/workbench/authoring/__tests__/dossierSnapshot.test.ts
git commit -m "feat: publish enriched agent-authored knowledge atomically"
```

---

### Task 6: Restore the agent-facing HTTP and CLI workflow

**Files:**
- Modify: `src/daemon/workbenchAuthoringApi.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Modify: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Modify: `src/cli/__tests__/authoringCli.test.ts`
- Modify: `docs/reference/daemon-api.md`

**Interfaces:**
- Consumes: V3 capabilities, suggestions, run opening, evidence/context, submit, and finish.
- Produces: the stable agent interface referenced by Copy Agent Prompt.

- [ ] **Step 1: Write failing API and CLI tests**

Required behavior:

```ts
expect(capabilities.bundleVersion).toBe("workbench-authoring-v3");
expect(capabilities.suggestionsAreBinding).toBe(false);

await client.open({
  actorId: "agent:test",
  databaseId: "database:test",
  sessionIds: ["session:a", "session:b"]
});

expect(await client.suggestions(["session:a", "session:b"]))
  .toEqual(expect.arrayContaining([expect.objectContaining({ advisory: true })]));
```

The API must reject `candidateId` on V3 open and reject more than 12 session IDs. The CLI help must show repeated `--session` arguments and must not advertise candidate selection.

- [ ] **Step 2: Run focused tests and confirm they fail**

```bash
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts
```

Expected: FAIL because current endpoints require `candidateId`.

- [ ] **Step 3: Advertise the V3 capabilities**

Return the exact V3 capabilities defined in Task 2. Keep the stable protocol and daemon-owned database identity.

- [ ] **Step 4: Add advisory suggestions and canonical context reads**

Expose:

```text
POST /workbench/authoring/suggestions
GET  /workbench/authoring/runs/:runId/context
```

`suggestions` accepts selected session IDs and returns nonbinding `WorkbenchArtifactSuggestionDto[]`. `context` returns the original canonical dossier representation for each run session plus the run's suggestions. Both are read-only and must work through the read-only worktree bridge.

Remove the normal `/workbench/authoring/candidates` and candidate-dismiss routes from `isWorkbenchAuthoringPath`, daemon capabilities, client methods, and CLI help. Historical candidate rows remain in SQLite for audit/recovery; no normal endpoint may trigger candidate discovery or reconciliation.

- [ ] **Step 5: Restore selection-scoped run opening**

`POST /workbench/authoring/runs` accepts:

```json
{
  "actorId": "mastheadctl",
  "databaseId": "database-id",
  "sessionIds": ["session:a", "session:b"]
}
```

Remove the active requirement for `candidateId`. Keep old V2 run reads for audit, but new opens always create V3 runs.

- [ ] **Step 6: Restore CLI session arguments**

The CLI surface becomes:

```text
mastheadctl workbench suggestions --session <id> [--session <id>] --json
mastheadctl workbench open --database-id <id> --session <id> [--session <id>] --json
mastheadctl workbench status --run <run-id> --json
mastheadctl workbench context --run <run-id> --json
mastheadctl workbench evidence --run <run-id> --session <id> ... --json
mastheadctl workbench submit --run <run-id> --file <bundle.json> --json
mastheadctl workbench finish --run <run-id> --json
```

Do not expose terminal recipes in Workbench UI; they remain agent-facing machinery.

- [ ] **Step 7: Run API and CLI tests**

```bash
npx vitest run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/app/__tests__/daemonClient.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit transport changes**

```bash
git add src/daemon/workbenchAuthoringApi.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts docs/reference/daemon-api.md
git commit -m "feat: restore session-selection agent authoring API"
```

---

### Task 7: Restore the simple Workbench handoff UI

**Files:**
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/styles/masthead.css`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`

**Interfaces:**
- Consumes: selected Workbench sessions and V3 capabilities.
- Produces: one `Copy Agent Prompt` action and a disposable session-selection handoff.

- [ ] **Step 1: Write failing UI contract tests**

The rendered panel must satisfy:

```ts
expect(html).toContain("Copy Agent Prompt");
expect(html).not.toContain("Author candidate");
expect(html).not.toContain("Publish canonical dossiers");
expect(html).not.toContain("Artifact candidate");
expect(html).not.toContain("<select");
```

Controller tests must prove that candidate APIs are never called and Copy Agent Prompt is enabled only when the live daemon advertises V3 and at least one compile-ready session is selected.

- [ ] **Step 2: Run focused UI tests and confirm they fail**

```bash
npx vitest run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

Expected: FAIL on the current candidate band and labels.

- [ ] **Step 3: Remove candidate state from the controller**

Delete candidate imports, pagination, loading/error state, selected candidate state, retry logic, and candidate-based `canRun`. Replace actions with:

```ts
export type WorkbenchActionKind =
  | "enroll_missing"
  | "check_transcript"
  | "import_transcript"
  | "quality_pass"
  | "quality_fail"
  | "quality_precheck"
  | "claim"
  | "release"
  | "copy_agent_prompt";
```

`copy_agent_prompt` has no daemon mutation. It records only local feedback: `Agent prompt copied for N sessions`.

- [ ] **Step 4: Restore the selection-scoped handoff**

`buildWorkbenchHandoff` accepts:

```ts
{
  authoringCommand: string;
  databaseId: string;
  sessionIds: string[];
  sessions: WorkbenchQueueSessionDto[];
}
```

The visible prompt must say:

```text
Complete this Masthead Workbench request for every selected session.
Enrich each session before publishing its dossier. Preserve Masthead's canonical dossier structure; improve the underlying title, summary, outcome, decisions, verification, reuse guidance, and other supported enrichment from evidence.
Create only the runbooks, ADRs, or incident timelines that your judgment finds genuinely reusable. Masthead may provide nonbinding suggestions; verify them against the complete canonical evidence, ignore weak suggestions, and create a different supported kind when warranted.
Revise deterministic validation findings until accepted, finish publication, and report the published artifacts.
```

The machine request must contain the stable protocol, V3 bundle version, exact database ID, exact selected session IDs, `maxSessionsPerRun: 12`, and the absolute agent-facing command. When more than 12 sessions are selected, instruct the agent to partition them into bounded runs while preserving related-session groups and completing every selected session exactly once.

- [ ] **Step 5: Restore the Workbench controls**

Replace the primary toolbar controls with:

```tsx
<AppButton
  className="workbench-copy-agent"
  variant="primary"
  onClick={() => run("copy_agent_prompt")}
  disabled={!canRun("copy_agent_prompt")}
  title="Copy a plain-language request for your coding agent to enrich the selected sessions and publish only justified artifacts."
>
  Copy Agent Prompt
</AppButton>
```

Delete the candidate band and canonical-dossier button. Remove their CSS selectors and responsive rules without restyling unrelated Workbench elements.

- [ ] **Step 6: Run focused UI tests**

```bash
npx vitest run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run the surface-contract check**

```bash
npm run check:surface-contract
```

Expected: PASS with no candidate UI or standalone canonical publication control.

- [ ] **Step 8: Commit the restored Workbench**

```bash
git add src/app/workbench/useWorkbenchController.ts src/ui/workbench/workbenchHandoff.ts src/ui/workbench/WorkbenchPanel.tsx src/styles/masthead.css src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
git commit -m "fix: restore Copy Agent Prompt Workbench flow"
```

---

### Task 8: Remove every normal-path unenriched dossier publication route

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/daemon/__tests__/workbenchApi.test.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/acceptance/product-release-gate.md`

**Interfaces:**
- Consumes: V3 finish from Task 5.
- Produces: one normal dossier-publication path, reachable only after agent enrichment.

- [ ] **Step 1: Write failing route-absence and invariant tests**

Add assertions:

```ts
expect(routeTable).not.toContain("POST /workbench/publish-canonical-dossiers");
expect(daemonClientSource).not.toContain("postWorkbenchPublishCanonicalDossiers");

const response = await finishAgentRunWithRawSession();
expect(response.status).toBe(409);
expect(response.body.error.code).toBe("session_enrichment_required");
expect(await searchLogbook("raw session")).toHaveLength(0);
```

- [ ] **Step 2: Run route tests and confirm they fail**

```bash
npx vitest run src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts
```

Expected: FAIL because the standalone canonical publication route/client still exist.

- [ ] **Step 3: Remove the public route and renderer client**

Delete the standalone request parsing, handler, response DTO, and client function. Keep recovery-only publication helpers private to maintenance modules and clearly exclude them from product documentation.

- [ ] **Step 4: Add the release-gate invariant**

`docs/acceptance/product-release-gate.md` must require:

```text
- A raw or merely deterministic session cannot create a Logbook dossier.
- Agent enrichment is applied before the canonical dossier snapshot is rendered.
- Copy Agent Prompt is the only primary authoring control in Workbench.
- Optional artifact kinds are agent-selected; detector suggestions are nonbinding.
```

- [ ] **Step 5: Run route and product-contract tests**

```bash
npx vitest run src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts src/workbench/__tests__/productContract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit route cleanup**

```bash
git add src/daemon/server.ts src/app/daemonClient.ts src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts docs/reference/daemon-api.md docs/acceptance/product-release-gate.md
git commit -m "fix: require enrichment before dossier publication"
```

---

### Task 9: Prove the complete agent-led flow on a focused corpus

**Files:**
- Create: `src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts`
- Modify: `src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts`
- Modify: `src/electron/__tests__/durableArtifactRehearsal.test.ts`
- Modify: `docs/acceptance/durable-artifact-production-canary.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete V3 UI/API/service pipeline.
- Produces: focused release evidence without a production-scale rehearsal.

- [ ] **Step 1: Write the end-to-end acceptance test**

Use four representative sessions:

1. a completed implementation needing enrichment and only a dossier;
2. a verified repeatable recovery supporting a runbook;
3. a material decision with alternatives supporting an ADR;
4. a failure/remediation sequence supporting an incident timeline.

The simulated agent—not the detector—submits one V3 enrichment per session and chooses the three optional artifacts. Assert:

```ts
expect(receipt.dossierArtifactIds).toHaveLength(4);
expect(receipt.optionalArtifacts.map((item) => item.kind).sort()).toEqual([
  "adr",
  "incident_timeline",
  "runbook"
]);
expect(logbookKinds()).toEqual([
  "session_dossier",
  "session_dossier",
  "session_dossier",
  "session_dossier",
  "runbook",
  "adr",
  "incident_timeline"
]);
expect(allDossiersHaveCurrentEnrichment()).toBe(true);
expect(allOptionalClaimsHaveVerbatimSupport()).toBe(true);
```

Add a second case where detector suggestions are deliberately wrong or absent and the agent's evidence-supported artifact still publishes.

- [ ] **Step 2: Run the acceptance test and confirm it fails before final wiring**

```bash
npx vitest run src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts
```

Expected: FAIL until every V3 integration is connected.

- [ ] **Step 3: Complete only missing integration wiring**

Fix imports, DTO dispatch, receipt serialization, Logbook indexing, and pipeline activity needed by the acceptance test. Do not add product features or a model runtime.

- [ ] **Step 4: Run the focused authoring suite**

```bash
npx vitest run \
  src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/workbench/authoring/__tests__/authoringValidation.test.ts \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx \
  src/app/logbook/__tests__/useLogbookController.test.tsx \
  src/mcp/__tests__/retrieval.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run focused static and build checks**

```bash
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm run build
```

Expected: all PASS; the ordinary Vite chunk-size warning is non-blocking.

- [ ] **Step 6: Inspect the app using a small isolated database**

Launch through the repository's supported local launcher against an isolated data directory. Verify only:

- Workbench shows selected sessions and **Copy Agent Prompt**;
- no candidate dropdown or **Publish canonical dossiers** appears;
- the copied prompt contains all selected session IDs and V3 machine request;
- an agent-submitted enrichment-only run publishes the original enriched dossier;
- agent-submitted runbook, ADR, and incident timeline appear in Logbook;
- MCP `search_artifacts` and `get_artifact` retrieve them with provenance.

Do not start the 6.6 GB production rehearsal and do not mutate the production database.

- [ ] **Step 7: Update current operator documentation**

Document the real user flow in `README.md` and the focused canary:

```text
Select sessions → Copy Agent Prompt → give it to the coding agent → agent enriches and authors → Masthead validates and atomically publishes → inspect/reuse in Logbook and MCP.
```

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts src/electron/__tests__/durableArtifactRehearsal.test.ts docs/acceptance/durable-artifact-production-canary.md README.md
git commit -m "test: prove agent-led enriched artifact flow"
```

---

## Final Verification Checklist

- [ ] `rg -n "Author candidate|Publish canonical dossiers|Artifact candidate" src/ui src/app design.md CONTEXT.md openwiki` returns no active product/UI matches.
- [ ] `rg -n "Copy Agent Prompt" src/ui design.md CONTEXT.md openwiki` returns the restored contract and UI.
- [ ] V3 permits an enrichment-only result with zero optional artifacts.
- [ ] V3 permits an evidence-supported artifact that was not suggested by deterministic analysis.
- [ ] V3 rejects missing enrichment for any selected session.
- [ ] V3 rejects authored dossier prose and rebuilds the original dossier after enrichment.
- [ ] V3 rejects unsupported claims, weak joins, protocol leakage, duplicates, and unknown evidence refs.
- [ ] V3 finish is atomic and idempotent.
- [ ] V1/V2 rows remain readable for audit but cannot be reopened as V3.
- [ ] No standalone normal-path canonical dossier publication endpoint remains.
- [ ] Workbench contains one clear authoring action: **Copy Agent Prompt**.
- [ ] Logbook contains only enriched published artifacts.
- [ ] MCP retrieves the published artifacts and provenance read-only.
- [ ] Production data remains untouched.

## Explicit Non-Goals

- Do not embed or launch an LLM inside Masthead.
- Do not replace the clipboard handoff with tasks, assignments, or an internal agent scheduler.
- Do not make the deterministic detector an artifact gate under a new name.
- Do not redesign Logbook, Now, Sources, or Settings.
- Do not migrate or delete historical V1/V2 authoring audit data.
- Do not run another exhaustive production rehearsal as part of this implementation.
