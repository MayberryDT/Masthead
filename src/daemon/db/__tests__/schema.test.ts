import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { ARTIFACT_CANDIDATE_DETECTOR_REVISION } from "../../../workbench/authoring/artifactCandidates.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { seedSession } from "./sessionTestHelpers.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import {
  hasWorkbenchArtifactCandidateScan,
  recordWorkbenchArtifactCandidateScan
} from "../workbenchArtifactCandidateRepository.ts";
import { ensureWorkbenchSessionState } from "../workbenchPipelineRepository.ts";

const tempDirs: string[] = [];
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("daemon database schema", () => {
  test("migration 027 distinguishes historical automatic prechecks from manual exclusions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateTestDatabaseThrough(db, 26);

    for (const [sessionId, reason] of [
      ["session:auto-duplicate", "duplicate_noise"],
      ["session:auto-exact", "exact_duplicate"],
      ["session:auto-hook", "hook_only"],
      ["session:auto-low", "low_evidence"],
      ["session:auto-metadata", "metadata_only"],
      ["session:auto-missing", "missing_identity"],
      ["session:auto-no-messages", "no_messages"],
      ["session:manual-exclusion", "operator_excluded"]
    ] as const) {
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: reason });
      db.prepare(
        `INSERT INTO workbench_session_state (
          session_id, publication_status, next_action, transcript_status, quality_status,
          session_enrichment_status, session_dossier_status, bug_fix_trace_status,
          non_publication_reason, created_at, updated_at
        ) VALUES (?, 'not_added_to_logbook', 'none', 'imported', 'failed', 'missing', 'missing', 'unknown', ?, ?, ?)`
      ).run(sessionId, reason, "2026-07-14T00:00:00.000Z", "2026-07-14T00:00:00.000Z");
      db.prepare(
        `INSERT INTO workbench_activity (
          activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary, details_json
        ) VALUES (?, ?, 'quality_failed', ?, 'user', 'workbench_ui', 'Quality failed', ?)`
      ).run(`${sessionId}:activity`, sessionId, "2026-07-14T00:00:00.000Z", JSON.stringify({ reason }));
    }

    db.exec(readFileSync(join(migrationsDir, "027_workbench_suppression_provenance.sql"), "utf8"));

    expect(
      db.prepare(
        `SELECT session_id AS sessionId, publication_status AS publicationStatus,
          next_action AS nextAction, quality_status AS qualityStatus,
          non_publication_reason AS nonPublicationReason,
          suppression_category AS suppressionCategory,
          quality_decision_source AS qualityDecisionSource
         FROM workbench_session_state ORDER BY session_id`
      ).all()
    ).toEqual([
      {
        nextAction: "review_quality",
        nonPublicationReason: "duplicate_noise",
        publicationStatus: "publish_path",
        qualityDecisionSource: "automatic",
        qualityStatus: "unchecked",
        sessionId: "session:auto-duplicate",
        suppressionCategory: "insufficient_evidence"
      },
      {
        nextAction: "none",
        nonPublicationReason: "exact_duplicate",
        publicationStatus: "not_added_to_logbook",
        qualityDecisionSource: "automatic",
        qualityStatus: "failed",
        sessionId: "session:auto-exact",
        suppressionCategory: "confirmed_noise"
      },
      {
        nextAction: "none",
        nonPublicationReason: "hook_only",
        publicationStatus: "not_added_to_logbook",
        qualityDecisionSource: "automatic",
        qualityStatus: "failed",
        sessionId: "session:auto-hook",
        suppressionCategory: "confirmed_noise"
      },
      {
        nextAction: "review_quality",
        nonPublicationReason: "low_evidence",
        publicationStatus: "publish_path",
        qualityDecisionSource: "automatic",
        qualityStatus: "unchecked",
        sessionId: "session:auto-low",
        suppressionCategory: "insufficient_evidence"
      },
      {
        nextAction: "review_quality",
        nonPublicationReason: "metadata_only",
        publicationStatus: "publish_path",
        qualityDecisionSource: "automatic",
        qualityStatus: "unchecked",
        sessionId: "session:auto-metadata",
        suppressionCategory: "insufficient_evidence"
      },
      {
        nextAction: "review_quality",
        nonPublicationReason: "missing_identity",
        publicationStatus: "publish_path",
        qualityDecisionSource: "automatic",
        qualityStatus: "unchecked",
        sessionId: "session:auto-missing",
        suppressionCategory: "insufficient_evidence"
      },
      {
        nextAction: "review_quality",
        nonPublicationReason: "no_messages",
        publicationStatus: "publish_path",
        qualityDecisionSource: "automatic",
        qualityStatus: "unchecked",
        sessionId: "session:auto-no-messages",
        suppressionCategory: "insufficient_evidence"
      },
      {
        nextAction: "none",
        nonPublicationReason: "operator_excluded",
        publicationStatus: "not_added_to_logbook",
        qualityDecisionSource: "user",
        qualityStatus: "failed",
        sessionId: "session:manual-exclusion",
        suppressionCategory: "manual_exclusion"
      }
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_activity").get()).toEqual({ count: 8 });
    db.close();
  });

  test("creates raw journal, canonical graph, enrichment, FTS, and audit tables idempotently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    migrateDatabase(db);
    migrateDatabase(db);

    expect(CURRENT_SCHEMA_VERSION).toBe(27);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "raw_events",
        "ingest_sources",
        "ingest_cursors",
        "source_exclusions",
        "import_jobs",
        "adapter_diagnostics",
        "hosts",
        "runtimes",
        "sessions",
        "session_aliases",
        "session_relationships",
        "turns",
        "messages",
        "tool_calls",
        "tool_results",
        "file_effects",
        "runtime_signals",
        "background_tasks",
        "checkpoints",
        "model_usage",
        "review_dispositions",
        "board_sessions",
        "session_enrichments",
        "session_topics",
        "project_summaries",
        "mcp_query_log",
        "session_search",
        "app_settings",
        "source_policies",
        "source_scan_runs",
        "source_setup_state",
        "runtime_policies",
        "import_manifests",
        "import_work_units",
        "import_failure_groups",
        "import_session_impacts",
        "session_import_health",
        "legacy_migrations",
        "board_headline_frames",
        "board_headline_generations",
        "live_state_reports",
        "workbench_runs",
        "session_artifacts",
        "session_artifact_search",
        "session_artifact_provenance",
        "workbench_session_state",
        "workbench_activity",
        "workbench_claims",
        "workbench_authoring_runs",
        "workbench_authoring_run_sessions",
        "workbench_artifact_candidates",
        "workbench_artifact_candidate_provenance",
        "workbench_artifact_candidate_signature_members",
        "workbench_artifact_candidate_source_revisions",
        "workbench_artifact_candidate_scans"
      ])
    );
    const applied = db.prepare("SELECT version, name FROM schema_migrations").all();
    expect(applied).toEqual([
      { version: 1, name: "001_initial" },
      { version: 2, name: "002_session_data_product" },
      { version: 3, name: "003_session_sources" },
      { version: 4, name: "004_cursor_context" },
      { version: 5, name: "005_import_progress" },
      { version: 6, name: "006_source_setup" },
      { version: 7, name: "007_live_projection_enrichment_indexes" },
      { version: 8, name: "008_live_projection_usage_indexes" },
      { version: 9, name: "009_import_ledger" },
      { version: 10, name: "010_board_headline_frames" },
      { version: 11, name: "011_board_headline_generations" },
      { version: 12, name: "012_board_headline_frame_refresh_keys" },
      { version: 13, name: "013_dossier_enrichment_indexes" },
      { version: 14, name: "014_live_state_reports" },
      { version: 15, name: "015_workbench_runs" },
      { version: 16, name: "016_session_artifacts" },
      { version: 17, name: "017_workbench_pipeline" },
      { version: 18, name: "018_artifact_first_logbook" },
      { version: 19, name: "019_workbench_authoring_runs" },
      { version: 20, name: "020_normalize_workbench_optional_statuses" },
      { version: 21, name: "021_artifact_body_search" },
      { version: 22, name: "022_workbench_authoring_v2" },
      { version: 23, name: "023_workbench_artifact_candidates" },
      { version: 24, name: "024_artifact_candidate_detector_revision" },
      { version: 25, name: "025_import_unit_scope" },
      { version: 26, name: "026_session_import_health" },
      { version: 27, name: "027_workbench_suppression_provenance" }
    ]);
    expect(
      (db.prepare("PRAGMA table_info(workbench_artifact_candidate_scans)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    ).toContain("detector_revision");
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "tool_results_tool_call_completed_idx",
        "tool_results_session_status_idx",
        "runtime_signals_session_observed_idx",
        "checkpoints_session_observed_idx",
        "idx_live_state_reports_session",
        "idx_workbench_authoring_run_contract_candidate",
        "idx_workbench_candidates_current_signature",
        "idx_workbench_candidates_current_session",
        "idx_workbench_candidates_status_updated",
        "idx_workbench_candidates_lineage",
        "idx_workbench_candidates_signature_history",
        "idx_workbench_candidates_session_history",
        "idx_workbench_candidate_provenance_session",
        "idx_workbench_signature_members_session",
        "idx_workbench_candidate_scans_session_time",
        "idx_session_import_health_status"
      ])
    );
    const importHealthColumns = db.prepare("PRAGMA table_info(session_import_health)").all() as Array<{
      name: string;
      notnull: number;
      pk: number;
    }>;
    expect(importHealthColumns.find((column) => column.name === "session_id")).toMatchObject({ notnull: 0, pk: 0 });
    expect(importHealthColumns.find((column) => column.name === "work_unit_id")).toMatchObject({ notnull: 1, pk: 1 });
    expect(importHealthColumns.find((column) => column.name === "diagnostics_json")).toMatchObject({ notnull: 1 });
    const sourceRevisionTriggers = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger' AND name LIKE 'workbench_candidate_%_revision'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    const transcriptTables = [
      "messages",
      "tool_calls",
      "tool_results",
      "checkpoints",
      "runtime_signals",
      "file_effects"
    ];
    expect(sourceRevisionTriggers.map((row) => row.name)).toEqual(
      transcriptTables
        .flatMap((table) =>
          ["insert", "update", "delete"].map(
            (operation) => `workbench_candidate_${table}_${operation}_revision`
          )
        )
        .sort()
    );
    const authoringRunColumns = db.prepare("PRAGMA table_info(workbench_authoring_runs)").all() as Array<{
      dflt_value: string | null;
      name: string;
      notnull: number;
    }>;
    expect(authoringRunColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dflt_value: "'workbench-authoring-v1'",
          name: "contract_version",
          notnull: 1
        }),
        expect.objectContaining({ dflt_value: null, name: "candidate_id" })
      ])
    );
    const candidateColumns = db.prepare("PRAGMA table_info(workbench_artifact_candidates)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(candidateColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "evidence_revision", notnull: 1 }),
        expect.objectContaining({ name: "supersedes_candidate_id" })
      ])
    );
    expect(db.prepare("PRAGMA foreign_key_list(workbench_artifact_candidates)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "supersedes_candidate_id",
          table: "workbench_artifact_candidates",
          to: "candidate_id"
        })
      ])
    );
    const frameColumns = db.prepare("PRAGMA table_info(board_headline_frames)").all() as Array<{ name: string }>;
    expect(frameColumns.map((row) => row.name)).toEqual(expect.arrayContaining(["refresh_key_hash"]));
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining(["idx_board_headline_frames_refresh_key"]));
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run(
      "session-1",
      "Codex importer",
      "Indexed historical session"
    );
    expect(db.prepare("SELECT session_id FROM session_search WHERE session_search MATCH ?").all("historical")).toEqual([
      { session_id: "session-1" }
    ]);
    db.close();
  });

  test("migration 023 enforces candidate lifecycle, current identity, and revision scans", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v23-candidates-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:candidate-schema",
      title: "Candidate schema"
    });
    const insertCandidate = db.prepare(
      `INSERT INTO workbench_artifact_candidates (
        candidate_id, kind, seed_session_id, provenance_session_ids_json,
        signal_evidence_refs_json, signal_summary, signature_key, evidence_revision,
        status, created_at, updated_at
      ) VALUES (?, 'runbook', 'session:candidate-schema', ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = "2026-07-12T00:00:00.000Z";
    insertCandidate.run(
      "candidate:one",
      JSON.stringify(["session:candidate-schema"]),
      JSON.stringify(["message:session:candidate-schema:message"]),
      "Grounded reusable procedure candidate.",
      "error:ssh:missing-command",
      "sha256:candidate-one",
      "pending",
      now,
      now
    );

    expect(() =>
      insertCandidate.run(
        "candidate:duplicate-current",
        JSON.stringify(["session:candidate-schema"]),
        JSON.stringify(["message:session:candidate-schema:message"]),
        "Duplicate current signature.",
        "error:ssh:missing-command",
        "sha256:candidate-duplicate",
        "claimed",
        now,
        now
      )
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `UPDATE workbench_artifact_candidates
           SET status = 'dismissed', dismissal_reason = 'too short', dismissal_evidence_refs_json = '[]'
           WHERE candidate_id = 'candidate:one'`
        )
        .run()
    ).toThrow();

    db.prepare(
      `UPDATE workbench_artifact_candidates
       SET status = 'dismissed',
         dismissal_reason = 'The evidence is real but this procedure is not reusable.',
         dismissal_evidence_refs_json = signal_evidence_refs_json
       WHERE candidate_id = 'candidate:one'`
    ).run();
    insertCandidate.run(
      "candidate:replacement",
      JSON.stringify(["session:candidate-schema"]),
      JSON.stringify(["message:session:candidate-schema:message"]),
      "Changed evidence creates a new current candidate.",
      "error:ssh:missing-command",
      "sha256:candidate-replacement",
      "pending",
      now,
      now
    );
    expect(
      db.prepare(
        `SELECT session_id AS sessionId, position
         FROM workbench_artifact_candidate_provenance
         WHERE candidate_id = 'candidate:replacement'
         ORDER BY position`
      ).all()
    ).toEqual([{ position: 0, sessionId: "session:candidate-schema" }]);
    expect(
      db.prepare(
        "SELECT origin FROM workbench_artifact_candidates WHERE candidate_id = 'candidate:replacement'"
      ).get()
    ).toEqual({ origin: "automatic" });
    db.prepare(
      `INSERT INTO workbench_artifact_candidate_scans (
        session_id, evidence_revision, source_revision, scanned_at
      ) VALUES ('session:candidate-schema', 'sha256:first', 0, ?)`
    ).run(now);
    db.prepare(
      `INSERT INTO workbench_artifact_candidate_scans (
        session_id, evidence_revision, source_revision, scanned_at
      ) VALUES ('session:candidate-schema', 'sha256:second', 1, ?)`
    ).run(now);
    expect(
      db
        .prepare(
          `SELECT evidence_revision AS evidenceRevision, source_revision AS sourceRevision
           FROM workbench_artifact_candidate_scans
           WHERE session_id = 'session:candidate-schema'
           ORDER BY evidence_revision`
        )
        .all()
    ).toEqual([
      { evidenceRevision: "sha256:first", sourceRevision: 0 },
      { evidenceRevision: "sha256:second", sourceRevision: 1 }
    ]);
    db.prepare(
      `INSERT INTO workbench_artifact_candidate_signature_members (
        kind, signature_key, session_id, evidence_revision, signal_evidence_refs_json, updated_at
      ) VALUES ('runbook', 'error:ssh:missing-command', 'session:candidate-schema',
        'sha256:member', '["message:session:candidate-schema:message"]', ?)`
    ).run(now);
    expect(() => db.prepare("DELETE FROM sessions WHERE session_id = 'session:candidate-schema'").run()).not.toThrow();
    for (const table of [
      "workbench_artifact_candidate_source_revisions",
      "workbench_artifact_candidate_provenance",
      "workbench_artifact_candidate_signature_members",
      "workbench_artifact_candidate_scans"
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    db.close();
  });

  test("migration 024 backfills populated scans and requires the current detector revision", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v24-detector-revision-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateTestDatabaseThrough(db, 23);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:detector-revision",
      title: "Detector revision migration"
    });
    db.prepare(
      `INSERT INTO workbench_artifact_candidate_scans (
        session_id, evidence_revision, source_revision, scanned_at
      ) VALUES (?, ?, ?, ?)`
    ).run(
      "session:detector-revision",
      "sha256:legacy-detector",
      0,
      "2026-07-13T12:00:00.000Z"
    );

    expect(
      (db.prepare("PRAGMA table_info(workbench_artifact_candidate_scans)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    ).not.toContain("detector_revision");

    db.exec(readFileSync(join(migrationsDir, "024_artifact_candidate_detector_revision.sql"), "utf8"));
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(
      24,
      "024_artifact_candidate_detector_revision",
      "2026-07-15T00:00:00.000Z"
    );

    expect(CURRENT_SCHEMA_VERSION).toBe(27);
    expect(db.prepare("SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({
      name: "024_artifact_candidate_detector_revision",
      version: 24
    });
    expect(
      (db.prepare("PRAGMA table_info(workbench_artifact_candidate_scans)").all() as Array<{
        dflt_value: string | null;
        name: string;
        notnull: number;
        type: string;
      }>).find((column) => column.name === "detector_revision")
    ).toMatchObject({
      dflt_value: "1",
      name: "detector_revision",
      notnull: 1,
      type: "INTEGER"
    });
    expect(
      db.prepare(
        `SELECT evidence_revision AS evidenceRevision,
                source_revision AS sourceRevision,
                detector_revision AS detectorRevision
         FROM workbench_artifact_candidate_scans
         WHERE session_id = ?`
      ).get("session:detector-revision")
    ).toEqual({
      detectorRevision: 1,
      evidenceRevision: "sha256:legacy-detector",
      sourceRevision: 0
    });

    expect(ARTIFACT_CANDIDATE_DETECTOR_REVISION).toBeGreaterThan(1);
    expect(
      hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: 1,
        sessionId: "session:detector-revision",
        sourceRevision: 0
      })
    ).toBe(true);
    expect(
      hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
        sessionId: "session:detector-revision",
        sourceRevision: 0
      })
    ).toBe(false);

    recordWorkbenchArtifactCandidateScan(db, {
      detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
      evidenceRevision: "sha256:current-detector",
      sessionId: "session:detector-revision",
      sourceRevision: 0
    });

    expect(
      hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
        sessionId: "session:detector-revision",
        sourceRevision: 0
      })
    ).toBe(true);
    expect(
      hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: 1,
        sessionId: "session:detector-revision",
        sourceRevision: 0
      })
    ).toBe(false);
    expect(
      db.prepare(
        `SELECT evidence_revision AS evidenceRevision,
                detector_revision AS detectorRevision
         FROM workbench_artifact_candidate_scans
         WHERE session_id = ? AND source_revision = ?`
      ).get("session:detector-revision", 0)
    ).toEqual({
      detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
      evidenceRevision: "sha256:current-detector"
    });
    db.close();
  });

  test("migration 025 records import unit scope evidence and manifest caps", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v25-import-unit-scope-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateTestDatabaseThrough(db, 24);

    expect(
      (db.prepare("PRAGMA table_info(import_work_units)").all() as Array<{ name: string }>).map((column) => column.name)
    ).not.toContain("semantic_activity_at");

    migrateDatabase(db);

    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version = 25").get()).toEqual({
      name: "025_import_unit_scope",
      version: 25
    });
    expect(
      (db.prepare("PRAGMA table_info(import_work_units)").all() as Array<{
        dflt_value: string | null;
        name: string;
        notnull: number;
      }>).find((column) => column.name === "timestamp_basis")
    ).toMatchObject({ dflt_value: "'unknown'", name: "timestamp_basis", notnull: 1 });
    expect(
      (db.prepare("PRAGMA table_info(import_work_units)").all() as Array<{ name: string }>).map((column) => column.name)
    ).toEqual(expect.arrayContaining(["semantic_activity_at", "scope_reason"]));
    expect(
      (db.prepare("PRAGMA table_info(import_manifests)").all() as Array<{ name: string }>).map((column) => column.name)
    ).toContain("capped_units");
    db.close();
  });

  test("migration 021 backfills current published artifact bodies into search", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v20-artifact-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:body-backfill",
      title: "Artifact body backfill"
    });
    const artifact = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { rootCause: "orphaned descriptor after cancellation", title: "Repair lock" },
      contentFingerprint: "body-backfill",
      createdBy: "migration-test",
      evidenceRefs: ["message:session:body-backfill:message"],
      schemaVersion: "runbook-v2",
      sessionId: "session:body-backfill",
      title: "Repair lock",
      validation: { ok: true }
    });
    publishSessionArtifact(db, artifact.artifactId);
    db.exec("DROP TABLE session_artifact_search;");
    db.prepare("DELETE FROM schema_migrations WHERE version = 21").run();

    migrateDatabase(db);

    expect(
      db
        .prepare(
          `SELECT artifact_id AS artifactId
           FROM session_artifact_search
           WHERE session_artifact_search MATCH ?`
        )
        .all('"orphaned" "descriptor"')
    ).toEqual([{ artifactId: artifact.artifactId }]);
    db.close();
  });

  test("normalizes optional satisfied rows written after migration 019", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v19-optional-statuses-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version IN (20, 21)").run();
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations WHERE version <= 21").get()).toEqual({
      version: 19
    });

    const publishedKinds = ["runbook", "adr", "incident_timeline"] as const;
    for (const kind of publishedKinds) {
      const sessionId = `session:${kind}:published`;
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: `${kind} published`
      });
      ensureWorkbenchSessionState(db, sessionId);
      const artifact = applySessionArtifact(db, {
        artifactKind: kind,
        content: { title: `${kind} published artifact` },
        contentFingerprint: `${kind}:published:fingerprint`,
        createdBy: "legacy-v1",
        evidenceRefs: [`message:${sessionId}:message`],
        provenanceSessionIds: [sessionId],
        schemaVersion: `${kind}-v1`,
        sessionId,
        title: `${kind} published artifact`,
        validation: { ok: true }
      });
      publishSessionArtifact(db, artifact.artifactId);
      const column = kind === "runbook" ? "runbook_status" : kind === "adr" ? "adr_status" : "incident_timeline_status";
      db.prepare(`UPDATE workbench_session_state SET ${column} = 'satisfied' WHERE session_id = ?`).run(sessionId);
      if (kind === "runbook") {
        db.prepare("UPDATE workbench_session_state SET bug_fix_trace_status = 'satisfied' WHERE session_id = ?").run(sessionId);
      }
    }
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported',
           quality_status = 'passed',
           session_enrichment_status = 'satisfied',
           session_dossier_status = 'satisfied',
           session_package_status = 'published',
           publication_status = 'published',
           adr_status = 'not_applicable',
           incident_timeline_status = 'not_applicable',
           resolution_status = 'automatic_resolved',
           next_action = 'none'
       WHERE session_id = 'session:runbook:published'`
    ).run();

    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:no-published-artifacts",
      title: "No published artifacts"
    });
    ensureWorkbenchSessionState(db, "session:no-published-artifacts");
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported',
           quality_status = 'passed',
           session_enrichment_status = 'satisfied',
           session_dossier_status = 'satisfied',
           session_package_status = 'published',
           publication_status = 'published',
           runbook_status = 'satisfied',
           adr_status = 'satisfied',
           incident_timeline_status = 'satisfied',
           bug_fix_trace_status = 'satisfied',
           resolution_status = 'automatic_resolved',
           next_action = 'none'
       WHERE session_id = 'session:no-published-artifacts'`
    ).run();

    for (const sessionId of ["session:not-added", "session:not-ready"]) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: sessionId
      });
      ensureWorkbenchSessionState(db, sessionId);
      db.prepare(
        `UPDATE workbench_session_state
         SET runbook_status = 'satisfied',
             adr_status = 'satisfied',
             incident_timeline_status = 'satisfied',
             resolution_status = 'automatic_resolved',
             next_action = 'enrich'
         WHERE session_id = ?`
      ).run(sessionId);
    }
    db.prepare(
      `UPDATE workbench_session_state
       SET publication_status = 'not_added_to_logbook'
       WHERE session_id = 'session:not-added'`
    ).run();

    db.exec("DROP TABLE session_artifact_search;");
    migrateDatabase(db);

    expect(
      db.prepare(
        `SELECT session_id AS sessionId,
                runbook_status AS runbookStatus,
                adr_status AS adrStatus,
                incident_timeline_status AS incidentTimelineStatus,
                bug_fix_trace_status AS bugFixTraceStatus
         FROM workbench_session_state
         WHERE session_id IN (
           'session:adr:published',
           'session:incident_timeline:published',
           'session:no-published-artifacts',
           'session:runbook:published'
         )
         ORDER BY session_id`
      ).all()
    ).toEqual([
      {
        adrStatus: "published",
        bugFixTraceStatus: "unknown",
        incidentTimelineStatus: "unknown",
        runbookStatus: "unknown",
        sessionId: "session:adr:published"
      },
      {
        adrStatus: "unknown",
        bugFixTraceStatus: "unknown",
        incidentTimelineStatus: "published",
        runbookStatus: "unknown",
        sessionId: "session:incident_timeline:published"
      },
      {
        adrStatus: "applied",
        bugFixTraceStatus: "required",
        incidentTimelineStatus: "applied",
        runbookStatus: "applied",
        sessionId: "session:no-published-artifacts"
      },
      {
        adrStatus: "not_applicable",
        bugFixTraceStatus: "satisfied",
        incidentTimelineStatus: "not_applicable",
        runbookStatus: "published",
        sessionId: "session:runbook:published"
      }
    ]);
    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version = 20").get()).toEqual({
      name: "020_normalize_workbench_optional_statuses",
      version: 20
    });
    expect(
      db.prepare(
        `SELECT session_id AS sessionId,
                resolution_status AS resolutionStatus,
                next_action AS nextAction
         FROM workbench_session_state
         WHERE session_id IN (
           'session:no-published-artifacts',
           'session:not-added',
           'session:not-ready',
           'session:runbook:published'
         )
         ORDER BY session_id`
      ).all()
    ).toEqual([
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        sessionId: "session:no-published-artifacts"
      },
      {
        nextAction: "none",
        resolutionStatus: "in_progress",
        sessionId: "session:not-added"
      },
      {
        nextAction: "check_transcript",
        resolutionStatus: "in_progress",
        sessionId: "session:not-ready"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        sessionId: "session:runbook:published"
      }
    ]);
    db.close();
  });

  test("canonicalizes legacy artifact signatures and repairs current lineage collisions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v19-artifact-signatures-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = 20").run();

    for (const sessionId of ["session:padded", "session:blank", "session:collision-old", "session:collision-new", "session:next"]) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: sessionId
      });
    }
    insertLegacyArtifact(db, {
      artifactId: "artifact:padded",
      artifactKind: "runbook",
      createdAt: "2026-07-10T10:00:00.000Z",
      sessionId: "session:padded",
      signatureKey: "  signature:padded  ",
      updatedAt: "2026-07-10T10:00:00.000Z"
    });
    insertLegacyArtifact(db, {
      artifactId: "artifact:blank",
      artifactKind: "adr",
      createdAt: "2026-07-10T10:00:00.000Z",
      sessionId: "session:blank",
      signatureKey: " \t ",
      updatedAt: "2026-07-10T10:00:00.000Z"
    });
    insertLegacyArtifact(db, {
      artifactId: "artifact:collision-old",
      artifactKind: "runbook",
      createdAt: "2026-07-10T10:00:00.000Z",
      sessionId: "session:collision-old",
      signatureKey: "signature:collision",
      updatedAt: "2026-07-10T10:30:00.000Z"
    });
    insertLegacyArtifact(db, {
      artifactId: "artifact:collision-new",
      artifactKind: "runbook",
      createdAt: "2026-07-10T11:00:00.000Z",
      sessionId: "session:collision-new",
      signatureKey: "  signature:collision  ",
      updatedAt: "2026-07-10T11:30:00.000Z"
    });

    migrateDatabase(db);

    expect(
      db.prepare(
        `SELECT artifact_id AS artifactId, signature_key AS signatureKey, status
         FROM session_artifacts
         WHERE artifact_id LIKE 'artifact:%'
         ORDER BY artifact_id`
      ).all()
    ).toEqual([
      { artifactId: "artifact:blank", signatureKey: null, status: "current" },
      { artifactId: "artifact:collision-new", signatureKey: "signature:collision", status: "current" },
      { artifactId: "artifact:collision-old", signatureKey: "signature:collision", status: "superseded" },
      { artifactId: "artifact:padded", signatureKey: "signature:padded", status: "current" }
    ]);

    const next = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "Canonical collision successor" },
      contentFingerprint: "canonical-collision-successor",
      createdBy: "migration-test",
      evidenceRefs: ["message:session:next:message"],
      schemaVersion: "runbook-v2",
      sessionId: "session:next",
      signatureKey: " signature:collision ",
      title: "Canonical collision successor",
      validation: { ok: true }
    });

    expect(next).toMatchObject({
      lineageId: "lineage:collision-new",
      signatureKey: "signature:collision",
      status: "current"
    });
    expect(
      db.prepare(
        `SELECT artifact_id AS artifactId, status
         FROM session_artifacts
         WHERE artifact_kind = 'runbook' AND signature_key = 'signature:collision'
         ORDER BY artifact_id`
      ).all()
    ).toEqual([
      { artifactId: "artifact:collision-new", status: "superseded" },
      { artifactId: "artifact:collision-old", status: "superseded" },
      { artifactId: next.artifactId, status: "current" }
    ]);
    db.close();
  });

  test("repairs resolved optional states after a cross-session published signature collision", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v19-published-signature-collision-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = 20").run();

    const sessionStatuses = [
      ["session:collision-old", "published"],
      ["session:collision-new", "published"],
      ["session:contribution-old", "contributed"],
      ["session:contribution-new", "contributed"],
      ["session:already-applied", "applied"],
      ["session:not-applicable", "not_applicable"]
    ] as const;
    for (const [sessionId, runbookStatus] of sessionStatuses) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: sessionId
      });
      ensureWorkbenchSessionState(db, sessionId);
      db.prepare(
        `UPDATE workbench_session_state
         SET transcript_status = 'imported',
             quality_status = 'passed',
             session_enrichment_status = 'satisfied',
             session_dossier_status = 'satisfied',
             session_package_status = 'published',
             publication_status = 'published',
             runbook_status = ?,
             adr_status = 'not_applicable',
             incident_timeline_status = 'not_applicable',
             resolution_status = ?,
             next_action = ?
         WHERE session_id = ?`
      ).run(
        runbookStatus,
        runbookStatus === "applied" ? "compile_ready" : "automatic_resolved",
        runbookStatus === "applied" ? "enrich" : "none",
        sessionId
      );
    }

    insertLegacyArtifact(db, {
      artifactId: "artifact:collision-old",
      artifactKind: "runbook",
      createdAt: "2026-07-10T10:00:00.000Z",
      sessionId: "session:collision-old",
      signatureKey: "signature:collision",
      updatedAt: "2026-07-10T10:30:00.000Z"
    });
    insertLegacyArtifact(db, {
      artifactId: "artifact:collision-new",
      artifactKind: "runbook",
      createdAt: "2026-07-10T11:00:00.000Z",
      sessionId: "session:collision-new",
      signatureKey: "  signature:collision  ",
      updatedAt: "2026-07-10T11:30:00.000Z"
    });
    db.prepare("UPDATE session_artifacts SET publication_status = 'published'").run();
    db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)").run(
      "artifact:collision-old",
      "session:contribution-old"
    );
    db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)").run(
      "artifact:collision-new",
      "session:contribution-new"
    );

    migrateDatabase(db);

    expect(
      db.prepare(
        `SELECT session_id AS sessionId,
                runbook_status AS runbookStatus,
                resolution_status AS resolutionStatus,
                next_action AS nextAction
         FROM workbench_session_state
         WHERE session_id LIKE 'session:%'
         ORDER BY session_id`
      ).all()
    ).toEqual([
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "applied",
        sessionId: "session:already-applied"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "published",
        sessionId: "session:collision-new"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "applied",
        sessionId: "session:collision-old"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "contributed",
        sessionId: "session:contribution-new"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "applied",
        sessionId: "session:contribution-old"
      },
      {
        nextAction: "none",
        resolutionStatus: "automatic_resolved",
        runbookStatus: "not_applicable",
        sessionId: "session:not-applicable"
      }
    ]);
    db.close();
  });

  test.each([
    {
      expectedStatus: "contributed",
      label: "losing seed remains only as retained artifact provenance",
      olderSeedIsTarget: true,
      priorStatus: "published"
    },
    {
      expectedStatus: "published",
      label: "losing contributor becomes the retained artifact seed",
      olderSeedIsTarget: false,
      priorStatus: "contributed"
    }
  ] as const)("derives the surviving artifact role when $label", async ({ expectedStatus, olderSeedIsTarget, priorStatus }) => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-v19-published-role-swap-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = 20").run();

    const targetSessionId = "session:role-target";
    const otherSessionId = "session:role-other";
    for (const sessionId of [targetSessionId, otherSessionId]) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: sessionId
      });
    }
    ensureWorkbenchSessionState(db, targetSessionId);
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported',
           quality_status = 'passed',
           session_enrichment_status = 'satisfied',
           session_dossier_status = 'satisfied',
           session_package_status = 'published',
           publication_status = 'published',
           runbook_status = ?,
           adr_status = 'not_applicable',
           incident_timeline_status = 'not_applicable',
           resolution_status = 'automatic_resolved',
           next_action = 'none'
       WHERE session_id = ?`
    ).run(priorStatus, targetSessionId);

    insertLegacyArtifact(db, {
      artifactId: "artifact:role-old",
      artifactKind: "runbook",
      createdAt: "2026-07-10T10:00:00.000Z",
      sessionId: olderSeedIsTarget ? targetSessionId : otherSessionId,
      signatureKey: "signature:role-swap",
      updatedAt: "2026-07-10T10:30:00.000Z"
    });
    insertLegacyArtifact(db, {
      artifactId: "artifact:role-new",
      artifactKind: "runbook",
      createdAt: "2026-07-10T11:00:00.000Z",
      sessionId: olderSeedIsTarget ? otherSessionId : targetSessionId,
      signatureKey: "  signature:role-swap  ",
      updatedAt: "2026-07-10T11:30:00.000Z"
    });
    db.prepare("UPDATE session_artifacts SET publication_status = 'published'").run();
    db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)").run(
      olderSeedIsTarget ? "artifact:role-new" : "artifact:role-old",
      targetSessionId
    );

    migrateDatabase(db);

    expect(
      db.prepare(
        `SELECT runbook_status AS runbookStatus,
                resolution_status AS resolutionStatus,
                next_action AS nextAction
         FROM workbench_session_state
         WHERE session_id = ?`
      ).get(targetSessionId)
    ).toEqual({
      nextAction: "none",
      resolutionStatus: "automatic_resolved",
      runbookStatus: expectedStatus
    });
    db.close();
  });

  test("rejects an applied migration marker when critical schema tables are missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      1,
      "001_initial",
      "2026-06-24T00:00:00.000Z"
    );

    expect(() => migrateDatabase(db)).toThrow(/missing critical tables|no such table/i);
    db.close();
  });

  test("repairs historical version 12 marker drift for board headline refresh keys", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    for (const migration of [
      [1, "001_initial"],
      [2, "002_session_data_product"],
      [3, "003_session_sources"],
      [4, "004_cursor_context"],
      [5, "005_import_progress"],
      [6, "006_source_setup"],
      [7, "007_live_projection_enrichment_indexes"],
      [8, "008_live_projection_usage_indexes"],
      [9, "009_import_ledger"],
      [10, "010_board_headline_frames"],
      [11, "011_board_headline_generations"],
      [13, "013_dossier_enrichment_indexes"],
      [14, "014_live_state_reports"],
      [15, "015_workbench_runs"],
      [16, "016_session_artifacts"],
      [17, "017_workbench_pipeline"],
      [18, "018_artifact_first_logbook"]
    ] as const) {
      const [version, name] = migration;
      db.exec(readFileSync(join(migrationsDir, `${name}.sql`), "utf8"));
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        version,
        name,
        "2026-07-03T01:03:02.688Z"
      );
    }
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      12,
      "012_session_enrichment_chunks",
      "2026-07-03T01:03:02.688Z"
    );
    expect((db.prepare("PRAGMA table_info(board_headline_frames)").all() as Array<{ name: string }>).map((row) => row.name)).not.toContain(
      "refresh_key_hash"
    );

    migrateDatabase(db);

    const frameColumns = db.prepare("PRAGMA table_info(board_headline_frames)").all() as Array<{ name: string }>;
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{ name: string }>;
    expect(frameColumns.map((row) => row.name)).toEqual(expect.arrayContaining(["refresh_key_hash"]));
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining(["idx_board_headline_frames_refresh_key"]));
    db.close();
  });

  test("treats nullable logical keys as unique values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    migrateDatabase(db);
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run("source:nullable", "opencode", "jsonl", "authoritative", "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO hosts (host_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?)`
    ).run("host:nullable", "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("runtime:nullable", "opencode", null, "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "session:nullable",
      "host:nullable",
      "runtime:nullable",
      "source-session",
      "running",
      "2026-06-24T00:00:00.000Z",
      "authoritative",
      "2026-06-24T00:00:00.000Z",
      "2026-06-24T00:00:00.000Z"
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO ingest_cursors (cursor_id, source_id, source_path, updated_at)
          VALUES (?, ?, ?, ?)`
        )
        .run("cursor:1", "source:nullable", null, "2026-06-24T00:00:00.000Z")
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO ingest_cursors (cursor_id, source_id, source_path, updated_at)
          VALUES (?, ?, ?, ?)`
        )
        .run("cursor:2", "source:nullable", null, "2026-06-24T00:00:01.000Z")
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?)`
        )
        .run("runtime:duplicate-null", "opencode", null, "2026-06-24T00:00:01.000Z", "2026-06-24T00:00:01.000Z")
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO turns (turn_id, session_id, source_turn_id, turn_index, role, source_ref_json)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("turn:1", "session:nullable", null, 1, "user", "{}")
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO turns (turn_id, session_id, source_turn_id, turn_index, role, source_ref_json)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("turn:2", "session:nullable", null, 1, "user", "{}")
    ).toThrow();
    db.close();
  });
});

function insertLegacyArtifact(
  db: MastheadDatabase,
  input: {
    artifactId: string;
    artifactKind: "runbook" | "adr";
    createdAt: string;
    sessionId: string;
    signatureKey: string;
    updatedAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO session_artifacts (
       artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
       created_by, schema_version, content_json, evidence_refs_json, validation_json,
       publication_status, signature_key, lineage_id
     ) VALUES (?, ?, ?, 'current', ?, ?, ?, 'legacy-v19', ?, '{}', '[]', '{"ok":true}', 'applied', ?, ?)`
  ).run(
    input.artifactId,
    input.sessionId,
    input.artifactKind,
    `fingerprint:${input.artifactId}`,
    input.createdAt,
    input.updatedAt,
    `${input.artifactKind}-v1`,
    input.signatureKey,
    `lineage:${input.artifactId.slice("artifact:".length)}`
  );
  db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)").run(
    input.artifactId,
    input.sessionId
  );
}
