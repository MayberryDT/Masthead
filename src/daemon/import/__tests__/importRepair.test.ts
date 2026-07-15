import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { applyImportRepair, previewImportRepair } from "../importRepair.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import repair", () => {
  test("repair preview scopes every deletion and reimport to selected import jobs without writing", async () => {
    const db = await repairDatabase();
    const before = databaseChanges(db);

    const preview = previewImportRepair(db, { importJobIds: ["job:hermes", "job:grok", "job:grok"] });

    expect(preview).toMatchObject({
      importJobIds: ["job:grok", "job:hermes"],
      affectedSessions: ["session:grok-fragment", "session:hermes-old"],
      pseudoSessionsToRemove: ["session:grok-fragment"],
      sessionsToReparse: ["session:hermes-old"],
      automaticSuppressionsToReopen: ["session:hermes-old"],
      preservedSessions: expect.arrayContaining(["session:live-codex", "session:manual", "session:unrelated"]),
      blockedPublishedSessions: [],
      reimportSources: ["source:grok", "source:hermes"],
      applyAllowed: true
    });
    expect(preview.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(databaseChanges(db)).toBe(before);
  });

  test("apply fails closed when the preview hash is wrong or its provenance drifts", async () => {
    const db = await repairDatabase();
    const input = { importJobIds: ["job:grok", "job:hermes"] };
    expect(() => applyImportRepair(db, { ...input, planHash: "wrong" })).toThrow("repair plan changed");

    const preview = previewImportRepair(db, input);
    seedImpact(db, "job:other", "source:other", "session:grok-fragment", "updated");
    expect(() => applyImportRepair(db, { ...input, planHash: preview.planHash })).toThrow("repair plan changed");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("published provenance blocks apply and remains untouched", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:published", "source:published", "session:published", "created");

    const preview = previewImportRepair(db, { importJobIds: ["job:published"] });

    expect(preview.applyAllowed).toBe(false);
    expect(preview.blockedPublishedSessions).toEqual(["session:published"]);
    expect(preview.affectedArtifacts).toEqual(["artifact:published"]);
    expect(() => applyImportRepair(db, { importJobIds: ["job:published"], planHash: preview.planHash })).toThrow(
      "published artifacts block repair"
    );
    expect(readSession(db, "session:published")).toBeDefined();
    expect(db.prepare("SELECT artifact_id FROM session_artifacts WHERE artifact_id = ?").get("artifact:published")).toBeDefined();
  });

  test("apply removes only exclusively owned pseudo-sessions and preserves live, manual, and unrelated data", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok", "job:hermes"] });

    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash
    });

    expect(receipt).toMatchObject({
      planHash: preview.planHash,
      removedSessions: ["session:grok-fragment"],
      resetSessions: ["session:hermes-old"],
      reopenedSuppressions: ["session:hermes-old"],
      reimportSources: ["source:grok", "source:hermes"]
    });
    expect(readSession(db, "session:grok-fragment")).toBeUndefined();
    expect(readSession(db, "session:hermes-old")).toBeDefined();
    expect(readSession(db, "session:live-codex")).toBeDefined();
    expect(readSession(db, "session:manual")).toBeDefined();
    expect(readSession(db, "session:unrelated")).toBeDefined();
    expect(db.prepare("SELECT publication_status, suppression_category FROM workbench_session_state WHERE session_id = ?").get("session:hermes-old"))
      .toEqual({ publication_status: "publish_path", suppression_category: null });
    expect(db.prepare("SELECT publication_status, suppression_category FROM workbench_session_state WHERE session_id = ?").get("session:manual"))
      .toEqual({ publication_status: "not_added_to_logbook", suppression_category: "manual_exclusion" });
  });
});

async function repairDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-repair-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  const now = "2026-07-15T12:00:00.000Z";
  db.prepare("INSERT INTO hosts(host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run("host:test", "test", now, now);
  for (const runtime of ["grok", "hermes", "codex"]) {
    db.prepare("INSERT INTO runtimes(runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(`runtime:${runtime}`, runtime, now, now);
  }
  for (const [sourceId, runtime] of [["source:grok", "grok"], ["source:hermes", "hermes"], ["source:other", "codex"], ["source:published", "grok"]]) {
    db.prepare(`INSERT INTO ingest_sources(source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at)
      VALUES (?, ?, 'jsonl', ?, 'authoritative', ?, ?)`).run(sourceId, runtime, `/tmp/${sourceId}`, now, now);
  }
  for (const [jobId, sourceId] of [["job:grok", "source:grok"], ["job:hermes", "source:hermes"], ["job:other", "source:other"], ["job:published", "source:published"]]) {
    db.prepare("INSERT INTO import_jobs(import_job_id, source_id, import_kind, status, updated_at) VALUES (?, ?, 'transcript', 'succeeded', ?)")
      .run(jobId, sourceId, now);
  }
  seedSession(db, "session:grok-fragment", "grok", "fragment");
  seedSession(db, "session:hermes-old", "hermes", "old");
  seedSession(db, "session:live-codex", "codex", "live");
  seedSession(db, "session:unrelated", "codex", "unrelated");
  seedSession(db, "session:manual", "hermes", "manual");
  seedSession(db, "session:published", "grok", "published");
  seedImpact(db, "job:grok", "source:grok", "session:grok-fragment", "created");
  seedImpact(db, "job:hermes", "source:hermes", "session:hermes-old", "updated");
  for (const [sessionId, sourceId] of [["session:grok-fragment", "source:grok"], ["session:hermes-old", "source:hermes"], ["session:manual", "source:hermes"], ["session:published", "source:published"]]) {
    db.prepare("INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(sessionId, sourceId, now, now);
  }
  db.prepare(`INSERT INTO workbench_session_state(session_id, publication_status, next_action, quality_status, non_publication_reason,
      suppression_category, quality_decision_source)
    VALUES (?, 'not_added_to_logbook', 'none', 'failed', 'partial_parse', 'insufficient_evidence', 'automatic')`).run("session:hermes-old");
  db.prepare(`INSERT INTO workbench_session_state(session_id, publication_status, next_action, quality_status, non_publication_reason,
      suppression_category, quality_decision_source)
    VALUES (?, 'not_added_to_logbook', 'none', 'failed', 'user_suppressed', 'manual_exclusion', 'user')`).run("session:manual");
  db.prepare(`INSERT INTO session_artifacts(artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
      created_by, schema_version, content_json, evidence_refs_json, validation_json, publication_status, lineage_id)
    VALUES ('artifact:published', 'session:published', 'session_dossier', 'current', 'sha256:x', ?, ?, 'test', 'v1', '{}', '[]', '{}', 'published', 'artifact:published')`)
    .run(now, now);
  db.prepare("INSERT INTO session_artifact_provenance(artifact_id, session_id) VALUES ('artifact:published', 'session:published')").run();
  return db;
}

function seedSession(db: MastheadDatabase, sessionId: string, runtime: string, sourceSessionId: string): void {
  const now = "2026-07-15T12:00:00.000Z";
  db.prepare(`INSERT INTO sessions(session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at)
    VALUES (?, 'host:test', ?, ?, 'unknown', ?, 'authoritative', ?, ?)`).run(sessionId, `runtime:${runtime}`, sourceSessionId, now, now, now);
}

function seedImpact(db: MastheadDatabase, jobId: string, sourceId: string, sessionId: string, kind: "created" | "updated"): void {
  db.prepare(`INSERT INTO import_session_impacts(impact_id, import_job_id, source_id, runtime_kind, session_id, impact_kind, observed_at)
    VALUES (?, ?, ?, 'grok', ?, ?, '2026-07-15T12:00:00.000Z')`).run(`impact:${jobId}:${sessionId}:${kind}`, jobId, sourceId, sessionId, kind);
}

function readSession(db: MastheadDatabase, sessionId: string): unknown {
  return db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(sessionId);
}

function databaseChanges(db: MastheadDatabase): number {
  return (db.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes;
}
