import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { listSessionArtifacts } from "../../daemon/db/sessionArtifactRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { getDataRevisions } from "../../daemon/db/dataRevisionRepository.ts";
import {
  listWorkbenchActivity,
  readWorkbenchSessionState,
  setWorkbenchArtifactApplicability
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { applyArtifact, publishArtifact } from "../applyArtifact.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("applyArtifact", () => {
  test("applies a session dossier artifact", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const result = applyArtifact(db, {
      kind: "session_dossier",
      output: {
        approach: ["Added repository tests"],
        commandsAndTools: [{ label: "npm test", status: "passed" }],
        confidence: "medium",
        context: "Workbench artifact storage",
        evidenceRefs: ["message:session:abc:message"],
        filesTouched: [{ label: "src/daemon/db/sessionArtifactRepository.ts", role: "repository" }],
        keyDecisions: ["Use one current artifact per session and kind"],
        lessonsLearned: [],
        missingEvidence: [],
        outcome: "Artifacts persist locally.",
        problemStatement: "Need local session dossier artifacts.",
        risksOrGaps: [],
        title: "Store Workbench artifacts",
        verification: ["npm test"]
      },
      sessionId: "session:abc"
    });

    expect(result).toMatchObject({ dryRun: false, ok: true });
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactKind: "session_dossier", status: "current", title: "Store Workbench artifacts" })
    ]);
    expect(readWorkbenchSessionState(db, "session:abc")).toMatchObject({
      publicationStatus: "publish_path",
      sessionDossierStatus: "satisfied"
    });
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ eventType: "session_dossier_applied", summary: "Session dossier applied" })
    ]);
  });

  test("applies a runbook artifact", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Bug fix session" });
    const beforeApply = getDataRevisions(db);

    const result = applyArtifact(db, {
      kind: "runbook",
      output: {
        changedFiles: ["src/workbench/applyArtifact.ts"],
        commands: ["npm test"],
        confidence: "medium",
        deadEnds: [],
        environmentRequirements: [],
        evidenceRefs: ["message:session:abc:message"],
        fixSteps: ["Guard artifact apply with schema validation"],
        missingEvidence: [],
        preconditions: [],
        preventionNotes: ["Keep artifact schema tests in the focused Workbench suite."],
        problemSignature: {
          affectedScope: "Workbench apply path",
          errorStrings: [],
          symptoms: ["V1 artifact acceptance could pass with dossier-only coverage."]
        },
        provenanceSessionIds: ["session:abc"],
        reproSteps: ["Apply a valid runbook output file."],
        risksOrGaps: [],
        rootCause: "Runbooks were not covered by an apply-path regression.",
        signatureKey: " \t ",
        title: "Cover runbook apply",
        validationChecks: ["npm test"]
      },
      sessionId: "session:abc"
    });

    expect(result).toMatchObject({ artifactKind: "runbook", dryRun: false, ok: true, publicationStatus: "applied" });
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({
        artifactKind: "runbook",
        signatureKey: undefined,
        status: "current",
        title: "Cover runbook apply"
      })
    ]);
    expect(readWorkbenchSessionState(db, "session:abc")).toMatchObject({
      publicationStatus: "publish_path",
      runbookStatus: "applied"
    });
    expect(getDataRevisions(db)).toEqual({
      logbook: beforeApply.logbook,
      workbench: beforeApply.workbench + 1
    });
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ eventType: "runbook_applied", summary: "Runbook applied" })
    ]);

    const beforePublish = getDataRevisions(db);
    publishArtifact(db, result.artifactId!);
    expect(readWorkbenchSessionState(db, "session:abc")?.runbookStatus).toBe("published");
    expect(getDataRevisions(db)).toEqual({
      logbook: beforePublish.logbook + 1,
      workbench: beforePublish.workbench + 1
    });
    expect(
      db.prepare(
        `SELECT runbook_status AS runbookStatus,
                adr_status AS adrStatus,
                incident_timeline_status AS incidentTimelineStatus,
                bug_fix_trace_status AS bugFixTraceStatus
         FROM workbench_session_state
         WHERE session_id = 'session:abc'`
      ).get()
    ).toEqual({
      adrStatus: "unknown",
      bugFixTraceStatus: "satisfied",
      incidentTimelineStatus: "unknown",
      runbookStatus: "published"
    });
  });

  test("marks runbook as not applicable without writing a fake artifact", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "No bug session" });

    const result = setWorkbenchArtifactApplicability(db, {
      actor: { kind: "agent", id: "codex" },
      artifactKind: "runbook",
      reason: "no_runbook_evidence",
      sessionId: "session:abc",
      status: "not_applicable"
    });

    expect(result.state).toMatchObject({
      publicationStatus: "publish_path",
      runbookStatus: "not_applicable"
    });
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([]);
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ reason: "no_runbook_evidence", status: "not_applicable" }),
        eventType: "runbook_not_applicable"
      })
    ]);
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-apply-artifact-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
