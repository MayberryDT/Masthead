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
  findBestWorkbenchArtifactCandidatePredecessor,
  getWorkbenchArtifactCandidate,
  listCurrentWorkbenchArtifactCandidatesForReconciliation,
  listWorkbenchArtifactSignatureMembersForIdentities,
  listWorkbenchArtifactCandidates,
  setWorkbenchArtifactCandidateStatus
} from "../../../daemon/db/workbenchArtifactCandidateRepository.ts";
import {
  discoverArtifactCandidatePage,
  discoverArtifactCandidates,
  proposeArtifactCandidate
} from "../artifactCandidates.ts";
import { getAuthoringEvidencePage } from "../evidenceCatalog.ts";
import {
  corpusSessionIds,
  dossierOnlyQuestion,
  durableArtifactCorpus,
  explicitArchitectureDecision,
  decisionWithRejectedAlternatives,
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
    for (const candidate of candidates) {
      const normalizedProvenance = db
        .prepare(
          `SELECT session_id AS sessionId
           FROM workbench_artifact_candidate_provenance
           WHERE candidate_id = ?
           ORDER BY position`
        )
        .all(candidate.candidateId) as Array<{ sessionId: string }>;
      expect(normalizedProvenance.map((row) => row.sessionId)).toEqual(candidate.provenanceSessionIds);
    }
    db.close();
  });

  test("keeps targeted current and predecessor queries bounded with unrelated active history", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidates(db, ["session:oauth-fixed"]);
    const insertHistorical = db.prepare(
      `INSERT INTO workbench_artifact_candidates (
        candidate_id, kind, seed_session_id, provenance_session_ids_json,
        signal_evidence_refs_json, signal_summary, signature_key, evidence_revision,
        origin, status, created_at, updated_at
      ) VALUES (?, 'runbook', ?, ?, ?, 'Unrelated active candidate.', ?, ?, 'automatic', 'pending', ?, ?)`
    );
    withImmediateTransaction(db, () => {
      for (let index = 0; index < 500; index += 1) {
        const candidateId = `candidate:unrelated-history:${index}`;
        insertHistorical.run(
          candidateId,
          dossierOnlyQuestion.id,
          JSON.stringify([dossierOnlyQuestion.id]),
          JSON.stringify([dossierOnlyQuestion.evidence[0]!.id]),
          `error:unrelated:${index}`,
          `revision:unrelated:${index}`,
          `2026-07-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
          `2026-07-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`
        );
      }
    });

    const relevant = listCurrentWorkbenchArtifactCandidatesForReconciliation(db, {
      identities: [],
      sessionIds: ["session:oauth-fixed"]
    });
    expect(relevant).toHaveLength(1);
    expect(relevant[0]!.seedSessionId).toBe("session:oauth-fixed");
    expect(
      findBestWorkbenchArtifactCandidatePredecessor(db, {
        kind: "runbook",
        provenanceSessionIds: ["session:oauth-fixed"],
        seedSessionId: "session:oauth-fixed"
      })?.candidateId
    ).toBe(relevant[0]!.candidateId);
    const planDetails = [
      ...(db.prepare(
        `EXPLAIN QUERY PLAN
         SELECT candidates.candidate_id
         FROM workbench_artifact_candidate_provenance provenance
         JOIN workbench_artifact_candidates candidates ON candidates.candidate_id = provenance.candidate_id
         WHERE provenance.session_id = ?
           AND candidates.status IN ('pending', 'claimed', 'published')`
      ).all("session:oauth-fixed") as Array<{ detail: string }>),
      ...(db.prepare(
        `EXPLAIN QUERY PLAN
         SELECT candidate_id
         FROM workbench_artifact_candidates
         WHERE kind = 'runbook' AND signature_key = 'error:unrelated:499'
         ORDER BY CASE WHEN status IN ('pending', 'claimed', 'published') THEN 0 ELSE 1 END,
           updated_at DESC, candidate_id
         LIMIT 1`
      ).all() as Array<{ detail: string }>)
    ].map((row) => row.detail).join("\n");
    expect(planDetails).toContain("idx_workbench_candidate_provenance_session");
    expect(planDetails).toContain("idx_workbench_candidates_signature_history");
    expect(planDetails).not.toMatch(/SCAN workbench_artifact_candidates/);
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
    expect(repeated?.signalEvidenceRefs).toEqual(
      expect.arrayContaining([
        "tool_result:repeated-error:1:failure",
        "tool_result:repeated-error:2:failure"
      ])
    );
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

    db.prepare("UPDATE tool_calls SET tool_name = tool_name || '_changed' WHERE session_id = ?").run(
      repeatedErrorPartTwo.id
    );
    expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([
      repeatedErrorPartTwo.id
    ]);
    db.close();
  });

  test("rolls back candidate reconciliation and scan acknowledgements together", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.exec(
      `CREATE TRIGGER fail_candidate_insert
       BEFORE INSERT ON workbench_artifact_candidates
       WHEN NEW.kind = 'runbook'
       BEGIN
         SELECT RAISE(ABORT, 'injected candidate persistence failure');
       END;`
    );

    expect(() => discoverArtifactCandidatePage(db, { limit: 100 })).toThrow(
      "injected candidate persistence failure"
    );
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_artifact_candidates").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_artifact_candidate_scans").get()).toEqual({ count: 0 });

    db.exec("DROP TRIGGER fail_candidate_insert;");
    const retry = discoverArtifactCandidatePage(db, { limit: 100 });
    expect(retry.scannedSessionIds).toHaveLength(durableArtifactCorpus.length);
    expect(retry.candidates).toHaveLength(7);
    db.close();
  });

  test("uses a source revision to skip unchanged transcript hashing and notices later evidence changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const sourceRevision = db
      .prepare(
        `SELECT source_revision AS sourceRevision
         FROM workbench_artifact_candidate_source_revisions
         WHERE session_id = ?`
      )
      .get(dossierOnlyQuestion.id) as { sourceRevision: number };

    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' unreadable sentinel' WHERE session_id = ?").run(
      dossierOnlyQuestion.id
    );
    db.prepare(
      `UPDATE workbench_artifact_candidate_source_revisions
       SET source_revision = ?
       WHERE session_id = ?`
    ).run(sourceRevision.sourceRevision, dossierOnlyQuestion.id);
    expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([]);

    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' changed again' WHERE session_id = ?").run(
      dossierOnlyQuestion.id
    );
    expect(discoverArtifactCandidatePage(db, { limit: 100 }).scannedSessionIds).toEqual([
      dossierOnlyQuestion.id
    ]);
    db.close();
  });

  test("supersedes stale pending candidates and atomically replaces changed evidence", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const original = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.kind === "runbook" && candidate.seedSessionId === "session:oauth-fixed"
    )!;

    db.prepare("UPDATE checkpoints SET summary = summary || ' Verified in a clean environment.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const page = discoverArtifactCandidatePage(db, { limit: 100 });
    const all = listWorkbenchArtifactCandidates(db);
    const replacement = all.find(
      (candidate) =>
        candidate.kind === "runbook" &&
        candidate.seedSessionId === "session:oauth-fixed" &&
        candidate.status === "pending"
    )!;

    expect(page.scannedSessionIds).toEqual(["session:oauth-fixed"]);
    expect(replacement.candidateId).not.toBe(original.candidateId);
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    db.close();
  });

  test("rolls back supersession and leaves changed evidence unacknowledged when replacement fails", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const original = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.kind === "runbook" && candidate.seedSessionId === "session:oauth-fixed"
    )!;
    db.prepare("UPDATE checkpoints SET summary = summary || ' Changed revision.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    db.exec(
      `CREATE TRIGGER fail_runbook_replacement
       BEFORE INSERT ON workbench_artifact_candidates
       WHEN NEW.kind = 'runbook'
       BEGIN
         SELECT RAISE(ABORT, 'injected replacement failure');
       END;`
    );

    expect(() => discoverArtifactCandidatePage(db, { limit: 100 })).toThrow("injected replacement failure");
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("pending");
    expect(
      listWorkbenchArtifactCandidates(db).filter(
        (candidate) => candidate.kind === "runbook" && candidate.seedSessionId === "session:oauth-fixed"
      )
    ).toHaveLength(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM workbench_artifact_candidate_scans WHERE session_id = 'session:oauth-fixed'"
        )
        .get()
    ).toEqual({ count: 1 });

    db.exec("DROP TRIGGER fail_runbook_replacement;");
    const retry = discoverArtifactCandidatePage(db, { limit: 100 });
    expect(retry.scannedSessionIds).toEqual(["session:oauth-fixed"]);
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    db.close();
  });

  test("removes stale pending candidates when changed evidence no longer earns a seed", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const original = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.kind === "runbook" && candidate.seedSessionId === "session:oauth-fixed"
    )!;

    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:oauth-fixed");
    const page = discoverArtifactCandidatePage(db, { limit: 100 });

    expect(page.scannedSessionIds).toEqual(["session:oauth-fixed"]);
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    expect(
      listWorkbenchArtifactCandidates(db).some(
        (candidate) =>
          candidate.kind === "runbook" &&
          candidate.seedSessionId === "session:oauth-fixed" &&
          candidate.status === "pending"
      )
    ).toBe(false);
    db.close();
  });

  test("re-evaluates an entire strong-signature provenance set when one member changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const original = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found"
    )!;

    db.prepare(
      "UPDATE tool_results SET output_redacted = output_redacted || ' Verified twice.' WHERE session_id = ? AND status = 'succeeded'"
    ).run(repeatedErrorPartTwo.id);
    const page = discoverArtifactCandidatePage(db, { limit: 100 });
    const replacement = listWorkbenchArtifactCandidates(db).find(
      (candidate) =>
        candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;

    expect(page.scannedSessionIds).toEqual([repeatedErrorPartTwo.id]);
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    expect(replacement.candidateId).not.toBe(original.candidateId);
    expect(replacement.provenanceSessionIds).toEqual([repeatedErrorPartOne.id, repeatedErrorPartTwo.id]);
    db.close();
  });

  test("freezes claimed evidence and defers the scan until the claim is released", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const claimed = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.kind === "runbook" && candidate.seedSessionId === "session:oauth-fixed"
    )!;
    setWorkbenchArtifactCandidateStatus(db, { candidateId: claimed.candidateId, status: "claimed" });
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:oauth-fixed");

    const deferred = discoverArtifactCandidatePage(db, { limit: 100 });
    expect(deferred.scannedSessionIds).toEqual([]);
    expect(getWorkbenchArtifactCandidate(db, claimed.candidateId)).toMatchObject({
      signalEvidenceRefs: claimed.signalEvidenceRefs,
      status: "claimed"
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM workbench_artifact_candidate_scans WHERE session_id = 'session:oauth-fixed'"
        )
        .get()
    ).toEqual({ count: 1 });

    setWorkbenchArtifactCandidateStatus(db, { candidateId: claimed.candidateId, status: "pending" });
    const reconciled = discoverArtifactCandidatePage(db, { limit: 100 });
    expect(reconciled.scannedSessionIds).toEqual(["session:oauth-fixed"]);
    expect(getWorkbenchArtifactCandidate(db, claimed.candidateId)?.status).toBe("superseded");
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

  test("rejects unsigned joins and preserves signed proposals until selected support becomes invalid", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "adr",
        provenanceSessionIds: [explicitArchitectureDecision.id, decisionWithRejectedAlternatives.id],
        seedSessionId: explicitArchitectureDecision.id,
        signalEvidenceRefs: [
          "message:decision-local-first:decision",
          "message:decision-artifact-logbook:alternatives"
        ],
        signalSummary: "A weak topic-only join must not become a directed ADR."
      })
    ).toThrow("candidate_proposal_multi_session_signature_required");

    const proposal = proposeArtifactCandidate(db, {
      kind: "runbook",
      provenanceSessionIds: [repeatedErrorPartOne.id, repeatedErrorPartTwo.id],
      seedSessionId: repeatedErrorPartOne.id,
      signalEvidenceRefs: [
        "tool_result:repeated-error:1:failure",
        "file:repeated-error:1:change",
        "checkpoint:repeated-error:1:verified",
        "tool_result:repeated-error:2:failure"
      ],
      signalSummary: "The directed runbook is joined by exact matching failure signatures.",
      signatureKey: "error:ssh:codex-command-not-found"
    });
    expect(proposal.origin).toBe("proposal");

    discoverArtifactCandidates(db, [repeatedErrorPartOne.id]);
    expect(getWorkbenchArtifactCandidate(db, proposal.candidateId)?.status).toBe("pending");

    db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES ('proposal:unrelated', ?, 'assistant', 'Unrelated follow-up.', 'proposal:unrelated:hash',
        '2026-07-01T14:00:00.000Z', '{}', 'authoritative')`
    ).run(repeatedErrorPartOne.id);
    discoverArtifactCandidates(db, [repeatedErrorPartOne.id]);
    const revised = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.origin === "proposal" && candidate.status === "pending"
    )!;
    expect(revised.supersedesCandidateId).toBe(proposal.candidateId);

    setWorkbenchArtifactCandidateStatus(db, { candidateId: revised.candidateId, status: "claimed" });
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' More context.' WHERE message_id = ?").run(
      "proposal:unrelated"
    );
    expect(discoverArtifactCandidates(db, [repeatedErrorPartOne.id])).toEqual([]);
    expect(getWorkbenchArtifactCandidate(db, revised.candidateId)?.status).toBe("claimed");

    setWorkbenchArtifactCandidateStatus(db, { candidateId: revised.candidateId, status: "pending" });
    discoverArtifactCandidates(db, [repeatedErrorPartOne.id]);
    const latest = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.origin === "proposal" && candidate.status === "pending"
    )!;
    db.prepare("DELETE FROM checkpoints WHERE checkpoint_id = 'repeated-error:1:verified'").run();
    discoverArtifactCandidates(db, [repeatedErrorPartOne.id]);
    expect(getWorkbenchArtifactCandidate(db, latest.candidateId)?.status).toBe("superseded");
    expect(
      listWorkbenchArtifactCandidates(db).some(
        (candidate) => candidate.origin === "proposal" && candidate.status === "pending"
      )
    ).toBe(false);
    db.close();
  });

  test("rejects non-positive proposal refs and requires every joined signature trigger", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES ('oauth:comment', 'session:oauth-fixed', 'assistant', 'Unrelated commentary.', 'hash',
        '2026-07-01T12:01:30.000Z', '{}', 'authoritative')`
    ).run();

    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: ["session:oauth-fixed"],
        seedSessionId: "session:oauth-fixed",
        signalEvidenceRefs: [
          "tool_result:oauth:failure",
          "file:oauth:change",
          "checkpoint:oauth:verified",
          "message:oauth:comment"
        ],
        signalSummary: "An unrelated exact ref must not be persisted as positive support."
      })
    ).toThrow("candidate_proposal_signal_evidence_extra:message:oauth:comment");

    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: [repeatedErrorPartOne.id, repeatedErrorPartTwo.id],
        seedSessionId: repeatedErrorPartOne.id,
        signalEvidenceRefs: [
          "tool_result:repeated-error:1:failure",
          "file:repeated-error:1:change",
          "checkpoint:repeated-error:1:verified"
        ],
        signalSummary: "A join cannot omit the second provenance session's signature trigger.",
        signatureKey: "error:ssh:codex-command-not-found"
      })
    ).toThrow("candidate_proposal_signature_not_in_evidence");

    const joined = proposeArtifactCandidate(db, {
      kind: "runbook",
      provenanceSessionIds: [repeatedErrorPartOne.id, repeatedErrorPartTwo.id],
      seedSessionId: repeatedErrorPartOne.id,
      signalEvidenceRefs: [
        "tool_result:repeated-error:1:failure",
        "file:repeated-error:1:change",
        "checkpoint:repeated-error:1:verified",
        "tool_result:repeated-error:2:failure"
      ],
      signalSummary: "A verified chain is joined by the exact signature trigger from both sessions.",
      signatureKey: "error:ssh:codex-command-not-found"
    });
    expect(joined.signalEvidenceRefs).toEqual([
      "checkpoint:repeated-error:1:verified",
      "file:repeated-error:1:change",
      "tool_result:repeated-error:1:failure",
      "tool_result:repeated-error:2:failure"
    ]);

    const seedChanged = proposeArtifactCandidate(db, {
      kind: "runbook",
      provenanceSessionIds: [repeatedErrorPartOne.id, repeatedErrorPartTwo.id],
      seedSessionId: repeatedErrorPartTwo.id,
      signalEvidenceRefs: joined.signalEvidenceRefs,
      signalSummary: joined.signalSummary,
      signatureKey: joined.signatureKey
    });
    expect(getWorkbenchArtifactCandidate(db, joined.candidateId)?.status).toBe("superseded");
    expect(seedChanged.supersedesCandidateId).toBe(joined.candidateId);
    expect(seedChanged.seedSessionId).toBe(repeatedErrorPartTwo.id);

    const summaryChanged = proposeArtifactCandidate(db, {
      kind: "runbook",
      provenanceSessionIds: [repeatedErrorPartOne.id, repeatedErrorPartTwo.id],
      seedSessionId: repeatedErrorPartTwo.id,
      signalEvidenceRefs: joined.signalEvidenceRefs,
      signalSummary: "The same signed evidence now has a deliberately revised durable summary.",
      signatureKey: joined.signatureKey
    });
    expect(getWorkbenchArtifactCandidate(db, seedChanged.candidateId)?.status).toBe("superseded");
    expect(summaryChanged.supersedesCandidateId).toBe(seedChanged.candidateId);
    expect(summaryChanged.signalSummary).not.toBe(joined.signalSummary);

    db.close();
  });

  test("atomically supersedes changed pending and published proposal revisions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const pendingA = proposeOauthRunbook(db);
    db.prepare("UPDATE checkpoints SET summary = summary || ' Pending B.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    db.exec(
      `CREATE TRIGGER fail_proposed_replacement
       BEFORE INSERT ON workbench_artifact_candidates
       WHEN NEW.kind = 'runbook'
       BEGIN
         SELECT RAISE(ABORT, 'injected proposed replacement failure');
       END;`
    );
    expect(() => proposeOauthRunbook(db)).toThrow("injected proposed replacement failure");
    expect(getWorkbenchArtifactCandidate(db, pendingA.candidateId)?.status).toBe("pending");
    db.exec("DROP TRIGGER fail_proposed_replacement;");
    const pendingB = proposeOauthRunbook(db);
    expect(getWorkbenchArtifactCandidate(db, pendingA.candidateId)?.status).toBe("superseded");
    expect(pendingB).toMatchObject({ status: "pending", supersedesCandidateId: pendingA.candidateId });

    setWorkbenchArtifactCandidateStatus(db, { candidateId: pendingB.candidateId, status: "published" });
    db.prepare("UPDATE checkpoints SET summary = summary || ' Published C.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const pendingC = proposeOauthRunbook(db);
    expect(getWorkbenchArtifactCandidate(db, pendingB.candidateId)?.status).toBe("superseded");
    expect(pendingC).toMatchObject({ status: "pending", supersedesCandidateId: pendingB.candidateId });
    db.close();
  });

  test("links proposal lineage to the known current predecessor when timestamps are equal", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const revisionA = proposeOauthRunbook(db);
    db.prepare("UPDATE checkpoints SET summary = summary || ' Revision B.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const revisionB = proposeOauthRunbook(db);
    db.prepare(
      `UPDATE workbench_artifact_candidates
       SET updated_at = '2026-07-13T00:00:00.000Z'
       WHERE candidate_id IN (?, ?)`
    ).run(revisionA.candidateId, revisionB.candidateId);

    db.prepare("UPDATE checkpoints SET summary = summary || ' Revision C.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const revisionC = proposeOauthRunbook(db);
    expect(revisionC.supersedesCandidateId).toBe(revisionB.candidateId);
    expect(getWorkbenchArtifactCandidate(db, revisionB.candidateId)?.status).toBe("superseded");
    db.close();
  });

  test("freezes a claimed proposal when its evidence revision changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const claimed = proposeOauthRunbook(db);
    setWorkbenchArtifactCandidateStatus(db, { candidateId: claimed.candidateId, status: "claimed" });
    db.prepare("UPDATE checkpoints SET summary = summary || ' Changed while claimed.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );

    expect(() => proposeOauthRunbook(db)).toThrow(
      `candidate_proposal_reconciliation_deferred:${claimed.candidateId}`
    );
    expect(getWorkbenchArtifactCandidate(db, claimed.candidateId)).toMatchObject({
      evidenceRevision: claimed.evidenceRevision,
      status: "claimed"
    });
    db.close();
  });

  test("gives proposal A to B to A revisions distinct predecessor lineage", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const originalSummary = (
      db.prepare("SELECT summary FROM checkpoints WHERE session_id = ?").get("session:oauth-fixed") as {
        summary: string;
      }
    ).summary;
    const revisionA = proposeOauthRunbook(db);
    expect(proposeOauthRunbook(db).candidateId).toBe(revisionA.candidateId);
    db.prepare("UPDATE checkpoints SET summary = summary || ' Proposal B.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const revisionB = proposeOauthRunbook(db);
    db.prepare("UPDATE checkpoints SET summary = ? WHERE session_id = ?").run(
      originalSummary,
      "session:oauth-fixed"
    );
    const revisionA2 = proposeOauthRunbook(db);

    expect(new Set([revisionA.candidateId, revisionB.candidateId, revisionA2.candidateId]).size).toBe(3);
    expect(revisionB.supersedesCandidateId).toBe(revisionA.candidateId);
    expect(revisionA2.supersedesCandidateId).toBe(revisionB.candidateId);
    expect(revisionA2.evidenceRevision).toBe(revisionA.evidenceRevision);
    db.close();
  });

  test("supersedes same-revision proposal support changes instead of returning stale refs", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare(
      `INSERT INTO checkpoints (
        checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
      ) VALUES ('oauth:verified-alternate', 'session:oauth-fixed', 'verification_passed',
        'Alternate OAuth verification test passed.', '2026-07-01T12:03:00.000Z', '{}')`
    ).run();
    const original = proposeOauthRunbook(db);
    const alternate = proposeOauthRunbook(db, "checkpoint:oauth:verified-alternate");

    expect(alternate.evidenceRevision).toBe(original.evidenceRevision);
    expect(alternate.candidateId).not.toBe(original.candidateId);
    expect(alternate.supersedesCandidateId).toBe(original.candidateId);
    expect(alternate.signalEvidenceRefs).toContain("checkpoint:oauth:verified-alternate");
    expect(alternate.signalEvidenceRefs).not.toContain("checkpoint:oauth:verified");
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    db.close();
  });

  test("atomically reconciles unsigned and signed proposal identity transitions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const unsigned = proposeOauthRunbook(db);
    addOauthSignature(db);
    const signed = proposeSignedOauthRunbook(db);

    expect(getWorkbenchArtifactCandidate(db, unsigned.candidateId)?.status).toBe("superseded");
    expect(signed).toMatchObject({
      signatureKey: "error:oauth:state-mismatch",
      status: "pending",
      supersedesCandidateId: unsigned.candidateId
    });
    expect(currentRunbookCandidates(db, "session:oauth-fixed")).toEqual([signed.candidateId]);

    setWorkbenchArtifactCandidateStatus(db, { candidateId: signed.candidateId, status: "published" });
    db.prepare("DELETE FROM messages WHERE message_id = 'oauth:signature'").run();
    const unsignedAgain = proposeOauthRunbook(db);
    expect(getWorkbenchArtifactCandidate(db, signed.candidateId)?.status).toBe("superseded");
    expect(unsignedAgain).toMatchObject({
      status: "pending",
      supersedesCandidateId: signed.candidateId
    });
    expect(unsignedAgain).not.toHaveProperty("signatureKey");
    expect(currentRunbookCandidates(db, "session:oauth-fixed")).toEqual([unsignedAgain.candidateId]);
    db.close();
  });

  test("defers an identity transition while its overlapping predecessor is claimed", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const claimed = proposeOauthRunbook(db);
    setWorkbenchArtifactCandidateStatus(db, { candidateId: claimed.candidateId, status: "claimed" });
    addOauthSignature(db);

    expect(() => proposeSignedOauthRunbook(db)).toThrow(
      `candidate_proposal_reconciliation_deferred:${claimed.candidateId}`
    );
    expect(getWorkbenchArtifactCandidate(db, claimed.candidateId)?.status).toBe("claimed");
    expect(currentRunbookCandidates(db, "session:oauth-fixed")).toEqual([claimed.candidateId]);
    db.close();
  });

  test("rolls back identity-transition supersession when proposed replacement insertion fails", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const unsigned = proposeOauthRunbook(db);
    addOauthSignature(db);
    db.exec(
      `CREATE TRIGGER fail_identity_transition
       BEFORE INSERT ON workbench_artifact_candidates
       WHEN NEW.kind = 'runbook'
       BEGIN
         SELECT RAISE(ABORT, 'injected identity transition failure');
       END;`
    );

    expect(() => proposeSignedOauthRunbook(db)).toThrow("injected identity transition failure");
    expect(getWorkbenchArtifactCandidate(db, unsigned.candidateId)?.status).toBe("pending");
    expect(currentRunbookCandidates(db, "session:oauth-fixed")).toEqual([unsigned.candidateId]);
    db.close();
  });

  test("requires real passed-verification semantics and retains only the earning chain", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare("UPDATE tool_results SET output_redacted = 'Command succeeded.' WHERE session_id = ?").run(
      "session:migration-fixed"
    );

    const candidates = discoverArtifactCandidates(db, ["session:migration-fixed", "session:oauth-fixed"]);
    const oauth = candidates.find((candidate) => candidate.seedSessionId === "session:oauth-fixed")!;

    expect(candidates.some((candidate) => candidate.seedSessionId === "session:migration-fixed")).toBe(false);
    expect(oauth.signalEvidenceRefs).toEqual([
      "checkpoint:oauth:verified",
      "file:oauth:change",
      "tool_result:oauth:failure"
    ]);
    db.close();
  });

  test("rejects failed-verification prose and successful file-read results even when they say tests passed", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare(
      "UPDATE tool_results SET output_redacted = ? WHERE session_id = ? AND status = 'succeeded'"
    ).run("Verification tests failed; failure reproduced successfully", "session:migration-fixed");
    expect(discoverArtifactCandidates(db, ["session:migration-fixed"])).toEqual([]);

    db.prepare(
      "UPDATE tool_results SET output_redacted = 'tests passed' WHERE session_id = ? AND status = 'succeeded'"
    ).run("session:migration-fixed");
    db.prepare(
      "UPDATE tool_calls SET tool_name = 'read_file' WHERE session_id = ? AND tool_call_id LIKE '%verified%call'"
    ).run("session:migration-fixed");
    const verificationResult = getAuthoringEvidencePage(db, {
      sessionId: "session:migration-fixed"
    }).items.find((item) => item.itemId === "tool_result:migration:verified");

    expect(verificationResult?.toolName).toBe("read_file");
    expect(discoverArtifactCandidates(db, ["session:migration-fixed"])).toEqual([]);

    db.prepare("UPDATE checkpoints SET summary = ? WHERE session_id = ?").run(
      "Verification tests failed; failure reproduced successfully",
      "session:oauth-fixed"
    );
    expect(discoverArtifactCandidates(db, ["session:oauth-fixed"])).toEqual([]);
    db.close();
  });

  test("does not turn succeeded, negated, or hypothetical error discussion into a failure signal", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare(
      `UPDATE tool_results
       SET status = 'succeeded', exit_code = 0, output_redacted = 'No error was observed.'
       WHERE session_id = 'session:migration-fixed' AND status = 'failed'`
    ).run();
    db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES ('migration:hypothetical', 'session:migration-fixed', 'assistant',
        'We discussed error handling if the migration fails.', 'migration:hypothetical:hash',
        '2026-07-01T12:00:30.000Z', '{}', 'authoritative')`
    ).run();

    expect(discoverArtifactCandidates(db, ["session:migration-fixed"])).toEqual([]);

    db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES ('migration:observed-failure', 'session:migration-fixed', 'assistant',
        'The migration failed during deployment.', 'migration:observed-failure:hash',
        '2026-07-01T12:00:45.000Z', '{}', 'authoritative')`
    ).run();
    const observed = discoverArtifactCandidates(db, ["session:migration-fixed"]);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.signalEvidenceRefs).toContain("message:migration:observed-failure");
    expect(observed[0]!.signalEvidenceRefs).not.toContain("tool_result:migration:failure");
    db.close();
  });

  test("rejects negated and hypothetical change, decision, and alternative language", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const sessionId = dossierOnlyQuestion.id;
    db.prepare(
      `INSERT INTO tool_calls (
        tool_call_id, session_id, tool_name, started_at, source_ref_json
      ) VALUES ('adversarial:failure:call', ?, 'exec_command', '2026-07-01T13:00:00.000Z', '{}')`
    ).run(sessionId);
    db.prepare(
      `INSERT INTO tool_results (
        tool_result_id, tool_call_id, session_id, status, exit_code, output_redacted, completed_at, source_ref_json
      ) VALUES ('adversarial:failure', 'adversarial:failure:call', ?, 'failed', 1,
        'The configuration test failed.', '2026-07-01T13:00:00.000Z', '{}')`
    ).run(sessionId);
    const insertMessage = db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES (?, ?, 'assistant', ?, ?, ?, '{}', 'authoritative')`
    );
    insertMessage.run(
      'adversarial:not-changed', sessionId, 'The configuration was not changed.',
      'adversarial:not-changed:hash', '2026-07-01T13:01:00.000Z'
    );
    insertMessage.run(
      'adversarial:no-update', sessionId, 'No update was applied.',
      'adversarial:no-update:hash', '2026-07-01T13:02:00.000Z'
    );
    insertMessage.run(
      'adversarial:hypothetical-change', sessionId, 'If the callback changed, it could be fixed later.',
      'adversarial:hypothetical-change:hash', '2026-07-01T13:03:00.000Z'
    );
    insertMessage.run(
      'adversarial:hypothetical-decision', sessionId,
      'If we decided to use SQLite instead of Postgres, we would discuss the tradeoff.',
      'adversarial:hypothetical-decision:hash', '2026-07-01T13:04:00.000Z'
    );
    insertMessage.run(
      'adversarial:rejected-decision', sessionId,
      'The proposed decision was rejected; no alternative was actually considered.',
      'adversarial:rejected-decision:hash', '2026-07-01T13:05:00.000Z'
    );
    db.prepare(
      `INSERT INTO checkpoints (
        checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
      ) VALUES ('adversarial:verified', ?, 'verification_passed',
        'Configuration verification test passed.', '2026-07-01T13:06:00.000Z', '{}')`
    ).run(sessionId);

    expect(discoverArtifactCandidates(db, [sessionId])).toEqual([]);
    db.close();
  });

  test("rejects incoherent runbook chronology, nonexistent sessions, and unrelated provenance padding", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    db.prepare("UPDATE checkpoints SET observed_at = '2026-07-01T11:59:00.000Z' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );

    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: ["session:migration-fixed", "session:oauth-fixed"],
        seedSessionId: "session:migration-fixed",
        signalEvidenceRefs: [
          "tool_result:migration:failure",
          "file:oauth:change",
          "checkpoint:oauth:verified"
        ],
        signalSummary: "These refs have all categories but no coherent chronological chain."
      })
    ).toThrow("candidate_proposal_multi_session_signature_required");
    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "adr",
        provenanceSessionIds: ["session:does-not-exist", "session:decision-local-first"],
        seedSessionId: "session:decision-local-first",
        signalEvidenceRefs: [
          "message:decision-local-first:decision",
          "message:decision-local-first:alternative"
        ],
        signalSummary: "A nonexistent session cannot pad otherwise valid provenance."
      })
    ).toThrow("candidate_proposal_session_not_found:session:does-not-exist");
    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "runbook",
        provenanceSessionIds: ["session:dossier-question", "session:migration-fixed"],
        seedSessionId: "session:migration-fixed",
        signalEvidenceRefs: [
          "message:dossier-question:1",
          "tool_result:migration:failure",
          "file:migration:change",
          "tool_result:migration:verified"
        ],
        signalSummary: "Unrelated dossier evidence cannot pad valid runbook provenance."
      })
    ).toThrow("candidate_proposal_multi_session_signature_required");
    db.close();
  });

  test("rejects unsigned directed proposals with positive signals split across sessions", async () => {
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

    expect(() =>
      proposeArtifactCandidate(db, {
        kind: "adr",
        provenanceSessionIds: [dossierOnlyQuestion.id, "session:dossier-sparse"],
        seedSessionId: dossierOnlyQuestion.id,
        signalEvidenceRefs: ["message:dossier-question:1", "message:dossier-sparse:1"],
        signalSummary: "Directed review cannot join sessions without a strong evidence key."
      })
    ).toThrow("candidate_proposal_multi_session_signature_required");
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
    const unchanged = discoverArtifactCandidates(db, corpusSessionIds()).find(
      (entry) => entry.candidateId === candidate.candidateId
    );
    expect(unchanged?.status).toBe("dismissed");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM workbench_artifact_candidates").get()
    ).toEqual({ count: 7 });
    db.prepare(
      `INSERT INTO workbench_artifact_candidates (
        candidate_id, kind, seed_session_id, provenance_session_ids_json,
        signal_evidence_refs_json, signal_summary, signature_key, evidence_revision,
        origin, status, created_at, updated_at
      ) VALUES ('candidate:active-overlap', ?, ?, ?, ?, 'Different active identity on the same provenance.',
        'error:synthetic:overlap', 'revision:active-overlap', 'proposal', 'pending', ?, ?)`
    ).run(
      candidate.kind,
      candidate.seedSessionId,
      JSON.stringify(candidate.provenanceSessionIds),
      JSON.stringify(candidate.signalEvidenceRefs),
      "2026-07-13T00:00:00.000Z",
      "2026-07-13T00:00:00.000Z"
    );
    const withActiveOverlap = discoverArtifactCandidates(db, candidate.provenanceSessionIds).find(
      (entry) => entry.candidateId === candidate.candidateId
    );
    expect(withActiveOverlap?.status).toBe("dismissed");
    db.close();
  });

  test("keeps an exactly unchanged directed proposal dismissed until its evidence changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const original = proposeOauthRunbook(db);
    dismissWorkbenchArtifactCandidate(db, {
      candidateId: original.candidateId,
      reason: "This exact directed procedure is not reusable in the current environment.",
      signalEvidenceRefs: original.signalEvidenceRefs
    });

    const unchanged = proposeOauthRunbook(db);
    expect(unchanged.candidateId).toBe(original.candidateId);
    expect(unchanged.status).toBe("dismissed");

    db.prepare(
      `INSERT INTO workbench_artifact_candidates (
        candidate_id, kind, seed_session_id, provenance_session_ids_json,
        signal_evidence_refs_json, signal_summary, signature_key, evidence_revision,
        origin, status, created_at, updated_at
      ) VALUES ('candidate:proposal-active-overlap', 'runbook', 'session:oauth-fixed',
        '["session:oauth-fixed"]', '["tool_result:oauth:failure"]',
        'Independent signed work on the same provenance.', 'error:independent:overlap',
        'revision:independent-overlap', 'proposal', 'pending', ?, ?)`
    ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
    const unchangedWithOverlap = proposeOauthRunbook(db);
    expect(unchangedWithOverlap.candidateId).toBe(original.candidateId);
    expect(getWorkbenchArtifactCandidate(db, "candidate:proposal-active-overlap")?.status).toBe("pending");
    setWorkbenchArtifactCandidateStatus(db, {
      candidateId: "candidate:proposal-active-overlap",
      status: "superseded"
    });

    db.prepare("UPDATE checkpoints SET summary = summary || ' New environment.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const changed = proposeOauthRunbook(db);
    expect(changed.candidateId).not.toBe(original.candidateId);
    expect(changed).toMatchObject({
      status: "pending",
      supersedesCandidateId: "candidate:proposal-active-overlap"
    });
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

  test("supersedes a published candidate and creates a distinct pending revision when evidence changes", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const published = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;
    setWorkbenchArtifactCandidateStatus(db, { candidateId: published.candidateId, status: "published" });
    db.prepare("UPDATE checkpoints SET summary = summary || ' Later wording.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );

    const result = discoverArtifactCandidates(db, ["session:oauth-fixed"]);

    expect(result).toHaveLength(1);
    expect(getWorkbenchArtifactCandidate(db, published.candidateId)?.status).toBe("superseded");
    expect(result[0]).toMatchObject({
      status: "pending",
      supersedesCandidateId: published.candidateId
    });
    expect(result[0]!.candidateId).not.toBe(published.candidateId);
    expect(result[0]!.evidenceRevision).not.toBe(published.evidenceRevision);
    db.close();
  });

  test("creates a lineage-distinct candidate for A to B to A evidence revisions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const originalSummary = (
      db.prepare("SELECT summary FROM checkpoints WHERE session_id = ?").get("session:oauth-fixed") as {
        summary: string;
      }
    ).summary;
    const revisionA = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;
    const unchangedA = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;
    expect(unchangedA.candidateId).toBe(revisionA.candidateId);
    expect(listWorkbenchArtifactCandidates(db)).toHaveLength(1);

    db.prepare("UPDATE checkpoints SET summary = summary || ' Revision B.' WHERE session_id = ?").run(
      "session:oauth-fixed"
    );
    const revisionB = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;
    db.prepare("UPDATE checkpoints SET summary = ? WHERE session_id = ?").run(
      originalSummary,
      "session:oauth-fixed"
    );
    const revisionA2 = discoverArtifactCandidates(db, ["session:oauth-fixed"])[0]!;

    expect(new Set([revisionA.candidateId, revisionB.candidateId, revisionA2.candidateId]).size).toBe(3);
    expect(revisionB.supersedesCandidateId).toBe(revisionA.candidateId);
    expect(revisionA2.supersedesCandidateId).toBe(revisionB.candidateId);
    expect(revisionA2.evidenceRevision).toBe(revisionA.evidenceRevision);
    expect(listWorkbenchArtifactCandidates(db).map((candidate) => candidate.status).sort()).toEqual([
      "pending",
      "superseded",
      "superseded"
    ]);
    db.close();
  });

  test("caps a strong-signature group at twelve while acknowledging every scanned session", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const addedIds = seedAdditionalStrongSignatureSessions(db, 11);

    const page = discoverArtifactCandidatePage(db, { limit: 100 });
    const repeated = page.candidates.find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found"
    )!;
    const allRepeatedIds = [repeatedErrorPartOne.id, repeatedErrorPartTwo.id, ...addedIds].sort();

    expect(repeated.provenanceSessionIds).toEqual(allRepeatedIds.slice(0, 12));
    expect(repeated.provenanceSessionIds).toHaveLength(12);
    expect(page.scannedSessionIds).toEqual(expect.arrayContaining(allRepeatedIds));
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM workbench_artifact_candidate_signature_members
           WHERE kind = 'runbook' AND signature_key = 'error:ssh:codex-command-not-found'`
        )
        .get()
    ).toEqual({ count: 13 });

    const invalidatedSessionId = repeated.provenanceSessionIds[0]!;
    const priorOverflowSessionId = allRepeatedIds[12]!;
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run(invalidatedSessionId);
    db.prepare("DELETE FROM tool_results WHERE session_id = ? AND status = 'succeeded'").run(
      invalidatedSessionId
    );
    const refillPage = discoverArtifactCandidatePage(db, { limit: 100 });
    const refilled = listWorkbenchArtifactCandidates(db).find(
      (candidate) =>
        candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;

    expect(refillPage.scannedSessionIds).toEqual([invalidatedSessionId]);
    expect(getWorkbenchArtifactCandidate(db, repeated.candidateId)?.status).toBe("superseded");
    expect(refilled.provenanceSessionIds).toHaveLength(12);
    expect(refilled.provenanceSessionIds).toContain(priorOverflowSessionId);
    expect(refilled.provenanceSessionIds).not.toContain(invalidatedSessionId);
    db.close();
  });

  test("does not refill a capped signature group from dirty unrescanned stored members", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    seedAdditionalStrongSignatureSessions(db, 99);
    let cursor: string | undefined;
    do {
      const page = discoverArtifactCandidatePage(db, {
        ...(cursor ? { afterSessionId: cursor } : {}),
        limit: 100
      });
      cursor = page.nextCursor;
    } while (cursor);

    const original = listWorkbenchArtifactCandidates(db).find(
      (candidate) =>
        candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;
    const memberRows = db
      .prepare(
        `SELECT session_id AS sessionId
         FROM workbench_artifact_candidate_signature_members
         WHERE kind = 'runbook' AND signature_key = 'error:ssh:codex-command-not-found'
         ORDER BY session_id`
      )
      .all() as Array<{ sessionId: string }>;
    expect(memberRows).toHaveLength(101);
    expect(
      listWorkbenchArtifactSignatureMembersForIdentities(db, [
        { kind: "runbook", signatureKey: "error:ssh:codex-command-not-found" }
      ])
    ).toHaveLength(12);

    const invalidatedSessionId = original.provenanceSessionIds[0]!;
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run(invalidatedSessionId);
    db.prepare("DELETE FROM tool_results WHERE session_id = ? AND status = 'succeeded'").run(
      invalidatedSessionId
    );

    // These sessions are deliberately outside the one-row scan below. Deleting their
    // evidence makes their stored membership stale, so it must not rebuild a candidate.
    const unrequested = memberRows
      .map((row) => row.sessionId)
      .filter((sessionId) => sessionId !== invalidatedSessionId);
    const placeholders = unrequested.map(() => "?").join(", ");
    db.prepare(`DELETE FROM checkpoints WHERE session_id IN (${placeholders})`).run(...unrequested);
    db.prepare(`DELETE FROM file_effects WHERE session_id IN (${placeholders})`).run(...unrequested);
    db.prepare(`DELETE FROM tool_results WHERE session_id IN (${placeholders})`).run(...unrequested);
    db.prepare(`DELETE FROM tool_calls WHERE session_id IN (${placeholders})`).run(...unrequested);

    const refillPage = discoverArtifactCandidatePage(db, {
      afterSessionId: "session:repeated-error:0",
      limit: 1
    });
    const refilled = listWorkbenchArtifactCandidates(db).find(
      (candidate) =>
        candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    );

    expect(refillPage.scannedSessionIds).toEqual([invalidatedSessionId]);
    expect(getWorkbenchArtifactCandidate(db, original.candidateId)?.status).toBe("superseded");
    expect(refilled).toBeUndefined();
    db.close();
  });

  test("supersedes and rebuilds joined candidates immediately after non-seed hard deletion", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const joined = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;
    expect(joined.seedSessionId).toBe(repeatedErrorPartOne.id);

    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(repeatedErrorPartTwo.id);
    const superseded = getWorkbenchArtifactCandidate(db, joined.candidateId)!;
    expect(superseded.status).toBe("superseded");
    expect(superseded.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Date.parse(superseded.updatedAt)).toBeGreaterThanOrEqual(Date.parse(joined.updatedAt));
    expect(superseded.provenanceSessionIds).toEqual([repeatedErrorPartOne.id]);
    expect(
      (
        db.prepare(
          `SELECT session_id AS sessionId
           FROM workbench_artifact_candidate_provenance
           WHERE candidate_id = ?
           ORDER BY position`
        ).all(joined.candidateId) as Array<{ sessionId: string }>
      ).map((row) => row.sessionId)
    ).toEqual(superseded.provenanceSessionIds);
    expect(
      listWorkbenchArtifactCandidates(db).some(
        (candidate) =>
          ["pending", "claimed", "published"].includes(candidate.status) &&
          candidate.provenanceSessionIds.includes(repeatedErrorPartTwo.id)
      )
    ).toBe(false);

    const page = discoverArtifactCandidatePage(db, { limit: 100 });
    const rebuilt = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;
    expect(page.scannedSessionIds).toContain(repeatedErrorPartOne.id);
    expect(rebuilt.provenanceSessionIds).toEqual([repeatedErrorPartOne.id]);
    db.close();
  });

  test("invalidates joined candidates on soft delete and rescans an undeleted member", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidatePage(db, { limit: 100 });
    const joined = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;

    db.prepare("UPDATE sessions SET deleted_at = ? WHERE session_id = ?").run(
      "2026-07-13T00:00:00.000Z",
      repeatedErrorPartTwo.id
    );
    expect(getWorkbenchArtifactCandidate(db, joined.candidateId)?.status).toBe("superseded");
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM workbench_artifact_candidate_signature_members WHERE session_id = ?"
      ).get(repeatedErrorPartTwo.id)
    ).toEqual({ count: 0 });
    discoverArtifactCandidatePage(db, { limit: 100 });

    db.prepare("UPDATE sessions SET deleted_at = NULL WHERE session_id = ?").run(repeatedErrorPartTwo.id);
    const undeleted = discoverArtifactCandidatePage(db, { limit: 100 });
    const rebuilt = listWorkbenchArtifactCandidates(db).find(
      (candidate) => candidate.signatureKey === "error:ssh:codex-command-not-found" && candidate.status === "pending"
    )!;
    expect(undeleted.scannedSessionIds).toEqual([repeatedErrorPartTwo.id]);
    expect(rebuilt.provenanceSessionIds).toEqual([repeatedErrorPartOne.id, repeatedErrorPartTwo.id]);
    db.close();
  });

  test("retains separate incident signature triggers from every joined provenance session", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const sessions = ["session:incident-root-cause", "session:incident-unproven-cause"];
    for (const [index, sessionId] of sessions.entries()) {
      db.prepare(
        `INSERT INTO messages (
          message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
        ) VALUES (?, ?, 'assistant', 'ERROR_SIGNATURE: database writer exhausted', ?,
          '2026-07-01T12:00:30.000Z', '{}', 'authoritative')`
      ).run(`incident-signature:${index}`, sessionId, `incident-signature:${index}:hash`);
    }

    const joined = discoverArtifactCandidates(db, sessions).find(
      (candidate) => candidate.kind === "incident_timeline"
    )!;

    expect(joined.signatureKey).toBe("error:database:writer-exhausted");
    expect(joined.provenanceSessionIds).toEqual(sessions.sort());
    expect(joined.signalEvidenceRefs).toEqual(
      expect.arrayContaining([
        "message:incident-signature:0",
        "message:incident-signature:1"
      ])
    );
    db.close();
  });

  test("never uses a different artifact kind as candidate lineage", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const adr = discoverArtifactCandidates(db, ["session:decision-local-first"]).find(
      (candidate) => candidate.kind === "adr"
    )!;
    seedRunbookSignals(db, "session:decision-local-first");

    const runbook = discoverArtifactCandidates(db, ["session:decision-local-first"]).find(
      (candidate) => candidate.kind === "runbook"
    )!;

    expect(adr.status).toBe("pending");
    expect(runbook.supersedesCandidateId).toBeUndefined();
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

function seedAdditionalStrongSignatureSessions(db: MastheadDatabase, count: number): string[] {
  const sessionIds: string[] = [];
  const insertSession = db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
    ) VALUES (?, 'host:corpus', 'runtime:corpus', ?, 'Masthead', ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    "INSERT INTO workbench_session_state (session_id, publication_status) VALUES (?, 'publish_path')"
  );
  const insertCall = db.prepare(
    "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, 'exec_command', ?, '{}')"
  );
  const insertResult = db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, exit_code, output_redacted, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`
  );
  const insertFile = db.prepare(
    `INSERT INTO file_effects (
      file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json
    ) VALUES (?, ?, 'remote/path-bootstrap.sh', 'modified', ?, '{}')`
  );
  const insertCheckpoint = db.prepare(
    `INSERT INTO checkpoints (
      checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
    ) VALUES (?, ?, 'verification_passed', 'Remote verification check passed.', ?, '{}')`
  );
  withImmediateTransaction(db, () => {
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const sessionId = `session:repeated-error:extra:${suffix}`;
      sessionIds.push(sessionId);
      insertSession.run(
        sessionId,
        sessionId,
        `Repeated error ${suffix}`,
        "2026-07-01T12:00:00.000Z",
        "2026-07-01T12:02:00.000Z",
        "2026-07-01T12:02:00.000Z",
        "2026-07-01T12:00:00.000Z",
        "2026-07-01T12:02:00.000Z"
      );
      insertState.run(sessionId);
      const failureCall = `${sessionId}:failure:call`;
      insertCall.run(failureCall, sessionId, "2026-07-01T12:00:00.000Z");
      insertResult.run(
        `${sessionId}:failure`,
        failureCall,
        sessionId,
        "failed",
        127,
        "ssh: codex: command not found. ERROR_SIGNATURE: ssh codex command not found",
        "2026-07-01T12:00:00.000Z"
      );
      insertFile.run(`${sessionId}:change`, sessionId, "2026-07-01T12:01:00.000Z");
      insertCheckpoint.run(`${sessionId}:verified`, sessionId, "2026-07-01T12:02:00.000Z");
    }
  });
  return sessionIds;
}

function proposeOauthRunbook(
  db: MastheadDatabase,
  verificationRef = "checkpoint:oauth:verified"
): ReturnType<typeof proposeArtifactCandidate> {
  return proposeArtifactCandidate(db, {
    kind: "runbook",
    provenanceSessionIds: ["session:oauth-fixed"],
    seedSessionId: "session:oauth-fixed",
    signalEvidenceRefs: ["tool_result:oauth:failure", "file:oauth:change", verificationRef],
    signalSummary: "OAuth callback failure recovery with an exact verified chain."
  });
}

function addOauthSignature(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES ('oauth:signature', 'session:oauth-fixed', 'assistant',
      'ERROR_SIGNATURE: oauth state mismatch', 'oauth:signature:hash',
      '2026-07-01T12:00:30.000Z', '{}', 'authoritative')`
  ).run();
}

function proposeSignedOauthRunbook(db: MastheadDatabase): ReturnType<typeof proposeArtifactCandidate> {
  return proposeArtifactCandidate(db, {
    kind: "runbook",
    provenanceSessionIds: ["session:oauth-fixed"],
    seedSessionId: "session:oauth-fixed",
    signalEvidenceRefs: [
      "tool_result:oauth:failure",
      "file:oauth:change",
      "checkpoint:oauth:verified",
      "message:oauth:signature"
    ],
    signalSummary: "OAuth callback recovery joined to its exact normalized failure signature.",
    signatureKey: "error:oauth:state-mismatch"
  });
}

function currentRunbookCandidates(db: MastheadDatabase, sessionId: string): string[] {
  return listWorkbenchArtifactCandidates(db)
    .filter(
      (candidate) =>
        candidate.kind === "runbook" &&
        (candidate.status === "pending" || candidate.status === "claimed" || candidate.status === "published") &&
        candidate.provenanceSessionIds.includes(sessionId)
    )
    .map((candidate) => candidate.candidateId)
    .sort();
}

function seedRunbookSignals(db: MastheadDatabase, sessionId: string): void {
  db.prepare(
    `INSERT INTO tool_calls (
      tool_call_id, session_id, tool_name, started_at, source_ref_json
    ) VALUES ('decision-runbook:failure:call', ?, 'exec_command', '2026-07-01T12:02:00.000Z', '{}')`
  ).run(sessionId);
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, exit_code, output_redacted, completed_at, source_ref_json
    ) VALUES ('decision-runbook:failure', 'decision-runbook:failure:call', ?, 'failed', 1,
      'Configuration test failed.', '2026-07-01T12:02:00.000Z', '{}')`
  ).run(sessionId);
  db.prepare(
    `INSERT INTO file_effects (
      file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json
    ) VALUES ('decision-runbook:change', ?, 'config/runtime.ts', 'modified', '2026-07-01T12:03:00.000Z', '{}')`
  ).run(sessionId);
  db.prepare(
    `INSERT INTO checkpoints (
      checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
    ) VALUES ('decision-runbook:verified', ?, 'verification_passed',
      'Configuration verification test passed.', '2026-07-01T12:04:00.000Z', '{}')`
  ).run(sessionId);
}
