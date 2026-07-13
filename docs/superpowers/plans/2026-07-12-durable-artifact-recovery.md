# Durable Artifact Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original canonical session dossier as the only dossier contract and replace bulk, schema-valid artifact fabrication with a candidate-driven authoring pipeline that publishes grounded, reusable runbooks, ADRs, and incident timelines.

**Architecture:** Session dossiers become daemon-built immutable snapshots of the existing `SessionDossierDto`; agents never write dossier prose. Optional artifacts move to a V2 candidate workflow: the daemon identifies evidence-shaped candidates, one candidate group is authored per run, every substantive claim carries a verbatim evidence excerpt, deterministic gates reject process leakage and template reuse, and publication remains atomic. Existing V1 output is removed from Logbook and V1 runs remain only as audit history.

**Tech Stack:** TypeScript, React, Vitest, SQLite/better-sqlite3, daemon HTTP API, `mastheadctl`, Electron/Vite, Codex in-app Browser.

## Global Constraints

- The original canonical dossier is the product contract: identity, coverage, narrative, files, tools, verification, attention, excerpts, timeline, reuse, usage, and the existing pleasant visual presentation.
- There must be only one user-facing meaning of “session dossier.”
- Agents must not author, summarize, enrich, or replace the dossier body; session enrichment remains on the existing dedicated enrichment path.
- Logbook remains an artifact book; a dossier artifact stores an immutable canonical dossier snapshot with exactly one provenance session.
- Runbooks, ADRs, and incident timelines are published only when positive evidence supports them; absence does not require three agent-written N/A paragraphs per session.
- Every published artifact must be reusable through Logbook search and read-only MCP without reopening the raw transcript for its core knowledge.
- V1 authoring bundles and completed V1 runs must never be reused by V2.
- No mass publication may resume until the fixture gate and production canary gate both pass.
- All recovery commands default to dry-run and preserve exactly one database backup, per repository disk-hygiene policy.
- UI work must follow `design.md`, use temporary `DevCite` wrappers while inspecting, remove them before completion, and pass desktop/tablet/narrow surface checks in the in-app Browser.
- Do not add a native Masthead model dependency; authoring remains harness-neutral.

---

## Definition of done

1. A published dossier’s body is a versioned snapshot of the original canonical dossier, excluding only recursive artifact listings, and Logbook renders the original dossier content/presentation.
2. A V2 agent bundle cannot contain a dossier body.
3. Artifact discovery produces explicit `runbook`, `adr`, and `incident_timeline` candidates from positive canonical evidence.
4. One V2 run authors one candidate group with at most 12 provenance sessions; arbitrary 20-session authoring runs are rejected.
5. Every substantive artifact claim includes a verbatim supporting excerpt that the daemon verifies against canonical evidence.
6. Unsupported authoring-protocol language and cross-session template reuse are rejected before publication.
7. The 1,283 failed dossiers disappear from Logbook, their V1 runs remain auditable, and their sessions are eligible for V2 dossier publication and candidate discovery.
8. The curated fixture corpus produces the expected kind mix, and a 25-session production canary earns a median human usefulness score of at least 4/5 with no stop-condition violations.
9. Known Logbook and MCP queries retrieve the correct fixture artifact in the top five results, and reuse tasks can be completed from the artifact body alone.

## File and module map

### New files

- `src/workbench/authoring/dossierSnapshot.ts` — converts the canonical `SessionDossierDto` into a stable, non-recursive published snapshot.
- `src/workbench/authoring/artifactCandidates.ts` — extracts positive kind signals and groups candidates by strong join keys.
- `src/workbench/authoring/artifactQuality.ts` — excerpt verification, protocol-leak detection, and duplicate-content detection.
- `src/workbench/authoring/__tests__/dossierSnapshot.test.ts` — snapshot fidelity and immutability tests.
- `src/workbench/authoring/__tests__/artifactCandidates.test.ts` — kind discovery and strong-join tests.
- `src/workbench/authoring/__tests__/artifactQuality.test.ts` — production-regression rejection tests.
- `src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts` — curated mixed-kind evidence corpus and expected outcomes.
- `src/workbench/__tests__/productContract.test.ts` — guards the one-dossier and candidate-driven product contract.
- `src/daemon/db/migrations/022_workbench_authoring_v2.sql` — immutable V2 contract-version and candidate-id columns on authoring runs (migration 021 already exists as artifact body search).
- `src/daemon/db/migrations/023_workbench_artifact_candidates.sql` — candidate and incremental scan persistence; migration 022 is never edited after Task 3.
- `src/daemon/db/workbenchArtifactCandidateRepository.ts` — candidate persistence and status transitions.
- `src/ui/session-dossier/SessionDossierContent.tsx` — the existing dossier reading experience without modal shell ownership.
- `scripts/dogfood-durable-artifacts.js` — fixture/canary acceptance harness.

### Major modifications

- `src/shared/sessionDossier.ts` — add the published canonical snapshot type.
- `src/shared/workbenchAuthoring.ts` — V2 bundle, candidate, claim-support, receipt, and capability types.
- `src/daemon/db/sessionDossierRepository.ts` — expose snapshot-safe canonical dossier construction.
- `src/daemon/db/sessionArtifactRepository.ts` — canonical dossier capsule fields, stable fingerprinting, and searchable body projection.
- `src/workbench/authoring/authoringSchemas.ts` — remove agent-authored dossier schema; add V2 candidate bundle schema.
- `src/workbench/authoring/authoringValidation.ts` — validate candidate ownership, excerpts, positive evidence, and uniqueness.
- `src/workbench/authoring/authoringService.ts` — V2 open/submit/finish and daemon-built dossier publication.
- `src/daemon/db/workbenchAuthoringRepository.ts` — scope reusable runs by contract version and candidate id.
- `src/daemon/workbenchAuthoringApi.ts`, `src/daemon/server.ts` — candidate and V2 authoring routes.
- `src/cli/authoringClient.ts`, `src/cli/workbenchAuthoring.ts` — `candidates`, V2 `open`, `submit`, `finish`, and recovery commands.
- `src/ui/workbench/workbenchHandoff.ts`, `src/ui/workbench/WorkbenchPanel.tsx` — candidate-sized handoff and visible candidate status.
- `src/ui/session-dossier/SessionDossier.tsx` — retain modal shell and delegate body rendering.
- `src/ui/logbook/LogbookInspector.tsx` — render dossier artifacts through shared dossier content.
- `src/daemon/db/sessionArtifactRepository.ts`, `src/cli/workbenchMaintenance.ts` — V1 recovery audit/invalidation/reset.
- `CONTEXT.md`, `design.md`, `openwiki/logbook-and-workbench.md`, `docs/reference/session-dossier.md`, `docs/reference/daemon-api.md`, `docs/reference/mcp-tools.md` — one dossier contract and V2 authoring workflow.

## Phase gates

- **Gate A — canonical dossier vertical slice (Tasks 1–5):** one fixture session publishes an idempotent canonical snapshot, produces human capsule/search fields, is retrievable by a body-only query, and renders through the original dossier presentation. Do not begin candidate authoring until this passes.
- **Gate B — reusable optional artifact slice (Tasks 6–10):** the labeled corpus produces the expected candidates; one runbook, ADR, and incident timeline each pass support validation, publish atomically, and are found through Logbook. Do not build recovery tooling until this passes.
- **Gate C — recovery readiness (Tasks 11–13):** the failed-generation audit, consistent backup, invalidation, complete acceptance harness, docs, and full repository verification pass on fixtures. Do not touch production until this passes.
- **Gate D — production rollout (Task 14):** temporary-database rehearsal and the 25-session canary pass every machine and human stop condition before bounded waves begin.

---

### Task 1: Lock the corrected product contract in an ADR and contract tests

**Files:**
- Create: `docs/adr/0013-canonical-dossier-and-candidate-authoring.md`
- Modify: `CONTEXT.md`
- Modify: `openwiki/logbook-and-workbench.md`
- Test: `src/workbench/__tests__/productContract.test.ts`

**Interfaces:**
- Produces: the terms `canonical dossier snapshot`, `artifact candidate`, `candidate group`, `claim support`, and `authoring contract V2`.
- Produces: contract assertions used by every later task.

- [ ] **Step 1: Write the failing contract test**

```ts
test("documents one canonical dossier and candidate-driven optional artifacts", async () => {
  const context = await readFile(resolve("CONTEXT.md"), "utf8");
  expect(context).toContain("Agents never author a session dossier body");
  expect(context).toContain("A dossier artifact is an immutable canonical dossier snapshot");
  expect(context).toContain("Optional artifact work begins from a positive-evidence artifact candidate");
  expect(context).not.toContain("exactly one published/N/A/contributed resolution path for every runbook");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run src/workbench/__tests__/productContract.test.ts`

Expected: FAIL because the current contract still makes agents author dossier bodies and resolve three optional obligations per session.

- [ ] **Step 3: Write ADR 0013 and update canonical vocabulary**

The ADR must make these decisions explicitly:

```text
1. getSessionDossier() remains the semantic and visual source of truth.
2. Publication snapshots that dossier; it does not ask an agent to recreate it.
3. Optional artifact work starts from positive evidence candidates, not per-session N/A obligations.
4. A V2 authoring run owns one candidate group.
5. Claims require daemon-verifiable verbatim support.
6. V1 data is invalidated and V1 runs are audit-only.
```

- [ ] **Step 4: Run the contract test**

Run: `npm test -- --run src/workbench/__tests__/productContract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0013-canonical-dossier-and-candidate-authoring.md CONTEXT.md openwiki/logbook-and-workbench.md src/workbench/__tests__/productContract.test.ts
git commit -m "docs: define canonical dossier artifact recovery"
```

---

### Task 2: Define and build the canonical published dossier snapshot

**Files:**
- Create: `src/workbench/authoring/dossierSnapshot.ts`
- Create: `src/workbench/authoring/__tests__/dossierSnapshot.test.ts`
- Modify: `src/shared/sessionDossier.ts`
- Modify: `src/daemon/db/sessionDossierRepository.ts`

**Interfaces:**
- Consumes: `getSessionDossier(db, sessionId): SessionDossierDto | undefined`.
- Produces: `PublishedSessionDossierV1`.
- Produces: `ReadableSessionDossier = Omit<SessionDossierDto, "artifacts"> & { artifacts?: SessionDossierArtifact[] }` so the shared renderer accepts both a live dossier and a non-recursive published snapshot without a cast.
- Produces: `buildPublishedDossierSnapshot(dossier: SessionDossierDto): PublishedSessionDossierV1`.
- Produces: `dossierSnapshotFingerprint(snapshot): string`, excluding only `capturedAt`.
- Produces: `dossierEvidenceRefs(snapshot): string[]`, collecting the canonical refs already present in narrative, attention, excerpts, files, tools, and timeline entries.

- [ ] **Step 1: Add the failing fidelity test**

```ts
test("published dossier preserves every original human-facing section", () => {
  const canonical = fixtureSessionDossier();
  const snapshot = buildPublishedDossierSnapshot(canonical);

  expect(snapshot).toMatchObject({
    identity: canonical.identity,
    coverage: canonical.coverage,
    narrative: canonical.narrative,
    files: canonical.files,
    tools: canonical.tools,
    verification: canonical.verification,
    attention: canonical.attention,
    excerpts: canonical.excerpts,
    timeline: canonical.timeline,
    reuse: canonical.reuse,
    usage: canonical.usage
  });
  expect(snapshot).not.toHaveProperty("artifacts");
  expect(snapshot.snapshotVersion).toBe("canonical-session-dossier-v1");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run src/workbench/authoring/__tests__/dossierSnapshot.test.ts`

Expected: FAIL because the snapshot type and builder do not exist.

- [ ] **Step 3: Add the stable snapshot type**

```ts
export type PublishedSessionDossierV1 = Omit<SessionDossierDto, "artifacts"> & {
  snapshotVersion: "canonical-session-dossier-v1";
  capturedAt: string;
};

export type ReadableSessionDossier = Omit<SessionDossierDto, "artifacts"> & {
  artifacts?: SessionDossierArtifact[];
};
```

- [ ] **Step 4: Implement a deep, non-recursive snapshot**

```ts
export function buildPublishedDossierSnapshot(
  dossier: SessionDossierDto,
  capturedAt = new Date().toISOString()
): PublishedSessionDossierV1 {
  const { artifacts: _artifacts, ...canonical } = structuredClone(dossier);
  return {
    ...canonical,
    capturedAt,
    snapshotVersion: "canonical-session-dossier-v1"
  };
}
```

Add tests proving mutation of the source DTO after construction cannot mutate the snapshot and that JSON round-tripping preserves it.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/dossierSnapshot.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/sessionDossier.ts src/daemon/db/sessionDossierRepository.ts src/workbench/authoring/dossierSnapshot.ts src/workbench/authoring/__tests__/dossierSnapshot.test.ts
git commit -m "feat: snapshot the canonical session dossier"
```

---

### Task 3: Introduce authoring contract V2 and remove agent-authored dossiers

**Files:**
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `src/workbench/authoring/authoringSchemas.ts`
- Modify: `src/workbench/authoring/__tests__/authoringValidation.test.ts`
- Modify: `src/daemon/db/workbenchAuthoringRepository.ts`
- Create: `src/daemon/db/migrations/022_workbench_authoring_v2.sql`
- Modify: `src/daemon/db/schema.ts`
- Test: `src/daemon/db/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `WorkbenchAuthoringBundleV2`, containing `candidateId` and exactly one optional artifact draft.
- Produces: `WorkbenchAuthoringRunDto.contractVersion: "workbench-authoring-v2"` and `candidateId`.

- [ ] **Step 1: Write schema tests that reject dossier prose**

```ts
test("V2 bundles cannot contain an agent-authored dossier", () => {
  const bundle = validV2Bundle();
  (bundle as Record<string, unknown>).sessionPackages = [{ dossier: { title: "fake" } }];
  expect(validateSchema(bundle).find((finding) => finding.path === "sessionPackages")).toBeDefined();
});

test("V1 bundles are not accepted by V2 submit", () => {
  expect(() => parseAuthoringBundleV2(validV1Bundle())).toThrow("unsupported_authoring_bundle_version");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringValidation.test.ts src/daemon/db/__tests__/schema.test.ts`

Expected: FAIL because only V1 exists.

- [ ] **Step 3: Define the V2 bundle**

```ts
export type WorkbenchClaimSupport = {
  path: string;
  evidenceRef: string;
  excerpt: string;
  supportKind:
    | "problem"
    | "decision"
    | "alternative"
    | "change"
    | "verification"
    | "timeline"
    | "remediation"
    | "root_cause";
};

export type WorkbenchAuthoringBundleV2 = {
  bundleVersion: "workbench-authoring-v2";
  runId: string;
  candidateId: string;
  evidenceRevision: string;
  artifact: WorkbenchArtifactDraft;
};
```

Do not retain `sessionPackages`, `dossier`, `enrichments`, `notApplicable`, or `contributions` in V2. The artifact-authoring agent has no write path into the canonical dossier or session enrichment.

- [ ] **Step 4: Persist contract and candidate identity**

Migration 022 must add non-null defaults for existing rows while keeping V1 audit history:

```sql
ALTER TABLE workbench_authoring_runs
  ADD COLUMN contract_version TEXT NOT NULL DEFAULT 'workbench-authoring-v1';
ALTER TABLE workbench_authoring_runs
  ADD COLUMN candidate_id TEXT;
CREATE INDEX idx_workbench_authoring_run_contract_candidate
  ON workbench_authoring_runs(contract_version, candidate_id, status, updated_at DESC);
```

Change run reuse to match `actor_id`, exact sessions, `contract_version`, and `candidate_id`. A V2 open must never return a V1 completed receipt.

Migration 022 is complete and immutable at the end of this task. Later tasks must add a new numbered migration rather than editing 022 after any developer database could have applied it.

- [ ] **Step 5: Run schema and validation tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringValidation.test.ts src/daemon/db/__tests__/schema.test.ts src/daemon/db/__tests__/workbenchAuthoringRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/workbenchAuthoring.ts src/workbench/authoring/authoringSchemas.ts src/workbench/authoring/__tests__/authoringValidation.test.ts src/daemon/db/workbenchAuthoringRepository.ts src/daemon/db/migrations/022_workbench_authoring_v2.sql src/daemon/db/schema.ts src/daemon/db/__tests__/schema.test.ts
git commit -m "feat: define candidate-scoped authoring v2"
```

---

### Task 4: Publish canonical dossiers through a daemon-owned service

**Files:**
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/workbench/authoring/__tests__/authoringService.test.ts`
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/workbenchApi.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Test: `src/daemon/__tests__/workbenchApi.test.ts`

**Interfaces:**
- Consumes: `buildPublishedDossierSnapshot()` from Task 2.
- Produces: `publishCanonicalDossierInTransaction(db, sessionId, actorId)`.
- Produces: `publishCanonicalDossiers(db, sessionIds, actorId)` for dossier-only publication in batches of at most 100 sessions.
- Produces: `CanonicalDossierPublicationReceipt = { artifactIds: string[]; sessionIds: string[] }`.
- Produces: `canonicalDossierCapsule(snapshot)` with a human title, narrative summary, verification/attention highlight, confidence, and project.
- Produces: `canonicalDossierSearchText(snapshot)` covering narrative, topics, technologies, files, tools, verification, attention, and bounded excerpts.
- Produces: a `session_dossier` artifact with schema version `canonical-session-dossier-v1`.

- [ ] **Step 1: Write the failing transaction test**

```ts
test("finish publishes the canonical dossier without accepting dossier prose", async () => {
  const run = openV2RunForFixtureCandidate(db, "candidate:runbook:oauth");
  submitValidV2Bundle(db, run);
  const receipt = finishAuthoringRun(db, { runId: run.runId });
  const dossier = listSessionArtifacts(db, {
    kind: "session_dossier",
    sessionId: "session:oauth"
  })[0]!;

  expect(dossier.schemaVersion).toBe("canonical-session-dossier-v1");
  expect(omitCapturedAt(dossier.content)).toEqual(
    omitCapturedAt(buildPublishedDossierSnapshot(getSessionDossier(db, "session:oauth")!))
  );
  expect(receipt.publishedArtifactIds).toContain(dossier.artifactId);
  expect(dossier.summary).toBe("OAuth callback routing was repaired and verified.");
  expect(dossier.highlight).toBe("Verification passed");
  expect(searchLogbookArtifacts(db, { query: "callback state mismatch" }).artifacts[0]?.artifactId)
    .toBe(dossier.artifactId);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringService.test.ts`

Expected: FAIL because finish still publishes `sessionPackage.dossier`.

- [ ] **Step 3: Replace agent dossier application**

```ts
function publishCanonicalDossierInTransaction(
  db: MastheadDatabase,
  sessionId: string,
  actorId: string
): SessionArtifactRecord {
  const canonical = getSessionDossier(db, sessionId);
  if (!canonical) throw new Error(`canonical_dossier_missing:${sessionId}`);
  const snapshot = buildPublishedDossierSnapshot(canonical);
  const capsule = canonicalDossierCapsule(snapshot);
  return applySessionArtifactInTransaction(db, {
    artifactKind: "session_dossier",
    content: snapshot,
    contentFingerprint: dossierSnapshotFingerprint(snapshot),
    createdBy: `workbench_authoring_v2:${actorId}`,
    evidenceRefs: dossierEvidenceRefs(snapshot),
    confidence: capsule.confidence,
    highlight: capsule.highlight,
    projectLabel: capsule.project,
    provenanceSessionIds: [sessionId],
    schemaVersion: snapshot.snapshotVersion,
    sessionId,
    summary: capsule.summary,
    title: capsule.title
  });
}
```

Do not apply agent-authored enrichment. Build the snapshot from the current canonical dossier exactly as the dedicated enrichment system has produced it.

Derive capsule fields from the original dossier's human narrative, never from evidence counts or authoring mechanics:

```ts
export function canonicalDossierCapsule(snapshot: PublishedSessionDossierV1) {
  return {
    title: snapshot.identity.title,
    summary:
      snapshot.durableEnrichment?.sessionSummary.text ??
      snapshot.narrative.finalAssistantMessage ??
      snapshot.narrative.outcome ??
      snapshot.narrative.objective ??
      snapshot.identity.title,
    highlight: snapshot.attention[0]?.title ?? snapshot.verification.summary,
    confidence:
      snapshot.durableEnrichment?.sessionSummary.confidence ??
      ({ authoritative: "high", inferred: "medium", heuristic: "low" } as const)[snapshot.identity.sourceConfidence],
    project: snapshot.identity.project
  };
}
```

Add a daemon-owned dossier-only operation used by Workbench and recovery:

```ts
export function publishCanonicalDossiers(
  db: MastheadDatabase,
  input: { actorId: string; sessionIds: string[] }
): CanonicalDossierPublicationReceipt {
  if (input.sessionIds.length > 100) throw new Error("canonical_dossier_batch_too_large");
  return withImmediateTransaction(db, () => ({
    artifactIds: input.sessionIds.map((sessionId) =>
      publishCanonicalDossierInTransaction(db, sessionId, input.actorId).artifactId
    ),
    sessionIds: [...input.sessionIds]
  }));
}
```

Use `dossierSnapshotFingerprint(snapshot)` to exclude only `capturedAt` from the content fingerprint. Re-publishing unchanged canonical content must reuse or supersede deterministically instead of creating churn solely because wall-clock time changed.

Do not rely on generic JSON fallback for dossier discoverability. Extend `indexSessionArtifactSearch()` to detect `canonical-session-dossier-v1` and index `canonicalDossierSearchText(snapshot)` as the FTS body. Add repository tests for title-only, narrative-only, file-path, tool-name, verification, and attention queries.

```ts
export function canonicalDossierSearchText(snapshot: PublishedSessionDossierV1): string {
  return [
    snapshot.identity.title,
    snapshot.identity.project,
    snapshot.identity.branch,
    snapshot.narrative.objective,
    snapshot.narrative.outcome,
    snapshot.durableEnrichment?.sessionSummary.text,
    ...(snapshot.narrative.topics ?? []),
    ...(snapshot.narrative.technologies ?? []),
    ...snapshot.files.flatMap((file) => [file.displayPath, file.basename, file.effectKind]),
    ...snapshot.tools.flatMap((tool) => [tool.toolName, tool.status, tool.outputPreview]),
    snapshot.verification.summary,
    ...snapshot.attention.flatMap((item) => [item.title, item.detail]),
    ...snapshot.excerpts.map((excerpt) => excerpt.text)
  ].filter((value): value is string => Boolean(value?.trim())).join("\n").slice(0, 256_000);
}
```

- [ ] **Step 4: Prove idempotence and rollback**

Add tests that a finish retry returns the original receipt, unchanged snapshots have a stable fingerprint, the dossier-only batch is atomic, and an optional-artifact publication failure leaves neither dossier nor optional artifact partially applied.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringService.test.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/__tests__/workbenchApi.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/authoring/authoringService.ts src/workbench/authoring/__tests__/authoringService.test.ts src/daemon/db/sessionArtifactRepository.ts src/daemon/workbenchApi.ts src/daemon/server.ts src/app/daemonClient.ts src/daemon/__tests__/workbenchApi.test.ts
git commit -m "feat: publish canonical dossiers in authoring finish"
```

---

### Task 5: Reuse the original dossier presentation in Logbook

**Files:**
- Create: `src/ui/session-dossier/SessionDossierContent.tsx`
- Modify: `src/ui/session-dossier/SessionDossier.tsx`
- Modify: `src/ui/logbook/LogbookInspector.tsx`
- Modify: `src/app/logbook/logbookInspectorModel.ts`
- Modify: `src/app/logbook/useLogbookController.ts`
- Modify: `src/app/daemonClient.ts`
- Test: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
- Test: `src/ui/logbook/__tests__/LogbookInspector.test.tsx`
- Test: `src/app/logbook/__tests__/useLogbookController.test.tsx`

**Interfaces:**
- Produces: `SessionDossierContent({ dossier: ReadableSessionDossier, transcript?, compactShell? })`.
- Consumes: `PublishedSessionDossierV1` as a structurally compatible canonical dossier snapshot.
- Consumes: the single provenance session id to load transcript evidence through the existing read-only transcript endpoint; transcript rows remain provenance evidence rather than being duplicated into the immutable artifact body.

- [ ] **Step 1: Write a failing shared-render test**

```tsx
test("Logbook dossier artifacts render the original dossier sections", () => {
  render(<LogbookInspector artifact={canonicalDossierArtifact()} onClose={() => {}} />);
  expect(screen.getByText("Transcript evidence")).toBeVisible();
  expect(screen.getByText("Needs attention")).toBeVisible();
  expect(screen.getByText("Tools")).toBeVisible();
  expect(screen.getByText("Timeline")).toBeVisible();
  expect(screen.queryByText("Cursor pagination")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/logbook/__tests__/LogbookInspector.test.tsx src/app/logbook/__tests__/useLogbookController.test.tsx`

Expected: FAIL because Logbook renders the replacement prose-field inspector.

- [ ] **Step 3: Extract content without redesigning it**

Move the original dossier header/body/sections into `SessionDossierContent`. Keep `SessionDossier` responsible only for stage, modal, close behavior, and live transcript loading. The related-artifacts subsection renders only when `dossier.artifacts` is present, avoiding recursive artifact snapshots without casting or changing the rest of the design. Render `SessionDossierContent` directly for `canonical-session-dossier-v1` artifacts.

```tsx
if (artifact.kind === "session_dossier" && isPublishedSessionDossierV1(artifact.body)) {
  return (
    <SessionDossierContent
      dossier={artifact.body}
      transcript={artifact.provenanceTranscript}
      compactShell
    />
  );
}
```

Load the transcript from the dossier artifact's only provenance session using the existing paginated read-only route. Delete the replacement `Problem / Approach / Key decisions / Lessons learned` branch for V2 dossiers. Keep a clearly labeled legacy fallback only for pre-V2 data during recovery.

- [ ] **Step 4: Run component tests**

Run: `npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/logbook/__tests__/LogbookInspector.test.tsx src/app/logbook/__tests__/useLogbookController.test.tsx`

Expected: PASS.

- [ ] **Step 5: Inspect the affected surfaces**

Add temporary `<DevCite name="CanonicalDossierContent">`, run Masthead on a non-conflicting UI port, and inspect Logbook dossier detail at desktop, tablet, and narrow mobile widths with the in-app Browser. Remove the wrapper and run:

Run: `npm run verify:no-citations`

Expected: PASS with no citation markers.

- [ ] **Step 6: Commit**

```bash
git add src/ui/session-dossier/SessionDossierContent.tsx src/ui/session-dossier/SessionDossier.tsx src/ui/logbook/LogbookInspector.tsx src/app/logbook/logbookInspectorModel.ts src/app/logbook/useLogbookController.ts src/app/daemonClient.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/logbook/__tests__/LogbookInspector.test.tsx src/app/logbook/__tests__/useLogbookController.test.tsx
git commit -m "fix: restore the original dossier in Logbook"
```

---

### Task 6: Discover positive-evidence artifact candidates

**Files:**
- Create: `src/workbench/authoring/artifactCandidates.ts`
- Create: `src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts`
- Create: `src/workbench/authoring/__tests__/artifactCandidates.test.ts`
- Create: `src/daemon/db/workbenchArtifactCandidateRepository.ts`
- Create: `src/daemon/db/migrations/023_workbench_artifact_candidates.sql`
- Modify: `src/daemon/db/schema.ts`
- Test: `src/daemon/db/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `discoverArtifactCandidates(db, sessionIds): WorkbenchArtifactCandidate[]`.
- Produces: `discoverArtifactCandidatePage(db, { afterSessionId, limit }): { candidates; scannedSessionIds; nextCursor }`, limited to 100 publish-path sessions and skipping sessions whose evidence revision is already scanned.
- Produces: `proposeArtifactCandidate(db, proposal)` for directed-agent or human nominations backed by positive evidence refs.
- Produces: `WorkbenchArtifactCandidate` with `candidateId`, `kind`, `seedSessionId`, `provenanceSessionIds`, `signalEvidenceRefs`, `signalSummary`, `signatureKey?`, and `status`.

- [ ] **Step 1: Build a curated fixture corpus**

Include twelve deterministic sessions:

```ts
export const durableArtifactCorpus = [
  dossierOnlyQuestion,
  dossierOnlySparseSession,
  oauthFailureFixedAndVerified,
  databaseMigrationFailureFixedAndVerified,
  explicitArchitectureDecision,
  decisionWithRejectedAlternatives,
  productionIncidentWithRootCause,
  incidentWithoutProvenRootCause,
  repeatedErrorPartOne,
  repeatedErrorPartTwo,
  mastheadAuthoringDiscussion,
  veryLargeNoisySession
] as const;
```

Expected candidates: two runbooks, two ADRs, two incident timelines, and one combined-provenance repeated-error runbook candidate. The two dossier-only sessions must produce no optional candidate.

- [ ] **Step 2: Write failing discovery tests**

```ts
test("discovers optional work only from positive kind signals", () => {
  seedDurableArtifactCorpus(db);
  const candidates = discoverArtifactCandidates(db, corpusSessionIds());
  expect(countKinds(candidates)).toEqual({ runbook: 3, adr: 2, incident_timeline: 2 });
  expect(candidates.some((candidate) => candidate.seedSessionId === dossierOnlyQuestion.id)).toBe(false);
});

test("combines only sessions sharing a strong normalized signature", () => {
  const repeated = discoverArtifactCandidates(db, corpusSessionIds())
    .find((candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found");
  expect(repeated?.provenanceSessionIds).toEqual([repeatedErrorPartOne.id, repeatedErrorPartTwo.id]);
});

test("candidate discovery resumes without rescanning unchanged sessions", () => {
  const first = discoverArtifactCandidatePage(db, { limit: 100 });
  const second = discoverArtifactCandidatePage(db, { afterSessionId: first.nextCursor, limit: 100 });
  expect(second.scannedSessionIds).not.toEqual(expect.arrayContaining(first.scannedSessionIds));
  expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([]);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --run src/workbench/authoring/__tests__/artifactCandidates.test.ts`

Expected: FAIL because discovery does not exist.

- [ ] **Step 4: Implement conservative signal extraction**

Use canonical structured facts before text heuristics:

```ts
const runbookReady = signals.hasFailure && signals.hasChange && signals.hasLaterPassedVerification;
const incidentReady = signals.hasFailure && signals.timelineEventCount >= 3;
const adrReady = signals.explicitDecisionRefs.length > 0 && signals.alternativeRefs.length > 0;
```

Text matches may nominate a candidate but must attach the exact evidence refs that triggered it. Multi-session grouping is allowed only for equal normalized error/decision signatures; project, topic, time, or generic file overlap never joins by itself.

Discovery must be incremental and bounded: scan at most 100 publish-path sessions per call, persist each session's evidence revision, and rescan only when that revision changes. Add a performance fixture with 100 tool-heavy sessions; the page must complete within two seconds on the test runner after database setup.

Add proposal validation so a directed agent can recover a candidate missed by deterministic discovery. A proposal must name one kind, 1–12 provenance sessions, and kind-specific positive signal refs; it may not create a candidate from a reason alone.

- [ ] **Step 5: Persist candidate lifecycle**

Migration 023 adds `workbench_artifact_candidates` with statuses `pending`, `claimed`, `published`, `dismissed`, and `superseded`, plus a `workbench_artifact_candidate_scans` cursor keyed by database evidence revision. Enforce one current candidate per `kind + signature_key`, while candidates without a signature remain session-scoped. Dismissal is candidate-specific and must cite the positive signal refs plus a concrete reason; it is measured as candidate precision, not copied onto each session as three N/A records.

- [ ] **Step 6: Run discovery and repository tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/artifactCandidates.test.ts src/daemon/db/__tests__/schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/authoring/artifactCandidates.ts src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts src/workbench/authoring/__tests__/artifactCandidates.test.ts src/daemon/db/workbenchArtifactCandidateRepository.ts src/daemon/db/migrations/023_workbench_artifact_candidates.sql src/daemon/db/schema.ts src/daemon/db/__tests__/schema.test.ts
git commit -m "feat: discover evidence-shaped artifact candidates"
```

---

### Task 7: Add candidate APIs, CLI discovery, and evidence-sized runs

**Files:**
- Modify: `src/shared/workbenchAuthoring.ts`
- Modify: `src/daemon/workbenchAuthoringApi.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/cli/authoringClient.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Test: `src/daemon/__tests__/workbenchAuthoringApi.test.ts`
- Test: `src/cli/__tests__/authoringCli.test.ts`

**Interfaces:**
- Produces: paginated `GET /workbench/authoring/candidates?status=pending&kind=...&cursor=...&limit=...` with a maximum page size of 100.
- Produces: `POST /workbench/authoring/candidates` for validated directed proposals.
- Produces: `POST /workbench/authoring/candidates/:id/dismiss` for evidence-specific false-positive dismissal.
- Produces: `mastheadctl workbench candidates --kind runbook --json` (with `adr` and `incident_timeline` accepted by the same option).
- Changes: V2 `open` accepts exactly one `candidateId` and derives its sessions server-side.

- [ ] **Step 1: Write failing API/CLI tests**

```ts
test("opens one candidate group and rejects arbitrary session batches", async () => {
  const candidate = await getJson(baseUrl, "/workbench/authoring/candidates?status=pending");
  const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
    actorId: "codex",
    databaseId,
    candidateId: candidate.candidates[0].candidateId
  });
  expect(opened.body.run.sessionIds).toEqual(candidate.candidates[0].provenanceSessionIds);

  const legacy = await postJson(baseUrl, "/workbench/authoring/runs", {
    actorId: "codex",
    databaseId,
    sessionIds: Array.from({ length: 20 }, (_, index) => `session:${index}`)
  });
  expect(legacy.status).toBe(400);
  expect(legacy.body.code).toBe("candidate_id_required");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts`

Expected: FAIL because candidates are not exposed and open is session-list based.

- [ ] **Step 3: Implement candidate-scoped operations**

Capabilities become:

```ts
operations: ["candidates", "open", "status", "evidence", "submit", "finish"]
bundleVersion: "workbench-authoring-v2"
```

`open` must load provenance from the candidate repository, reject more than 12 sessions, claim that candidate, then claim only those sessions. Proposal and dismissal routes must reuse the same positive-signal validation as automatic discovery.

- [ ] **Step 4: Remove ceremonial full-corpus reading**

Keep the complete manifest visible, but make evidence requirements kind-specific:

```ts
evidenceRequirements: {
  runbook: ["problem", "change", "verification"],
  adr: ["context", "decision", "alternatives"],
  incident_timeline: ["symptom", "ordered_events", "remediation"]
}
```

The agent may query any canonical evidence page, but the handoff must not claim it can meaningfully read 100,000 items. Validation checks required evidence classes and claim excerpts instead.

- [ ] **Step 5: Run API/CLI tests**

Run: `npm test -- --run src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/workbenchAuthoring.ts src/daemon/workbenchAuthoringApi.ts src/daemon/server.ts src/cli/authoringClient.ts src/cli/workbenchAuthoring.ts src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts
git commit -m "feat: scope authoring runs to artifact candidates"
```

---

### Task 8: Enforce semantic support and reject protocol/template contamination

**Files:**
- Create: `src/workbench/authoring/artifactQuality.ts`
- Create: `src/workbench/authoring/__tests__/artifactQuality.test.ts`
- Modify: `src/workbench/authoring/authoringValidation.ts`
- Modify: `src/workbench/types.ts`
- Modify: `src/workbench/authoring/authoringService.ts`

**Interfaces:**
- Produces: `validateClaimSupport(output, supports, evidenceByRef)`.
- Produces: `findUnsupportedProtocolLanguage(output, supports, evidenceByRef)`.
- Produces: `findDuplicateHumanContent(outputs, recentArtifacts)`.

- [ ] **Step 1: Encode the production failure as a red regression test**

```ts
test("rejects the 1,283-dossier template pattern", () => {
  const result = validateAuthoringBundleV2({
    bundle: bundleWithOutput({
      approach: ["Read every canonical evidence item through cursor pagination."],
      outcome: "The canonical redacted record was fully reviewed."
    }),
    evidenceByRef: fixtureEvidence()
  });
  expect(result.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "unsupported_authoring_protocol_language" })
  ]));
});

test("rejects a claim excerpt that is not present in cited evidence", () => {
  const result = validateArtifactOutput(outputWithSupport({
    path: "rootCause",
    evidenceRef: "message:actual",
    excerpt: "A sentence that never appeared"
  }));
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "unsupported_claim_excerpt" }));
});

test("rejects a runbook whose verification support is not a passed check", () => {
  const result = validateArtifactOutput(runbookSupportedByFailedCommandOnly());
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: "invalid_support_kind_evidence",
    path: "artifact.output.validationChecks[0]"
  }));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run src/workbench/authoring/__tests__/artifactQuality.test.ts`

Expected: FAIL because current validation checks IDs and paths only.

- [ ] **Step 3: Extend validation evidence**

```ts
export type WorkbenchValidationEvidence = {
  sessionId: string;
  kind: SessionTranscriptKind;
  role?: string;
  text: string;
  observedAt: string;
  status?: string;
  exitCode?: number;
  lowValue: boolean;
};
```

For every support entry, normalize whitespace and require a 20+ character excerpt to occur verbatim in `evidence.text`. Require support for every populated claim-bearing field already listed by `requiredClaimPaths()`.

Enforce a kind-specific support matrix in addition to excerpt matching:

```ts
const REQUIRED_SUPPORT_KINDS = {
  runbook: ["problem", "change", "verification"],
  adr: ["decision", "alternative"],
  incident_timeline: ["problem", "timeline", "remediation"]
} as const;
```

`verification` must reference a passed tool/check result; `timeline` evidence must carry timestamps and preserve chronological order; `change` must reference a file effect, command, or explicit assistant change statement. A non-empty root cause is allowed only with `root_cause` support. Otherwise runbooks and incidents must state that root cause is unknown rather than infer one.

- [ ] **Step 4: Reject unsupported protocol leakage without false positives**

Detect `cursor pagination`, `canonical evidence`, `evidence manifest`, `authoring run`, `single provenance`, `weak multi-session join`, and `published artifact` in human-facing artifact fields. Permit a phrase only when at least one support excerpt for that field contains it, so a real session about Masthead authoring remains valid.

- [ ] **Step 5: Reject duplicate human content**

Fingerprint normalized title, summary/context, outcome/decision/root cause, and ordered substantive arrays. Reject identical fingerprints across distinct candidates and reject a new artifact when its substantive fingerprint matches a recent current artifact with disjoint provenance. This duplicate gate applies to optional authored artifacts only; canonical dossier snapshots use their stable dossier fingerprint.

- [ ] **Step 6: Run quality and service tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/artifactQuality.test.ts src/workbench/authoring/__tests__/authoringValidation.test.ts src/workbench/authoring/__tests__/authoringService.test.ts`

Expected: PASS, including the real Masthead-authoring fixture that legitimately discusses manifests.

- [ ] **Step 7: Commit**

```bash
git add src/workbench/authoring/artifactQuality.ts src/workbench/authoring/__tests__/artifactQuality.test.ts src/workbench/authoring/authoringValidation.ts src/workbench/types.ts src/workbench/authoring/authoringService.ts
git commit -m "fix: enforce supported and non-template artifact claims"
```

---

### Task 9: Make candidate completion atomic and useful

**Files:**
- Modify: `src/workbench/authoring/authoringService.ts`
- Modify: `src/daemon/db/workbenchArtifactCandidateRepository.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/workbench/authoring/__tests__/authoringService.test.ts`

**Interfaces:**
- Consumes: one accepted V2 artifact and its candidate.
- Produces: a receipt with `candidateId`, published dossier ids, published optional artifact id, and provenance sessions.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test("finish publishes one optional artifact and canonical dossiers atomically", () => {
  const receipt = finishAcceptedCandidate(db, "candidate:runbook:oauth");
  expect(receipt.candidateId).toBe("candidate:runbook:oauth");
  expect(receipt.optionalArtifact.kind).toBe("runbook");
  expect(readCandidate(db, receipt.candidateId)?.status).toBe("published");
  expect(receipt.dossierArtifactIds).toHaveLength(receipt.resolvedSessionIds.length);
});

test("an empty optional artifact cannot finish a positive candidate", () => {
  expect(() => finishBundleWithoutArtifact(db)).toThrow("candidate_artifact_required");
});

test("reauthoring changed evidence supersedes the old artifact without duplicate search hits", () => {
  const first = finishAcceptedCandidate(db, "candidate:runbook:oauth");
  reviseCandidateEvidence(db, "candidate:runbook:oauth");
  const second = finishAcceptedCandidate(db, "candidate:runbook:oauth");
  expect(getSessionArtifact(db, first.optionalArtifact.artifactId)?.status).toBe("superseded");
  expect(searchLogbookArtifacts(db, { query: "oauth callback" }).artifacts.map((row) => row.artifactId))
    .toEqual([second.optionalArtifact.artifactId]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringService.test.ts`

Expected: FAIL under V1 resolution semantics.

- [ ] **Step 3: Replace per-session N/A resolution**

Finishing a candidate must publish exactly one artifact of the candidate kind, mark the candidate published, mark provenance sessions contributed to that artifact, and publish/update each canonical dossier snapshot. Sessions without candidates receive their dossier through `publishCanonicalDossiers()` from Task 4; they do not receive fabricated N/A decisions.

When canonical evidence changes, discovery supersedes the old candidate revision. Reauthoring the same normalized signature must create a new artifact version, mark the prior version superseded, preserve lineage, and expose only the current version through Logbook and MCP search.

- [ ] **Step 4: Preserve atomic rollback and idempotence**

Keep dossier snapshots, optional artifact publication, search indexing, candidate status, claims, and receipt persistence inside the existing immediate transaction. Add failure injection after each mutation boundary and assert zero partial rows.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/workbench/authoring/__tests__/authoringService.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workbench/authoring/authoringService.ts src/daemon/db/workbenchArtifactCandidateRepository.ts src/daemon/db/workbenchPipelineRepository.ts src/workbench/authoring/__tests__/authoringService.test.ts
git commit -m "feat: finish candidate artifacts atomically"
```

---

### Task 10: Replace the bulk handoff with candidate-sized Workbench guidance

**Files:**
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Test: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

**Interfaces:**
- Consumes: a selected `WorkbenchArtifactCandidate`.
- Produces: a V2 handoff containing one candidate id, its kind, signal summary, provenance set, and exact CLI capability identity.

- [ ] **Step 1: Write a failing handoff test**

```ts
test("handoff asks for one reusable candidate artifact and never asks for dossier prose", () => {
  const handoff = buildWorkbenchHandoff({ candidate: runbookCandidate(), authoringCommand, databaseId });
  expect(handoff).toContain("candidate:runbook:oauth");
  expect(handoff).toContain("Author one reusable runbook");
  expect(handoff).not.toContain("read every item named by every session evidence manifest");
  expect(handoff).not.toContain("session dossier");
  expect(handoff).not.toContain("otherwise resolve them as N/A");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/ui/workbench/__tests__/workbenchHandoff.test.ts src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx`

Expected: FAIL because the current handoff is bulk and protocol-heavy.

- [ ] **Step 3: Implement candidate guidance**

The visible request must say what reusable knowledge to produce, which positive signals nominated it, and that claim excerpts are mandatory. Protocol mechanics remain in the machine request. The UI must show candidate kind, provenance count, signal summary, and status; the primary optional-artifact action is `Author candidate`, not `Publish package` for a 20-session selection. A separate `Publish canonical dossiers` control calls the daemon-owned batch service and never generates an agent handoff.

- [ ] **Step 4: Run UI tests and inspect Workbench**

Run: `npm test -- --run src/ui/workbench/__tests__/workbenchHandoff.test.ts src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx`

Expected: PASS. Inspect desktop/tablet/narrow Workbench with temporary DevCite markers, remove them, then run `npm run verify:no-citations`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/workbench/workbenchHandoff.ts src/ui/workbench/WorkbenchPanel.tsx src/app/workbench/useWorkbenchController.ts src/app/daemonClient.ts src/ui/workbench/__tests__/workbenchHandoff.test.ts src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx
git commit -m "fix: make Workbench handoffs candidate-sized"
```

---

### Task 11: Add safe recovery for the failed V1 generation

**Files:**
- Modify: `src/daemon/db/sessionArtifactRepository.ts`
- Modify: `src/daemon/db/workbenchAuthoringRepository.ts`
- Create: `src/daemon/databaseBackup.ts`
- Modify: `src/cli/workbenchMaintenance.ts`
- Modify: `src/cli/workbenchAuthoring.ts`
- Test: `src/daemon/db/__tests__/sessionArtifactRepository.test.ts`
- Test: `src/cli/__tests__/authoringCli.test.ts`

**Interfaces:**
- Produces: `auditFailedV1Generation(db): FailedGenerationAudit`.
- Produces: `invalidateFailedV1Generation(db, expectedAuditHash): FailedGenerationReceipt`.
- Produces: `createSingleConsistentBackup(databasePath)` using SQLite's online backup API and deleting older snapshots before creating the new one.
- Produces CLI commands `audit-v1-generation`, `prepare-v1-recovery`, and `invalidate-v1-generation`.

- [ ] **Step 1: Write failing dry-run and invalidation tests**

```ts
test("audits the exact failed V1 generation without mutation", () => {
  seedFailedGeneration(db, 1_283);
  const before = databaseFingerprint(db);
  const audit = auditFailedV1Generation(db);
  expect(audit).toMatchObject({ dossiers: 1_283, runbooks: 0, adrs: 0, incidentTimelines: 0 });
  expect(databaseFingerprint(db)).toBe(before);
});

test("invalidation removes V1 output from Logbook and resets every optional status", () => {
  const audit = auditFailedV1Generation(db);
  invalidateFailedV1Generation(db, audit.auditHash);
  expect(searchLogbookArtifacts(db, {}).total).toBe(0);
  expect(readWorkbenchSessionState(db, "session:one")).toMatchObject({
    sessionDossierStatus: "missing",
    runbookStatus: "unknown",
    adrStatus: "unknown",
    incidentTimelineStatus: "unknown",
    resolutionStatus: "in_progress"
  });
  expect(getWorkbenchAuthoringRun(db, "v1-run")?.status).toBe("completed");
});

test("recovery backup includes committed WAL state and leaves exactly one snapshot", async () => {
  seedCommittedWalRows(databasePath);
  await createSingleConsistentBackup(databasePath);
  await createSingleConsistentBackup(databasePath);
  expect(await listDatabaseBackups(databasePath)).toHaveLength(1);
  expect(readArtifactCountFromBackup(databasePath)).toBe(readArtifactCount(databasePath));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/cli/__tests__/authoringCli.test.ts`

Expected: FAIL because the current wipe is all-or-nothing and leaves N/A statuses intact.

- [ ] **Step 3: Implement a fingerprinted dry-run**

The audit must identify rows by V1 contract, `created_by`, schema version, publication window, and the known template fingerprints. It must print counts by kind, run, status, and session plus a SHA-256 audit hash. Invalidation requires that exact hash and aborts if the database changed.

`prepare-v1-recovery` must stop if a writer lease is active, remove all older `masthead.sqlite.backup-*` files, create one transactionally consistent backup through the SQLite backup API, reopen it read-only, and return its path, size, database id, and integrity-check result. Never use a plain file copy while WAL state may exist.

- [ ] **Step 4: Invalidate without erasing audit history**

Inside one transaction:

```text
- delete matching artifact search and provenance rows;
- delete matching failed artifact rows;
- reset dossier status to missing;
- reset runbook/ADR/timeline status to unknown, including prior N/A values;
- reset session package/resolution/publication state;
- release stale claims;
- retain V1 authoring runs and receipts as audit records;
- record one recovery activity row with the audit hash.
```

- [ ] **Step 5: Run recovery tests**

Run: `npm test -- --run src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/cli/__tests__/authoringCli.test.ts`

Expected: PASS, including hash mismatch and mixed valid/invalid artifact cases.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/db/sessionArtifactRepository.ts src/daemon/db/workbenchAuthoringRepository.ts src/daemon/databaseBackup.ts src/cli/workbenchMaintenance.ts src/cli/workbenchAuthoring.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/cli/__tests__/authoringCli.test.ts
git commit -m "fix: safely invalidate failed v1 artifacts"
```

---

### Task 12: Build the durable-artifact acceptance harness

**Files:**
- Create: `scripts/dogfood-durable-artifacts.js`
- Modify: `package.json`
- Create: `docs/acceptance/durable-artifact-gate.md`
- Test: `src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts`

**Interfaces:**
- Produces: `npm run dogfood:durable-artifacts`.
- Produces: a JSON report with expected/actual kinds, claim-support coverage, protocol leakage, duplicate fingerprints, dossier fidelity, Logbook/MCP retrieval results, reuse-task results, and human-review worksheet.

- [ ] **Step 1: Write the failing corpus acceptance test**

```ts
test("curated corpus meets the durable artifact contract", async () => {
  const report = await runDurableArtifactCorpus();
  expect(report.dossierFidelity).toBe(1);
  expect(report.claimSupportCoverage).toBe(1);
  expect(report.candidateRecall).toBe(1);
  expect(report.candidatePrecision).toBe(1);
  expect(report.logbookRetrievalRecallAt5).toBe(1);
  expect(report.mcpRetrievalRecallAt5).toBe(1);
  expect(report.reuseTaskPassRate).toBe(1);
  expect(report.protocolLeakCount).toBe(0);
  expect(report.duplicateSubstantiveFingerprintCount).toBe(0);
  expect(report.actualKinds).toEqual(report.expectedKinds);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts`

Expected: FAIL because the acceptance harness does not exist.

- [ ] **Step 3: Implement deterministic machine gates**

The script must fail non-zero if any of these are true:

```text
dossierFidelity < 1.0
claimSupportCoverage < 1.0
candidateRecall < 1.0 on the labeled fixture corpus
candidatePrecision < 1.0 on the labeled fixture corpus
Logbook retrieval recall@5 < 1.0 for labeled fixture queries
MCP retrieval recall@5 < 1.0 for labeled fixture queries
reuse task pass rate < 1.0
protocolLeakCount > 0
duplicateSubstantiveFingerprintCount > 0
unexpectedKindCount > 0
missingExpectedKindCount > 0
candidateRunProvenanceSize > 12
candidateDiscoveryPageDurationMs > 2000 for the 100-session performance fixture
```

Add five reuse tasks with expected answer keys: execute the OAuth repair from the runbook, explain why the architecture alternative was rejected from the ADR, reconstruct the incident sequence, find a dossier by a changed file path, and identify a verification failure from dossier attention. Each task must succeed from `get_artifact` output alone after `search_artifacts` locates it; raw transcript tools are forbidden during the reuse assertion.

- [ ] **Step 4: Add the human usefulness rubric**

Every canary artifact is scored 1–5 on:

```text
Findability: title and capsule identify the real work.
Grounding: claims are directly supported and uncertainty is explicit.
Reusability: another person can act without reopening the raw transcript.
Specificity: concrete files, commands, decisions, symptoms, and checks replace generic prose.
Readability: the body is pleasant, concise, and organized for its artifact kind.
```

Passing requires median overall score `>= 4.0`, no artifact below `3.0`, and 100% review completion.

- [ ] **Step 5: Run the harness**

Run: `npm run dogfood:durable-artifacts`

Expected: PASS with the exact fixture kind mix and all machine metrics at their thresholds.

- [ ] **Step 6: Commit**

```bash
git add scripts/dogfood-durable-artifacts.js package.json docs/acceptance/durable-artifact-gate.md src/workbench/authoring/__tests__/durableArtifactCorpus.test.ts
git commit -m "test: add durable artifact acceptance gate"
```

---

### Task 13: Align documentation and run the full release gate

**Files:**
- Modify: `design.md`
- Modify: `prd.md`
- Modify: `README.md`
- Modify: `docs/reference/session-dossier.md`
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/reference/mcp-tools.md`
- Modify: `docs/acceptance/product-release-gate.md`
- Modify: `openwiki/quickstart.md`
- Modify: `openwiki/data-and-integrations.md`

**Interfaces:**
- Documents: canonical dossier snapshots, candidate discovery, V2 routes/CLI, recovery, and rollout gates.

- [ ] **Step 1: Add documentation contract assertions**

Extend the product-contract test to reject these stale statements:

```ts
expect(activeDocs).not.toMatch(/agent-authored session dossier/i);
expect(activeDocs).not.toMatch(/read every item named by every session evidence manifest/i);
expect(activeDocs).not.toMatch(/runbook.*ADR.*timeline.*N\/A.*every session/i);
```

- [ ] **Step 2: Update active documentation**

Document the one dossier contract, immutable snapshot semantics, V2 candidate workflow, exact evidence-support rules, recovery commands, and acceptance thresholds. Mark ADR 0012’s bundle/N/A portions as superseded by ADR 0013; retain its daemon-owned atomic-publication decision.

- [ ] **Step 3: Run focused and full verification**

Run: `npm run verify:no-citations`

Expected: PASS.

Run: `npm run verify`

Expected: all typechecks, tests, builds, endpoint checks, and smoke suites PASS.

Run: `npm run dogfood:durable-artifacts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add design.md prd.md README.md docs/reference/session-dossier.md docs/reference/daemon-api.md docs/reference/mcp-tools.md docs/acceptance/product-release-gate.md openwiki/quickstart.md openwiki/data-and-integrations.md src/workbench/__tests__/productContract.test.ts
git commit -m "docs: publish the durable artifact v2 contract"
```

---

### Task 14: Recover production through a gated canary rollout

**Files:**
- No product-code changes.
- Write evidence: `docs/acceptance/durable-artifact-production-canary.md`

**Interfaces:**
- Consumes: the V2 build, audit hash, and acceptance harness.
- Produces: recovery receipt and signed canary decision.

- [ ] **Step 1: Stop all V1 authoring and verify database identity**

Run the installed V2 capabilities command and record the exact database id, contract version, app version, and artifact counts. Abort if capabilities are not `workbench-authoring-v2`.

- [ ] **Step 2: Keep exactly one backup**

Run: `mastheadctl workbench prepare-v1-recovery --json`

Expected: the daemon writer is stopped, older `masthead.sqlite.backup-*` snapshots are removed, one SQLite-consistent backup is created and reopened read-only, and the receipt reports the matching database id plus `integrityCheck: "ok"`.

- [ ] **Step 3: Audit the failed generation**

Run: `mastheadctl workbench audit-v1-generation --json`

Expected: 1,283 dossiers, zero optional artifacts, 66 V1 completed runs, and the production audit hash. Abort on any unexpected artifact kind or count.

- [ ] **Step 4: Rehearse recovery and canary against a temporary database copy**

Copy the verified single backup—not the live database or WAL files—into a temporary directory, point an isolated daemon at that copy, run invalidation, publish the 25 canonical dossiers, author the discovered candidates, and complete the full review worksheet. Delete the temporary directory after the rehearsal. Do not touch production unless the rehearsal passes every stop condition.

- [ ] **Step 5: Invalidate production using the exact audit hash**

Run: `mastheadctl workbench invalidate-v1-generation --audit-hash "$AUDIT_HASH" --confirm --json`, where `AUDIT_HASH` is copied from Step 3's audit receipt.

Expected: the 1,283 artifacts leave Logbook, V1 audit runs remain, and affected sessions reset for V2.

- [ ] **Step 6: Publish canonical dossiers for a stratified 25-session production canary**

Sample five sessions from each evidence band: sparse, ordinary conversation, tool-heavy, failure/fix, and decision-heavy. Publish canonical dossiers and verify every one against the original dossier component.

- [ ] **Step 7: Author all positive candidates in that canary**

Run one candidate per V2 authoring run. Review every resulting optional artifact using the five-axis rubric.

- [ ] **Step 8: Apply stop conditions**

Stop and roll back to the single backup if any condition occurs:

```text
Any dossier section is missing or materially differs from the original dossier.
Any authoring-protocol language appears without direct session support.
Any claim excerpt fails exact canonical matching.
Any substantive fingerprint is duplicated across unrelated provenance.
Any expected fixture kind has zero yield.
Any canary artifact scores below 3/5.
Median canary usefulness is below 4/5.
Any V2 run exceeds 12 provenance sessions.
Candidate recall is below 90% against reviewer labels for the 25-session canary.
Candidate precision is below 80% against reviewer labels for the 25-session canary.
```

- [ ] **Step 9: Expand in bounded waves**

After canary approval, process 25 candidates per wave, not 25 arbitrary sessions. After each wave, run the machine report and review a 20% stratified sample. Pause automatically on any stop condition; never auto-continue from a failed wave.

- [ ] **Step 10: Close out**

Record final dossier count, artifact counts by kind, candidate precision, claim-support coverage, duplicate rate, usefulness sample scores, and remaining pending candidates in `docs/acceptance/durable-artifact-production-canary.md` and a concise GBrain session closeout.

Schedule a 30-day read-only usefulness review from existing Logbook access and MCP audit data: search-to-open rate, `search_artifacts` to `get_artifact` follow-through, repeated retrieval of the same artifact, zero-result queries, and any supersede/correction events. These are lagging product signals, not publication gates, but they determine whether the artifacts are actually being reused rather than merely passing generation tests.

---

## Plan-wide verification commands

```bash
npm test -- --run src/workbench/authoring src/daemon/__tests__/workbenchAuthoringApi.test.ts src/cli/__tests__/authoringCli.test.ts src/ui/logbook src/ui/session-dossier
npm run verify:no-citations
npm run dogfood:durable-artifacts
npm run verify
```

Expected final result: all commands pass; the fixture corpus produces the exact expected kind mix; no authored dossier path remains; and Logbook renders the canonical dossier snapshot through the original dossier presentation.

## Explicit non-goals

- No new artifact kinds beyond dossier, runbook, ADR, and incident timeline.
- No native Masthead model provider or background LLM service.
- No semantic clustering based only on project/topic/time similarity.
- No opaque aggregate “quality score” replacing explicit gates.
- No bulk automatic rollout without fixture and production-canary review.
- No redesign of the original dossier.
