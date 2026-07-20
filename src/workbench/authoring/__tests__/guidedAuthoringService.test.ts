import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchArtifactSuggestionDto } from "../../../shared/workbenchAuthoring.ts";
import { getGuidedAssignments, listGuidedOpportunities } from "../../../daemon/db/guidedAuthoringRepository.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import * as advisorySuggestions from "../advisorySuggestions.ts";
import * as evidenceCatalog from "../evidenceCatalog.ts";
import type { AuthoringEvidenceSnapshot } from "../evidenceCatalog.ts";
import {
  GUIDED_TOOL_HEAVY_CALL_THRESHOLD,
  classifyPlanningSession,
  planGuidedAssignments,
  type GuidedPlanningSession
} from "../guidedAuthoringPolicy.ts";
import { assertGuidedSelectionCompileReady } from "../guidedAuthoringPreflight.ts";
import { createGuidedRequest, startGuidedAssignment } from "../guidedAuthoringService.ts";

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
