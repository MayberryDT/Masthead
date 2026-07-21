import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { stableRecordId } from "../../../daemon/identity.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type { WorkbenchAuthoringBundleV3 } from "../../../shared/workbenchAuthoring.ts";
import { getArtifactSuggestions } from "../advisorySuggestions.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import { parseAuthoringBundleV3 } from "../authoringSchemas.ts";
import { authoringEvidenceRevision } from "../evidenceCatalog.ts";
import {
  dossierOnlyQuestion,
  explicitArchitectureDecision,
  oauthFailureFixedAndVerified,
  repeatedErrorPartOne,
  repeatedErrorPartTwo,
  seedDurableArtifactCorpus
} from "../__fixtures__/durableArtifactCorpus.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("artifact suggestions", () => {
  test("maps detector output to explicitly nonbinding suggestions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    const suggestions = getArtifactSuggestions(db, [oauthFailureFixedAndVerified.id]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ advisory: true, kind: "runbook" });
    expect(suggestions[0]?.suggestionId).toBe(stableRecordId("artifact-suggestion", [
      "runbook",
      oauthFailureFixedAndVerified.id,
      "unsigned",
      authoringEvidenceRevision(db, [oauthFailureFixedAndVerified.id])
    ]));
    expect(getArtifactSuggestions(db, [oauthFailureFixedAndVerified.id])[0]?.suggestionId).toBe(
      suggestions[0]?.suggestionId
    );
    db.close();
  });

  test("normalizes provenance order and changes the dedupe ID with evidence", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const forward = getArtifactSuggestions(db, [repeatedErrorPartOne.id, repeatedErrorPartTwo.id])
      .find((item) => item.kind === "runbook")!;

    const reverse = getArtifactSuggestions(db, [repeatedErrorPartTwo.id, repeatedErrorPartOne.id])
      .find((item) => item.kind === "runbook")!;
    expect(reverse.suggestionId).toBe(forward.suggestionId);
    expect(forward.suggestionId).toBe(stableRecordId("artifact-suggestion", [
      forward.kind,
      ...forward.provenanceSessionIds,
      forward.signatureKey!,
      signatureEvidenceRevision(db, forward.provenanceSessionIds)
    ]));

    db.prepare("UPDATE checkpoints SET summary = summary || ' changed' WHERE session_id = ?")
      .run(repeatedErrorPartOne.id);
    const changed = getArtifactSuggestions(db, [repeatedErrorPartOne.id, repeatedErrorPartTwo.id])
      .find((item) => item.kind === "runbook")!;
    expect(changed.suggestionId).not.toBe(forward.suggestionId);
    db.close();
  });

  test("preserves the pre-V4 single-session and joined suggestion identities byte for byte", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    expect(getArtifactSuggestions(db, [oauthFailureFixedAndVerified.id])[0]?.suggestionId).toBe(
      "artifact-suggestion:3643e87bbcc67d1dae134350e14985c5"
    );
    expect(
      getArtifactSuggestions(db, [repeatedErrorPartOne.id, repeatedErrorPartTwo.id])
        .find(({ kind }) => kind === "runbook")?.suggestionId
    ).toBe("artifact-suggestion:86bdf9a27eacf858ba1e60bd147213e9");
    db.close();
  });

  test("returns no suggestion without positive evidence", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    expect(getArtifactSuggestions(db, [dossierOnlyQuestion.id])).toEqual([]);
    db.close();
  });

  test("does not claim, dismiss, or mutate candidate status", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    discoverArtifactCandidates(db, [oauthFailureFixedAndVerified.id]);
    const before = candidateAuditRows(db);

    getArtifactSuggestions(db, [oauthFailureFixedAndVerified.id]);

    expect(candidateAuditRows(db)).toEqual(before);
    db.close();
  });

  test("does not prevent an agent-selected kind missing from suggestions", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);

    const suggestions = getArtifactSuggestions(db, [explicitArchitectureDecision.id]);

    expect(suggestions.every((item) => item.kind !== "runbook")).toBe(true);
    expect(parseAuthoringBundleV3(agentSelectedRunbookBundle())).toEqual(agentSelectedRunbookBundle());
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-advisory-suggestions-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function signatureEvidenceRevision(db: MastheadDatabase, sessionIds: string[]): string {
  return stableRecordId(
    "artifact-candidate-signature-revision",
    sessionIds.flatMap((sessionId) => [sessionId, authoringEvidenceRevision(db, [sessionId])])
  );
}

function candidateAuditRows(db: MastheadDatabase): Record<string, unknown[]> {
  const tables = (db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'workbench_artifact_candidate%'
       ORDER BY name`
    )
    .all() as Array<{ name: string }>).map((row) => row.name);
  return Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
  );
}

function agentSelectedRunbookBundle(): WorkbenchAuthoringBundleV3 {
  const sessionId = explicitArchitectureDecision.id;
  return {
    artifacts: [{
      kind: "runbook",
      output: {
        changedFiles: [],
        claimSupport: [],
        commands: [],
        confidence: "medium",
        deadEnds: [],
        environmentRequirements: [],
        evidenceRefs: [],
        fixSteps: [],
        missingEvidence: [],
        preconditions: [],
        preventionNotes: [],
        problemSignature: {
          affectedScope: "Local storage",
          errorStrings: [],
          symptoms: []
        },
        provenanceSessionIds: [sessionId],
        reproSteps: [],
        risksOrGaps: [],
        rootCause: "The agent selected this useful kind from canonical evidence.",
        title: "Operate the local-first store",
        validationChecks: []
      },
      provenanceSessionIds: [sessionId],
      seedSessionId: sessionId
    }],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision: "evidence:agent-selected",
    runId: "authoring:agent-selected",
    sessionEnrichments: []
  };
}
