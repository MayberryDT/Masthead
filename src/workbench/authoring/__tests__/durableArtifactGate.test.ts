import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  WorkbenchAuthoringReceiptV3
} from "../../../shared/workbenchAuthoring.ts";
import { getLogbookArtifactDetail } from "../../../daemon/db/logbookArtifactRepository.ts";
import {
  listSessionArtifacts,
  searchPublishedArtifactCapsules
} from "../../../daemon/db/sessionArtifactRepository.ts";
import { getWorkbenchArtifactCandidate } from "../../../daemon/db/workbenchArtifactCandidateRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import {
  finishAuthoringRun,
  openAgentLedAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import {
  buildDurableArtifactFixtureBundleV3,
  corpusSessionIds,
  seedDurableArtifactCorpusWithPerformedActions
} from "../__fixtures__/durableArtifactCorpus.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Gate B durable optional artifact slice", () => {
  test("publishes one grounded reusable artifact of every optional kind from the labeled corpus", async () => {
    const db = await testDb();
    seedDurableArtifactCorpusWithPerformedActions(db);
    const candidates = discoverArtifactCandidates(db, corpusSessionIds());

    expect(countKinds(candidates)).toEqual({ runbook: 3, adr: 2, incident_timeline: 2 });

    const selected = [
      requireCandidate(candidates, "runbook", "session:oauth-fixed"),
      requireCandidate(candidates, "adr", "session:decision-local-first"),
      requireCandidate(candidates, "incident_timeline", "session:incident-root-cause")
    ];
    const receipts: WorkbenchAuthoringReceiptV3[] = [];

    for (const candidate of selected) {
      const opened = openAgentLedAuthoringRun(db, {
        actorId: "gate-b",
        databaseId: getOrCreateDatabaseIdentity(db),
        sessionIds: candidate.provenanceSessionIds
      });
      expect(opened.run).toMatchObject({
        contractVersion: "workbench-authoring-v3",
        sessionIds: candidate.provenanceSessionIds
      });

      const bundle = buildDurableArtifactFixtureBundleV3(opened.run, candidate);
      expect(JSON.stringify(bundle.artifacts[0]!.output).toLowerCase()).not.toMatch(
        /cursor pagination|canonical evidence|evidence manifest|authoring run|single provenance|weak multi-session join|published artifact/
      );
      const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
      expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

      const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
      if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("gate_v3_receipt_required");
      receipts.push(receipt);
      expect(receipt).toMatchObject({
        dossierArtifactIds: expect.any(Array),
        optionalArtifacts: [{ kind: candidate.kind, provenanceSessionIds: candidate.provenanceSessionIds }]
      });
      expect(receipt.dossierArtifactIds).toHaveLength(candidate.provenanceSessionIds.length);
      expect(receipt.publishedArtifactIds).toEqual([
        ...receipt.dossierArtifactIds,
        receipt.optionalArtifacts[0]!.artifactId
      ]);
      expect(getWorkbenchArtifactCandidate(db, candidate.candidateId)?.status).toBe("pending");
      expect(
        db.prepare(
          `SELECT COUNT(*) AS count
           FROM workbench_claims claims
           JOIN workbench_authoring_run_sessions sessions ON sessions.claim_id = claims.claim_id
           WHERE sessions.run_id = ? AND claims.released_at IS NULL`
        )
          .get(opened.run.runId)
      ).toEqual({ count: 0 });

      const optionalId = receipt.optionalArtifacts[0]!.artifactId;
      expect(getLogbookArtifactDetail(db, optionalId)).toMatchObject({
        capsule: { kind: candidate.kind },
        provenanceSessionIds: candidate.provenanceSessionIds,
        publicationStatus: "published",
        status: "current"
      });
      for (const [index, dossierId] of receipt.dossierArtifactIds.entries()) {
        expect(getLogbookArtifactDetail(db, dossierId)).toMatchObject({
          capsule: { kind: "session_dossier" },
          provenanceSessionIds: [candidate.provenanceSessionIds[index]],
          publicationStatus: "published",
          status: "current"
        });
      }

      const search = searchPublishedArtifactCapsules(db, {
        kind: candidate.kind,
        q: searchPhrase(candidate.kind)
      });
      expect(search.artifacts.map(({ artifactId }) => artifactId)).toEqual([optionalId]);
      expect(new Set(search.artifacts.map(({ artifactId }) => artifactId)).size).toBe(search.artifacts.length);
    }

    expect(receipts.flatMap((receipt) => receipt.optionalArtifacts.map(({ kind }) => kind)).sort()).toEqual([
      "adr",
      "incident_timeline",
      "runbook"
    ]);
    expect(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM workbench_activity
         WHERE event_type LIKE '%not_applicable%' OR lower(summary) LIKE '%n/a%'`
      ).get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM workbench_session_state
         WHERE runbook_status = 'not_applicable'
            OR adr_status = 'not_applicable'
            OR incident_timeline_status = 'not_applicable'`
      ).get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare(
        `SELECT artifact_id AS artifactId
         FROM session_artifact_search
         GROUP BY artifact_id
         HAVING COUNT(*) > 1`
      ).all()
    ).toEqual([]);
    expect(listSessionArtifacts(db, { artifactKind: "runbook", publicationStatus: "published" })).toHaveLength(1);
    expect(listSessionArtifacts(db, { artifactKind: "adr", publicationStatus: "published" })).toHaveLength(1);
    expect(
      listSessionArtifacts(db, { artifactKind: "incident_timeline", publicationStatus: "published" })
    ).toHaveLength(1);
    db.close();
  });
});

type Candidate = ReturnType<typeof discoverArtifactCandidates>[number];

function requireCandidate(candidates: Candidate[], kind: Candidate["kind"], seedSessionId: string): Candidate {
  const candidate = candidates.find((entry) => entry.kind === kind && entry.seedSessionId === seedSessionId);
  if (!candidate) throw new Error(`gate_candidate_missing:${kind}:${seedSessionId}`);
  return candidate;
}

function countKinds(candidates: Candidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function searchPhrase(kind: Candidate["kind"]): string {
  if (kind === "runbook") return "invalid state nonce";
  if (kind === "adr") return "hosted database";
  return "writer leases";
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-durable-artifact-gate-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
