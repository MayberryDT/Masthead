#!/usr/bin/env node
/**
 * Dogfood the complete Workbench human-ops publish loop against a temporary SQLite DB.
 * Never touches the real dev database.
 *
 * Pipeline: check transcript → quality pass → enrichment + dossier satisfied →
 * bug_fix not_applicable → publish → assert Logbook-visible published state.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const requiredModules = [
  "dist/daemon/src/daemon/db/schema.js",
  "dist/daemon/src/daemon/db/sqlite.js",
  "dist/daemon/src/daemon/db/workbenchPipelineRepository.js",
  "dist/daemon/src/daemon/db/workbenchPublicationSql.js",
  "dist/daemon/src/workbench/transcriptWorkflow.js",
  "dist/daemon/src/workbench/qualityPrecheck.js"
];

for (const relativePath of requiredModules) {
  if (!existsSync(resolve(repoRoot, relativePath))) {
    console.error(`Missing built module ${relativePath}. Run npm run build:daemon first.`);
    process.exit(1);
  }
}

const { migrateDatabase } = await import("../dist/daemon/src/daemon/db/schema.js");
const { openMastheadDatabase } = await import("../dist/daemon/src/daemon/db/sqlite.js");
const {
  markWorkbenchQuality,
  markWorkbenchSessionEnrichmentSatisfied,
  markWorkbenchArtifactSatisfied,
  setWorkbenchArtifactApplicability,
  publishWorkbenchSession,
  readWorkbenchSessionState
} = await import("../dist/daemon/src/daemon/db/workbenchPipelineRepository.js");
const { workbenchSessionIsPublished } = await import("../dist/daemon/src/daemon/db/workbenchPublicationSql.js");
const { checkWorkbenchTranscript } = await import("../dist/daemon/src/workbench/transcriptWorkflow.js");
const { runCaptureQualityPrecheck } = await import("../dist/daemon/src/workbench/qualityPrecheck.js");

const sessionId = "session:ops-dogfood";
const actor = { kind: "agent", id: "dogfood-ops" };
const steps = [];
const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-ops-"));

try {
  const dbPath = join(tempDir, "masthead.sqlite");
  const db = await openMastheadDatabase(dbPath);
  migrateDatabase(db);
  seedSession(db, sessionId);

  // 1. Check transcript — seeded messages should yield imported/usable coverage.
  const transcript = checkWorkbenchTranscript(db, { actor, sessionId });
  steps.push({ name: "check_transcript", ok: transcript.ok === true, result: transcript });
  if (!transcript.ok) throw new Error(`check_transcript failed: ${JSON.stringify(transcript)}`);
  if (transcript.transcriptStatus !== "imported" && transcript.transcriptStatus !== "available") {
    throw new Error(`Expected usable transcript status, got ${transcript.transcriptStatus}`);
  }

  // 2. Precheck quality (informational) then mark quality pass.
  const precheck = runCaptureQualityPrecheck(db, sessionId);
  steps.push({ name: "quality_precheck", ok: precheck.ok === true, result: precheck });
  if (!precheck.ok) throw new Error(`quality_precheck failed: ${JSON.stringify(precheck)}`);

  const quality = markWorkbenchQuality(db, { actor, sessionId, status: "passed" });
  steps.push({
    name: "quality_pass",
    ok: quality.state.qualityStatus === "passed",
    qualityStatus: quality.state.qualityStatus,
    activityType: quality.activity.eventType
  });
  if (quality.state.qualityStatus !== "passed") {
    throw new Error(`Expected quality_status passed, got ${quality.state.qualityStatus}`);
  }

  // 3. Mark enrichment + dossier satisfied; bug_fix not applicable for this non-bug session.
  const enrichment = markWorkbenchSessionEnrichmentSatisfied(db, { actor, sessionId });
  steps.push({
    name: "session_enrichment_satisfied",
    ok: enrichment.state.sessionEnrichmentStatus === "satisfied",
    sessionEnrichmentStatus: enrichment.state.sessionEnrichmentStatus
  });

  const dossier = markWorkbenchArtifactSatisfied(db, {
    actor,
    artifactKind: "session_dossier",
    sessionId
  });
  steps.push({
    name: "session_dossier_satisfied",
    ok: dossier.state.sessionDossierStatus === "satisfied",
    sessionDossierStatus: dossier.state.sessionDossierStatus
  });

  const bugFix = setWorkbenchArtifactApplicability(db, {
    actor,
    artifactKind: "bug_fix_trace",
    reason: "ops_dogfood_non_bug_session",
    sessionId,
    status: "not_applicable"
  });
  steps.push({
    name: "bug_fix_not_applicable",
    ok: bugFix.state.bugFixTraceStatus === "not_applicable",
    bugFixTraceStatus: bugFix.state.bugFixTraceStatus
  });

  // 4. Publish when gates pass.
  const published = publishWorkbenchSession(db, { actor, sessionId });
  if (!published.ok) {
    steps.push({ name: "publish", ok: false, result: published });
    throw new Error(`publish failed: missing=${JSON.stringify(published.missing)}`);
  }
  steps.push({
    name: "publish",
    ok: true,
    publicationStatus: published.state.publicationStatus,
    activityType: published.activity.eventType
  });

  const state = readWorkbenchSessionState(db, sessionId);
  if (!state || state.publicationStatus !== "published") {
    throw new Error(`Expected publication_status published, got ${state?.publicationStatus ?? "missing"}`);
  }

  // 5. Logbook-visible via published-only helper.
  const logbookVisible = workbenchSessionIsPublished(db, sessionId);
  steps.push({ name: "logbook_visible", ok: logbookVisible === true, logbookVisible });
  if (!logbookVisible) throw new Error("workbenchSessionIsPublished returned false after publish");

  db.close();

  const receipt = { ok: true, sessionId, steps, dbPath };
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, sessionId, steps, error: message }, null, 2));
  process.exitCode = 1;
} finally {
  if (!process.env.MASTHEAD_KEEP_DOGFOOD_DB) {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function seedSession(db, id) {
  const now = "2026-07-08T16:00:00.000Z";
  const sourceId = "source:ops-dogfood";
  const hostId = "host:ops-dogfood";
  const runtimeId = "runtime:ops-dogfood";

  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    hostId,
    "ops-dogfood-host",
    now,
    now
  );
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run(runtimeId, "codex", "ops-dogfood", now, now);

  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    hostId,
    runtimeId,
    "source-session-ops-dogfood",
    "Masthead",
    repoRoot,
    repoRoot,
    "main",
    "Workbench ops dogfood session",
    "Prove check → quality → enrich → publish on a temporary database",
    "ended",
    "completed",
    now,
    now,
    now,
    "authoritative",
    now,
    now
  );

  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "codex", "jsonl", `/tmp/${sourceId}.jsonl`, "authoritative", now, now);

  db.prepare(
    `INSERT INTO session_sources (session_id, source_id, first_seen_at, last_seen_at, imported_record_count)
    VALUES (?, ?, ?, ?, ?)`
  ).run(id, sourceId, now, now, 3);

  // Meaningful user + assistant messages so transcript coverage is usable and quality precheck passes.
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${id}:message:user`,
    id,
    "user",
    "Walk the full Workbench ops loop: check transcript, accept quality, satisfy enrichment and dossier, then publish to Logbook.",
    `${id}:message:user-hash`,
    now,
    JSON.stringify({ source: "ops-dogfood", id: `${id}:message:user` }),
    "authoritative"
  );
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${id}:message:assistant`,
    id,
    "assistant",
    "Completed the Workbench ops dogfood against a temporary SQLite database and published the session.",
    `${id}:message:assistant-hash`,
    now,
    JSON.stringify({ source: "ops-dogfood", id: `${id}:message:assistant` }),
    "authoritative"
  );

  db.prepare(
    "INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(`${id}:file`, id, "scripts/dogfood-workbench-ops.js", "modified", now, "{}");

  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${id}:tool`,
    id,
    "node scripts/dogfood-workbench-ops.js",
    now,
    "{}"
  );
  db.prepare(
    `INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, output_redacted, source_ref_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`${id}:tool-result`, `${id}:tool`, id, "succeeded", now, "ok:true", "{}");

  db.prepare(
    "INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(`${id}:usage`, id, "gpt-5", "openai", now, "{}");
}
