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
  advanceGuidedAssignmentEvidenceRevision,
  advanceGuidedAssignmentEvidenceRevisionInTransaction,
  createGuidedAuthoringRequest,
  createGuidedAuthoringRequestInTransaction,
  getGuidedAssignment,
  getGuidedAssignmentReceipt,
  getGuidedAssignments,
  getGuidedAuthoringRequest,
  getGuidedAuthoringRequestForAssignment,
  invalidateLockedGuidedAssignmentEvidenceInTransaction,
  listGuidedDraftReviews,
  listGuidedEvidenceAccess,
  listGuidedOperatorReviews,
  listGuidedOpportunities,
  listPendingGuidedCanaryAssignments,
  persistGuidedAssignmentReceiptInTransaction,
  recordCanaryDecision,
  recordCanaryDecisionInTransaction,
  recordGuidedEvidenceAccess,
  recordGuidedEvidenceAccessInTransaction,
  storeGuidedDraftReview,
  storeGuidedDraftReviewInTransaction,
  transitionGuidedAssignmentAfterReceiptInTransaction,
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
      name: "037_guided_authoring_v5_contract",
      version: 37
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

  test("loads only stable request binding fields for a pre-transaction assignment guard", async () => {
    const db = await createdDb();

    expect(getGuidedAuthoringRequestForAssignment(db, "assignment:one:0")).toEqual({
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      contractVersion: "workbench-authoring-v4",
      creationInstanceId: "instance:creation-only",
      databaseId: "database:test",
      instanceManifest: "manifest:test"
    });
    expect(getGuidedAuthoringRequestForAssignment(db, "assignment:missing")).toBeUndefined();
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

  test("records current-revision evidence refs idempotently", async () => {
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
    expect(() => recordGuidedEvidenceAccess(db, { ...access, evidenceRevision: "evidence:one:0:revised" }))
      .toThrow("guided_evidence_revision_mismatch");

    expect(listGuidedEvidenceAccess(db, access.assignmentId)).toHaveLength(1);
    expect(listGuidedEvidenceAccess(db, access.assignmentId, access.evidenceRevision)).toHaveLength(1);
  });

  test("advances evidence revision by compare-and-swap and preserves audit rows", async () => {
    const db = await createdDb();
    for (const [revision, accepted] of [[1, 1], [2, 0]] as const) {
      db.prepare(
        `INSERT INTO guided_authoring_draft_reviews
         (assignment_id, revision, evidence_revision, draft_json, findings_json, accepted, created_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?)`
      ).run(
        "assignment:one:0",
        revision,
        "evidence:one:0",
        JSON.stringify(draft(revision)),
        accepted,
        `2026-07-19T12:0${revision}:00.000Z`
      );
    }
    db.prepare(
      `UPDATE guided_authoring_assignments
       SET status = 'needs_revision', current_draft_revision = 2, accepted_draft_revision = 1
       WHERE assignment_id = ?`
    ).run("assignment:one:0");
    recordGuidedEvidenceAccess(db, {
      assignmentId: "assignment:one:0",
      evidenceRefs: ["message:a:1"],
      evidenceRevision: "evidence:one:0",
      requestId: "request:one",
      sessionId: "session:0"
    });

    const advanced = advanceGuidedAssignmentEvidenceRevision(db, {
      assignmentId: "assignment:one:0",
      expectedEvidenceRevision: "evidence:one:0",
      nextEvidenceRevision: "evidence:one:0:revised"
    });

    expect(advanced).toMatchObject({
      currentDraftRevision: 2,
      evidenceRevision: "evidence:one:0:revised",
      status: "investigating"
    });
    expect(advanced).not.toHaveProperty("acceptedDraftRevision");
    expect(listGuidedEvidenceAccess(db, "assignment:one:0", "evidence:one:0")).toHaveLength(1);
    expect(listGuidedDraftReviews(db, "assignment:one:0")).toHaveLength(2);
    expect(() => advanceGuidedAssignmentEvidenceRevision(db, {
      assignmentId: "assignment:one:0",
      expectedEvidenceRevision: "evidence:one:0",
      nextEvidenceRevision: "evidence:one:0:newer"
    })).toThrow("guided_evidence_revision_conflict");
  });

  test.each(["staged_canary", "ready_to_finish", "completed"] as const)(
    "locks evidence revision advancement in %s",
    async (status) => {
      const db = await createdDb();
      db.prepare("UPDATE guided_authoring_assignments SET status = ? WHERE assignment_id = ?")
        .run(status, "assignment:one:0");
      const before = getGuidedAssignment(db, "assignment:one:0");

      expect(() => advanceGuidedAssignmentEvidenceRevision(db, {
        assignmentId: "assignment:one:0",
        expectedEvidenceRevision: "evidence:one:0",
        nextEvidenceRevision: "evidence:one:0:revised"
      })).toThrow("guided_assignment_evidence_locked");
      expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(before);
    }
  );

  test("composes evidence revision advancement under an outer rollback", async () => {
    const db = await createdDb();
    const before = getGuidedAssignment(db, "assignment:one:0");

    expect(() => withImmediateTransaction(db, () => {
      advanceGuidedAssignmentEvidenceRevisionInTransaction(db, {
        assignmentId: "assignment:one:0",
        expectedEvidenceRevision: "evidence:one:0",
        nextEvidenceRevision: "evidence:one:0:revised"
      });
      throw new Error("injected_after_revision_advance");
    })).toThrow("injected_after_revision_advance");

    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(before);
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

  test("rediscovers staged canaries deterministically from durable state", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });

    expect(listPendingGuidedCanaryAssignments(db).map(({ assignmentId }) => assignmentId))
      .toEqual(["assignment:one:0"]);
    expect(listPendingGuidedCanaryAssignments(db).map(({ assignmentId }) => assignmentId))
      .toEqual(["assignment:one:0"]);

    recordCanaryDecision(db, decision(1, "approved"));
    expect(listPendingGuidedCanaryAssignments(db).map(({ assignmentId }) => assignmentId))
      .toEqual([]);
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

  test("does not treat ready_to_finish as a legal canary completion state", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    db.prepare("UPDATE guided_authoring_assignments SET status = 'ready_to_finish' WHERE assignment_id = ?")
      .run("assignment:one:0");

    expect(() => completeGuidedAssignment(db, "assignment:one:0", receipt()))
      .toThrow("guided_assignment_not_ready");
    expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toBeUndefined();
  });

  test("rejecting a canary clears its accepted revision and request approval state", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));

    db.prepare("DELETE FROM guided_authoring_operator_reviews WHERE assignment_id = ?")
      .run("assignment:one:0");
    const rejected = recordCanaryDecision(db, decision(1, "rejected"));

    expect(rejected).toMatchObject({ status: "open" });
    expect(rejected).not.toHaveProperty("canaryApprovedAt");
    expect(rejected).not.toHaveProperty("canaryApprovedBy");
    expect(getGuidedAssignment(db, "assignment:one:0")).toMatchObject({
      currentDraftRevision: 1,
      status: "needs_revision"
    });
    expect(getGuidedAssignment(db, "assignment:one:0")).not.toHaveProperty("acceptedDraftRevision");
    expect(listGuidedOperatorReviews(db, "assignment:one:0").map(({ decision: value }) => value))
      .toEqual(["rejected"]);
  });

  test("invalidates a locked canary by exact status, evidence revision, and accepted draft", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));

    const result = withImmediateTransaction(db, () =>
      invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
        assignmentId: "assignment:one:0",
        expectedEvidenceRevision: "evidence:one:0",
        expectedStatus: "staged_canary",
        nextEvidenceRevision: "evidence:one:0:revised"
      })
    );

    expect(result.assignment).toMatchObject({
      currentDraftRevision: 1,
      evidenceRevision: "evidence:one:0:revised",
      status: "investigating"
    });
    expect(result.assignment).not.toHaveProperty("acceptedDraftRevision");
    expect(result.request).toMatchObject({ status: "open" });
    expect(result.request).not.toHaveProperty("canaryApprovedAt");
    expect(result.request).not.toHaveProperty("canaryApprovedBy");
    expect(listGuidedDraftReviews(db, "assignment:one:0")).toHaveLength(1);
    expect(listGuidedOperatorReviews(db, "assignment:one:0")).toHaveLength(1);
  });

  test.each([
    { expectedEvidenceRevision: "evidence:wrong", expectedStatus: "staged_canary" as const },
    { expectedEvidenceRevision: "evidence:one:0", expectedStatus: "ready_to_finish" as const }
  ])("refuses a loose locked invalidation CAS for $expectedStatus", async (input) => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    const beforeAssignment = getGuidedAssignment(db, "assignment:one:0");
    const beforeRequest = getGuidedAuthoringRequest(db, "request:one");

    expect(() => withImmediateTransaction(db, () =>
      invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
        assignmentId: "assignment:one:0",
        nextEvidenceRevision: "evidence:one:0:revised",
        ...input
      })
    )).toThrow("guided_evidence_revision_conflict");

    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(beforeAssignment);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(beforeRequest);
  });

  test("refuses locked invalidation without a non-null accepted draft", async () => {
    const db = await createdDb();
    db.prepare(
      `UPDATE guided_authoring_assignments
       SET status = 'staged_canary'
       WHERE assignment_id = ?`
    ).run("assignment:one:0");
    const before = getGuidedAssignment(db, "assignment:one:0");

    expect(() => withImmediateTransaction(db, () =>
      invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
        assignmentId: "assignment:one:0",
        expectedEvidenceRevision: "evidence:one:0",
        expectedStatus: "staged_canary",
        nextEvidenceRevision: "evidence:one:0:revised"
      })
    )).toThrow("guided_evidence_revision_conflict");
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(before);
  });

  test("invalidating a ready non-canary keeps its request active", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    completeGuidedAssignment(db, "assignment:one:0", receipt());
    const nonCanaryDraft = {
      ...draft(1),
      assignmentId: "assignment:one:1",
      evidenceRevision: "evidence:one:1"
    };
    storeGuidedDraftReview(db, {
      assignmentId: "assignment:one:1",
      draft: nonCanaryDraft,
      findings: []
    });

    const result = withImmediateTransaction(db, () =>
      invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
        assignmentId: "assignment:one:1",
        expectedEvidenceRevision: "evidence:one:1",
        expectedStatus: "ready_to_finish",
        nextEvidenceRevision: "evidence:one:1:revised"
      })
    );

    expect(result.assignment).toMatchObject({
      currentDraftRevision: 1,
      evidenceRevision: "evidence:one:1:revised",
      status: "investigating"
    });
    expect(result.assignment).not.toHaveProperty("acceptedDraftRevision");
    expect(result.request).toMatchObject({ status: "active" });
  });

  test("historical approval does not lock a fresh evidence revision", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    withImmediateTransaction(db, () => invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
      assignmentId: "assignment:one:0",
      expectedEvidenceRevision: "evidence:one:0",
      expectedStatus: "staged_canary",
      nextEvidenceRevision: "evidence:one:0:revised"
    }));

    const freshDraft = {
      ...draft(2),
      evidenceRevision: "evidence:one:0:revised"
    };
    expect(() => storeGuidedDraftReview(db, {
      assignmentId: "assignment:one:0",
      draft: freshDraft,
      findings: []
    })).not.toThrow();
    expect(getGuidedAssignment(db, "assignment:one:0")).toMatchObject({
      acceptedDraftRevision: 2,
      currentDraftRevision: 2,
      status: "staged_canary"
    });
    expect(listGuidedOperatorReviews(db, "assignment:one:0")).toHaveLength(1);
  });

  test("does not accept an approval whose draft belongs to an older evidence revision", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    db.prepare(
      `UPDATE guided_authoring_assignments
       SET evidence_revision = ?
       WHERE assignment_id = ?`
    ).run("evidence:one:0:revised", "assignment:one:0");

    expect(() => completeGuidedAssignment(db, "assignment:one:0", {
      ...receipt(),
      evidenceRevision: "evidence:one:0:revised"
    })).toThrow("guided_assignment_not_ready");
    expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("staged_canary");
  });

  test("returns the immutable stored receipt from a completed retry", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    const stored = completeGuidedAssignment(db, "assignment:one:0", receipt());
    const assignmentBeforeRetry = getGuidedAssignment(db, "assignment:one:0");
    const requestBeforeRetry = getGuidedAuthoringRequest(db, "request:one");

    const retried = completeGuidedAssignment(db, "assignment:one:0", {
      ...receipt(),
      completedAt: "2099-01-01T00:00:00.000Z",
      publicationInstanceId: "instance:untrusted-retry"
    });

    expect(retried).toEqual(stored);
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(assignmentBeforeRetry);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(requestBeforeRetry);
  });

  test("can observe receipt persistence before transition and rolls both phases back together", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    const beforeAssignment = getGuidedAssignment(db, "assignment:one:0");
    const beforeRequest = getGuidedAuthoringRequest(db, "request:one");

    expect(() => withImmediateTransaction(db, () => {
      const persisted = persistGuidedAssignmentReceiptInTransaction(
        db,
        "assignment:one:0",
        receipt()
      );
      expect(persisted).toEqual(receipt());
      expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toEqual(receipt());
      expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("staged_canary");
      expect(getGuidedAuthoringRequest(db, "request:one")?.status).toBe("awaiting_canary_approval");
      throw new Error("injected_between_receipt_and_transition");
    })).toThrow("injected_between_receipt_and_transition");

    expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toBeUndefined();
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(beforeAssignment);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(beforeRequest);

    expect(() => withImmediateTransaction(db, () => {
      persistGuidedAssignmentReceiptInTransaction(db, "assignment:one:0", receipt());
      db.prepare("UPDATE guided_authoring_assignments SET status = 'investigating' WHERE assignment_id = ?")
        .run("assignment:one:0");
      transitionGuidedAssignmentAfterReceiptInTransaction(db, "assignment:one:0", receipt());
    })).toThrow("guided_assignment_not_ready");
    expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toBeUndefined();
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(beforeAssignment);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(beforeRequest);
  });

  test("refuses completion transition without the matching stored receipt and state", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));
    const beforeAssignment = getGuidedAssignment(db, "assignment:one:0");
    const beforeRequest = getGuidedAuthoringRequest(db, "request:one");

    expect(() => withImmediateTransaction(db, () =>
      transitionGuidedAssignmentAfterReceiptInTransaction(db, "assignment:one:0", receipt())
    )).toThrow("guided_assignment_receipt_not_persisted");
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(beforeAssignment);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(beforeRequest);

    expect(() => withImmediateTransaction(db, () => {
      persistGuidedAssignmentReceiptInTransaction(db, "assignment:one:0", receipt());
      transitionGuidedAssignmentAfterReceiptInTransaction(db, "assignment:one:0", {
        ...receipt(),
        publicationInstanceId: "instance:mismatch"
      });
    })).toThrow("guided_assignment_receipt_mismatch");
    expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toBeUndefined();
    expect(getGuidedAssignment(db, "assignment:one:0")).toEqual(beforeAssignment);
    expect(getGuidedAuthoringRequest(db, "request:one")).toEqual(beforeRequest);
  });

  test("composes receipt persistence and request transition with an exact result", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    recordCanaryDecision(db, decision(1, "approved"));

    const result = withImmediateTransaction(db, () => {
      persistGuidedAssignmentReceiptInTransaction(db, "assignment:one:0", receipt());
      return transitionGuidedAssignmentAfterReceiptInTransaction(db, "assignment:one:0", receipt());
    });

    expect(result.receipt).toEqual(receipt());
    expect(result.request).toMatchObject({
      completedSessionCount: 3,
      currentAssignmentId: "assignment:one:1",
      status: "active"
    });
    expect(getGuidedAssignment(db, "assignment:one:0")?.status).toBe("completed");
    expect(getGuidedAssignmentReceipt(db, "assignment:one:0")).toEqual(receipt());
  });

  test("rejects saving another draft from staged canary state before writing", async () => {
    const db = await createdDb();
    storeGuidedDraftReview(db, { assignmentId: "assignment:one:0", draft: draft(1), findings: [] });
    const before = listGuidedDraftReviews(db, "assignment:one:0");

    expect(() => storeGuidedDraftReview(db, {
      assignmentId: "assignment:one:0",
      draft: draft(2),
      findings: []
    })).toThrow("guided_assignment_not_draftable");
    expect(listGuidedDraftReviews(db, "assignment:one:0")).toEqual(before);
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
    contractVersion: "workbench-authoring-v4",
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
