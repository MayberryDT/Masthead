import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getKnowledgeFlowSummary } from "../knowledgeFlowRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { ensureWorkbenchSessionState } from "../workbenchPipelineRepository.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("knowledge flow repository", () => {
  test("summarizes current pipeline inventory without deleted or superseded rows", async () => {
    const db = await testDb();
    for (const sessionId of ["session:one", "session:two", "session:resolved", "session:deleted"]) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: sessionId
      });
      ensureWorkbenchSessionState(db, sessionId);
    }
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE session_id = ?").run(
      "2026-07-09T12:00:00.000Z",
      "session:deleted"
    );
    db.prepare(
      "UPDATE workbench_session_state SET publication_status = 'published', resolution_status = 'automatic_resolved' WHERE session_id = ?"
    ).run("session:resolved");

    const publishArtifact = (sessionId: string, fingerprint: string) => {
      const artifact = applySessionArtifact(db, {
        artifactKind: "session_dossier",
        content: { summary: fingerprint },
        contentFingerprint: fingerprint,
        createdBy: "test",
        evidenceRefs: [],
        schemaVersion: "session-dossier-v1",
        sessionId,
        title: fingerprint,
        validation: { ok: true }
      });
      publishSessionArtifact(db, artifact.artifactId);
      return artifact;
    };

    publishArtifact("session:one", "artifact-old");
    publishArtifact("session:one", "artifact-one");
    publishArtifact("session:two", "artifact-two");

    expect(getKnowledgeFlowSummary(db)).toEqual({
      capturedSessions: 3,
      workbenchSessions: 2,
      publishedArtifacts: 2,
      automaticallyResolvedSessions: 1
    });
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-knowledge-flow-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
