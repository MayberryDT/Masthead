import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { recordImportSessionImpact } from "../../db/importSessionImpactRepository.ts";
import { getImportJob, updateImportJob } from "../../db/importJobRepository.ts";
import { recordSessionImportHealth } from "../../db/sessionImportHealthRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { markWorkbenchPublished, readWorkbenchSessionState } from "../../db/workbenchPipelineRepository.ts";
import { reconcileImportedTranscript } from "../../../workbench/transcriptQualityReconciler.ts";
import { buildImportCompletionReport, settleImportSessionClassifications } from "../importCompletionReport.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import completion report", () => {
  test("derives created sessions and transcript coverage from persisted impact rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-report-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportSession(db);
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "created",
      observedAt: "2026-07-01T00:01:00.000Z",
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });
    seedImportWorkUnit(db);
    recordSessionImportHealth(db, {
      diagnostics: [{
        code: "recoverable_parse_gap",
        message: "Some transcript rows were not recognized.",
        severity: "warning"
      }],
      evidenceRevision: "sha256:partial",
      importJobId: "import-1",
      reason: "partial_parse",
      sessionId: "session:1",
      status: "repair_required",
      updatedAt: "2026-07-01T00:02:00.000Z",
      workUnitId: "unit:1"
    });
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      recordCount: 4,
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });

    const report = buildImportCompletionReport(db, {
      failedUnits: 1,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 0,
      recordsImported: 4,
      recordsSkipped: 1,
      runtime: "opencode",
      skippedUnits: 1,
      sourceUnitsDiscovered: 6,
      sourceUnitsHydrated: 4,
      sourceUnitsRemaining: 0,
      status: "succeeded",
      transcriptsImported: 0
    });

    expect(report).toMatchObject({
      anomalies: [],
      cappedUnits: 2,
      importJobId: "import-1",
      importHealth: {
        complete: 0,
        diagnostics: [{
          code: "recoverable_parse_gap",
          count: 1,
          message: "Some transcript rows were not recognized.",
          severity: "warning"
        }],
        partial: 0,
        reasons: [{ count: 1, reason: "partial_parse" }],
        repairRequired: 1,
        total: 1
      },
      nextActions: expect.arrayContaining(["open_logbook", "import_full_archive", "run_enrichment"]),
      outOfRangeSessions: 0,
      recordsRecognized: 4,
      recordsRejected: 0,
      recordsImported: 4,
      recordsSkipped: 1,
      sourceUnitsDeferred: 1,
      sourceUnitsDiscovered: 6,
      sourceUnitsFailed: 1,
      sourceUnitsHydrated: 4,
      sourceUnitsRemaining: 0,
      sessionsDiscovered: 1,
      sessionsHydrated: 1,
      sessionsCreated: 1,
      sessionsFinalized: 1,
      sessionsOnPackagePath: 0,
      sessionsRepairRequired: 1,
      sessionsSuppressed: 0,
      sessionsUpdated: 0,
      status: "succeeded_with_issues",
      timestampBasis: {
        file_modified: 0,
        semantic: 0,
        source_path: 0,
        unknown: 1
      },
      transcriptsImported: 1
    });
    db.close();
  });

  test("turns error anomalies into a repair-required receipt", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-report-anomaly-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportSession(db);
    seedImportWorkUnit(db);
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      recordCount: 20,
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });
    const insertMessage = db.prepare(
      "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (let index = 0; index < 20; index += 1) {
      insertMessage.run(
        `message:${index}`,
        "session:1",
        "tool",
        `tool evidence ${index}`,
        `hash:${index}`,
        `2026-07-01T00:00:${String(index).padStart(2, "0")}.000Z`,
        "{}",
        "authoritative"
      );
    }

    const report = buildImportCompletionReport(db, {
      failedUnits: 0,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 0,
      recordsImported: 20,
      recordsSkipped: 0,
      runtime: "opencode",
      skippedUnits: 0,
      status: "succeeded",
      transcriptsImported: 20
    });

    expect(report).toMatchObject({
      anomalies: [expect.objectContaining({ code: "tool_evidence_not_normalized", severity: "error" })],
      nextActions: expect.arrayContaining(["repair_import"]),
      status: "succeeded_with_issues"
    });
    const failedReport = buildImportCompletionReport(db, {
      failedUnits: 1,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 20,
      recordsImported: 0,
      recordsSkipped: 0,
      runtime: "opencode",
      skippedUnits: 0,
      status: "failed",
      transcriptsImported: 0
    });
    expect(failedReport).toMatchObject({
      anomalies: [expect.objectContaining({ code: "tool_evidence_not_normalized", severity: "error" })],
      nextActions: expect.arrayContaining(["repair_import"]),
      status: "failed"
    });
    db.close();
  });

  test("reports a sessionless repair-required work unit without inflating session counts", async () => {
    const { db } = await seededReportDatabase("masthead-import-report-sessionless-repair-");
    recordSessionImportHealth(db, {
      diagnostics: [{
        code: "missing_session_identity",
        message: "The source unit did not contain a canonical session identity.",
        severity: "error"
      }],
      evidenceRevision: "sha256:missing-identity",
      importJobId: "import-1",
      reason: "missing_session_identity",
      status: "repair_required",
      updatedAt: "2026-07-01T00:02:00.000Z",
      workUnitId: "unit:1"
    });

    expect(buildImportCompletionReport(db, reportInput())).toMatchObject({
      importHealth: { repairRequired: 1 },
      nextActions: expect.arrayContaining(["repair_import"]),
      sessionsFinalized: 0,
      sessionsRepairRequired: 0,
      status: "succeeded_with_issues"
    });
    db.close();
  });

  test("holds pathological import sessions on the review path instead of automatic Not Added", async () => {
    const { db } = await seededReportDatabase("masthead-import-report-pathological-");
    cloneImportSession(db, "session:published", "s-published");
    markWorkbenchPublished(db, {
      actor: { kind: "system", id: "test" },
      publishedVia: "test",
      sessionId: "session:published"
    });
    removeCanonicalEvidence(db, "session:1");
    for (const sessionId of ["session:1", "session:published"]) {
      recordImportSessionImpact(db, {
        importJobId: "import-1",
        impactKind: "transcript_added",
        observedAt: "2026-07-01T00:02:00.000Z",
        runtime: "opencode",
        sessionId,
        sourceId: "opencode-sessions"
      });
    }
    db.prepare(
      "UPDATE import_work_units SET processed_records = 200, imported_records = 100, failed_records = 100 WHERE work_unit_id = 'unit:1'"
    ).run();
    reconcileImportedTranscript(db, "session:1");
    expect(readWorkbenchSessionState(db, "session:1")?.publicationStatus).toBe("not_added_to_logbook");

    const preliminary = buildImportCompletionReport(db, reportInput({ recordsFailed: 100, recordsImported: 100 }));
    settleImportSessionClassifications(db, {
      anomalies: preliminary.anomalies,
      finalizeNoise: true,
      importJobId: "import-1"
    });
    const report = buildImportCompletionReport(db, reportInput({ recordsFailed: 100, recordsImported: 100 }));

    expect(report).toMatchObject({
      nextActions: expect.arrayContaining(["repair_import"]),
      sessionsOnPackagePath: 1,
      sessionsSuppressed: 0,
      status: "succeeded_with_issues"
    });
    expect(readWorkbenchSessionState(db, "session:1")).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path",
      qualityDecisionSource: "automatic",
      qualityStatus: "unchecked"
    });
    expect(readWorkbenchSessionState(db, "session:published")).toMatchObject({
      publicationStatus: "published",
      sessionPackageStatus: "published"
    });
    updateImportJob(db, "import-1", {
      completionReport: report,
      updatedAt: "2026-07-01T00:04:00.000Z"
    });
    expect(getImportJob(db, "import-1")?.completionReport).toMatchObject({
      nextActions: expect.arrayContaining(["repair_import"]),
      status: "succeeded_with_issues"
    });
    db.close();
  });

  test("finalizes confirmed noise only after a clean aggregate receipt", async () => {
    const { db } = await seededReportDatabase("masthead-import-report-clean-noise-");
    removeCanonicalEvidence(db, "session:1");
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });

    const preliminary = buildImportCompletionReport(db, reportInput());
    expect(preliminary.anomalies).toEqual([]);
    settleImportSessionClassifications(db, {
      anomalies: preliminary.anomalies,
      finalizeNoise: true,
      importJobId: "import-1"
    });

    expect(readWorkbenchSessionState(db, "session:1")).toMatchObject({
      nonPublicationReason: "empty",
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic",
      qualityStatus: "failed"
    });
    expect(buildImportCompletionReport(db, reportInput())).toMatchObject({
      sessionsOnPackagePath: 0,
      sessionsSuppressed: 1
    });
    db.prepare(
      `UPDATE workbench_session_state
       SET quality_decision_source = 'user', suppression_category = 'manual_exclusion'
       WHERE session_id = 'session:1'`
    ).run();
    expect(buildImportCompletionReport(db, reportInput())).toMatchObject({
      sessionsOnPackagePath: 0,
      sessionsSuppressed: 0
    });
    db.close();
  });

  test("settles classification from health rows in the current import job only", async () => {
    const { db } = await seededReportDatabase("masthead-import-report-current-health-");
    removeCanonicalEvidence(db, "session:1");
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });
    recordSessionImportHealth(db, {
      evidenceRevision: "sha256:current-complete",
      importJobId: "import-1",
      sessionId: "session:1",
      status: "complete",
      updatedAt: "2026-07-01T00:02:00.000Z",
      workUnitId: "unit:1"
    });
    seedHistoricalRepairHealth(db);

    settleImportSessionClassifications(db, {
      anomalies: [],
      finalizeNoise: true,
      importJobId: "import-1"
    });

    expect(readWorkbenchSessionState(db, "session:1")).toMatchObject({
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic",
      suppressionCategory: "confirmed_noise"
    });
    db.close();
  });

  test("detects transcript-created sessions outside a recent scope", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-report-range-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportSession(db);
    seedImportWorkUnit(db);
    db.prepare("UPDATE sessions SET last_activity_at = ? WHERE session_id = ?").run("2020-01-01T00:00:00.000Z", "session:1");
    db.prepare("UPDATE import_manifests SET scope_json = ?, capped_units = 0 WHERE manifest_id = ?").run(
      JSON.stringify({ days: 30, includeChangedSinceCursor: true, mode: "transcript_recent" }),
      "manifest:1"
    );
    for (const impactKind of ["created", "transcript_added"] as const) {
      recordImportSessionImpact(db, {
        importJobId: "import-1",
        impactKind,
        observedAt: "2026-07-01T00:02:00.000Z",
        runtime: "opencode",
        sessionId: "session:1",
        sourceId: "opencode-sessions"
      });
    }

    const report = buildImportCompletionReport(db, {
      failedUnits: 0,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 0,
      recordsImported: 4,
      recordsSkipped: 0,
      runtime: "opencode",
      skippedUnits: 0,
      status: "succeeded",
      transcriptsImported: 4
    });

    expect(report).toMatchObject({
      anomalies: [expect.objectContaining({ code: "out_of_range_sessions", severity: "error" })],
      nextActions: expect.arrayContaining(["repair_import"]),
      outOfRangeSessions: 1,
      status: "succeeded_with_issues"
    });
    db.close();
  });

  test("discloses a recent import cap without treating it as a pathological import", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-report-cap-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportSession(db);
    seedImportWorkUnit(db);

    const report = buildImportCompletionReport(db, {
      failedUnits: 0,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 0,
      recordsImported: 4,
      recordsSkipped: 2,
      runtime: "opencode",
      skippedUnits: 2,
      status: "succeeded",
      transcriptsImported: 4
    });

    expect(report).toMatchObject({
      anomalies: [],
      cappedUnits: 2,
      status: "succeeded"
    });
    expect(report.nextActions).not.toContain("repair_import");
    db.close();
  });
});

function seedImportSession(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "opencode-sessions", "transcript", "succeeded", "2026-07-01T00:00:00.000Z");
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run(
    "host:test",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:opencode:test",
    "opencode",
    "test",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session:1",
    "host:test",
    "runtime:opencode:test",
    "s1",
    "unknown",
    "2026-07-01T00:00:00.000Z",
    "authoritative",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run("session:1", "Import me", "Import me");
}

function seedImportWorkUnit(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("manifest:1", "import-1", "opencode-sessions", "opencode", "transcript", "{}", "2026-07-01T00:00:00.000Z", 3, 1, 2, 2, 1);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, status, timestamp_basis, processed_records, imported_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("unit:1", "manifest:1", "import-1", "opencode-sessions", "opencode", "jsonl", "authoritative", "transcript_file", "succeeded_with_issues", "unknown", 4, 4);
}

function seedHistoricalRepairHealth(db: MastheadDatabase): void {
  db.prepare(
    "INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("import-old", "opencode-sessions", "transcript", "succeeded_with_issues", "2026-07-02T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("manifest:old", "import-old", "opencode-sessions", "opencode", "transcript", "{}", "2026-07-02T00:00:00.000Z", 1, 1, 0, 0, 1);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, status, timestamp_basis, processed_records, imported_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("unit:old", "manifest:old", "import-old", "opencode-sessions", "opencode", "jsonl", "authoritative", "transcript_file", "succeeded_with_issues", "unknown", 1, 1);
  recordSessionImportHealth(db, {
    evidenceRevision: "sha256:historical-repair",
    importJobId: "import-old",
    reason: "partial_parse",
    sessionId: "session:1",
    status: "repair_required",
    updatedAt: "2026-07-02T00:01:00.000Z",
    workUnitId: "unit:old"
  });
}

async function seededReportDatabase(prefix: string): Promise<{ db: MastheadDatabase }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  seedImportSession(db);
  seedImportWorkUnit(db);
  db.prepare("UPDATE import_manifests SET capped_units = 0, excluded_units = 0 WHERE manifest_id = 'manifest:1'").run();
  return { db };
}

function removeCanonicalEvidence(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "runtime_signals", "checkpoints"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}

function cloneImportSession(db: MastheadDatabase, sessionId: string, sourceSessionId: string): void {
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    ) SELECT ?, host_id, runtime_id, ?, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    FROM sessions
    WHERE session_id = 'session:1'`
  ).run(sessionId, sourceSessionId);
}

function reportInput(overrides: { recordsFailed?: number; recordsImported?: number } = {}) {
  return {
    failedUnits: 0,
    generatedAt: "2026-07-01T00:03:00.000Z",
    importJobId: "import-1",
    recordsFailed: overrides.recordsFailed ?? 0,
    recordsImported: overrides.recordsImported ?? 4,
    recordsSkipped: 0,
    runtime: "opencode" as const,
    skippedUnits: 0,
    status: "succeeded" as const,
    transcriptsImported: overrides.recordsImported ?? 4
  };
}
