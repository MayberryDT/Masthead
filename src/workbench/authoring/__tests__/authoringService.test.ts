import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchAuthoringBundle } from "../../../shared/workbenchAuthoring.ts";
import { seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { readWorkbenchSessionState, claimWorkbenchSessions } from "../../../daemon/db/workbenchPipelineRepository.ts";
import { completeWorkbenchAuthoringRun } from "../../../daemon/db/workbenchAuthoringRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import {
  getAuthoringRunEvidence,
  getAuthoringRunStatus,
  openAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench authoring service", () => {
  test("opens selected sessions without a privacy permission gate", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:a");

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.run.status).toBe("open");
    expect(opened.run.sessionIds).toEqual(["session:a"]);
    expect(opened.evidence.sessions[0]?.totalItems).toBeGreaterThan(0);
    expect(opened.contract.automaticKinds).toEqual(["runbook", "adr", "incident_timeline"]);
    expect(opened.contract).not.toHaveProperty("permissionRequired");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      qualityStatus: "passed",
      transcriptStatus: "available"
    });
    db.close();
  });

  test("refuses the wrong daemon database before claiming sessions", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:a");

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: "different-database",
        sessionIds: ["session:a"]
      })
    ).toThrow("database_identity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    db.close();
  });

  test("stores findings without applying artifacts", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const enrichmentCount = db.prepare("SELECT COUNT(*) AS count FROM session_enrichments").get();

    const result = submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });

    expect(result.accepted).toBe(false);
    expect(result.run.status).toBe("needs_revision");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifacts").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments").get()).toEqual(enrichmentCount);
    db.close();
  });

  test("reuses the same run and claims when open is retried", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };

    const first = openAuthoringRun(db, input);
    const second = openAuthoringRun(db, input);

    expect(second.run.runId).toBe(first.run.runId);
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims WHERE released_at IS NULL").get()).toEqual({
      count: 1
    });
    db.close();
  });

  test("submit reacquires an expired lease and refuses another actor's live claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    expireAuthoringClaims(db, opened.run.runId);

    const renewed = submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });
    expect(Date.parse(renewed.run.claimsExpireAt)).toBeGreaterThan(Date.now());

    const conflictedDb = await readyAuthoringDb();
    const conflictedRun = openAuthoringRun(conflictedDb, {
      actorId: "codex",
      databaseId: testDatabaseId(conflictedDb),
      sessionIds: ["session:a"]
    });
    expireAuthoringClaims(conflictedDb, conflictedRun.run.runId);
    claimWorkbenchSessions(conflictedDb, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:a"]
    });
    expect(() =>
      submitAuthoringBundle(conflictedDb, {
        bundle: invalidBundle(conflictedRun.run.runId, conflictedRun.run.evidenceRevision),
        runId: conflictedRun.run.runId
      })
    ).toThrow("authoring_claim_conflict:session:a");
    db.close();
    conflictedDb.close();
  });

  test("reports status and pages evidence without mutating Workbench state", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const before = authoringRowCounts(db);

    expect(getAuthoringRunStatus(db, opened.run.runId)).toEqual({
      evidenceStatus: "current",
      ok: true,
      run: opened.run
    });
    const page = getAuthoringRunEvidence(db, {
      limit: 1,
      runId: opened.run.runId,
      sessionId: "session:a"
    });

    expect(page.evidenceRevision).toBe(opened.run.evidenceRevision);
    expect(page.items).toHaveLength(1);
    expect(authoringRowCounts(db)).toEqual(before);
    expect(() =>
      getAuthoringRunEvidence(db, {
        runId: opened.run.runId,
        sessionId: "session:outside"
      })
    ).toThrow("authoring_session_not_in_run:session:outside");
    db.close();
  });

  test("requires repeat-open recovery when canonical evidence changes", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });
    insertMessage(db, "session:a", "changed", "New canonical evidence arrived.");

    expect(getAuthoringRunStatus(db, opened.run.runId).evidenceStatus).toBe("changed");
    expect(() =>
      getAuthoringRunEvidence(db, {
        runId: opened.run.runId,
        sessionId: "session:a"
      })
    ).toThrow("evidence_revision_changed");

    const reopened = openAuthoringRun(db, input);
    expect(reopened.run).toMatchObject({
      findings: [],
      runId: opened.run.runId,
      status: "open"
    });
    expect(reopened.run).not.toHaveProperty("bundle");
    expect(reopened.run.evidenceRevision).not.toBe(opened.run.evidenceRevision);
    expect(getAuthoringRunEvidence(db, { runId: reopened.run.runId, sessionId: "session:a" }).total).toBeGreaterThan(1);
    db.close();
  });

  test("keeps sparse non-empty canonical evidence on the automatic path with warnings", async () => {
    const db = await readyAuthoringDb();

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.evidence.sessions[0]?.warnings).toContain("Fewer than two canonical messages are available.");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      publicationStatus: "publish_path",
      qualityStatus: "passed"
    });
    db.close();
  });

  test("does not weaken an imported transcript while opening authoring", async () => {
    const db = await readyAuthoringDb();
    db.prepare(
      `INSERT INTO workbench_session_state (
        session_id, publication_status, next_action, transcript_status, quality_status,
        session_enrichment_status, session_dossier_status, bug_fix_trace_status, created_at, updated_at
      ) VALUES (?, 'publish_path', 'review_quality', 'imported', 'unchecked', 'missing', 'missing', 'unknown', ?, ?)`
    ).run("session:a", "2026-07-10T11:00:00.000Z", "2026-07-10T11:00:00.000Z");

    openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(readWorkbenchSessionState(db, "session:a")?.transcriptStatus).toBe("imported");
    db.close();
  });

  test("rejects sessions with no usable canonical redacted evidence", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:a"]
      })
    ).toThrow("missing_canonical_evidence:session:a");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_session_state").get()).toEqual({ count: 0 });
    db.close();
  });

  test("accepts a grounded bundle while deferring every artifact and enrichment write", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const before = authoringOutputCounts(db);

    const result = submitAuthoringBundle(db, {
      bundle: validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a"),
      runId: opened.run.runId
    });

    expect(result).toMatchObject({ accepted: true, findings: expect.any(Array), ok: true, run: { status: "ready_to_finish" } });
    expect(result.findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(authoringOutputCounts(db)).toEqual(before);
    db.close();
  });

  test("rolls back partial claim reacquisition when any run session conflicts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    seedSessionWithRedactedEvidence(db, "session:b");
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a", "session:b"]
    });
    expireAuthoringClaims(db, opened.run.runId);
    claimWorkbenchSessions(db, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:b"]
    });
    const claimsBeforeSubmit = runClaimRows(db, opened.run.runId);

    expect(() =>
      submitAuthoringBundle(db, {
        bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
        runId: opened.run.runId
      })
    ).toThrow("authoring_claim_conflict:session:b");
    expect(runClaimRows(db, opened.run.runId)).toEqual(claimsBeforeSubmit);
    db.close();
  });

  test("returns a completed exact-set run unchanged", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    completeWorkbenchAuthoringRun(db, {
      receipt: {
        completedAt: "2026-07-10T12:30:00.000Z",
        contributions: [],
        notApplicable: [],
        publishedArtifactIds: [],
        resolvedSessionIds: ["session:a"],
        runId: opened.run.runId
      },
      runId: opened.run.runId
    });

    const reopened = openAuthoringRun(db, input);

    expect(reopened.run).toMatchObject({
      completedAt: "2026-07-10T12:30:00.000Z",
      runId: opened.run.runId,
      status: "completed"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 1 });
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-authoring-service-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

async function readyAuthoringDb(): Promise<MastheadDatabase> {
  const db = await testDb();
  seedSessionWithRedactedEvidence(db, "session:a");
  return db;
}

function seedSessionWithRedactedEvidence(db: MastheadDatabase, sessionId: string): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: `Authoring ${sessionId}`
  });
}

function testDatabaseId(db: MastheadDatabase): string {
  return getOrCreateDatabaseIdentity(db);
}

function invalidBundle(runId: string, evidenceRevision: string): WorkbenchAuthoringBundle {
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: [],
    runId,
    sessionPackages: []
  };
}

function validBundle(runId: string, evidenceRevision: string, sessionId: string): WorkbenchAuthoringBundle {
  const evidenceRef = `message:${sessionId}:message`;
  const missingEvidence = ["Only one user-authored message is available for this session."];
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: (["runbook", "adr", "incident_timeline"] as const).map((kind) => ({
      evidenceRefs: [evidenceRef],
      kind,
      reason: "The reviewed session evidence does not support this optional artifact kind.",
      sessionId
    })),
    runId,
    sessionPackages: [
      {
        dossier: {
          approach: ["Inspect the canonical redacted evidence and preserve its grounded outcome."],
          claimEvidence: [
            { evidenceRefs: [evidenceRef], path: "keyDecisions[0]" },
            { evidenceRefs: [evidenceRef], path: "outcome" },
            { evidenceRefs: [evidenceRef], path: "verification[0]" }
          ],
          commandsAndTools: [],
          confidence: "low",
          context: "A daemon-owned authoring run selected this canonical session.",
          evidenceRefs: [evidenceRef],
          filesTouched: [],
          keyDecisions: ["Keep daemon-owned authoring grounded in canonical redacted evidence."],
          lessonsLearned: ["Sparse evidence must remain explicit in the authored output."],
          missingEvidence,
          outcome: "The authoring service accepted a complete grounded session package.",
          problemStatement: "Validate the daemon-owned authoring submission boundary.",
          risksOrGaps: ["Only sparse canonical message coverage is available."],
          title: "Validate daemon-owned authoring",
          verification: ["The focused authoring service contract test passed."]
        },
        enrichment: {
          claimEvidence: [{ evidenceRefs: [evidenceRef], path: "summary" }],
          confidence: "low",
          evidenceRefs: [evidenceRef],
          missingEvidence,
          searchPhrases: ["daemon-owned Workbench authoring"],
          summary: "The daemon validated and stored one grounded authoring bundle without applying outputs.",
          technologies: ["TypeScript", "SQLite"],
          title: "Validate daemon-owned authoring",
          topics: ["Workbench", "artifact authoring"]
        },
        sessionId
      }
    ]
  };
}

function expireAuthoringClaims(db: MastheadDatabase, runId: string): void {
  db.prepare(
    `UPDATE workbench_claims
     SET expires_at = ?
     WHERE claim_id IN (
       SELECT claim_id FROM workbench_authoring_run_sessions WHERE run_id = ?
     )`
  ).run(new Date(Date.now() - 1_000).toISOString(), runId);
}

function insertMessage(db: MastheadDatabase, sessionId: string, suffix: string, text: string): void {
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, 'assistant', ?, ?, ?, '{}', 'authoritative')`
  ).run(`${sessionId}:message:${suffix}`, sessionId, text, `${sessionId}:hash:${suffix}`, "2026-07-10T12:15:00.000Z");
}

function clearCanonicalEvidence(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "checkpoints", "runtime_signals"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}

function authoringRowCounts(db: MastheadDatabase): Record<string, number> {
  return Object.fromEntries(
    ["workbench_claims", "workbench_activity", "workbench_session_state", "workbench_authoring_runs"].map((table) => [
      table,
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  );
}

function authoringOutputCounts(db: MastheadDatabase): Record<string, number> {
  return Object.fromEntries(
    ["session_artifacts", "session_enrichments"].map((table) => [
      table,
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  );
}

function runClaimRows(db: MastheadDatabase, runId: string): Array<{ claimId: string; expiresAt: string; releasedAt: string | null }> {
  return db
    .prepare(
      `SELECT claims.claim_id AS claimId, claims.expires_at AS expiresAt, claims.released_at AS releasedAt
       FROM workbench_authoring_run_sessions AS run_sessions
       JOIN workbench_claims AS claims ON claims.claim_id = run_sessions.claim_id
       WHERE run_sessions.run_id = ?
       ORDER BY run_sessions.ordinal`
    )
    .all(runId) as Array<{ claimId: string; expiresAt: string; releasedAt: string | null }>;
}
