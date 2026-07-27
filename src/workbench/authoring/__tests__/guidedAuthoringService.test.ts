import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createGuidedAuthoringRequest, getGuidedAuthoringRequest } from "../../../daemon/db/guidedAuthoringRepository.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type { WorkbenchArtifactSuggestionDto } from "../../../shared/workbenchAuthoring.ts";
import {
  GUIDED_TOOL_HEAVY_CALL_THRESHOLD,
  classifyPlanningSession,
  planGuidedAssignments,
  type GuidedPlanningSession
} from "../guidedAuthoringPolicy.ts";
import { createGuidedRequest, startGuidedAssignment } from "../guidedAuthoringService.ts";

const tempDirs: string[] = [];
const identity = {
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  databaseId: "database:test",
  instanceId: "instance:test",
  instanceManifest: "/tmp/masthead-instance.json"
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("retired guided authoring service", () => {
  test("hard-retires the duplicate V5 request creator before any write", async () => {
    const db = await serviceDb(1);
    const before = totalChanges(db);

    expect(() => createGuidedRequest(db, {
      actorId: "codex",
      command: "masthead",
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds: ["session:0"]
    })).toThrow("authoring_contract_retired");
    expect(totalChanges(db)).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM guided_authoring_requests").get()).toEqual({ count: 0 });
    db.close();
  });

  test("hard-retires legacy guided mutation services while preserving V4 audit rows", async () => {
    const db = await serviceDb(1);
    const request = createGuidedAuthoringRequest(db, {
      actorId: "codex",
      assignments: [{
        assignmentId: "assignment:retired-v4:0",
        canary: true,
        evidenceRevision: "evidence:retired-v4:0",
        opportunityIds: [],
        ordinal: 0,
        sessionIds: ["session:0"]
      }],
      contractVersion: "workbench-authoring-v4",
      identity: {
        baseUrl: identity.baseUrl,
        buildSha: identity.buildSha,
        creationInstanceId: identity.instanceId,
        databaseId: identity.databaseId,
        instanceManifest: identity.instanceManifest
      },
      opportunities: [],
      policyVersion: "guided-authoring-v1",
      requestId: "request:retired-v4",
      sessions: [{ ordinal: 0, sessionId: "session:0" }]
    });
    const before = totalChanges(db);

    expect(() => startGuidedAssignment(db, {
      command: "masthead",
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: request.requestId
    })).toThrow("authoring_contract_retired");
    expect(totalChanges(db)).toBe(before);
    expect(getGuidedAuthoringRequest(db, request.requestId)).toEqual(request);
    db.close();
  });
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

  test("rejects connected strong opportunities above twelve sessions", () => {
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
  const root = await mkdtemp(join(tmpdir(), "masthead-guided-service-"));
  tempDirs.push(root);
  const db = await openMastheadDatabase(join(root, "masthead.sqlite"));
  migrateDatabase(db);
  for (let index = 0; index < sessionCount; index += 1) {
    const sessionId = `session:${index}`;
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: `Session ${index}` });
    markSessionCompileReady(db, sessionId);
  }
  return db;
}

function totalChanges(db: MastheadDatabase): number {
  return Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
}
