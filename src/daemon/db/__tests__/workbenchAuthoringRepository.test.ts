import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringReceipt
} from "../../../shared/workbenchAuthoring.ts";
import { seedSession as seedCanonicalSession } from "./sessionTestHelpers.ts";
import {
  completeWorkbenchAuthoringRun,
  createWorkbenchAuthoringRun,
  findReusableWorkbenchAuthoringRun,
  getWorkbenchAuthoringRun,
  resetWorkbenchAuthoringRunEvidence,
  saveWorkbenchAuthoringSubmission
} from "../workbenchAuthoringRepository.ts";
import { claimWorkbenchSessions } from "../workbenchPipelineRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("workbench authoring repository", () => {
  test("persists an idempotent multi-session authoring run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-10T12:00:00.000Z");
    const db = await testDb();
    seedSession(db, { sessionId: "session:a", project: "Masthead" });
    seedSession(db, { sessionId: "session:b", project: "Masthead" });
    const claims = claimWorkbenchSessions(db, {
      claimedBy: "codex",
      expiresAt: "2026-07-10T12:15:00.000Z",
      sessionIds: ["session:a", "session:b"]
    }).claims;

    const created = createWorkbenchAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      evidenceRevision: "evidence:1",
      runId: "authoring:1",
      sessions: claims.map((claim, ordinal) => ({
        claimId: claim.claimId,
        ordinal,
        sessionId: claim.sessionId
      }))
    });

    expect(created).toMatchObject({
      runId: "authoring:1",
      status: "open",
      sessionIds: ["session:a", "session:b"],
      claimIds: claims.map((claim) => claim.claimId),
      claimsExpireAt: "2026-07-10T12:15:00.000Z",
      claimStatus: "active",
      findings: []
    });
    expect(getWorkbenchAuthoringRun(db, "authoring:1")).toEqual(created);
    expect(
      findReusableWorkbenchAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:b", "session:a"]
      })
    ).toEqual(created);
    expect(
      findReusableWorkbenchAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:a"]
      })
    ).toBeUndefined();

    const bundle = validBundle("authoring:1", ["session:a", "session:b"]);
    const needsRevision = saveWorkbenchAuthoringSubmission(db, {
      bundle,
      evidenceRevision: "evidence:1",
      findings: [
        {
          artifactKind: "runbook",
          code: "missing_evidence",
          message: "Runbook needs a verification reference",
          severity: "error"
        }
      ],
      runId: "authoring:1",
      status: "needs_revision"
    });
    expect(needsRevision).toMatchObject({
      bundle,
      findings: [{ code: "missing_evidence", severity: "error" }],
      status: "needs_revision"
    });

    const ready = saveWorkbenchAuthoringSubmission(db, {
      bundle,
      evidenceRevision: "evidence:1",
      findings: [],
      runId: "authoring:1",
      status: "ready_to_finish"
    });
    expect(ready).toMatchObject({ bundle, findings: [], status: "ready_to_finish" });

    const receipt = receiptFor("authoring:1");
    expect(completeWorkbenchAuthoringRun(db, { receipt, runId: "authoring:1" })).toEqual(receipt);
    expect(
      completeWorkbenchAuthoringRun(db, {
        receipt: { ...receipt, completedAt: "2026-07-10T13:00:00.000Z" },
        runId: "authoring:1"
      })
    ).toEqual(receipt);
    expect(getWorkbenchAuthoringRun(db, "authoring:1")).toMatchObject({
      completedAt: receipt.completedAt,
      receipt,
      status: "completed"
    });
  });

  test("resets changed evidence without reopening a completed run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-10T12:00:00.000Z");
    const db = await testDb();
    seedSession(db, { sessionId: "session:a", project: "Masthead" });
    const claim = claimWorkbenchSessions(db, {
      claimedBy: "codex",
      expiresAt: "2026-07-10T12:15:00.000Z",
      sessionIds: ["session:a"]
    }).claims[0]!;
    createWorkbenchAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      evidenceRevision: "evidence:1",
      runId: "authoring:reset",
      sessions: [{ claimId: claim.claimId, ordinal: 0, sessionId: claim.sessionId }]
    });
    saveWorkbenchAuthoringSubmission(db, {
      bundle: validBundle("authoring:reset", ["session:a"]),
      evidenceRevision: "evidence:1",
      findings: [{ code: "revise", message: "Revise output", severity: "error" }],
      runId: "authoring:reset",
      status: "needs_revision"
    });

    const reset = resetWorkbenchAuthoringRunEvidence(db, {
      evidenceRevision: "evidence:2",
      runId: "authoring:reset",
      updatedAt: "2026-07-10T12:05:00.000Z"
    });
    expect(reset).toMatchObject({
      evidenceRevision: "evidence:2",
      findings: [],
      status: "open",
      updatedAt: "2026-07-10T12:05:00.000Z"
    });
    expect(reset.bundle).toBeUndefined();

    const receipt = receiptFor("authoring:reset");
    completeWorkbenchAuthoringRun(db, { receipt, runId: "authoring:reset" });
    const completed = getWorkbenchAuthoringRun(db, "authoring:reset")!;
    expect(
      resetWorkbenchAuthoringRunEvidence(db, {
        evidenceRevision: "evidence:3",
        runId: "authoring:reset",
        updatedAt: "2026-07-10T12:10:00.000Z"
      })
    ).toEqual(completed);
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-authoring-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function testDatabaseId(db: MastheadDatabase): string {
  return getOrCreateDatabaseIdentity(db);
}

function seedSession(db: MastheadDatabase, input: { sessionId: string; project: string }): void {
  seedCanonicalSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: input.project,
    sessionId: input.sessionId,
    title: `Authoring ${input.sessionId}`
  });
}

function validBundle(runId: string, sessionIds: string[]): WorkbenchAuthoringBundle {
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision: "evidence:1",
    notApplicable: sessionIds.flatMap((sessionId) =>
      (["runbook", "adr", "incident_timeline"] as const).map((kind) => ({
        evidenceRefs: [`${sessionId}:message`],
        kind,
        reason: "No reusable automatic artifact is supported by the evidence.",
        sessionId
      }))
    ),
    runId,
    sessionPackages: sessionIds.map((sessionId) => ({
      dossier: { objective: "Exercise durable authoring storage" },
      enrichment: { title: `Authoring ${sessionId}` },
      sessionId
    }))
  };
}

function receiptFor(runId: string): WorkbenchAuthoringReceipt {
  return {
    completedAt: "2026-07-10T12:10:00.000Z",
    contributions: [],
    notApplicable: [{ kind: "runbook", sessionId: "session:a" }],
    publishedArtifactIds: ["artifact:dossier:a"],
    resolvedSessionIds: ["session:a"],
    runId
  };
}
