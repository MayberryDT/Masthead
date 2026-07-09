import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { listSessionArtifacts } from "../../daemon/db/sessionArtifactRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import {
  listWorkbenchActivity,
  readWorkbenchSessionState,
  setWorkbenchArtifactApplicability
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { applyArtifact } from "../applyArtifact.ts";

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

  test("applies a bug-fix trace artifact", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Bug fix session" });

    const result = applyArtifact(db, {
      kind: "bug_fix_trace",
      output: {
        affectedStack: ["CLI Workbench"],
        confidence: "medium",
        evidenceRefs: ["message:session:abc:message"],
        failedHypotheses: [],
        fixSummary: "Guarded artifact apply with schema validation.",
        missingEvidence: [],
        patchShape: ["Added applyArtifact tests"],
        preventionNotes: ["Keep artifact schema tests in the focused Workbench suite."],
        reproduction: "Apply a valid bug-fix trace output file.",
        risksOrGaps: [],
        rootCause: "Bug-fix traces were not covered by an apply-path regression.",
        symptom: "V1 artifact acceptance could pass with dossier-only coverage.",
        title: "Cover bug-fix trace apply",
        verification: ["npm test"]
      },
      sessionId: "session:abc"
    });

    expect(result).toMatchObject({ artifactKind: "bug_fix_trace", dryRun: false, ok: true });
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactKind: "bug_fix_trace", status: "current", title: "Cover bug-fix trace apply" })
    ]);
    expect(readWorkbenchSessionState(db, "session:abc")).toMatchObject({
      bugFixTraceStatus: "satisfied",
      publicationStatus: "publish_path"
    });
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ eventType: "bug_fix_trace_applied", summary: "Bug-fix trace applied" })
    ]);
  });

  test("marks bug-fix trace as not applicable without writing a fake artifact", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "No bug session" });

    const result = setWorkbenchArtifactApplicability(db, {
      actor: { kind: "agent", id: "codex" },
      artifactKind: "bug_fix_trace",
      reason: "no_bug_fix_evidence",
      sessionId: "session:abc",
      status: "not_applicable"
    });

    expect(result.state).toMatchObject({
      bugFixTraceStatus: "not_applicable",
      publicationStatus: "publish_path"
    });
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([]);
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ reason: "no_bug_fix_evidence", status: "not_applicable" }),
        eventType: "bug_fix_trace_not_applicable"
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
