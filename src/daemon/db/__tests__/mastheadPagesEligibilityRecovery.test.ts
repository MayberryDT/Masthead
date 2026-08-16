import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  prepareProductionTransition,
  restoreProductionTransition
} from "../../productionTransitionMaintenance.ts";
import type { PublishedSessionDossierV1 } from "../../../shared/sessionDossier.ts";
import {
  MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
  backfillMastheadPagesArtifactEligibilityBatch,
  resolveMaterializedMastheadPagesSelection
} from "../mastheadPagesEligibilityRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

async function makeDatabase(prefix: string): Promise<{ databasePath: string; db: MastheadDatabase }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const db = await openMastheadDatabase(databasePath);
  return { databasePath, db };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Masthead Pages eligibility migration and recovery", () => {
  test("migration 041 adds eligibility storage without rewriting populated schema-40 state", async () => {
    const { db } = await makeDatabase("masthead-pages-migration-041-");
    migrateTestDatabaseThrough(db, 40);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:before-041",
      title: "Existing Page"
    });
    const contentJson = JSON.stringify(eligibleDossier("session:before-041"));
    db.prepare(
      `INSERT INTO session_artifacts (
         artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
         created_by, schema_version, title, summary, content_json, evidence_refs_json, validation_json,
         publication_status, lineage_id, project_label, published_at
       ) VALUES (?, ?, 'session_dossier', 'current', ?, ?, ?, 'test', 'canonical-session-dossier-v1',
         ?, ?, ?, '[]', '{"ok":true}', 'published', ?, 'Masthead', ?)`
    ).run(
      "artifact:before-041",
      "session:before-041",
      "fingerprint:before-041",
      "2026-08-15T12:00:00.000Z",
      "2026-08-15T12:00:00.000Z",
      "Existing Page",
      "Existing summary",
      contentJson,
      "lineage:before-041",
      "2026-08-15T12:00:00.000Z"
    );
    db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)")
      .run("artifact:before-041", "session:before-041");
    db.prepare(
      `INSERT INTO masthead_pages_release_mappings (
         lineage_id, source_artifact_id, local_content_fingerprint, pages_account_id, public_logbook_id,
         page_id, object_id, friendly_url, exact_url, egress_fingerprint, status, created_at, updated_at,
         published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)`
    ).run(
      "lineage:before-041",
      "artifact:before-041",
      "fingerprint:before-041",
      "account:before-041",
      "logbook:before-041",
      "11111111-1111-4111-8111-111111111111",
      `sha256-${"a".repeat(64)}`,
      "https://masthead.page/@demo/logbook/existing-page",
      `https://masthead.page/@demo/logbook/existing-page/revisions/sha256-${"a".repeat(64)}`,
      `sha256-${"b".repeat(64)}`,
      "2026-08-15T12:00:00.000Z",
      "2026-08-15T12:00:00.000Z",
      "2026-08-15T12:00:00.000Z"
    );

    migrateDatabase(db);

    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version = 41").get()).toEqual({
      name: "041_masthead_pages_artifact_eligibility",
      version: 41
    });
    expect(db.prepare(
      "SELECT artifact_id, content_json, publication_status FROM session_artifacts WHERE artifact_id = ?"
    ).get("artifact:before-041")).toEqual({
      artifact_id: "artifact:before-041",
      content_json: contentJson,
      publication_status: "published"
    });
    expect(db.prepare(
      "SELECT artifact_id, session_id FROM session_artifact_provenance WHERE artifact_id = ?"
    ).get("artifact:before-041")).toEqual({
      artifact_id: "artifact:before-041",
      session_id: "session:before-041"
    });
    expect(db.prepare(
      "SELECT page_id, status FROM masthead_pages_release_mappings WHERE source_artifact_id = ?"
    ).get("artifact:before-041")).toEqual({
      page_id: "11111111-1111-4111-8111-111111111111",
      status: "live"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility").get()).toEqual({ count: 0 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("an interrupted bounded backfill resumes in artifact order without duplicate policy rows", async () => {
    const { db } = await makeDatabase("masthead-pages-backfill-resume-");
    migrateDatabase(db);
    const artifactIds = Array.from({ length: 5 }, (_, index) =>
      seedEligibleArtifact(db, `session:backfill-${index}`)
    ).sort();
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility").run();

    const first = backfillMastheadPagesArtifactEligibilityBatch(db, { batchSize: 2 });
    expect(first).toMatchObject({ complete: false, errors: 0, materialized: 2, scanned: 2 });
    expect(first.nextCursor).toBe(artifactIds[1]);
    expect(readEligibilityIds(db)).toEqual(artifactIds.slice(0, 2));

    const resumed = backfillMastheadPagesArtifactEligibilityBatch(db, {
      afterArtifactId: first.nextCursor,
      batchSize: 2
    });
    expect(resumed).toMatchObject({ complete: false, errors: 0, materialized: 2, scanned: 2 });
    expect(resumed.nextCursor).toBe(artifactIds[3]);
    expect(readEligibilityIds(db)).toEqual(artifactIds.slice(0, 4));

    const completed = backfillMastheadPagesArtifactEligibilityBatch(db, {
      afterArtifactId: resumed.nextCursor,
      batchSize: 2
    });
    expect(completed).toMatchObject({ complete: true, errors: 0, materialized: 1, scanned: 1 });
    expect(readEligibilityIds(db)).toEqual(artifactIds);

    expect(backfillMastheadPagesArtifactEligibilityBatch(db, { batchSize: 2 })).toMatchObject({
      complete: true,
      errors: 0,
      materialized: 0,
      scanned: 0
    });
    expect(db.prepare(
      `SELECT artifact_id, policy_version, COUNT(*) AS count
       FROM masthead_pages_artifact_eligibility
       GROUP BY artifact_id, policy_version
       ORDER BY artifact_id`
    ).all()).toEqual(artifactIds.map((artifactId) => ({
      artifact_id: artifactId,
      count: 1,
      policy_version: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION
    })));
    db.close();
  });

  test("a verified production-transition backup restores an offline-usable materialized resolver state", async () => {
    const { databasePath, db } = await makeDatabase("masthead-pages-backup-restore-");
    migrateDatabase(db);
    const databaseId = getOrCreateDatabaseIdentity(db);
    const artifactId = seedEligibleArtifact(db, "session:backup-restore");
    db.close();
    const transition = {
      databasePath,
      newBundle: {
        bundleDigest: "b".repeat(64),
        gitSha: "b".repeat(40),
        target: `${databasePath}.bundle-new`,
        version: "0.1.15"
      },
      nonce: "19191919-1919-4919-8919-191919191919",
      oldBundle: {
        bundleDigest: "a".repeat(64),
        gitSha: "a".repeat(40),
        target: `${databasePath}.bundle-old`,
        version: "0.1.14"
      }
    };
    const prepared = await prepareProductionTransition(transition);
    expect(prepared).toMatchObject({
      databaseId,
      snapshot: {
        path: expect.stringContaining("masthead.sqlite.backup-current"),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      sourceSchemaVersion: 41,
      state: "ready_to_activate",
      targetSchemaVersion: 41
    });
    expect(prepared.snapshot.sizeBytes).toBeGreaterThan(0);

    const changed = await openMastheadDatabase(databasePath);
    changed.prepare("UPDATE session_artifacts SET status = 'superseded' WHERE artifact_id = ?").run(artifactId);
    changed.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);
    changed.close();

    const restore = await restoreProductionTransition(transition);
    expect(restore).toMatchObject({
      databaseId,
      snapshot: { path: prepared.snapshot.path },
      state: "restored"
    });

    const restored = await openMastheadDatabase(databasePath);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));
    expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(restored.prepare("SELECT version, name FROM schema_migrations WHERE version = 41").get()).toEqual({
      name: "041_masthead_pages_artifact_eligibility",
      version: 41
    });
    expect(resolveMaterializedMastheadPagesSelection(restored)).toEqual({
      artifactIds: [artifactId],
      status: "complete"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    restored.close();
  });
});

function seedEligibleArtifact(db: MastheadDatabase, sessionId: string): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Eligible Page"
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(sessionId),
    contentFingerprint: `fingerprint:${sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    title: `Eligible ${sessionId}`,
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

function eligibleDossier(sessionId: string): PublishedSessionDossierV1 {
  const title = `Eligible ${sessionId}`;
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId,
      sourceSessionId: sessionId,
      title,
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
      keywords: ["selection", "eligibility"],
      sessionTitle: { text: title, basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: `Summary for ${title}`, state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Verified eligible work"],
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

function readEligibilityIds(db: MastheadDatabase): string[] {
  return (db.prepare(
    "SELECT artifact_id AS artifactId FROM masthead_pages_artifact_eligibility ORDER BY artifact_id"
  ).all() as Array<{ artifactId: string }>).map(({ artifactId }) => artifactId);
}
