import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import {
  openMastheadDatabase,
  withImmediateTransaction,
  type MastheadDatabase
} from "../../../daemon/db/sqlite.ts";
import {
  dismissWorkbenchArtifactCandidate,
  getWorkbenchArtifactCandidate,
  setWorkbenchArtifactCandidateStatus
} from "../../../daemon/db/workbenchArtifactCandidateRepository.ts";
import {
  discoverArtifactCandidatePage,
  discoverArtifactCandidates,
  proposeArtifactCandidate
} from "../artifactCandidates.ts";
import {
  corpusSessionIds,
  dossierOnlyQuestion,
  durableArtifactCorpus,
  repeatedErrorPartOne,
  repeatedErrorPartTwo,
  seedDurableArtifactCorpus
} from "../__fixtures__/durableArtifactCorpus.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("artifact candidate discovery", () => {
  test("discovers optional work only from positive kind signals", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    const candidates = discoverArtifactCandidates(db, corpusSessionIds());

    expect(countKinds(candidates)).toEqual({ runbook: 3, adr: 2, incident_timeline: 2 });
    expect(candidates.some((candidate) => candidate.seedSessionId === dossierOnlyQuestion.id)).toBe(false);
    expect(candidates.every((candidate) => candidate.signalEvidenceRefs.length > 0)).toBe(true);
    db.close();
  });

  test("combines only sessions sharing a strong normalized signature", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    const candidates = discoverArtifactCandidates(db, corpusSessionIds());
    const repeated = candidates.find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found"
    );

    expect(repeated?.provenanceSessionIds).toEqual([repeatedErrorPartOne.id, repeatedErrorPartTwo.id]);
    expect(
      candidates.some(
        (candidate) =>
          candidate.provenanceSessionIds.length > 1 &&
          candidate.signatureKey !== "error:ssh:codex-command-not-found"
      )
    ).toBe(false);
    db.close();
  });

  test("candidate discovery resumes without rescanning unchanged sessions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    const first = discoverArtifactCandidatePage(db, { limit: 100 });
    const second = discoverArtifactCandidatePage(db, { afterSessionId: first.nextCursor, limit: 100 });

    expect(first.scannedSessionIds).toHaveLength(durableArtifactCorpus.length);
    expect(second.scannedSessionIds).not.toEqual(expect.arrayContaining(first.scannedSessionIds));
    expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([]);

    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' changed' WHERE session_id = ?").run(
      dossierOnlyQuestion.id
    );
    expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([
      dossierOnlyQuestion.id
    ]);
    db.close();
  });

  test("validates directed proposals against exact kind-specific positive evidence", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const session = durableArtifactCorpus.find((entry) => entry.id === "session:oauth-fixed")!;
    const refs = session.evidence.map((entry) => entry.id);

    const proposed = proposeArtifactCandidate(db, {
      kind: "runbook",
      provenanceSessionIds: [session.id],
      seedSessionId: session.id,
      signalEvidenceRefs: refs,
      signalSummary: "Repeatable OAuth callback recovery with a verified result."
    });

    expect(proposed).toMatchObject({ kind: "runbook", status: "pending" });
    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: [dossierOnlyQuestion.id],
        seedSessionId: dossierOnlyQuestion.id,
        signalEvidenceRefs: [],
        signalSummary: "This sounds useful."
      })
    ).toThrow("candidate_proposal_positive_evidence_required");
    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: [dossierOnlyQuestion.id],
        seedSessionId: dossierOnlyQuestion.id,
        signalEvidenceRefs: [dossierOnlyQuestion.evidence[0]!.id],
        signalSummary: "A reason cannot replace positive signals."
      })
    ).toThrow("candidate_proposal_kind_signals_missing");
    db.close();
  });

  test("allows a directed proposal to recover positive signals split across named sessions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare("UPDATE messages SET text_redacted = ? WHERE message_id = ?").run(
      "Decision: adopt a compact steel card for Settings.",
      "dossier-question:1"
    );
    db.prepare("UPDATE messages SET text_redacted = ? WHERE message_id = ?").run(
      "Rejected alternative: a full dashboard would obscure direct preferences.",
      "dossier-sparse:1"
    );

    expect(
      discoverArtifactCandidates(db, [dossierOnlyQuestion.id, "session:dossier-sparse"])
    ).toEqual([]);

    const proposed = proposeArtifactCandidate(db, {
      kind: "adr",
      provenanceSessionIds: [dossierOnlyQuestion.id, "session:dossier-sparse"],
      seedSessionId: dossierOnlyQuestion.id,
      signalEvidenceRefs: ["message:dossier-question:1", "message:dossier-sparse:1"],
      signalSummary: "Directed review connected an explicit decision to its rejected alternative."
    });

    expect(proposed).toMatchObject({
      kind: "adr",
      provenanceSessionIds: ["session:dossier-question", "session:dossier-sparse"],
      status: "pending"
    });
    db.close();
  });

  test("persists candidate-specific dismissal with evidence and a concrete reason", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const candidate = discoverArtifactCandidates(db, corpusSessionIds())[0]!;

    expect(() =>
      dismissWorkbenchArtifactCandidate(db, {
        candidateId: candidate.candidateId,
        reason: "no",
        signalEvidenceRefs: candidate.signalEvidenceRefs
      })
    ).toThrow("candidate_dismissal_reason_too_short");

    dismissWorkbenchArtifactCandidate(db, {
      candidateId: candidate.candidateId,
      reason: "The evidence is real but the procedure is too environment-specific to reuse.",
      signalEvidenceRefs: candidate.signalEvidenceRefs
    });

    expect(getWorkbenchArtifactCandidate(db, candidate.candidateId)).toMatchObject({ status: "dismissed" });
    expect(() =>
      setWorkbenchArtifactCandidateStatus(db, { candidateId: candidate.candidateId, status: "pending" })
    ).toThrow("artifact_candidate_transition_invalid:dismissed:pending");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM workbench_artifact_candidates WHERE status = 'dismissed'").get()
    ).toEqual({ count: 1 });
    db.close();
  });

  test("creates a distinct current candidate when dismissed evidence later changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const original = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;
    dismissWorkbenchArtifactCandidate(db, {
      candidateId: original.candidateId,
      reason: "The first version lacked enough environmental detail to be reusable.",
      signalEvidenceRefs: original.signalEvidenceRefs
    });

    db.prepare("UPDATE checkpoints SET summary = summary || ' Includes the missing environment.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const rediscovered = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;

    expect(rediscovered.candidateId).not.toBe(original.candidateId);
    expect(rediscovered.status).toBe("pending");
    expect(
      db
        .prepare(
          "SELECT status, COUNT(*) AS count FROM workbench_artifact_candidates GROUP BY status ORDER BY status"
        )
        .all()
    ).toEqual([
      { status: "dismissed", count: 1 },
      { status: "pending", count: 1 }
    ]);
    db.close();
  });

  test("caps a discovery page at 100 tool-heavy publish-path sessions and completes within two seconds", async () => {
    const db = await testDb();
    seedToolHeavySessions(db, 101, 60);

    const started = performance.now();
    const page = discoverArtifactCandidatePage(db, { limit: 500 });
    const elapsed = performance.now() - started;

    expect(page.scannedSessionIds).toHaveLength(100);
    expect(page.nextCursor).toBe("session:perf:099");
    expect(elapsed).toBeLessThan(2_000);
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-artifact-candidates-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function countKinds(candidates: ReturnType<typeof discoverArtifactCandidates>): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function seedToolHeavySessions(db: MastheadDatabase, sessionCount: number, toolsPerSession: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES ('host:perf', 'perf', ?, ?)"
  ).run("2026-07-12T00:00:00.000Z", "2026-07-12T00:00:00.000Z");
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES ('runtime:perf', 'codex', 'test', ?, ?)"
  ).run("2026-07-12T00:00:00.000Z", "2026-07-12T00:00:00.000Z");
  const insertSession = db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
    ) VALUES (?, 'host:perf', 'runtime:perf', ?, 'Performance', ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    "INSERT INTO workbench_session_state (session_id, publication_status) VALUES (?, 'publish_path')"
  );
  const insertCall = db.prepare(
    "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, 'read_file', ?, '{}')"
  );
  const insertResult = db.prepare(
    "INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, source_ref_json) VALUES (?, ?, ?, 'succeeded', ?, '{}')"
  );
  withImmediateTransaction(db, () => {
    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      const sessionId = `session:perf:${String(sessionIndex).padStart(3, "0")}`;
      const observedAt = `2026-07-12T00:${String(sessionIndex % 60).padStart(2, "0")}:00.000Z`;
      insertSession.run(sessionId, sessionId, sessionId, observedAt, observedAt, observedAt, observedAt, observedAt);
      insertState.run(sessionId);
      for (let toolIndex = 0; toolIndex < toolsPerSession; toolIndex += 1) {
        const callId = `${sessionId}:tool:${toolIndex}`;
        insertCall.run(callId, sessionId, observedAt);
        insertResult.run(`${callId}:result`, callId, sessionId, observedAt);
      }
    }
  });
}
