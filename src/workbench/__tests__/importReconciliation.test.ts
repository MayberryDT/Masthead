import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { publishSessionToLogbook, seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { recordSessionImportHealth } from "../../daemon/db/sessionImportHealthRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { markWorkbenchNotAdded, readWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import { reconcileMissingImportedWorkbenchSessions } from "../importReconciliation.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("missing imported Workbench session reconciliation", () => {
  test("admits a complete import while preserving a session whose latest import health requires repair", async () => {
    const db = await testDb();
    seedImportHealthUnits(db, ["unit-complete", "unit-repair"]);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:complete",
      title: "Complete import"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:repair",
      title: "Repair-held import"
    });
    recordSessionImportHealth(db, {
      evidenceRevision: "rev-complete",
      importJobId: "import-current",
      sessionId: "session:complete",
      status: "complete",
      updatedAt: "2026-07-15T11:00:00.000Z",
      workUnitId: "unit-complete"
    });
    recordSessionImportHealth(db, {
      evidenceRevision: "rev-repair",
      importJobId: "import-current",
      reason: "partial_parse",
      sessionId: "session:repair",
      status: "repair_required",
      updatedAt: "2026-07-15T11:01:00.000Z",
      workUnitId: "unit-repair"
    });

    const result = reconcileMissingImportedWorkbenchSessions(db, {
      actor: { kind: "user", id: "workbench_ui" },
      limit: 100
    });

    expect(result).toMatchObject({
      enrolled: 1,
      enrolledSessionIds: ["session:complete"],
      heldForImportRepair: 1,
      limit: 100
    });
    expect(readWorkbenchSessionState(db, "session:complete")).toMatchObject({
      publicationStatus: "publish_path",
      qualityStatus: "passed",
      transcriptStatus: "imported"
    });
    expect(readWorkbenchSessionState(db, "session:repair")).toBeUndefined();
    db.close();
  });

  test("uses latest health, preserves existing decisions, and classifies complete empty evidence once", async () => {
    const db = await testDb();
    seedImportHealthUnits(db, ["unit-empty", "unit-latest", "unit-old-repair"]);
    for (const [sessionId, title] of [
      ["session:empty", "Empty complete import"],
      ["session:latest", "Latest complete import"],
      ["session:manual", "Manual exclusion"],
      ["session:published", "Published session"]
    ] as const) {
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title });
    }
    removeCanonicalEvidence(db, "session:empty");
    markWorkbenchNotAdded(db, {
      actor: { kind: "user", id: "tyler" },
      qualityDecisionSource: "user",
      reason: "user_suppressed",
      sessionId: "session:manual",
      suppressionCategory: "manual_exclusion"
    });
    publishSessionToLogbook(db, "session:published");
    recordSessionImportHealth(db, {
      evidenceRevision: "rev-old-repair",
      importJobId: "import-current",
      reason: "partial_parse",
      sessionId: "session:latest",
      status: "repair_required",
      updatedAt: "2026-07-15T10:59:00.000Z",
      workUnitId: "unit-old-repair"
    });
    recordSessionImportHealth(db, {
      evidenceRevision: "rev-latest-complete",
      importJobId: "import-current",
      sessionId: "session:latest",
      status: "complete",
      updatedAt: "2026-07-15T11:00:00.000Z",
      workUnitId: "unit-latest"
    });
    recordSessionImportHealth(db, {
      evidenceRevision: "rev-empty",
      importJobId: "import-current",
      sessionId: "session:empty",
      status: "complete",
      updatedAt: "2026-07-15T11:01:00.000Z",
      workUnitId: "unit-empty"
    });

    const first = reconcileMissingImportedWorkbenchSessions(db, {
      actor: { kind: "user", id: "workbench_ui" },
      limit: 100
    });

    expect(first.enrolledSessionIds).toEqual(expect.arrayContaining(["session:empty", "session:latest"]));
    expect(first).toMatchObject({ enrolled: 2, heldForImportRepair: 0 });
    expect(readWorkbenchSessionState(db, "session:empty")).toMatchObject({
      nonPublicationReason: "empty",
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic",
      suppressionCategory: "confirmed_noise"
    });
    expect(readWorkbenchSessionState(db, "session:manual")).toMatchObject({
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "user",
      suppressionCategory: "manual_exclusion"
    });
    expect(readWorkbenchSessionState(db, "session:published")?.publicationStatus).toBe("published");

    const second = reconcileMissingImportedWorkbenchSessions(db, {
      actor: { kind: "user", id: "workbench_ui" },
      limit: 100
    });
    expect(second).toMatchObject({ enrolled: 0, heldForImportRepair: 0 });
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-import-reconciliation-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedImportHealthUnits(db: MastheadDatabase, workUnitIds: string[]): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("source:import-health", "codex", "jsonl", "authoritative", "2026-07-15T10:00:00.000Z", "2026-07-15T10:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run("import-current", "source:import-health", "transcript", "succeeded_with_issues", "2026-07-15T10:00:00.000Z");
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("manifest-current", "import-current", "source:import-health", "codex", "transcript", "{}", "2026-07-15T10:00:00.000Z", workUnitIds.length, workUnitIds.length, 0, 0, workUnitIds.length);
  const insert = db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, source_path, status, timestamp_basis
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const workUnitId of workUnitIds) {
    insert.run(workUnitId, "manifest-current", "import-current", "source:import-health", "codex", "jsonl", "authoritative", "transcript_file", `/tmp/${workUnitId}.jsonl`, "succeeded_with_issues", "unknown");
  }
}

function removeCanonicalEvidence(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "runtime_signals", "checkpoints"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}
