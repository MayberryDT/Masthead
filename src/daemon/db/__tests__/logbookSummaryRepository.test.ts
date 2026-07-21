import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { LOGBOOK_ARTIFACT_SUMMARY_SQL, getLogbookSummary } from "../logbookSummaryRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { applySessionArtifact, publishSessionArtifact, type SessionArtifactKind } from "../sessionArtifactRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("logbook summary repository", () => {
  test("returns stable zero counts for an empty artifact table", async () => {
    const db = await openTestDatabase();

    expect(getLogbookSummary(db)).toEqual({
      artifacts: 0,
      byKind: { session_dossier: 0, runbook: 0, adr: 0, incident_timeline: 0 },
      projects: 0,
      earliestPublishedAt: undefined,
      latestPublishedAt: undefined
    });
    db.close();
  });

  test("summarizes published artifacts without scanning messages or tools", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      sessionId: "session:a",
      title: "OAuth callback repair"
    });
    publishArtifact(db, "session_dossier", "dossier");
    publishArtifact(db, "runbook", "runbook");

    const plan = db.prepare(`EXPLAIN QUERY PLAN ${LOGBOOK_ARTIFACT_SUMMARY_SQL}`).all();
    expect(getLogbookSummary(db)).toEqual({
      artifacts: 2,
      byKind: { session_dossier: 1, runbook: 1, adr: 0, incident_timeline: 0 },
      projects: 1,
      earliestPublishedAt: expect.any(String),
      latestPublishedAt: expect.any(String)
    });
    expect(JSON.stringify(plan)).not.toMatch(/messages|tool_calls|file_effects/);
    db.close();
  });
});

function publishArtifact(db: MastheadDatabase, artifactKind: SessionArtifactKind, suffix: string): void {
  const artifact = applySessionArtifact(db, {
    artifactKind,
    content: { title: `${suffix} title` },
    contentFingerprint: `fingerprint:${suffix}`,
    createdBy: "test",
    evidenceRefs: [],
    projectLabel: "Pip",
    schemaVersion: `${artifactKind}-v1`,
    sessionId: "session:a",
    title: `${suffix} title`,
    validation: { valid: true }
  });
  publishSessionArtifact(db, artifact.artifactId);
}

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-logbook-summary-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
