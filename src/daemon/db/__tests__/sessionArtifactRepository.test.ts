import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import { applySessionArtifact, listSessionArtifacts } from "../sessionArtifactRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session artifact repository", () => {
  test("applies artifacts idempotently by fingerprint", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));

    expect(second.artifactId).toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: first.artifactId, status: "current", title: "First dossier" })
    ]);
  });

  test("supersedes prior current artifact for the same session and kind", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-2", "Second dossier"));

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: second.artifactId, status: "current", title: "Second dossier" }),
      expect.objectContaining({ artifactId: first.artifactId, status: "superseded", title: "First dossier" })
    ]);
  });
});

function artifactInput(contentFingerprint: string, title: string) {
  return {
    artifactKind: "session_dossier" as const,
    content: { title },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: ["message:session:abc:message"],
    schemaVersion: "session_dossier-v1",
    sessionId: "session:abc",
    title,
    validation: { ok: true }
  };
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-artifact-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

