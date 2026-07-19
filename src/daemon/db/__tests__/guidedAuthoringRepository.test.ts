import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GuidedAuthoringBundleV4, GuidedAuthoringReceiptDto } from "../../../shared/guidedAuthoring.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { seedSession as seedCanonicalSession } from "./sessionTestHelpers.ts";
import {
  completeGuidedAssignment,
  completeGuidedAssignmentInTransaction,
  createGuidedAuthoringRequest,
  createGuidedAuthoringRequestInTransaction,
  getGuidedAssignment,
  getGuidedAssignments,
  getGuidedAuthoringRequest,
  listGuidedDraftReviews,
  listGuidedEvidenceAccess,
  listGuidedOperatorReviews,
  listGuidedOpportunities,
  recordCanaryDecision,
  recordCanaryDecisionInTransaction,
  recordGuidedEvidenceAccess,
  recordGuidedEvidenceAccessInTransaction,
  storeGuidedDraftReview,
  storeGuidedDraftReviewInTransaction,
  type CreateGuidedAuthoringRequestInput
} from "../guidedAuthoringRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase, withImmediateTransaction } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("guided authoring repository", () => {
  test("migrates a schema-30 database and leaves composite foreign keys valid", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-schema-30-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateTestDatabaseThrough(db, 30);

    migrateDatabase(db);

    expect(db.prepare("SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({
      name: "031_guided_authoring",
      version: 31
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("persists request membership and a three-session canary atomically", async () => {
    const db = await testDb(14);
    const input = requestInput(14);

    const request = createGuidedAuthoringRequest(db, input);
    const assignments = getGuidedAssignments(db, request.requestId);

    expect(request).toMatchObject({
      assignmentCount: 2,
      canaryAssignmentId: "assignment:one:0",
      creationInstanceId: "instance:creation-only",
      sessionCount: 14
    });
    expect(assignments[0]).toMatchObject({ canary: true, sessionIds: ["session:0", "session:1", "session:2"] });
    expect(assignments[1]?.sessionIds).toHaveLength(11);
    expect(listGuidedOpportunities(db, request.requestId)).toEqual([
      expect.objectContaining({ opportunityId: "opportunity:shared", provenanceSessionIds: ["session:0"] }),
      expect.objectContaining({ opportunityId: "opportunity:one:1", provenanceSessionIds: ["session:3"] })
    ]);
  });

  test("rolls back request membership, opportunities, assignments, and canary together", async () => {
    const db = await testDb(14);
    db.exec(`CREATE TRIGGER abort_guided_assignment
      BEFORE INSERT ON guided_authoring_assignments
      BEGIN SELECT RAISE(ABORT, 'injected_guided_request_failure'); END;`);

    expect(() => createGuidedAuthoringRequest(db, requestInput(14))).toThrow("injected_guided_request_failure");
    for (const table of guidedTables) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  test("records evidence refs idempotently and preserves revisions", async () => {
    const db = await createdDb();
    const access = {
      assignmentId: "assignment:one:0",
      evidenceRefs: ["message:a:1", "message:a:1"],
      evidenceRevision: "evidence:one:0",
      requestId: "request:one",
      sessionId: "session:0"
    };

    recordGuidedEvidenceAccess(db, access);
    recordGuidedEvidenceAccess(db, access);
    recordGuidedEvidenceAccess(db, { ...access, evidenceRevision: "evidence:one:0:revised" });

    expect(listGuidedEvidenceAccess(db, access.assignmentId)).toHaveLength(2);
    expect(listGuidedEvidenceAccess(db, access.assignmentId, access.evidenceRevision)).toHaveLength(1);
  });

  test("rejects evidence for a session outside the assignment", async () => {
    const db = await createdDb();
    expect(() => recordGuidedEvidenceAccess(db, {
      assignmentId: "assignment:one:0",
      evidenceRefs: ["message:wrong:1"],
      evidenceRevision: "evidence:one:0",
      requestId: "request:one",
      sessionId: "session:3"
    })).toThrow();
    expect(listGuidedEvidenceAccess(db, "assignment:one:0")).toEqual([]);
  });

  test("rejects illegal stage transitions without partial writes", async () => {
    const db = await createdDb();

    expect(() => completeGuidedAssignment(db, "assignment:one:0", receipt())).toThrow("guided_assignment_not_ready");
    expect(() => storeGuidedDraftReview(db, {
      assignmentId: "assignment:one:1",
      draft: { ...draft(1), assignmentId: "assignment:one:1", evidenceRevision: "evidence:one:1" },
      findings: []
    })).toThrow("guided_assignment_not_active");
    expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("investigating");
    expect(getGuidedAssignment(db, "assignment:one:1")?.status).toBe("investigating");
  });

  test("preserves rejected and approved canary reviews as append-only history", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "rejected"));
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(2), findings: [] });
    const request = recordCanaryDecision(db, decision(2, "approved"));

    expect(request).toMatchObject({ canaryApprovedBy: "operator", creationInstanceId: "instance:creation-only" });
    expect(listGuidedDraftReviews(db, "assignment:one:0")).toHaveLength(2);
    expect(listGuidedOperatorReviews(db, "assignment:one:0").map(({ decision, draftRevision }) => ({ decision, draftRevision }))).toEqual([
      { decision: "rejected", draftRevision: 1 },
      { decision: "approved", draftRevision: 2 }
    ]);
  });

  test("returns an identical canary approval retry without appending a review", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });

    const first = recordCanaryDecision(db, decision(1, "approved"));
    const retried = recordCanaryDecision(db, decision(1, "approved"));

    expect(retried).toEqual(first);
    expect(listGuidedOperatorReviews(db, "assignment:one:0")).toHaveLength(1);
    expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("staged_canary");
  });

  test("rejects conflicting canary decision retries without changing approved state", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    const approvedRequest = recordCanaryDecision(db, decision(1, "approved"));
    const approvedAssignment = getGuidedAssignment(db, "assignment:one:0");
    const approvedReviews = listGuidedOperatorReviews(db, "assignment:one:0");

    const conflicts = [
      decision(1, "rejected"),
      { ...decision(1, "approved"), notes: "changed approval notes" },
      { ...decision(1, "approved"), reviewedBy: "another-operator" }
    ];
    for (const conflict of conflicts) {
      expect(() => recordCanaryDecision(db, conflict)).toThrow("guided_canary_decision_conflict");
    }

    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(approvedRequest);
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(approvedAssignment);
    expect(listGuidedOperatorReviews(db, "assignment:one:0")).toEqual(approvedReviews);
  });

  test("enforces one operator decision per assignment draft revision in sqlite", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));

    expect(() => db.prepare(
      `INSERT INTO guided_authoring_operator_reviews
       (review_id, request_id, assignment_id, draft_revision, decision, notes, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "review:duplicate",
      "request:one",
      "assignment:one:0",
      1,
      "rejected",
      "conflicting direct write",
      "operator",
      "2026-07-19T12:01:00.000Z"
    )).toThrow();
    expect(listGuidedOperatorReviews(db, "assignment:one:0")).toHaveLength(1);
  });

  test("keeps canary approval pending until finish and refuses a post-approval draft", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });

    const approved = recordCanaryDecision(db, decision(1, "approved"));

    expect(approved.status).toBe("awaiting_canary_approval");
    expect(() => storeGuidedDraftReview(db, {
      assignmentId: "assignment:one:0",
      draft: draft(2),
      findings: []
    })).toThrow("guided_canary_review_locked");
    expect(getGuidedAssignment(db, "assignment:one:0")).toMatchObject({
      acceptedDraftRevision: 1,
      currentDraftRevision: 1,
      status: "staged_canary"
    });

    completeGuidedAssignment(db, "assignment:one:0", receipt());
    expect(getGuidedAuthoringRequest(db, "request:one")?.status).toBe("active");
  });

  test("requires an approved operator review for the exact accepted canary draft", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    db.prepare(
      `INSERT INTO guided_authoring_draft_reviews
       (assignment_id, revision, evidence_revision, draft_json, findings_json, accepted, created_at)
       VALUES (?, ?, ?, ?, '[]', 1, ?)`
    ).run("assignment:one:0", 2, "evidence:one:0", JSON.stringify(draft(2)), "2026-07-19T12:01:00.000Z");
    db.prepare(
      `UPDATE guided_authoring_assignments
       SET current_draft_revision = 2, accepted_draft_revision = 2 WHERE assignment_id = ?`
    ).run("assignment:one:0");

    expect(() => completeGuidedAssignment(db, "assignment:one:0", { ...receipt(), draftRevision: 2 }))
      .toThrow("guided_assignment_not_ready");
    expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("staged_canary");
    expect(getGuidedAuthoringRequest(db, "request:one")?.status).toBe("awaiting_canary_approval");
    expect(listGuidedOperatorReviews(db, "assignment:one:0").map(({ draftRevision }) => draftRevision)).toEqual([1]);
  });

  test("composes all in-transaction mutations under one outer rollback", async () => {
    const db = await testDb(3);

    expect(() => withImmediateTransaction(db, () => {
      createGuidedAuthoringRequestInTransaction(db, requestInput(3));
      recordGuidedEvidenceAccessInTransaction(db, {
        assignmentId: "assignment:one:0",
        evidenceRefs: ["message:a:1"],
        evidenceRevision: "evidence:one:0",
        requestId: "request:one",
        sessionId: "session:0"
      });
      storeGuidedDraftReviewInTransaction(db, {
        assignmentId: "assignment:one:0",
        draft: draft(1),
        findings: []
      });
      recordCanaryDecisionInTransaction(db, decision(1, "approved"));
      completeGuidedAssignmentInTransaction(db, "assignment:one:0", receipt());
      throw new Error("injected_after_guided_completion");
    })).toThrow("injected_after_guided_completion");

    for (const table of guidedTables) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  test("scopes repeated opportunity IDs by request and rejects cross-request linkage", async () => {
    const db = await testDb(6);
    createGuidedAuthoringRequest(db, requestInput(3));
    createGuidedAuthoringRequest(db, requestInput(3, "two"));
    expect(listGuidedOpportunities(db, "request:one")[0]?.opportunityId).toBe("opportunity:shared");
    expect(listGuidedOpportunities(db, "request:two")[0]?.opportunityId).toBe("opportunity:shared");

    expect(() => db.prepare(
      `INSERT INTO guided_authoring_assignment_opportunities
       (assignment_id, request_id, opportunity_id, ordinal) VALUES (?, ?, ?, ?)`
    ).run("assignment:one:0", "request:two", "opportunity:shared", 99)).toThrow();
  });

  test.each([
    ["noncontiguous session ordinals", (input: CreateGuidedAuthoringRequestInput) => { input.sessions[1]!.ordinal = 4; }],
    ["noncontiguous assignment ordinals", (input: CreateGuidedAuthoringRequestInput) => { input.assignments[1]!.ordinal = 4; }],
    ["oversize assignment", (input: CreateGuidedAuthoringRequestInput) => {
      input.assignments = [{ ...input.assignments[0]!, sessionIds: input.sessions.map(({ sessionId }) => sessionId), opportunityIds: input.opportunities.map(({ opportunityId }) => opportunityId) }];
    }],
    ["invalid canary", (input: CreateGuidedAuthoringRequestInput) => { input.assignments[1]!.canary = true; }],
    ["duplicate membership", (input: CreateGuidedAuthoringRequestInput) => { input.assignments[1]!.sessionIds[0] = "session:0"; }],
    ["missing opportunity", (input: CreateGuidedAuthoringRequestInput) => { input.assignments[0]!.opportunityIds = ["opportunity:missing"]; }],
    ["opportunity provenance outside its assignment", (input: CreateGuidedAuthoringRequestInput) => {
      input.opportunities[1]!.provenanceSessionIds = ["session:0"];
    }]
  ])("validates %s before writing", async (_label, mutate) => {
    const db = await testDb(14);
    const input = requestInput(14);
    mutate(input);
    expect(() => createGuidedAuthoringRequest(db, input)).toThrow("invalid_guided_authoring_plan");
    expect(db.prepare("SELECT COUNT(*) AS count FROM guided_authoring_requests").get()).toEqual({ count: 0 });
  });
});

const guidedTables = [
  "guided_authoring_requests",
  "guided_authoring_request_sessions",
  "guided_authoring_opportunities",
  "guided_authoring_assignments",
  "guided_authoring_assignment_sessions",
  "guided_authoring_assignment_opportunities",
  "guided_authoring_evidence_access",
  "guided_authoring_draft_reviews",
  "guided_authoring_operator_reviews"
] as const;

async function testDb(sessionCount: number): Promise<MastheadDatabase> {
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-19T12:00:00.000Z");
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-authoring-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  for (let index = 0; index < sessionCount; index += 1) {
    seedCanonicalSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: `session:${index}`,
      title: `Guided session ${index}`
    });
  }
  return db;
}

async function createdDb(): Promise<MastheadDatabase> {
  const db = await testDb(14);
  createGuidedAuthoringRequest(db, requestInput(14));
  return db;
}

function requestInput(sessionCount: number, suffix = "one"): CreateGuidedAuthoringRequestInput {
  const sessions = Array.from({ length: sessionCount }, (_, ordinal) => ({ ordinal, sessionId: `session:${ordinal}` }));
  const split = Math.min(3, sessionCount);
  return {
    actorId: "codex",
    assignments: [
      {
        assignmentId: `assignment:${suffix}:0`,
        canary: true,
        evidenceRevision: `evidence:${suffix}:0`,
        opportunityIds: ["opportunity:shared"],
        ordinal: 0,
        sessionIds: sessions.slice(0, split).map(({ sessionId }) => sessionId)
      },
      ...(sessionCount > split ? [{
        assignmentId: `assignment:${suffix}:1`,
        canary: false,
        evidenceRevision: `evidence:${suffix}:1`,
        opportunityIds: [`opportunity:${suffix}:1`],
        ordinal: 1,
        sessionIds: sessions.slice(split).map(({ sessionId }) => sessionId)
      }] : [])
    ],
    identity: {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      creationInstanceId: "instance:creation-only",
      databaseId: "database:test",
      instanceManifest: "manifest:test"
    },
    opportunities: [
      {
        evidenceRefs: ["message:a:1"],
        opportunityId: "opportunity:shared",
        provenanceSessionIds: ["session:0"],
        signalStrength: "high",
        suggestedKind: "adr",
        summary: "A durable choice should be retained."
      },
      ...(sessionCount > split ? [{
        evidenceRefs: ["message:b:1"],
        opportunityId: `opportunity:${suffix}:1`,
        provenanceSessionIds: [`session:${split}`],
        signalStrength: "medium" as const,
        suggestedKind: "runbook" as const,
        summary: "A reusable procedure should be retained."
      }] : [])
    ],
    policyVersion: "guided-authoring-v1",
    requestId: `request:${suffix}`,
    sessions
  };
}

function draft(revision: number): GuidedAuthoringBundleV4 {
  return {
    artifacts: [],
    assignmentId: "assignment:one:0",
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: "evidence:one:0",
    opportunityDispositions: [],
    sessionEnrichments: []
  };
}

function decision(draftRevision: number, decisionValue: "approved" | "rejected") {
  return {
    assignmentId: "assignment:one:0",
    decision: decisionValue,
    draftRevision,
    notes: `${decisionValue} revision ${draftRevision}`,
    requestId: "request:one",
    reviewedBy: "operator"
  } as const;
}

function receipt(): GuidedAuthoringReceiptDto {
  return {
    assignmentId: "assignment:one:0",
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "build:test",
    completedAt: "2026-07-19T12:30:00.000Z",
    databaseId: "database:test",
    draftRevision: 1,
    evidenceRevision: "evidence:one:0",
    instanceManifest: "manifest:test",
    opportunityIds: ["opportunity:shared"],
    publicationInstanceId: "instance:after-restart",
    publishedArtifacts: [],
    receiptVersion: "guided-authoring-receipt-v1",
    requestId: "request:one",
    sessionIds: ["session:0", "session:1", "session:2"]
  };
}
