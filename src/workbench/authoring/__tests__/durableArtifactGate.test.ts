import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringReceiptV2
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
  openCandidateAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import {
  corpusSessionIds,
  seedDurableArtifactCorpus
} from "../__fixtures__/durableArtifactCorpus.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Gate B durable optional artifact slice", () => {
  test("publishes one grounded reusable artifact of every optional kind from the labeled corpus", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const candidates = discoverArtifactCandidates(db, corpusSessionIds());

    expect(countKinds(candidates)).toEqual({ runbook: 3, adr: 2, incident_timeline: 2 });

    const selected = [
      requireCandidate(candidates, "runbook", "session:oauth-fixed"),
      requireCandidate(candidates, "adr", "session:decision-local-first"),
      requireCandidate(candidates, "incident_timeline", "session:incident-root-cause")
    ];
    const receipts: WorkbenchAuthoringReceiptV2[] = [];

    for (const candidate of selected) {
      const opened = openCandidateAuthoringRun(db, {
        actorId: "gate-b",
        candidateId: candidate.candidateId,
        databaseId: getOrCreateDatabaseIdentity(db)
      });
      expect(opened.run).toMatchObject({
        candidateId: candidate.candidateId,
        contractVersion: "workbench-authoring-v2",
        sessionIds: candidate.provenanceSessionIds
      });

      const bundle = buildGateBundle(opened.run, candidate);
      expect(JSON.stringify(bundle.artifact.output).toLowerCase()).not.toMatch(
        /cursor pagination|canonical evidence|evidence manifest|authoring run|single provenance|weak multi-session join|published artifact/
      );
      const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
      expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

      const receipt = requireV2Receipt(finishAuthoringRun(db, { runId: opened.run.runId }));
      receipts.push(receipt);
      expect(receipt).toMatchObject({
        candidateId: candidate.candidateId,
        dossierArtifactIds: expect.any(Array),
        optionalArtifact: { kind: candidate.kind },
        provenanceSessionIds: candidate.provenanceSessionIds
      });
      expect(receipt.dossierArtifactIds).toHaveLength(candidate.provenanceSessionIds.length);
      expect(receipt.publishedArtifactIds).toEqual([
        ...receipt.dossierArtifactIds,
        receipt.optionalArtifact.artifactId
      ]);
      expect(getWorkbenchArtifactCandidate(db, candidate.candidateId)?.status).toBe("published");
      expect(
        db.prepare(
          `SELECT COUNT(*) AS count
           FROM workbench_claims claims
           JOIN workbench_authoring_run_sessions sessions ON sessions.claim_id = claims.claim_id
           WHERE sessions.run_id = ? AND claims.released_at IS NULL`
        )
          .get(opened.run.runId)
      ).toEqual({ count: 0 });

      const optionalId = receipt.optionalArtifact.artifactId;
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

    expect(receipts.map((receipt) => receipt.optionalArtifact.kind).sort()).toEqual([
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
type OpenedRun = ReturnType<typeof openCandidateAuthoringRun>["run"];

function buildGateBundle(run: OpenedRun, candidate: Candidate): WorkbenchAuthoringBundleV2 {
  const output = candidate.kind === "runbook"
    ? runbookOutput(candidate)
    : candidate.kind === "adr"
      ? adrOutput(candidate)
      : incidentOutput(candidate);
  return {
    artifact: {
      kind: candidate.kind,
      output,
      provenanceSessionIds: candidate.provenanceSessionIds,
      seedSessionId: candidate.seedSessionId
    },
    bundleVersion: "workbench-authoring-v2",
    candidateId: candidate.candidateId,
    evidenceRevision: run.evidenceRevision,
    runId: run.runId
  };
}

function runbookOutput(candidate: Candidate): Record<string, unknown> {
  const problemRef = "tool_result:oauth:failure";
  const problem = "OAuth callback test failed with an invalid state nonce.";
  const changeRef = "file:oauth:change";
  const change = "modified auth/callback.ts";
  const verificationRef = "checkpoint:oauth:verified";
  const verification = "Callback regression test passed after the nonce repair.";
  return {
    changedFiles: ["auth/callback.ts"],
    claimSupport: [
      support("problemSignature.symptoms[0]", problemRef, problem, "problem"),
      support("fixSteps[0]", changeRef, change, "change"),
      support("validationChecks[0]", verificationRef, verification, "verification")
    ],
    commands: ["Run the OAuth callback regression test."],
    confidence: "low",
    deadEnds: [],
    environmentRequirements: ["OAuth callback test environment"],
    evidenceRefs: [problemRef, changeRef, verificationRef],
    fixSteps: [`Apply the recorded callback change: ${change}.`],
    missingEvidence: [],
    preconditions: ["The callback regression reproduces an invalid state nonce."],
    preventionNotes: ["Keep the callback regression in the verification suite."],
    problemSignature: {
      affectedScope: "OAuth callback state validation",
      errorStrings: ["invalid state nonce"],
      symptoms: [problem]
    },
    provenanceSessionIds: candidate.provenanceSessionIds,
    reproSteps: ["Run the OAuth callback regression test and observe the invalid state nonce."],
    risksOrGaps: [],
    rootCause: "The root cause remains unknown from the available evidence.",
    title: "Repair OAuth callback state nonce validation",
    validationChecks: [verification]
  };
}

function adrOutput(candidate: Candidate): Record<string, unknown> {
  const decisionRef = "message:decision-local-first:decision";
  const decision = "Decision: adopt SQLite as the canonical local-first session store.";
  const alternativeRef = "message:decision-local-first:alternative";
  const alternative = "Rejected alternative: a hosted database would break offline operation.";
  return {
    alternatives: [alternative],
    claimSupport: [
      support("decision", decisionRef, decision, "decision"),
      support("alternatives[0]", alternativeRef, alternative, "alternative")
    ],
    confidence: "low",
    consequences: ["The session store remains local and supports offline operation."],
    context: "The storage choice must preserve local operation without a hosted dependency.",
    decision,
    evidenceRefs: [decisionRef, alternativeRef],
    missingEvidence: [],
    provenanceSessionIds: candidate.provenanceSessionIds,
    status: "accepted",
    title: "Keep the canonical session store local-first"
  };
}

function incidentOutput(candidate: Candidate): Record<string, unknown> {
  const detectedRef = "signal:incident-root-cause:detected";
  const detected = "Ingestion requests failed across production.";
  const triageRef = "signal:incident-root-cause:triage";
  const triage = "Triage isolated exhausted SQLite writer leases.";
  const mitigatedRef = "signal:incident-root-cause:mitigated";
  const mitigated = "The stuck writer was recycled and backlog processing resumed.";
  const restoredRef = "checkpoint:incident-root-cause:restored";
  const restored = "Service health and backlog drain were verified.";
  return {
    claimSupport: [
      support("symptom", detectedRef, detected, "problem"),
      support("timeline[0].summary", detectedRef, detected, "timeline"),
      support("timeline[1].summary", triageRef, triage, "timeline"),
      support("timeline[2].summary", mitigatedRef, mitigated, "timeline"),
      support("timeline[3].summary", restoredRef, restored, "timeline"),
      support("rootCause", triageRef, triage, "root_cause"),
      support("remediation[0]", mitigatedRef, mitigated, "remediation")
    ],
    confidence: "low",
    contributingFactors: [triage],
    evidenceRefs: [detectedRef, triageRef, mitigatedRef, restoredRef],
    impact: detected,
    missingEvidence: [],
    prevention: ["Monitor writer lease exhaustion and backlog health."],
    provenanceSessionIds: candidate.provenanceSessionIds,
    remediation: [mitigated],
    rootCause: triage,
    status: "resolved",
    symptom: detected,
    timeline: [
      { at: "2026-07-01T12:00:00.000Z", evidenceRefs: [detectedRef], summary: detected },
      { at: "2026-07-01T12:01:00.000Z", evidenceRefs: [triageRef], summary: triage },
      { at: "2026-07-01T12:02:00.000Z", evidenceRefs: [mitigatedRef], summary: mitigated },
      { at: "2026-07-01T12:03:00.000Z", evidenceRefs: [restoredRef], summary: restored }
    ],
    title: "Restore ingestion after SQLite writer lease exhaustion"
  };
}

function support(
  path: string,
  evidenceRef: string,
  excerpt: string,
  supportKind: "problem" | "decision" | "alternative" | "change" | "verification" | "timeline" | "remediation" | "root_cause"
): { path: string; evidenceRef: string; excerpt: string; supportKind: typeof supportKind } {
  return { path, evidenceRef, excerpt, supportKind };
}

function requireCandidate(candidates: Candidate[], kind: Candidate["kind"], seedSessionId: string): Candidate {
  const candidate = candidates.find((entry) => entry.kind === kind && entry.seedSessionId === seedSessionId);
  if (!candidate) throw new Error(`gate_candidate_missing:${kind}:${seedSessionId}`);
  return candidate;
}

function requireV2Receipt(receipt: WorkbenchAuthoringReceipt): WorkbenchAuthoringReceiptV2 {
  if (receipt.contractVersion !== "workbench-authoring-v2") throw new Error("gate_v2_receipt_required");
  return receipt;
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
