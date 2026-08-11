import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { PublishedSessionDossierV1 } from "../../../shared/sessionDossier.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { seedSession } from "./sessionTestHelpers.ts";
import { listEligibleMastheadPagesArtifactIds } from "../logbookArtifactRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("listEligibleMastheadPagesArtifactIds", () => {
  test("returns only current eligible session dossiers in deterministic order", async () => {
    const db = await testDb();
    const first = seedEligible(db, "session:a", "2026-08-11T10:00:00.000Z");
    const second = seedEligible(db, "session:b", "2026-08-11T12:00:00.000Z");
    seedIneligibleRunbook(db);

    const ids = listEligibleMastheadPagesArtifactIds(db, {}, 500);
    expect(ids).toEqual([second, first]);
  });

  test("respects the 500 cap without requiring paged search loops", async () => {
    const db = await testDb();
    for (let i = 0; i < 3; i += 1) {
      seedEligible(db, `session:cap-${i}`, `2026-08-11T1${i}:00:00.000Z`);
    }
    expect(listEligibleMastheadPagesArtifactIds(db, {}, 2)).toHaveLength(2);
  });
});

function seedEligible(db: MastheadDatabase, sessionId: string, publishedAt: string): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: sessionId
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(),
    contentFingerprint: `fp-${sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    title: "Eligible",
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
  db.prepare(`UPDATE session_artifacts SET published_at = ? WHERE artifact_id = ?`).run(publishedAt, applied.artifactId);
  return applied.artifactId;
}

function seedIneligibleRunbook(db: MastheadDatabase): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:runbook-ineligible",
    title: "Runbook"
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "runbook",
    content: { title: "Runbook" },
    contentFingerprint: "fp-runbook",
    createdBy: "test",
    evidenceRefs: [],
    schemaVersion: "runbook-v1",
    sessionId: "session:runbook-ineligible",
    title: "Runbook",
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
}

function eligibleDossier(): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId: "session:private",
      sourceSessionId: "source:private",
      title: "Eligible",
      runtime: "codex",
      project: "Masthead",
      branch: "main",
      lifecycle: "ended"
    },
    narrative: {
      objective: "Eligible work",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["pages"],
      technologies: ["typescript"],
      unresolved: []
    },
    files: [],
    tools: [],
    verification: { status: "passed", summary: "ok", commands: [] },
    attention: [],
    excerpts: [],
    enrichment: { status: "current" },
    durableEnrichment: {
      keywords: ["eligible"],
      sessionTitle: { text: "Eligible", basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: "Summary", state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Work"],
        decisions: [],
        blockers: [],
        verification: { status: "passed", summary: "ok", commands: [], failures: [], evidenceRefs: [] },
        continuation: { openQuestions: [], constraints: [] },
        warnings: [],
        evidenceRefs: []
      }
    }
  } as unknown as PublishedSessionDossierV1;
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-logbook-eligible-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
