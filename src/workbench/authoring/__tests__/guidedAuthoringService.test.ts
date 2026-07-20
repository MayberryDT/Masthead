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
  getGuidedAssignments,
  listGuidedEvidenceAccess,
  listGuidedOpportunities
} from "../../../daemon/db/guidedAuthoringRepository.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
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
import {
  buildGuidedAuthoringValidationInput,
  createGuidedRequest,
  inspectGuidedAssignment,
  reviewGuidedAssignment,
  startGuidedAssignment
} from "../guidedAuthoringService.ts";

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
      command: `masthead workbench author save --assignment ${assignmentId} --file <draft.json> --json`,
      kind: "save",
      reason: "Every assignment session has complete canonical evidence coverage."
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
        .toThrow("guided_assignment_evidence_locked");
      expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" }).nextAction.kind).toBe(nextKind);
    }
    db.prepare("UPDATE guided_authoring_assignments SET status = 'completed' WHERE assignment_id = ?").run(assignmentId);
    const completedReview = reviewGuidedAssignment(db, { assignmentId, command: "masthead" });
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' completed' WHERE session_id = ?").run("session:0");
    expect(() => inspectGuidedAssignment(db, { assignmentId, command: "masthead" }))
      .toThrow("guided_assignment_evidence_locked");
    expect(reviewGuidedAssignment(db, { assignmentId, command: "masthead" })).toEqual(completedReview);
    db.close();
  });

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
