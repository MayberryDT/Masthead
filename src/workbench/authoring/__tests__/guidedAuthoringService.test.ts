import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchArtifactSuggestionDto } from "../../../shared/workbenchAuthoring.ts";
import type { GuidedAuthoringAssignmentDto, GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import {
  getGuidedAssignment,
  getGuidedAssignmentReceipt,
  getGuidedAssignments,
  getGuidedAuthoringRequest,
  listGuidedDraftReviews,
  listGuidedEvidenceAccess,
  listGuidedOpportunities
} from "../../../daemon/db/guidedAuthoringRepository.ts";
import { listGuidedEnrichmentProvenance } from "../../../daemon/db/enrichmentRepository.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import { getDataRevisions } from "../../../daemon/db/dataRevisionRepository.ts";
import * as advisorySuggestions from "../advisorySuggestions.ts";
import * as evidenceCatalog from "../evidenceCatalog.ts";
import type { AuthoringEvidenceSnapshot } from "../evidenceCatalog.ts";
import {
  GUIDED_EVIDENCE_QUESTIONS,
  GUIDED_TOOL_HEAVY_CALL_THRESHOLD,
  classifyPlanningSession,
  planGuidedAssignments,
  type GuidedPlanningSession
} from "../guidedAuthoringPolicy.ts";
import { assertGuidedSelectionCompileReady } from "../guidedAuthoringPreflight.ts";
import * as guidedQuality from "../guidedAuthoringQuality.ts";
import {
  approveGuidedCanary,
  buildGuidedDraftScaffold,
  buildGuidedAuthoringValidationInput,
  createGuidedRequest as createGuidedRequestService,
  finishGuidedAssignment,
  guidedDraftFilePath,
  GUIDED_PUBLICATION_FAILURE_POINTS,
  installGuidedAuthoringServiceTestHooks,
  inspectGuidedAssignment as inspectGuidedAssignmentService,
  rejectGuidedCanary,
  reviewGuidedAssignment,
  saveGuidedDraft,
  startGuidedAssignment as startGuidedAssignmentService
} from "../guidedAuthoringService.ts";
import { parseGuidedAuthoringBundleV4 } from "../authoringSchemas.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("guided authoring assignment policy", () => {
  test("keeps strong and overlapping opportunities in one bounded assignment", () => {
    const plan = planGuidedAssignments(selection(8), [
      suggestion(["session:0", "session:1", "session:2"], "adr", "shared-a"),
      suggestion(["session:2", "session:3", "session:4"], "runbook", "shared-b"),
      suggestion(["session:0"], "incident_timeline", "singleton")
    ]);

    expect(plan.groups.find(({ opportunityIds }) => opportunityIds.length === 3)?.sessionIds)
      .toEqual(["session:0", "session:1", "session:2", "session:3", "session:4"]);
    expect(plan.groups.every(({ sessionIds }) => sessionIds.length <= 12)).toBe(true);
  });

  test("rejects a complete strong component above twelve", () => {
    expect(() => planGuidedAssignments(selection(13), [
      suggestion(selection(13).map(({ sessionId }) => sessionId), "runbook", "oversize")
    ])).toThrow("guided_opportunity_group_too_large");
  });

  test("rejects overlapping bounded opportunities whose connected component exceeds twelve", () => {
    expect(() => planGuidedAssignments(selection(13), [
      suggestion(selectionIds(7), "adr", "left-bounded"),
      suggestion(selectionIds(7).map((_, index) => `session:${index + 6}`), "runbook", "right-bounded")
    ])).toThrow("guided_opportunity_group_too_large");
  });

  test("classifies the tool-heavy threshold and singleton priority exactly", () => {
    const ordinary = { ordinal: 0, sessionId: "session:a", toolCallCount: GUIDED_TOOL_HEAVY_CALL_THRESHOLD - 1 };
    const heavy = { ...ordinary, toolCallCount: GUIDED_TOOL_HEAVY_CALL_THRESHOLD };
    expect(classifyPlanningSession(ordinary, false)).toBe("ordinary");
    expect(classifyPlanningSession(heavy, false)).toBe("tool_heavy");
    expect(classifyPlanningSession(heavy, true)).toBe("artifact_signal");
  });

  test("chooses a diverse dossier canary and attaches singleton opportunities once", () => {
    const sessions = selection(6).map((session, index) => ({
      ...session,
      toolCallCount: index === 1 ? GUIDED_TOOL_HEAVY_CALL_THRESHOLD : 0
    }));
    const plan = planGuidedAssignments(sessions, [suggestion(["session:0"], "adr", "singleton")]);

    expect(plan.canary.sessionIds).toEqual(["session:0", "session:1", "session:2"]);
    expect(plan.canary.coverageClasses).toEqual(["artifact_signal", "tool_heavy", "ordinary"]);
    expect(plan.canary.opportunityIds).toHaveLength(1);
    expect(plan.groups.flatMap(({ opportunityIds }) => opportunityIds)).toEqual(plan.opportunities.map(({ opportunityId }) => opportunityId));
  });

  test.each([4, 12])("does not split a %i-session strong group to manufacture a canary", (size) => {
    const strong = suggestion(selection(size).map(({ sessionId }) => sessionId), "adr", `strong-${size}`);
    expect(() => planGuidedAssignments(selection(size), [strong])).toThrow("guided_canary_not_constructible");

    const withFallback = planGuidedAssignments(selection(size + 1), [strong]);
    expect(withFallback.canary.sessionIds).toEqual([`session:${size}`]);
    expect(withFallback.groups.find(({ opportunityIds }) => opportunityIds.length === 1)?.sessionIds)
      .toEqual(selection(size).map(({ sessionId }) => sessionId));
  });

  test("is stable across opportunity, provenance, and evidence-ref order", () => {
    const forward = [
      suggestion(["session:0", "session:1"], "adr", "a", ["message:z", "message:a"]),
      suggestion(["session:3"], "runbook", "b", ["tool:z", "tool:a"])
    ];
    const reverse = [...forward].reverse().map((entry) => ({
      ...entry,
      evidenceRefs: [...entry.evidenceRefs].reverse(),
      provenanceSessionIds: [...entry.provenanceSessionIds].reverse()
    }));

    expect(planGuidedAssignments(selection(6), reverse)).toEqual(planGuidedAssignments(selection(6), forward));
  });

  test.each([
    {
      label: "duplicate provenance",
      sessions: selection(2),
      suggestions: [suggestion(["session:0", "session:0"], "adr", "duplicate-provenance")],
      error: "guided_opportunity_invalid"
    },
    {
      label: "duplicate evidence refs",
      sessions: selection(2),
      suggestions: [suggestion(["session:0"], "adr", "duplicate-refs", ["message:a", "message:a"])],
      error: "guided_opportunity_invalid"
    },
    {
      label: "blank provenance",
      sessions: selection(2),
      suggestions: [suggestion([" "], "adr", "blank-provenance")],
      error: "guided_opportunity_invalid"
    },
    {
      label: "blank evidence ref",
      sessions: selection(2),
      suggestions: [suggestion(["session:0"], "adr", "blank-ref", [" "])],
      error: "guided_opportunity_invalid"
    },
    {
      label: "out-of-selection provenance",
      sessions: selection(2),
      suggestions: [suggestion(["session:99"], "adr", "outside-selection")],
      error: "guided_opportunity_invalid"
    },
    {
      label: "noncontiguous ordinals",
      sessions: [
        { ordinal: 0, sessionId: "session:0", toolCallCount: 0 },
        { ordinal: 2, sessionId: "session:1", toolCallCount: 0 }
      ],
      suggestions: [],
      error: "guided_selection_ordinal_invalid"
    }
  ])("rejects $label instead of normalizing malformed planning input", ({ error, sessions, suggestions }) => {
    expect(() => planGuidedAssignments(sessions, suggestions)).toThrow(error);
  });

  test("assigns every selected session and opportunity exactly once", () => {
    const plan = planGuidedAssignments(selection(18), [
      suggestion(["session:0", "session:1", "session:2"], "adr", "strong"),
      suggestion(["session:4"], "runbook", "single-a"),
      suggestion(["session:15"], "incident_timeline", "single-b")
    ]);
    expect(counts(plan.groups.flatMap(({ sessionIds }) => sessionIds)))
      .toEqual(Object.fromEntries(selection(18).map(({ sessionId }) => [sessionId, 1])));
    expect(counts(plan.groups.flatMap(({ opportunityIds }) => opportunityIds)))
      .toEqual(Object.fromEntries(plan.opportunities.map(({ opportunityId }) => [opportunityId, 1])));
    expect(plan.groups[0]).toEqual(plan.canary);
  });
});

describe("guided authoring service", () => {
  test("preflights caller order from exactly one strict evidence snapshot", async () => {
    const db = await serviceDb(3);
    db.prepare("UPDATE workbench_session_state SET quality_status = 'unchecked' WHERE session_id = ?").run("session:1");
    const snapshot = vi.spyOn(evidenceCatalog, "getAuthoringEvidenceSnapshot");

    expect(() => assertGuidedSelectionCompileReady(db, ["session:1", "session:0"]))
      .toThrow("authoring_session_not_compile_ready:session:1");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith(db, ["session:1", "session:0"]);
    db.close();
  });

  test("rejects blank and duplicate membership before snapshot collection", async () => {
    const db = await serviceDb(2);
    const snapshot = vi.spyOn(evidenceCatalog, "getAuthoringEvidenceSnapshot");

    expect(() => assertGuidedSelectionCompileReady(db, ["session:0", " "])).toThrow("authoring_session_id_blank");
    expect(() => assertGuidedSelectionCompileReady(db, ["session:0", "session:0"])).toThrow(
      "authoring_session_id_duplicate:session:0"
    );
    expect(snapshot).not.toHaveBeenCalled();
    db.close();
  });

  test("rejects invalid request membership before opening the immediate transaction", async () => {
    const db = await serviceDb(2);
    const exec = vi.spyOn(db, "exec");

    expect(() => createGuidedRequest(db, requestInput(["session:0", "session:0"])))
      .toThrow("authoring_session_id_duplicate:session:0");
    expect(exec.mock.calls.flat()).not.toContain("BEGIN IMMEDIATE;");
    db.close();
  });

  test("creates one immutable aggregate from one snapshot inside an outer immediate transaction", async () => {
    const db = await serviceDb(18);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const snapshot = vi.spyOn(evidenceCatalog, "getAuthoringEvidenceSnapshot");
    const legacy = vi.spyOn(evidenceCatalog, "authoringEvidenceRevision");

    const created = createGuidedRequest(db, requestInput(selectionIds(18)));
    const assignments = getGuidedAssignments(db, created.request.requestId);

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
    expect(created.nextAction).toEqual({
      kind: "claim_next",
      command: `masthead workbench author start --request ${created.request.requestId} --json`,
      reason: "The canary assignment is ready to start."
    });
    expect(assignments[0]?.sessionIds).toEqual(["session:0", "session:1", "session:2"]);
    expect(assignments.every(({ sessionIds }) => sessionIds.length <= 12)).toBe(true);
    const captured = snapshot.mock.results[0]!.value as AuthoringEvidenceSnapshot;
    for (const assignment of assignments) {
      expect(assignment.evidenceRevision).toBe(evidenceCatalog.guidedAuthoringEvidenceRevisionFromInputs(
        captured.sessions
          .filter(({ revisionInput }) => assignment.sessionIds.includes(revisionInput.sessionId))
          .map(({ revisionInput }) => revisionInput)
      ));
    }
    db.close();
  });

  test("rolls back the complete aggregate after persistence fails", async () => {
    const db = await serviceDb(4);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    db.exec(`CREATE TRIGGER abort_guided_assignment
      BEFORE INSERT ON guided_authoring_assignments
      BEGIN SELECT RAISE(ABORT, 'injected_guided_request_failure'); END;`);

    expect(() => createGuidedRequest(db, requestInput(selectionIds(4), [
      suggestion(["session:0"], "runbook", "persisted")
    ]))).toThrow("injected_guided_request_failure");
    expect(guidedCounts(db)).toEqual([0, 0, 0, 0, 0, 0]);
    db.close();
  });

  test("rejects an over-limit strong group without persisting a partial request", async () => {
    const db = await serviceDb(13);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([
      suggestion(selectionIds(13), "runbook", "oversize-service")
    ]);

    expect(() => createGuidedRequest(db, requestInput(selectionIds(13))))
      .toThrow("guided_opportunity_group_too_large");
    expect(guidedCounts(db)).toEqual([0, 0, 0, 0, 0, 0]);
    db.close();
  });

  test("rejects a non-compile-ready selection before any guided write", async () => {
    const db = await serviceDb(4);
    db.prepare("UPDATE workbench_session_state SET quality_status = 'unchecked' WHERE session_id = ?").run("session:2");
    const detector = vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);

    expect(() => createGuidedRequest(db, requestInput(selectionIds(4))))
      .toThrow("authoring_session_not_compile_ready:session:2");
    expect(detector).not.toHaveBeenCalled();
    expect(guidedCounts(db)).toEqual([0, 0, 0, 0, 0, 0]);
    db.close();
  });

  test("holds one WAL write reservation across snapshot, detection, planning, and persistence", async () => {
    const fixture = await serviceDbWithPath(4);
    const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 6));
    const worker = new Worker(new URL("./fixtures/guidedAuthoringWalWriter.mjs", import.meta.url), {
      workerData: { databasePath: fixture.databasePath, shared: state.buffer }
    });
    try {
      expect((await once(worker, "message"))[0]).toEqual({ kind: "ready" });
      vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockImplementation(() => {
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
        expect(Atomics.wait(state, 1, 0, 2_000)).not.toBe("timed-out");
        expect(Atomics.load(state, 2)).toBe(1);
        return [];
      });

      const created = createGuidedRequest(fixture.db, requestInput(selectionIds(4)));
      expect(created.request.sessionCount).toBe(4);
      Atomics.store(state, 3, 1);
      Atomics.notify(state, 3);
      expect(Atomics.wait(state, 4, 0, 2_000)).not.toBe("timed-out");
      expect(Atomics.load(state, 5)).toBe(2);
      expect((fixture.db.prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ?").get("session:0") as { text: string }).text)
        .toContain("worker mutation");
      expect(() => startGuidedAssignment(fixture.db, {
        command: "masthead",
        requestId: created.request.requestId
      })).toThrow("guided_assignment_evidence_changed");
    } finally {
      await worker.terminate();
      fixture.db.close();
    }
  });

  test("starts from the persisted plan without rerunning detection or planning", async () => {
    const db = await serviceDb(5);
    const persisted = suggestion(["session:0"], "adr", "persisted");
    const detector = vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([persisted]);
    const created = createGuidedRequest(db, requestInput(selectionIds(5)));
    detector.mockReturnValue([suggestion(["session:4"], "runbook", "later")]);
    const changesBefore = totalChanges(db);

    const started = startGuidedAssignment(db, {
      command: "masthead",
      requestId: created.request.requestId
    });

    expect(detector).toHaveBeenCalledTimes(1);
    expect(totalChanges(db)).toBe(changesBefore);
    expect(started.editorialBrief).toMatchObject({
      objective: "Produce grounded knowledge reusable without reopening raw session evidence.",
      opportunities: [expect.objectContaining({ summary: persisted.summary })]
    });
    expect(started.nextAction).toEqual({
      kind: "inspect",
      command: `masthead workbench author inspect --assignment ${started.assignment.assignmentId} --json`,
      reason: "Every session still has unread canonical evidence."
    });
    db.close();
  });

  test("builds a schema-valid scaffold from trusted assignment membership without authoring substantive prose", async () => {
    const db = await serviceDb(2);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(["session:0", "session:1"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    const changesBefore = totalChanges(db);
    const scaffold = buildGuidedDraftScaffold(db, { assignmentId: assignment.assignmentId, command: "/opt/mastheadctl" });
    expect(totalChanges(db)).toBe(changesBefore);
    expect(parseGuidedAuthoringBundleV4(scaffold.draft)).toEqual(scaffold.draft);
    expect(scaffold.draft).toMatchObject({
      assignmentId: assignment.assignmentId,
      evidenceRevision: assignment.evidenceRevision,
      sessionEnrichments: assignment.sessionIds.map((sessionId) => ({
        sessionId,
        enrichment: { sessionTitle: { text: "REPLACE_WITH_SPECIFIC_SESSION_TITLE" } },
        claimSupport: expect.any(Array)
      }))
    });
    expect(scaffold.bundleSchema).toMatchObject({ title: "GuidedAuthoringBundleV4" });
    for (const session of scaffold.draft.sessionEnrichments) {
      const supportByPath = new Map(session.claimSupport.map((support) => [support.path, support]));
      expect(session.enrichment.sessionTitle.evidenceRefs.map(({ id }) => id)).toContain(
        supportByPath.get("/sessionTitle/text")?.evidenceRef
      );
      expect(session.enrichment.sessionSummary.evidenceRefs.map(({ id }) => id)).toContain(
        supportByPath.get("/sessionSummary/text")?.evidenceRef
      );
      expect(session.enrichment.sessionDossier.evidenceRefs.map(({ id }) => id)).toEqual(expect.arrayContaining([
        supportByPath.get("/sessionDossier/purpose")?.evidenceRef,
        supportByPath.get("/sessionDossier/outcome")?.evidenceRef,
        supportByPath.get("/sessionDossier/keyWork/0")?.evidenceRef
      ]));
      expect(session.enrichment.sessionDossier.verification.evidenceRefs.map(({ id }) => id)).toContain(
        supportByPath.get("/sessionDossier/verification/summary")?.evidenceRef
      );
      expect([
        ...session.enrichment.sessionTitle.evidenceRefs,
        ...session.enrichment.sessionSummary.evidenceRefs,
        ...session.enrichment.sessionDossier.evidenceRefs,
        ...session.enrichment.sessionDossier.verification.evidenceRefs
      ]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^REPLACE_WITH_/), kind: "event", observedAt: expect.any(String), source: expect.any(String) })
      ]));
      expect(session.claimSupport.map(({ path, supportKind }) => ({ path, supportKind }))).toEqual([
        { path: "/sessionTitle/text", supportKind: "reuse" },
        { path: "/sessionSummary/text", supportKind: "outcome" },
        { path: "/sessionDossier/purpose", supportKind: "purpose" },
        { path: "/sessionDossier/outcome", supportKind: "outcome" },
        { path: "/sessionDossier/keyWork/0", supportKind: "change" },
        { path: "/sessionDossier/verification/summary", supportKind: "verification" }
      ]);
    }
    expect(scaffold.nextAction).toMatchObject({
      kind: "save",
      command: `/opt/mastheadctl workbench author save --assignment ${assignment.assignmentId} --file ${guidedDraftFilePath(assignment.assignmentId)} --json`
    });
    expect(scaffold.nextAction.reason).toContain("put each supported result in its capsule summary");
    expect(scaffold.nextAction.reason).toContain("never leave a result-bearing sessionSummary.state unknown");
    expect(scaffold.nextAction.reason).toContain("preserve each prefilled claimSupport path and supportKind");
    expect(scaffold.nextAction.reason).toContain("full {id, kind, observedAt, source} object");
    expect(scaffold.nextAction.reason).toContain("fix its supportKind instead of deleting rootCause or replacing it with unknown");
    db.close();
  });

  test.each(["runbook", "adr", "incident_timeline"] as const)(
    "scaffolds a deterministic linked %s opportunity draft that remains quality-invalid",
    async (kind) => {
      const db = await serviceDb(1);
      const semanticRefs = seedSemanticScaffoldEvidence(db, "session:0");
      const evidenceRefs = Object.values(semanticRefs);
      const created = createGuidedRequest(db, requestInput(
        ["session:0"],
        [suggestion(["session:0"], kind, `scaffold-${kind}`, evidenceRefs)]
      ));
      const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
      const changesBefore = totalChanges(db);

      const first = buildGuidedDraftScaffold(db, { assignmentId: assignment.assignmentId, command: "/opt/mastheadctl" });
      const second = buildGuidedDraftScaffold(db, { assignmentId: assignment.assignmentId, command: "/opt/mastheadctl" });

      expect(totalChanges(db)).toBe(changesBefore);
      expect(second.draft).toEqual(first.draft);
      expect(parseGuidedAuthoringBundleV4(first.draft)).toEqual(first.draft);
      expect(first.draft.opportunityDispositions).toEqual([expect.objectContaining({
        artifactDraftId: first.draft.artifacts[0]?.draftId,
        artifactKind: kind,
        disposition: "authored",
        evidenceRefs: expect.arrayContaining(evidenceRefs),
        opportunityId: assignment.opportunityIds[0]
      })]);
      expect(first.draft.artifacts).toEqual([expect.objectContaining({
        draftId: expect.stringMatching(/^guided-artifact-draft:/),
        kind,
        provenanceSessionIds: ["session:0"],
        seedSessionId: "session:0",
        output: expect.objectContaining({
          claimSupport: expect.any(Array),
          provenanceSessionIds: ["session:0"],
          title: "REPLACE_WITH_SPECIFIC_ARTIFACT_TITLE"
        })
      })]);
      const artifactSupports = first.draft.artifacts[0]!.output.claimSupport as Array<{
        evidenceRef: string;
        path: string;
        supportKind: string;
      }>;
      const supportRef = (path: string) => artifactSupports.find((support) => support.path === path)?.evidenceRef;
      if (kind === "runbook") {
        expect(first.draft.artifacts[0]?.output.deadEnds).toEqual([]);
        expect(supportRef("problemSignature.affectedScope")).toBe(semanticRefs.problem);
        expect(supportRef("fixSteps[0]")).toBe(semanticRefs.performedAction);
        expect(supportRef("changedFiles[0]")).toBe(semanticRefs.change);
        expect(supportRef("validationChecks[0]")).toBe(semanticRefs.verification);
        expect(supportRef("risksOrGaps[0]")).toBe(semanticRefs.problem);
        expect(supportRef("rootCause")).toBe(semanticRefs.rootCause);
      } else if (kind === "adr") {
        expect(supportRef("context")).toBe(semanticRefs.problem);
        expect(supportRef("decision")).toBe(semanticRefs.decision);
        expect(supportRef("alternatives[0]")).toBe(semanticRefs.alternative);
        expect(supportRef("consequences[0]")).toBe(semanticRefs.decision);
      }
      if (kind === "incident_timeline") {
        expect(first.draft.artifacts[0]?.output).toMatchObject({
          timeline: [
            {
              at: "2026-06-25T12:01:00.000Z",
              evidenceRefs: [semanticRefs.problem],
              summary: "REPLACE_WITH_DETECTION_OR_IMPACT_EVENT"
            },
            {
              at: "2026-06-25T12:02:15.000Z",
              evidenceRefs: [semanticRefs.performedAction],
              summary: "REPLACE_WITH_REMEDIATION_EVENT"
            },
            {
              at: "2026-06-25T12:03:00.000Z",
              evidenceRefs: [semanticRefs.verification],
              summary: "REPLACE_WITH_RECOVERY_VERIFICATION_EVENT"
            }
          ],
          claimSupport: expect.arrayContaining([0, 1, 2].map((index) => expect.objectContaining({
            path: `timeline[${index}].summary`,
            supportKind: "timeline"
          })))
        });
        expect(supportRef("timeline[0].summary")).toBe(semanticRefs.problem);
        expect(supportRef("timeline[1].summary")).toBe(semanticRefs.performedAction);
        expect(supportRef("timeline[2].summary")).toBe(semanticRefs.verification);
        expect(supportRef("remediation[0]")).toBe(semanticRefs.performedAction);
        expect(supportRef("status")).toBe(semanticRefs.verification);
        expect(supportRef("rootCause")).toBe(semanticRefs.rootCause);
      }

      inspectAllAssignmentEvidence(db, assignment);
      const review = saveGuidedDraft(db, saveInput(assignment, first.draft));
      expect(review.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          artifactDraftId: first.draft.artifacts[0]?.draftId,
          severity: "error"
        })
      ]));
      expect(review.nextAction.kind).toBe("revise");
      db.close();
    }
  );

  test.each([
    {
      combinedText: "Implemented the signed nonce store and OAuth verification tests passed successfully.",
      kind: "runbook" as const,
      paths: ["fixSteps[0]", "validationChecks[0]"]
    },
    {
      combinedText: "Decided to adopt a signed nonce store after considering the alternative stateless callback design.",
      kind: "adr" as const,
      paths: ["decision", "alternatives[0]"]
    }
  ])("reuses one semantically strongest compact $kind ref instead of an irrelevant distinct ref", async ({ combinedText, kind, paths }) => {
    const db = await serviceDb(1);
    const refs = seedCompactScaffoldEvidence(db, "session:0", combinedText);
    const created = createGuidedRequest(db, requestInput(
      ["session:0"],
      [suggestion(["session:0"], kind, `compact-${kind}`, Object.values(refs))]
    ));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;

    const scaffold = buildGuidedDraftScaffold(db, { assignmentId: assignment.assignmentId, command: "/opt/mastheadctl" });
    const supports = scaffold.draft.artifacts[0]!.output.claimSupport as Array<{ evidenceRef: string; path: string }>;

    expect(paths.map((path) => supports.find((support) => support.path === path)?.evidenceRef))
      .toEqual([refs.combined, refs.combined]);
    expect(supports.filter((support) => paths.includes(support.path)).every((support) => support.evidenceRef !== refs.irrelevant))
      .toBe(true);
    db.close();
  });

  test("repeated start returns the persisted canary, finish, and completed actions", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectAllAssignmentEvidence(db, assignment);
    const staged = saveGuidedDraft(db, saveInput(assignment, publicationBundle(assignment)));

    expect(startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).nextAction)
      .toEqual(staged.nextAction);

    const approved = approveGuidedCanary(db, decisionInput(staged));
    expect(startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).nextAction)
      .toEqual(approved.nextAction);

    finishGuidedAssignment(db, finishInput(assignment.assignmentId));
    expect(startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).nextAction)
      .toEqual({
        command: "",
        kind: "complete",
        reason: "The guided authoring request is complete."
      });
    db.close();
  });

  test("repeated start returns revise for rejected draft work", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({
      accepted: false,
      findings: [{ code: "missing_session_enrichment", message: "revise", severity: "error" }]
    });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectAllAssignmentEvidence(db, assignment);
    const revision = saveGuidedDraft(db, saveInput(assignment, publicationBundle(assignment)));

    expect(startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).nextAction)
      .toEqual(revision.nextAction);
    expect(revision.nextAction.kind).toBe("revise");
    db.close();
  });

  test("repeated start returns finish for a non-canary ready assignment", async () => {
    const db = await serviceDb(4);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(selectionIds(4)));
    const canary = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectAllAssignmentEvidence(db, canary);
    const staged = saveGuidedDraft(db, saveInput(canary, publicationBundle(canary)));
    approveGuidedCanary(db, decisionInput(staged));
    finishGuidedAssignment(db, finishInput(canary.assignmentId));
    const nonCanary = startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).assignment;
    inspectAllAssignmentEvidence(db, nonCanary);
    const ready = saveGuidedDraft(db, saveInput(nonCanary, publicationBundle(nonCanary)));

    expect(startGuidedAssignment(db, { command: "masthead", requestId: created.request.requestId }).nextAction)
      .toEqual(ready.nextAction);
    expect(ready.nextAction.kind).toBe("finish");
    db.close();
  });

  test("builds validation input from the trusted persisted assignment while preserving bundle mismatches", async () => {
    const db = await serviceDb(16);
    const firstOpportunity = suggestion(["session:0"], "adr", "first-persisted", ["message:session:0:seed-user"]);
    const secondOpportunity = suggestion(["session:1"], "runbook", "second-persisted", ["message:session:1:seed-user"]);
    const created = createGuidedRequest(db, requestInput(selectionIds(16), [secondOpportunity, firstOpportunity]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    const bundle = bundleFor(assignment, {
      assignmentId: "assignment:submitted-wrong",
      evidenceRevision: "sha256:submitted-wrong"
    });

    const input = buildGuidedAuthoringValidationInput(db, {
      bundle,
      loadedAssignment: assignment,
      trustedAssignmentId: assignment.assignmentId
    });

    expect(input.bundle).toBe(bundle);
    expect(input.assignment).toEqual({
      assignmentId: assignment.assignmentId,
      evidenceRevision: assignment.evidenceRevision,
      opportunityIds: assignment.opportunityIds,
      requestId: assignment.requestId,
      sessionIds: assignment.sessionIds
    });
    expect([...input.canonicalDossiersBySession.keys()]).toEqual(assignment.sessionIds);
    expect(new Set([...input.evidenceByRef.values()].map(({ sessionId }) => sessionId)))
      .toEqual(new Set(assignment.sessionIds));
    expect(input.coverage).toEqual(assignment.sessionIds.map((sessionId) => ({
      accessedItems: 0,
      complete: false,
      evidenceRevision: assignment.evidenceRevision,
      sessionId,
      totalItems: 4
    })));
    const opportunitiesById = new Map(listGuidedOpportunities(db, assignment.requestId)
      .map((opportunity) => [opportunity.opportunityId, opportunity]));
    expect(input.opportunities).toEqual(assignment.opportunityIds.map((opportunityId) => {
      const opportunity = opportunitiesById.get(opportunityId)!;
      return {
        evidenceRefs: opportunity.evidenceRefs,
        opportunityId,
        provenanceSessionIds: opportunity.provenanceSessionIds,
        signalStrength: opportunity.signalStrength,
        suggestedKind: opportunity.suggestedKind,
        summary: opportunity.summary
      };
    }));
    db.close();
  });

  test("selects only each other assignment's exact accepted draft revision", async () => {
    const db = await serviceDb(16);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(16)));
    const [current, acceptedOther, rejectedOther] = getGuidedAssignments(db, created.request.requestId);
    insertDraftReview(db, current!, 1, true);
    insertDraftReview(db, acceptedOther!, 1, true);
    insertDraftReview(db, acceptedOther!, 2, false);
    insertDraftReview(db, rejectedOther!, 1, false);
    const loadedAssignment = getGuidedAssignment(db, current!.assignmentId)!;

    const input = buildGuidedAuthoringValidationInput(db, {
      bundle: bundleFor(loadedAssignment),
      loadedAssignment,
      trustedAssignmentId: loadedAssignment.assignmentId
    });

    expect(input.requestAcceptedDrafts).toEqual([{
      assignmentId: acceptedOther!.assignmentId,
      draft: bundleFor(acceptedOther!, { evidenceRevision: "revision:1" }),
      draftRevision: 1,
      evidenceRevision: "revision:1"
    }]);
    db.close();
  });

  test("rejects an accepted draft pointer that targets a rejected review row", async () => {
    const db = await serviceDb(16);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(16)));
    const [current, rejectedOther] = getGuidedAssignments(db, created.request.requestId);
    insertDraftReview(db, rejectedOther!, 1, false);
    db.prepare(
      "UPDATE guided_authoring_assignments SET accepted_draft_revision = 1 WHERE assignment_id = ?"
    ).run(rejectedOther!.assignmentId);
    const loadedAssignment = getGuidedAssignment(db, current!.assignmentId)!;

    expect(() => buildGuidedAuthoringValidationInput(db, {
      bundle: bundleFor(loadedAssignment),
      loadedAssignment,
      trustedAssignmentId: loadedAssignment.assignmentId
    })).toThrow(`guided_accepted_draft_revision_invariant:${rejectedOther!.assignmentId}`);
    db.close();
  });

  test("rejects a loaded assignment that does not match the trusted route identity", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;

    expect(() => buildGuidedAuthoringValidationInput(db, {
      bundle: bundleFor(assignment),
      loadedAssignment: assignment,
      trustedAssignmentId: "assignment:different"
    })).toThrow("guided_assignment_identity_invariant");
    db.close();
  });

  test("refuses a stale persisted assignment evidence baseline", async () => {
    const db = await serviceDb(3);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(3)));
    db.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?").run("Changed evidence", "session:0");

    expect(() => startGuidedAssignment(db, {
      command: "masthead",
      requestId: created.request.requestId
    })).toThrow("guided_assignment_evidence_changed");
    db.close();
  });

  test("requires complete canonical evidence coverage before save", async () => {
    const db = await serviceDb(2);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(2)));
    const assignmentId = created.request.currentAssignmentId!;

    const first = inspectGuidedAssignment(db, { assignmentId, command: "masthead", limit: 1 });
    const sampled = inspectGuidedAssignment(db, {
      assignmentId,
      command: "masthead",
      limit: 1,
      order: "desc"
    });
    const review = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });

    expect(first.progressRecorded).toBe(true);
    expect(first.authoringContract.rule).toContain("the capsule summary must state that specific result");
    expect(first.authoringContract.rule).toContain("keep work completion separate from explicit verification status and warnings");
    expect(first.evidenceRevision).not.toBe(first.evidence.evidenceRevision);
    expect(first.coverage.every(({ evidenceRevision }) => evidenceRevision === first.evidenceRevision)).toBe(true);
    expect(listGuidedEvidenceAccess(db, assignmentId).every(({ evidenceRevision }) => (
      evidenceRevision === first.evidenceRevision && evidenceRevision !== first.evidence.evidenceRevision
    ))).toBe(true);
    expect(sampled.progressRecorded).toBe(false);
    expect(review.coverage[0]).toMatchObject({ accessedItems: 1, complete: false, totalItems: 4 });
    expect(review.nextAction.kind).toBe("inspect");
    expect(review.editorialQuestions).toEqual(GUIDED_EVIDENCE_QUESTIONS);

    let current = review;
    for (let index = 0; index < 10 && current.nextAction.kind === "inspect"; index += 1) {
      inspectGuidedAssignment(db, { assignmentId, command: "masthead", limit: 2 });
      current = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    }
    expect(current.coverage.every(({ complete }) => complete)).toBe(true);
    expect(current.nextAction).toEqual({
      command: `masthead workbench author scaffold --assignment ${assignmentId} --file ${guidedDraftFilePath(assignmentId)} --json`,
      kind: "scaffold",
      reason: "Every assignment session has complete canonical evidence coverage; generate the daemon-owned V4 scaffold before authoring."
    });
    db.close();
  });

  test("keeps supplementary reads out of coverage and returns the earliest canonical hole", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;

    const assignmentBefore = getGuidedAssignment(db, assignmentId);
    for (const supplementary of [{ query: "OAuth" }, { kind: "tools" as const }, { order: "desc" as const }]) {
      const inspected = inspectGuidedAssignment(db, { assignmentId, command: "masthead", ...supplementary });
      expect(inspected.progressRecorded).toBe(false);
    }
    expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual([]);
    expect(getGuidedAssignment(db, assignmentId)).toEqual(assignmentBefore);

    inspectGuidedAssignment(db, { assignmentId, command: "masthead", cursor: "2", limit: 1 });
    expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" }).nextAction).toEqual({
      command: `masthead workbench author inspect --assignment ${assignmentId} --session session:0 --cursor 0 --json`,
      kind: "inspect",
      reason: "Session session:0 still has unread canonical evidence."
    });
    db.close();
  });

  test("accepts leading-zero decimal cursors and keeps repeated explicit reads idempotent", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;
    const input = { assignmentId, command: "masthead", cursor: "01", limit: 1 };

    const first = inspectGuidedAssignment(db, input);
    const access = listGuidedEvidenceAccess(db, assignmentId);
    const repeated = inspectGuidedAssignment(db, input);

    expect(first.evidence.items).toHaveLength(1);
    expect(repeated.coverage).toEqual(first.coverage);
    expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual(access);
    db.close();
  });

  test("derives holes from observedAt and itemId order rather than access count", async () => {
    const db = await serviceDb(1);
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session:0");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session:0");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:0");
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:0");
    const insert = db.prepare(
      `INSERT INTO messages
       (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
       VALUES (?, 'session:0', 'user', ?, ?, ?, '{}', 'authoritative')`
    );
    insert.run("item:z", "Earlier z", "hash:z", "2026-07-19T10:00:00.000Z");
    insert.run("item:b", "Later b", "hash:b", "2026-07-19T10:01:00.000Z");
    insert.run("item:a", "Later a", "hash:a", "2026-07-19T10:01:00.000Z");
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;

    const skipped = inspectGuidedAssignment(db, { assignmentId, command: "masthead", cursor: "1", limit: 1 });
    expect(skipped.evidence.items[0]?.itemId).toBe("message:item:a");
    expect(skipped.nextAction.command).toContain("--cursor 0");
    const first = inspectGuidedAssignment(db, { assignmentId, command: "masthead", cursor: "0", limit: 1 });
    expect(first.evidence.items[0]?.itemId).toBe("message:item:z");
    expect(first.nextAction.command).toContain("--cursor 2");
    db.close();
  });

  test("chooses incomplete sessions in persisted assignment order", async () => {
    const db = await serviceDb(2);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(["session:1", "session:0"]));
    const assignmentId = created.request.currentAssignmentId!;

    inspectGuidedAssignment(db, {
      assignmentId,
      command: "masthead",
      limit: 100,
      sessionId: "session:1"
    });
    expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" }).nextAction.command)
      .toContain("--session session:0 --cursor 0");
    db.close();
  });

  test.each(["", " ", "NaN", "-1", "1.5", "+1", "1e2", "0x10", "1junk", "9007199254740992", "4", "999"])(
    "rejects invalid inspection cursor %j before recording progress",
    async (cursor) => {
      const db = await serviceDb(1);
      vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
      const created = createGuidedRequest(db, requestInput(selectionIds(1)));
      const assignmentId = created.request.currentAssignmentId!;
      expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead", cursor }))
        .toThrow("guided_inspection_cursor_invalid");
      expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead", cursor, query: "OAuth" }))
        .toThrow("guided_inspection_cursor_invalid");
      expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual([]);
      db.close();
    }
  );

  test("commits assignment-wide evidence revision reset before throwing", async () => {
    const fixture = await serviceDbWithPath(2);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(fixture.db, requestInput(selectionIds(2)));
    const assignmentId = created.request.currentAssignmentId!;
    const previousRevision = getGuidedAssignment(fixture.db, assignmentId)!.evidenceRevision;
    inspectGuidedAssignment(fixture.db, { assignmentId, command: "masthead", limit: 1 });
    fixture.db.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?")
      .run("Changed canonical evidence", "session:1");

    expect(() => inspectGuidedAssignment(fixture.db, {
      assignmentId,
      command: "masthead",
      query: "Changed"
    })).toThrow("evidence_revision_changed");

    const second = await openMastheadDatabase(fixture.databasePath);
    const advanced = getGuidedAssignment(second, assignmentId)!;
    expect(advanced.evidenceRevision).not.toBe(previousRevision);
    expect(reviewGuidedAssignment(second, { assignmentId, command: "masthead" }).coverage)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ accessedItems: 0, complete: false, evidenceRevision: advanced.evidenceRevision })
      ]));
    expect(listGuidedEvidenceAccess(second, assignmentId, previousRevision)).toHaveLength(1);
    second.close();
    fixture.db.close();
  });

  test("defensively resets when evidence changes after the page read", async () => {
    const db = await serviceDb(2);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(2)));
    const assignmentId = created.request.currentAssignmentId!;
    const previousRevision = getGuidedAssignment(db, assignmentId)!.evidenceRevision;
    const originalPage = evidenceCatalog.getAuthoringEvidencePage;
    vi.spyOn(evidenceCatalog, "getAuthoringEvidencePage").mockImplementation((database, query) => {
      const page = originalPage(database, query);
      database.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?")
        .run("Changed after page selection", "session:1");
      return page;
    });

    expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead", limit: 1 }))
      .toThrow("evidence_revision_changed");
    expect(getGuidedAssignment(db, assignmentId)!.evidenceRevision).not.toBe(previousRevision);
    expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual([]);
    db.close();
  });

  test("keeps review read-only", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;
    const assignmentBefore = getGuidedAssignment(db, assignmentId);
    const changesBefore = totalChanges(db);

    reviewGuidedAssignment(db, { assignmentId, command: "masthead" });

    expect(totalChanges(db)).toBe(changesBefore);
    expect(getGuidedAssignment(db, assignmentId)).toEqual(assignmentBefore);
    expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual([]);
    db.close();
  });

  test("hides stale draft findings after revision reset while preserving history", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;
    const assignment = getGuidedAssignment(db, assignmentId)!;
    const draft = {
      artifacts: [],
      assignmentId,
      bundleVersion: "workbench-authoring-v4",
      evidenceRevision: assignment.evidenceRevision,
      opportunityDispositions: [],
      sessionEnrichments: []
    };
    db.prepare(
      `INSERT INTO guided_authoring_draft_reviews
       (assignment_id, revision, evidence_revision, draft_json, findings_json, accepted, created_at)
       VALUES (?, 1, ?, ?, ?, 0, ?)`
    ).run(
      assignmentId,
      assignment.evidenceRevision,
      JSON.stringify(draft),
      JSON.stringify([{ code: "revise", message: "Revise it", severity: "error" }]),
      "2026-07-19T12:00:00.000Z"
    );
    db.prepare(
      "UPDATE guided_authoring_assignments SET status = 'needs_revision', current_draft_revision = 1 WHERE assignment_id = ?"
    ).run(assignmentId);
    db.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?").run("New evidence", "session:0");

    expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead" }))
      .toThrow("evidence_revision_changed");
    const reviewed = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    expect(reviewed).toMatchObject({
      editorialQuestions: GUIDED_EVIDENCE_QUESTIONS,
      findings: [],
      nextAction: { kind: "inspect" }
    });
    expect(reviewed).not.toHaveProperty("draft");
    expect(reviewed).not.toHaveProperty("draftRevision");
    expect(getGuidedAssignment(db, assignmentId)).toMatchObject({ currentDraftRevision: 1, findings: [] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM guided_authoring_draft_reviews WHERE assignment_id = ?")
      .get(assignmentId)).toEqual({ count: 1 });
    db.close();
  });

  test("serializes two WAL inspectors before page selection", async () => {
    const fixture = await serviceDbWithPath(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(fixture.db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;
    const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3));
    const workerUrl = new URL("./fixtures/guidedInspectionWalWorker.mjs", import.meta.url);
    const workerA = new Worker(workerUrl, {
      workerData: {
        assignmentId,
        databasePath: fixture.databasePath,
        identity: testIdentity(),
        pauseAfterSelection: true,
        releaseIndex: 1,
        shared: state.buffer
      }
    });
    const workers = [workerA];
    try {
      await waitForWorkerMessage(workerA, "page_selected", 2_000);
      const workerB = new Worker(workerUrl, {
        workerData: {
          assignmentId,
          databasePath: fixture.databasePath,
          identity: testIdentity(),
          pauseAfterSelection: false,
          releaseIndex: 2,
          shared: state.buffer
        }
      });
      workers.push(workerB);
      await waitForWorkerMessage(workerB, "transaction_attempted", 2_000);
      await expect(waitForWorkerMessage(workerB, "page_selected", 100)).rejects.toThrow("bounded_timeout");

      const committedA = waitForWorkerMessage(workerA, "committed", 2_000);
      const selectedB = waitForWorkerMessage(workerB, "page_selected", 2_000);
      const committedB = waitForWorkerMessage(workerB, "committed", 2_000);
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
      const [first, secondSelected, second] = await Promise.all([committedA, selectedB, committedB]);

      expect(first.kind).toBe("committed");
      expect(secondSelected.kind).toBe("page_selected");
      expect(first.result.evidence.items[0]?.itemId).not.toBe(second.result.evidence.items[0]?.itemId);
      expect(second.result.coverage[0]?.accessedItems).toBe(2);
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      fixture.db.close();
    }
  });

  test("refuses nested inspection and locked evidence revision resets", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;

    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead" }))
        .toThrow("guided_inspection_requires_top_level_transaction");
    } finally {
      db.exec("ROLLBACK");
    }

    for (const [status, nextKind] of [["staged_canary", "await_operator"], ["ready_to_finish", "finish"]] as const) {
      db.prepare("UPDATE guided_authoring_assignments SET status = ? WHERE assignment_id = ?").run(status, assignmentId);
      db.prepare("UPDATE messages SET text_redacted = text_redacted || ? WHERE session_id = ?")
        .run(` ${status}`, "session:0");
      expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead" }))
        .toThrow("guided_assignment_not_inspectable");
      expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" }).nextAction.kind).toBe(nextKind);
    }
    db.prepare("UPDATE guided_authoring_assignments SET status = 'completed' WHERE assignment_id = ?").run(assignmentId);
    const completedReview = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' completed' WHERE session_id = ?").run("session:0");
    expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead" }))
      .toThrow("guided_assignment_not_inspectable");
    expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" })).toEqual(completedReview);
    db.close();
  });

  test.each(["staged_canary", "ready_to_finish", "completed"] as const)(
    "refuses inspection in unchanged locked %s state before recording progress",
    async (status) => {
      const db = await serviceDb(1);
      vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
      const created = createGuidedRequest(db, requestInput(["session:0"]));
      const assignmentId = created.request.currentAssignmentId!;
      db.prepare("UPDATE guided_authoring_assignments SET status = ? WHERE assignment_id = ?")
        .run(status, assignmentId);
      const beforeAccess = listGuidedEvidenceAccess(db, assignmentId);
      const beforeChanges = totalChanges(db);

      expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead", limit: 100 }))
        .toThrow("guided_assignment_not_inspectable");
      expect(listGuidedEvidenceAccess(db, assignmentId)).toEqual(beforeAccess);
      expect(totalChanges(db)).toBe(beforeChanges);
      db.close();
    }
  );

  test.each([
    ["staged_canary", "await_operator"],
    ["ready_to_finish", "finish"]
  ] as const)("keeps coherent historical coverage for stale locked %s review", async (status, nextKind) => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(selectionIds(1)));
    const assignmentId = created.request.currentAssignmentId!;
    inspectGuidedAssignment(db, { assignmentId, command: "masthead", limit: 100 });
    db.prepare("UPDATE guided_authoring_assignments SET status = ? WHERE assignment_id = ?").run(status, assignmentId);
    const historical = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    db.prepare(
      `INSERT INTO messages
       (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
       VALUES (?, ?, 'user', ?, ?, ?, '{}', 'authoritative')`
    ).run("message:later", "session:0", "Later evidence", "hash:later", "2026-07-19T13:00:00.000Z");

    const stale = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    expect(stale.coverage).toEqual(historical.coverage);
    expect(stale.coverage[0]).toMatchObject({ accessedItems: 4, complete: true, totalItems: 4 });
    expect(stale.nextAction.kind).toBe(nextKind);
    db.close();
  });

  test("stages an accepted canary without publishing", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });

    const review = saveGuidedDraft(db, saveInput(assignment, bundleFor(assignment)));

    expect(review.status).toBe("staged_canary");
    expect(review.nextAction.kind).toBe("await_operator");
    expect(tableCount(db, "session_artifacts")).toBe(0);
    expect(getGuidedAuthoringRequest(db, assignment.requestId)?.status).toBe("awaiting_canary_approval");
    db.close();
  });

  test("approves and rejects only the exact current canary revision", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });
    const staged = saveGuidedDraft(db, saveInput(assignment, bundleFor(assignment)));
    const beforeApproval = approvalIsolationState(db);

    const approved = approveGuidedCanary(db, decisionInput(staged));
    expect(approved.nextAction.kind).toBe("finish");
    expect(approvalIsolationState(db)).toEqual(beforeApproval);

    expect(() => rejectGuidedCanary(db, {
      ...decisionInput(staged),
      notes: "A conflicting later decision."
    })).toThrow("guided_canary_decision_conflict");
    db.close();
  });

  test("rejects a canary into revision work without publishing", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });
    const staged = saveGuidedDraft(db, saveInput(assignment, bundleFor(assignment)));

    const rejected = rejectGuidedCanary(db, {
      ...decisionInput(staged),
      notes: "The canary needs a more specific reusable outcome."
    });

    expect(rejected).toMatchObject({
      status: "needs_revision",
      nextAction: {
        command: `masthead workbench author save --assignment ${assignment.assignmentId} --file ${guidedDraftFilePath(assignment.assignmentId)} --json`,
        kind: "revise",
        reason: "The saved draft has blocking structured findings to resolve."
      }
    });
    expect(getGuidedAuthoringRequest(db, assignment.requestId)?.status).toBe("open");
    expect(tableCount(db, "session_artifacts")).toBe(0);
    db.close();
  });

  test.each(["save", "approve", "reject", "finish"] as const)(
    "refuses nested public %s before validation or mutation",
    async (operation) => {
      const db = await serviceDb(1);
      db.exec("BEGIN IMMEDIATE");
      try {
        const identity = testIdentity();
        const invoke = {
          save: () => saveGuidedDraft(db, { assignmentId: "missing", command: "masthead", currentIdentity: identity, draft: {} as GuidedAuthoringBundleV4, expectedIdentity: identity }),
          approve: () => approveGuidedCanary(db, { assignmentId: "missing", command: "masthead", currentIdentity: identity, draftRevision: 1, evidenceRevision: "evidence", expectedIdentity: identity, notes: "notes", requestId: "missing", reviewedBy: "operator" }),
          reject: () => rejectGuidedCanary(db, { assignmentId: "missing", command: "masthead", currentIdentity: identity, draftRevision: 1, evidenceRevision: "evidence", expectedIdentity: identity, notes: "notes", requestId: "missing", reviewedBy: "operator" }),
          finish: () => finishGuidedAssignment(db, { assignmentId: "missing", command: "masthead", currentIdentity: identity, expectedIdentity: identity })
        }[operation];
        expect(invoke).toThrow("guided_authoring_public_mutation_requires_top_level_transaction");
      } finally {
        db.exec("ROLLBACK");
      }
      db.close();
    }
  );

  test("guards save identity before opening its owned transaction or validating", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    const validation = vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft");
    const begin = vi.spyOn(db, "exec");

    expect(() => saveGuidedDraft(db, {
      ...saveInput(assignment, bundleFor(assignment)),
      currentIdentity: { ...testIdentity(), instanceId: "instance:rotated" }
    })).toThrow("instance_identity_mismatch");
    expect(validation).not.toHaveBeenCalled();
    expect(begin.mock.calls.flat()).not.toContain("BEGIN IMMEDIATE;");
    db.close();
  });

  test("guards create, start, and progress-recording inspect before their first write", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const identity = testIdentity();
    const swapped = { ...identity, instanceId: "instance:swapped" };
    const beforeCreate = totalChanges(db);
    expect(() => createGuidedRequestService(db, {
      ...requestInput(["session:0"]),
      expectedIdentity: swapped
    })).toThrow("instance_identity_mismatch");
    expect(totalChanges(db)).toBe(beforeCreate);

    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignmentId = created.request.currentAssignmentId!;
    const beforeStart = totalChanges(db);
    expect(() => startGuidedAssignmentService(db, {
      command: "masthead",
      currentIdentity: identity,
      expectedIdentity: swapped,
      requestId: created.request.requestId
    })).toThrow("instance_identity_mismatch");
    expect(totalChanges(db)).toBe(beforeStart);

    const beforeInspect = totalChanges(db);
    expect(() => inspectGuidedAssignmentService(db, {
      assignmentId,
      command: "masthead",
      currentIdentity: identity,
      expectedIdentity: swapped
    })).toThrow("instance_identity_mismatch");
    expect(totalChanges(db)).toBe(beforeInspect);
    db.close();
  });

  test.each(["save", "approve", "reject", "finish"] as const)(
    "%s rejects a rotated current instance before its first write",
    async (operation) => {
      const db = await serviceDb(1);
      vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
      const created = createGuidedRequest(db, requestInput(["session:0"]));
      const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
      const expectedIdentity = testIdentity();
      const currentIdentity = { ...expectedIdentity, instanceId: "instance:rotated" };
      const before = totalChanges(db);
      const common = { command: "masthead", currentIdentity, expectedIdentity };
      const invoke = {
        save: () => saveGuidedDraft(db, { ...common, assignmentId: assignment.assignmentId, draft: bundleFor(assignment) }),
        approve: () => approveGuidedCanary(db, { ...common, assignmentId: assignment.assignmentId, draftRevision: 1, evidenceRevision: assignment.evidenceRevision, notes: "notes", requestId: assignment.requestId, reviewedBy: "operator" }),
        reject: () => rejectGuidedCanary(db, { ...common, assignmentId: assignment.assignmentId, draftRevision: 1, evidenceRevision: assignment.evidenceRevision, notes: "notes", requestId: assignment.requestId, reviewedBy: "operator" }),
        finish: () => finishGuidedAssignment(db, { ...common, assignmentId: assignment.assignmentId })
      }[operation];
      expect(invoke).toThrow("instance_identity_mismatch");
      expect(totalChanges(db)).toBe(before);
      db.close();
    }
  );

  test("runs the save probe before all six validation-state families", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: false, findings: [{ code: "missing_session_enrichment", message: "revise", severity: "error" }] });
    const created = createGuidedRequest(db, requestInput(["session:0"]));
    const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });
    const events: string[] = [];
    const uninstall = installGuidedAuthoringServiceTestHooks(db, {
      afterOwnedSaveBegin: () => {
        expect(db.isTransaction).toBe(true);
        events.push("begin");
      },
      beforeValidationStateRead: (family) => events.push(family)
    });
    try {
      saveGuidedDraft(db, saveInput(assignment, bundleFor(assignment)));
    } finally {
      uninstall();
    }
    expect(events).toEqual([
      "begin", "assignment", "canonical_dossier", "opportunity",
      "accepted_revision", "coverage", "canonical_evidence"
    ]);
    db.close();
  });

  test.each([
    "assignment",
    "coverage",
    "canonical_dossier",
    "canonical_evidence",
    "opportunity",
    "accepted_revision"
  ] as const)("serializes save validation and persistence against a %s writer", async (kind) => {
    const fixture = await serviceDbWithPath(kind === "accepted_revision" ? 4 : 1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([
      suggestion(["session:0"], "adr", "wal-opportunity", ["message:session:0:message"])
    ]);
    const validation = vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({
      accepted: false,
      findings: [{ code: "missing_session_enrichment", message: "revise", severity: "error" }]
    });
    const created = createGuidedRequest(
      fixture.db,
      requestInput(kind === "accepted_revision" ? selectionIds(4) : ["session:0"])
    );
    let assignment = getGuidedAssignment(fixture.db, created.request.currentAssignmentId!)!;
    let acceptedAssignmentId: string | undefined;
    let acceptedSummarySeenBySaver: string | undefined;
    if (kind === "accepted_revision") {
      acceptedAssignmentId = assignment.assignmentId;
      inspectAllAssignmentEvidence(fixture.db, assignment);
      validation.mockReturnValue({ accepted: true, findings: [] });
      const staged = saveGuidedDraft(fixture.db, saveInput(assignment, publicationBundle(assignment)));
      approveGuidedCanary(fixture.db, decisionInput(staged));
      finishGuidedAssignment(fixture.db, finishInput(assignment.assignmentId));
      assignment = getGuidedAssignment(fixture.db, getGuidedAuthoringRequest(fixture.db, assignment.requestId)!.currentAssignmentId!)!;
      validation.mockImplementation((input) => {
        acceptedSummarySeenBySaver = input.requestAcceptedDrafts[0]?.draft.sessionEnrichments[0]?.enrichment.sessionSummary.text;
        return {
          accepted: false,
          findings: [{ code: "missing_session_enrichment", message: "revise", severity: "error" }]
        };
      });
    }
    inspectGuidedAssignment(fixture.db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });
    const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5));
    const worker = new Worker(new URL("./fixtures/guidedSaveWalWriter.mjs", import.meta.url), {
      workerData: {
        assignmentId: assignment.assignmentId,
        acceptedAssignmentId,
        databasePath: fixture.databasePath,
        evidenceRevision: assignment.evidenceRevision,
        kind,
        requestId: assignment.requestId,
        sessionId: "session:0",
        shared: state.buffer
      }
    });
    const observed: string[] = [];
    let probeCalls = 0;
    const uninstall = installGuidedAuthoringServiceTestHooks(fixture.db, {
      afterOwnedSaveBegin: () => {
        probeCalls += 1;
        expect(fixture.db.isTransaction).toBe(true);
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
        expect(Atomics.wait(state, 1, 0, 2_000)).not.toBe("timed-out");
        expect(Atomics.wait(state, 2, 0, 100)).toBe("timed-out");
      },
      beforeValidationStateRead: (family) => observed.push(family)
    });
    try {
      saveGuidedDraft(fixture.db, saveInput(assignment, bundleFor(assignment)));
      expect(Atomics.wait(state, 3, 0, 3_000)).not.toBe("timed-out");
      expect(Atomics.load(state, 4)).toBe(0);
      expect(probeCalls).toBe(1);
      expect(observed).toEqual([
        "assignment", "canonical_dossier", "opportunity",
        "accepted_revision", "coverage", "canonical_evidence"
      ]);
      expect(listGuidedDraftReviews(fixture.db, assignment.assignmentId)).toHaveLength(1);
      if (kind === "accepted_revision") {
        expect(acceptedSummarySeenBySaver).toBe("Repaired and verified the OAuth authentication callback.");
        const persistedAcceptedDraft = listGuidedDraftReviews(fixture.db, acceptedAssignmentId!)[0]!.draft;
        expect(persistedAcceptedDraft.sessionEnrichments[0]?.enrichment.sessionSummary.text)
          .toBe("Writer changed the accepted summary after the saver snapshot.");
      }
    } finally {
      uninstall();
      await worker.terminate();
      fixture.db.close();
    }
  });

  test.each(GUIDED_PUBLICATION_FAILURE_POINTS)(
    "rolls back the entire finish boundary at %s",
    async (failurePoint) => {
      const db = await serviceDb(1);
      vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
      const assignment = seedReadyPublicationAssignment(db);
      const before = publicationCounts(db);
      const uninstall = installGuidedAuthoringServiceTestHooks(db, {
        afterPublicationBoundary: (point) => {
          if (point === failurePoint) throw new Error("injected_publication_failure");
        }
      });
      try {
        expect(() => finishGuidedAssignment(db, finishInput(assignment.assignmentId)))
          .toThrow("injected_publication_failure");
      } finally {
        uninstall();
      }
      expect(publicationCounts(db)).toEqual(before);
      expect(getGuidedAssignmentReceipt(db, assignment.assignmentId)).toBeUndefined();
      db.close();
    }
  );

  test("commits locked revision invalidation before finish throws", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const assignment = seedReadyPublicationAssignment(db);
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' changed' WHERE session_id = 'session:0'").run();

    expect(() => finishGuidedAssignment(db, finishInput(assignment.assignmentId)))
      .toThrow("evidence_revision_changed");

    const invalidated = getGuidedAssignment(db, assignment.assignmentId)!;
    expect(invalidated).toMatchObject({
      currentDraftRevision: 1,
      status: "investigating"
    });
    expect(invalidated).not.toHaveProperty("acceptedDraftRevision");
    expect(listGuidedDraftReviews(db, assignment.assignmentId)).toHaveLength(1);
    expect(reviewGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead" }))
      .toMatchObject({ findings: [], nextAction: { kind: "inspect" } });
    expect(getGuidedAssignmentReceipt(db, assignment.assignmentId)).toBeUndefined();
    db.close();
  });

  test("requires canary finish from staged_canary with its exact current approval", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const assignment = seedReadyPublicationAssignment(db);
    db.prepare("UPDATE guided_authoring_assignments SET status = 'ready_to_finish' WHERE assignment_id = ?")
      .run(assignment.assignmentId);

    expect(() => finishGuidedAssignment(db, finishInput(assignment.assignmentId)))
      .toThrow("guided_assignment_not_ready");
    expect(getGuidedAssignmentReceipt(db, assignment.assignmentId)).toBeUndefined();
    db.close();
  });

  test("does not allow an outer transaction to capture locked invalidation", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const assignment = seedReadyPublicationAssignment(db);
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' changed' WHERE session_id = 'session:0'").run();
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => finishGuidedAssignment(db, finishInput(assignment.assignmentId)))
        .toThrow("guided_authoring_public_mutation_requires_top_level_transaction");
    } finally {
      db.exec("ROLLBACK");
    }
    expect(getGuidedAssignment(db, assignment.assignmentId)).toMatchObject({
      acceptedDraftRevision: 1,
      status: "staged_canary"
    });
    db.close();
  });

  test("publishes atomically, records provenance for every enrichment, and retries immutably", async () => {
    const db = await serviceDb(1);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    const assignment = seedReadyPublicationAssignment(db);
    const revisionsBefore = getDataRevisions(db);
    const first = finishGuidedAssignment(db, finishInput(assignment.assignmentId));
    expect(first.nextAction).toEqual({
      command: "",
      kind: "complete",
      reason: "The guided authoring request is complete."
    });
    expect(first.receipt.publishedArtifacts).toHaveLength(1);
    expect(listGuidedEnrichmentProvenance(db, assignment.assignmentId)).toHaveLength(3);
    expect(getDataRevisions(db)).toEqual({
      logbook: revisionsBefore.logbook + 1,
      workbench: revisionsBefore.workbench + 1
    });

    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' later' WHERE session_id = 'session:0'").run();
    expect(finishGuidedAssignment(db, finishInput(assignment.assignmentId))).toEqual(first);
    db.close();
  });

  test("finishing a canary releases ordinal one for claim_next and a non-canary finishes from ready_to_finish", async () => {
    const db = await serviceDb(4);
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([]);
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    const created = createGuidedRequest(db, requestInput(selectionIds(4)));
    const canary = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
    inspectAllAssignmentEvidence(db, canary);
    const staged = saveGuidedDraft(db, saveInput(canary, publicationBundle(canary)));
    approveGuidedCanary(db, decisionInput(staged));

    const canaryFinished = finishGuidedAssignment(db, finishInput(canary.assignmentId));
    expect(canaryFinished.nextAction).toEqual({
      command: `masthead workbench author start --request ${canary.requestId} --json`,
      kind: "claim_next",
      reason: "The next guided assignment is ready to start."
    });
    expect(db.prepare(
      `SELECT session_id AS sessionId, state FROM guided_authoring_request_sessions
       WHERE request_id = ? ORDER BY ordinal`
    ).all(canary.requestId)).toEqual([
      { sessionId: "session:0", state: "completed" },
      { sessionId: "session:1", state: "completed" },
      { sessionId: "session:2", state: "completed" },
      { sessionId: "session:3", state: "assigned" }
    ]);

    const started = startGuidedAssignment(db, { command: "masthead", requestId: canary.requestId });
    expect(started.assignment).toMatchObject({ canary: false, ordinal: 1, status: "investigating" });
    inspectGuidedAssignment(db, { assignmentId: started.assignment.assignmentId, command: "masthead", limit: 100 });
    const ready = saveGuidedDraft(db, saveInput(started.assignment, publicationBundle(started.assignment)));
    expect(ready).toMatchObject({ status: "ready_to_finish", nextAction: { kind: "finish" } });
    expect(finishGuidedAssignment(db, finishInput(started.assignment.assignmentId)).nextAction.kind).toBe("complete");
    db.close();
  });
});

function selection(count: number): GuidedPlanningSession[] {
  return Array.from({ length: count }, (_, ordinal) => ({ ordinal, sessionId: `session:${ordinal}`, toolCallCount: 0 }));
}

function selectionIds(count: number): string[] {
  return selection(count).map(({ sessionId }) => sessionId);
}

function suggestion(
  provenanceSessionIds: string[],
  kind: WorkbenchArtifactSuggestionDto["kind"],
  suffix: string,
  evidenceRefs = [`message:${suffix}`]
): WorkbenchArtifactSuggestionDto {
  return {
    advisory: true,
    evidenceRefs,
    kind,
    provenanceSessionIds,
    signatureKey: `signature:${suffix}`,
    suggestionId: `suggestion:${suffix}`,
    summary: `Reusable ${suffix} knowledge.`
  };
}

function seedSemanticScaffoldEvidence(db: MastheadDatabase, sessionId: string) {
  const source = (id: string) => JSON.stringify({ id, source: "semantic-scaffold-test" });
  db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-z-problem", sessionId, "user",
    "The production OAuth callback fails nonce validation and blocks sign-in.",
    "hash:problem", "2026-06-25T12:01:00.000Z", source("opaque-z-problem"), "authoritative"
  );
  db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-a-decision", sessionId, "assistant",
    "Decided to adopt a signed nonce store for callback validation.",
    "hash:decision", "2026-06-25T12:01:30.000Z", source("opaque-a-decision"), "authoritative"
  );
  db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-y-alternative", sessionId, "assistant",
    "The alternative considered was retaining stateless callback validation with shorter expiry.",
    "hash:alternative", "2026-06-25T12:01:45.000Z", source("opaque-y-alternative"), "authoritative"
  );
  db.prepare(
    `INSERT INTO file_effects
     (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-b-change", sessionId, "auth/callback.ts", "modified",
    "2026-06-25T12:02:00.000Z", source("opaque-b-change")
  );
  db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-x-performed-action", sessionId, "assistant",
    "Cleared the stale nonce, bound the replacement nonce, and retried callback validation.",
    "hash:performed-action", "2026-06-25T12:02:15.000Z", source("opaque-x-performed-action"), "authoritative"
  );
  db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-root-cause", sessionId, "assistant",
    "OAuth callback validation failed because the stored state nonce was stale.",
    "hash:root-cause", "2026-06-25T12:02:30.000Z", source("opaque-root-cause"), "authoritative"
  );
  db.prepare(
    `INSERT INTO tool_calls
     (tool_call_id, session_id, tool_name, started_at, source_ref_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "opaque-c-verify-call", sessionId, "vitest", "2026-06-25T12:03:00.000Z", source("opaque-c-verify-call")
  );
  db.prepare(
    `INSERT INTO tool_results
     (tool_result_id, tool_call_id, session_id, status, output_redacted, exit_code, completed_at, source_ref_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "opaque-c-verify", "opaque-c-verify-call", sessionId, "succeeded",
    "OAuth callback tests passed with nonce validation verified.", 0,
    "2026-06-25T12:03:00.000Z", source("opaque-c-verify")
  );
  return {
    alternative: "message:opaque-y-alternative",
    change: "file:opaque-b-change",
    decision: "message:opaque-a-decision",
    performedAction: "message:opaque-x-performed-action",
    problem: "message:opaque-z-problem",
    rootCause: "message:opaque-root-cause",
    verification: "tool_result:opaque-c-verify"
  };
}

function seedCompactScaffoldEvidence(db: MastheadDatabase, sessionId: string, combinedText: string) {
  const insert = db.prepare(
    `INSERT INTO messages
     (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    "compact-z-problem", sessionId, "user",
    "OAuth callback nonce validation fails and blocks sign-in.",
    "hash:compact-problem", "2026-06-25T12:04:00.000Z", "{}", "authoritative"
  );
  insert.run(
    "compact-a-combined", sessionId, "assistant", combinedText,
    "hash:compact-combined", "2026-06-25T12:05:00.000Z", "{}", "authoritative"
  );
  insert.run(
    "compact-m-irrelevant", sessionId, "assistant",
    "The workspace remains available for later follow-up.",
    "hash:compact-irrelevant", "2026-06-25T12:06:00.000Z", "{}", "authoritative"
  );
  return {
    combined: "message:compact-a-combined",
    irrelevant: "message:compact-m-irrelevant",
    problem: "message:compact-z-problem"
  };
}

function bundleFor(
  assignment: GuidedAuthoringAssignmentDto,
  overrides: Partial<GuidedAuthoringBundleV4> = {}
): GuidedAuthoringBundleV4 {
  return {
    artifacts: [],
    assignmentId: assignment.assignmentId,
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: assignment.evidenceRevision,
    opportunityDispositions: [],
    sessionEnrichments: [],
    ...overrides
  };
}

function testIdentity() {
  return {
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "build:test",
    databaseId: "database:test",
    instanceId: "instance:test",
    instanceManifest: "/tmp/masthead-instance.json"
  };
}

function createGuidedRequest(
  db: MastheadDatabase,
  input: Omit<Parameters<typeof createGuidedRequestService>[1], "expectedIdentity">
) {
  return createGuidedRequestService(db, { ...input, expectedIdentity: input.currentIdentity });
}

function startGuidedAssignment(
  db: MastheadDatabase,
  input: Omit<Parameters<typeof startGuidedAssignmentService>[1], "currentIdentity" | "expectedIdentity">
) {
  const identity = testIdentity();
  return startGuidedAssignmentService(db, { ...input, currentIdentity: identity, expectedIdentity: identity });
}

function inspectGuidedAssignment(
  db: MastheadDatabase,
  input: Omit<Parameters<typeof inspectGuidedAssignmentService>[1], "currentIdentity" | "expectedIdentity">
) {
  const identity = testIdentity();
  return inspectGuidedAssignmentService(db, { ...input, currentIdentity: identity, expectedIdentity: identity });
}

function saveInput(assignment: GuidedAuthoringAssignmentDto, draft: GuidedAuthoringBundleV4) {
  const identity = testIdentity();
  return {
    assignmentId: assignment.assignmentId,
    command: "masthead",
    currentIdentity: identity,
    draft,
    expectedIdentity: identity
  };
}

function decisionInput(review: ReturnType<typeof reviewGuidedAssignment>) {
  const identity = testIdentity();
  return {
    assignmentId: review.assignmentId,
    command: "masthead",
    currentIdentity: identity,
    draftRevision: review.draftRevision!,
    evidenceRevision: review.evidenceRevision,
    expectedIdentity: identity,
    notes: "The evidence-backed canary is ready.",
    requestId: review.requestId,
    reviewedBy: "operator:test"
  };
}

function finishInput(assignmentId: string) {
  const identity = testIdentity();
  return { assignmentId, command: "masthead", currentIdentity: identity, expectedIdentity: identity };
}

function inspectAllAssignmentEvidence(db: MastheadDatabase, assignment: GuidedAuthoringAssignmentDto): void {
  for (const sessionId of assignment.sessionIds) {
    inspectGuidedAssignment(db, {
      assignmentId: assignment.assignmentId,
      command: "masthead",
      limit: 100,
      sessionId
    });
  }
}

function seedReadyPublicationAssignment(db: MastheadDatabase): GuidedAuthoringAssignmentDto {
  const created = createGuidedRequest(db, requestInput(["session:0"]));
  const assignment = getGuidedAssignment(db, created.request.currentAssignmentId!)!;
  inspectGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: "masthead", limit: 100 });
  vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
  const staged = saveGuidedDraft(db, saveInput(assignment, publicationBundle(assignment)));
  approveGuidedCanary(db, decisionInput(staged));
  return getGuidedAssignment(db, assignment.assignmentId)!;
}

function publicationBundle(assignment: GuidedAuthoringAssignmentDto): GuidedAuthoringBundleV4 {
  return {
    artifacts: [],
    assignmentId: assignment.assignmentId,
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: assignment.evidenceRevision,
    opportunityDispositions: [],
    sessionEnrichments: assignment.sessionIds.map((sessionId) => ({
      claimSupport: [],
      enrichment: {
        sessionDossier: {
          blockers: [],
          continuation: { constraints: ["Keep the callback contract stable."], openQuestions: [] },
          decisions: ["Keep callback verification local and deterministic."],
          evidenceRefs: [],
          keyWork: ["Repaired the OAuth callback path and verified the resulting state."],
          outcome: "The OAuth callback now returns the authenticated session safely.",
          purpose: "Repair the OAuth authentication callback for this application.",
          verification: {
            commands: ["npm test"],
            evidenceRefs: [],
            failures: [],
            status: "passed",
            summary: "The focused callback verification completed successfully."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefs: [],
          state: "completed",
          text: "Repaired and verified the OAuth authentication callback."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefs: [],
          text: "Repair OAuth authentication callback"
        },
        source: "manual",
        version: "session-capsule-v4"
      },
      sessionId
    }))
  };
}

function tableCount(db: MastheadDatabase, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function publicationCounts(db: MastheadDatabase): Record<string, unknown> {
  return {
    artifacts: tableCount(db, "session_artifacts"),
    enrichmentProvenance: tableCount(db, "guided_authoring_enrichment_provenance"),
    enrichments: tableCount(db, "session_enrichments"),
    request: db.prepare(
      `SELECT status, completed_at AS completedAt,
              (SELECT COUNT(*) FROM guided_authoring_request_sessions WHERE state = 'completed') AS completedSessionCount
       FROM guided_authoring_requests LIMIT 1`
    ).get(),
    assignment: db.prepare(
      `SELECT status, receipt_json AS receiptJson, completed_at AS completedAt
       FROM guided_authoring_assignments LIMIT 1`
    ).get(),
    workbench: db.prepare(
      `SELECT publication_status AS publicationStatus, session_enrichment_status AS enrichmentStatus,
              session_dossier_status AS dossierStatus, next_action AS nextAction
       FROM workbench_session_state WHERE session_id = 'session:0'`
    ).get()
  };
}

function approvalIsolationState(db: MastheadDatabase): Record<string, unknown> {
  return {
    artifacts: tableCount(db, "session_artifacts"),
    enrichmentProvenance: tableCount(db, "guided_authoring_enrichment_provenance"),
    enrichments: tableCount(db, "session_enrichments"),
    requestSessions: db.prepare(
      `SELECT session_id AS sessionId, state FROM guided_authoring_request_sessions ORDER BY ordinal`
    ).all(),
    workbench: db.prepare(
      `SELECT session_id AS sessionId, publication_status AS publicationStatus,
              session_enrichment_status AS enrichmentStatus, session_dossier_status AS dossierStatus,
              next_action AS nextAction
       FROM workbench_session_state ORDER BY session_id`
    ).all()
  };
}

function insertDraftReview(
  db: MastheadDatabase,
  assignment: GuidedAuthoringAssignmentDto,
  revision: number,
  accepted: boolean
): void {
  const evidenceRevision = `revision:${revision}`;
  db.prepare(
    `INSERT INTO guided_authoring_draft_reviews
     (assignment_id, revision, evidence_revision, draft_json, findings_json, accepted, created_at)
     VALUES (?, ?, ?, ?, '[]', ?, ?)`
  ).run(
    assignment.assignmentId,
    revision,
    evidenceRevision,
    JSON.stringify(bundleFor(assignment, { evidenceRevision })),
    accepted ? 1 : 0,
    `2026-07-19T12:00:0${revision}.000Z`
  );
  db.prepare(
    `UPDATE guided_authoring_assignments
     SET current_draft_revision = ?, accepted_draft_revision = CASE WHEN ? = 1 THEN ? ELSE accepted_draft_revision END
     WHERE assignment_id = ?`
  ).run(revision, accepted ? 1 : 0, revision, assignment.assignmentId);
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

async function serviceDb(sessionCount: number): Promise<MastheadDatabase> {
  return (await serviceDbWithPath(sessionCount)).db;
}

async function serviceDbWithPath(sessionCount: number): Promise<{ db: MastheadDatabase; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "masthead-guided-service-"));
  tempDirs.push(root);
  const databasePath = join(root, "masthead.sqlite");
  const db = await openMastheadDatabase(databasePath);
  migrateDatabase(db);
  for (let index = 0; index < sessionCount; index += 1) {
    const sessionId = `session:${index}`;
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: `Session ${index}` });
    markSessionCompileReady(db, sessionId);
  }
  return { databasePath, db };
}

function requestInput(sessionIds: string[], suggestions?: WorkbenchArtifactSuggestionDto[]) {
  if (suggestions) vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue(suggestions);
  return {
    actorId: "codex",
    command: "masthead",
    currentIdentity: {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest: "/tmp/masthead-instance.json"
    },
    sessionIds
  };
}

function guidedCounts(db: MastheadDatabase): number[] {
  return [
    "guided_authoring_requests",
    "guided_authoring_request_sessions",
    "guided_authoring_opportunities",
    "guided_authoring_assignments",
    "guided_authoring_assignment_sessions",
    "guided_authoring_assignment_opportunities"
  ].map((table) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count));
}

function totalChanges(db: MastheadDatabase): number {
  return Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
}

function waitForWorkerMessage(
  worker: Worker,
  kind: string,
  timeoutMs: number
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off("message", onMessage);
      reject(new Error("bounded_timeout"));
    }, timeoutMs);
    const onMessage = (message: Record<string, any>) => {
      if (message.kind === "failed") {
        clearTimeout(timeout);
        worker.off("message", onMessage);
        reject(new Error(message.message));
      } else if (message.kind === kind) {
        clearTimeout(timeout);
        worker.off("message", onMessage);
        resolve(message);
      }
    };
    worker.on("message", onMessage);
  });
}
