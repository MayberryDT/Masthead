#!/usr/bin/env node
/**
 * Dogfood the complete Workbench human-ops publish loop against a temporary SQLite DB.
 * Never touches the real dev database.
 *
 * Pipeline: enroll missing (idempotent catch-up) → check transcript → quality pass →
 * enrichment + dossier applied → runbook not_applicable → publish →
 * assert Logbook-visible published artifact state.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const requiredModules = [
  "dist/daemon/src/daemon/db/sessionArtifactRepository.js",
  "dist/daemon/src/daemon/db/workbenchPipelineRepository.js",
  "dist/daemon/src/daemon/server.js",
  "dist/daemon/src/workbench/transcriptWorkflow.js",
  "dist/daemon/src/workbench/qualityPrecheck.js"
];

for (const relativePath of requiredModules) {
  if (!existsSync(resolve(repoRoot, relativePath))) {
    console.error(`Missing built module ${relativePath}. Run npm run build:daemon first.`);
    process.exit(1);
  }
}

const { applySessionArtifact } = await import("../dist/daemon/src/daemon/db/sessionArtifactRepository.js");
const {
  enrollMissingWorkbenchSessions,
  markWorkbenchQuality,
  markWorkbenchSessionEnrichmentSatisfied,
  markWorkbenchArtifactSatisfied,
  setWorkbenchArtifactApplicability,
  publishWorkbenchSession,
  readWorkbenchSessionState
} = await import("../dist/daemon/src/daemon/db/workbenchPipelineRepository.js");
const { checkWorkbenchTranscript } = await import("../dist/daemon/src/workbench/transcriptWorkflow.js");
const { runCaptureQualityPrecheck } = await import("../dist/daemon/src/workbench/qualityPrecheck.js");
const { createMastheadDaemon } = await import("../dist/daemon/src/daemon/server.js");

const actor = { kind: "agent", id: "dogfood-ops" };
const steps = [];
const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-ops-"));
let daemon;
let restartedDaemon;
let sessionId;

try {
  const dbPath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const config = daemonConfig(dbPath, storePath);
  daemon = await createMastheadDaemon(config);
  const baseUrl = await listen(daemon);
  const sourceSessionId = "source-session-ops-dogfood";
  const accepted = await postJson(baseUrl, "/ingest?runtime=opencode", livePayload(sourceSessionId));
  const projection = await getJson(baseUrl, `/projection?expandedSessionId=${encodeURIComponent(sourceSessionId)}`);
  const liveCard = projection.projection?.cards?.find((card) => card.sourceSessionId === sourceSessionId);
  sessionId = liveCard?.canonicalSessionId;
  if (accepted.status !== "accepted" || !sessionId) throw new Error("Live source did not reach the Now projection with canonical identity");
  steps.push({
    name: "live_source_to_now",
    ok: true,
    ingestStatus: accepted.status,
    runtime: liveCard.runtime,
    canonicalSessionId: sessionId
  });

  const db = daemon.database;
  seedSessionEvidence(db, sessionId);
  // Second session stays unenrolled until bulk enroll; proves catch-up only.
  seedSession(db, "session:ops-dogfood-missing", {
    title: "Workbench ops dogfood missing session",
    objective: "Prove enroll-missing catch-up on a temporary database"
  });

  // 0. Enroll missing — the live session is already enrolled, so only the seeded catch-up session should enroll.
  const enrollFirst = enrollMissingWorkbenchSessions(db, { actor, limit: 500 });
  steps.push({
    name: "enroll_missing",
    ok: enrollFirst.enrolled === 1 && enrollFirst.enrolledSessionIds.includes("session:ops-dogfood-missing"),
    enrolled: enrollFirst.enrolled,
    skippedExisting: enrollFirst.skippedExisting,
    enrolledSessionIds: enrollFirst.enrolledSessionIds
  });
  if (enrollFirst.enrolled !== 1) {
    throw new Error(`Expected enroll_missing enrolled=1, got ${JSON.stringify(enrollFirst)}`);
  }
  const enrolledState = readWorkbenchSessionState(db, sessionId);
  if (!enrolledState || enrolledState.publicationStatus !== "publish_path") {
    throw new Error(
      `Expected publish_path after enroll, got ${enrolledState?.publicationStatus ?? "missing"}`
    );
  }

  // 0b. Second enroll is a no-op (idempotent).
  const enrollSecond = enrollMissingWorkbenchSessions(db, { actor, limit: 500 });
  steps.push({
    name: "enroll_missing_idempotent",
    ok: enrollSecond.enrolled === 0 && enrollSecond.skippedExisting === 2,
    enrolled: enrollSecond.enrolled,
    skippedExisting: enrollSecond.skippedExisting
  });
  if (enrollSecond.enrolled !== 0) {
    throw new Error(`Expected second enroll enrolled=0, got ${JSON.stringify(enrollSecond)}`);
  }

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

  // 3. Mark enrichment satisfied, apply a real dossier, and mark runbook not applicable.
  const enrichment = markWorkbenchSessionEnrichmentSatisfied(db, { actor, sessionId });
  steps.push({
    name: "session_enrichment_satisfied",
    ok: enrichment.state.sessionEnrichmentStatus === "satisfied",
    sessionEnrichmentStatus: enrichment.state.sessionEnrichmentStatus
  });

  const dossierArtifact = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    confidence: "high",
    content: {
      outcome: "Workbench ops dogfood completed against a temporary SQLite database.",
      verification: ["node scripts/dogfood-workbench-ops.js"]
    },
    contentFingerprint: "workbench-ops-dogfood-dossier-v1",
    createdBy: "dogfood-ops",
    evidenceRefs: [`${sessionId}:message:user`, `${sessionId}:message:assistant`],
    highlight: "Completed the full Workbench publish path.",
    projectLabel: "Masthead",
    schemaVersion: "session-dossier-v1",
    sessionId,
    summary: "Verifies Workbench gates, artifact publication, and Logbook visibility.",
    title: "Workbench ops dogfood dossier",
    validation: { valid: true }
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

  const runbook = setWorkbenchArtifactApplicability(db, {
    actor,
    artifactKind: "runbook",
    reason: "ops_dogfood_no_runbook_evidence",
    sessionId,
    status: "not_applicable"
  });
  steps.push({
    name: "runbook_not_applicable",
    ok: runbook.state.runbookStatus === "not_applicable",
    runbookStatus: runbook.state.runbookStatus
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

  // 5. Logbook-visible through the product API, not merely a published session flag.
  const logbook = await getJson(baseUrl, "/logbook/artifacts?q=Workbench%20ops%20dogfood&limit=10");
  const logbookArtifact = logbook.artifacts?.find((artifact) => artifact.artifactId === dossierArtifact.artifactId);
  const detail = await getJson(baseUrl, `/logbook/artifacts/${encodeURIComponent(dossierArtifact.artifactId)}`);
  const logbookVisible = Boolean(logbookArtifact && detail.artifact?.provenanceSessionIds?.includes(sessionId));
  steps.push({
    name: "published_artifact_visible",
    ok: logbookVisible,
    artifactId: dossierArtifact.artifactId,
    publicationStatus: logbookArtifact ? "published" : "missing"
  });
  if (!logbookVisible) throw new Error("Published dossier was not visible in artifact-first Logbook");

  // 6. Restart the daemon and prove the canonical session and published artifact remain singular.
  const beforeRestart = persistenceCounts(db);
  await daemon.close();
  daemon = undefined;
  restartedDaemon = await createMastheadDaemon(config);
  const restartedBaseUrl = await listen(restartedDaemon);
  const afterRestart = persistenceCounts(restartedDaemon.database);
  const restartedLogbook = await getJson(restartedBaseUrl, "/logbook/artifacts?q=Workbench%20ops%20dogfood&limit=10");
  const restartStable =
    afterRestart.sessions === beforeRestart.sessions &&
    afterRestart.publishedArtifacts === beforeRestart.publishedArtifacts &&
    restartedLogbook.artifacts?.some((artifact) => artifact.artifactId === dossierArtifact.artifactId);
  steps.push({
    name: "restart_persistence",
    ok: Boolean(restartStable),
    before: beforeRestart,
    after: afterRestart
  });
  if (!restartStable) throw new Error("Daemon restart changed session or published artifact counts");

  // 7. Read the same published artifact through the real MCP stdio protocol.
  const mcp = verifyArtifactThroughMcp(dbPath, dossierArtifact.artifactId);
  steps.push({ name: "artifact_primary_mcp", ok: mcp.ok, searchResults: mcp.searchResults, artifactRead: mcp.artifactRead });
  if (!mcp.ok) throw new Error("Artifact-primary MCP did not return the published dossier");

  const failedSteps = steps.filter((step) => !step.ok);
  if (failedSteps.length > 0) throw new Error(`Dogfood receipt contains failed steps: ${failedSteps.map((step) => step.name).join(", ")}`);

  const receipt = { ok: true, sessionId, steps, dbPath };
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, sessionId, steps, error: message }, null, 2));
  process.exitCode = 1;
} finally {
  if (daemon) await daemon.close();
  if (restartedDaemon) await restartedDaemon.close();
  if (!process.env.MASTHEAD_KEEP_DOGFOOD_DB) {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function daemonConfig(databasePath, storePath) {
  return {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath
  };
}

function livePayload(sourceSessionId) {
  return {
    content: "Start the Workbench golden-path dogfood.",
    directory: repoRoot,
    project: "Masthead",
    repo_root: repoRoot,
    sessionID: sourceSessionId,
    summary: "Workbench golden-path dogfood",
    time: "2026-07-09T12:00:00.000Z",
    timestamp: "2026-07-09T12:00:00.000Z",
    title: "Workbench ops dogfood session",
    type: "session.created"
  };
}

function listen(instance) {
  return new Promise((resolve) => {
    instance.server.listen(0, "127.0.0.1", () => {
      const address = instance.server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function persistenceCounts(db) {
  return {
    publishedArtifacts: db
      .prepare("SELECT COUNT(*) AS count FROM session_artifacts WHERE publication_status = 'published' AND status = 'current'")
      .get().count,
    sessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count
  };
}

function verifyArtifactThroughMcp(databasePath, artifactId) {
  try {
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_artifacts", arguments: { query: "Workbench ops dogfood", limit: 5 } }
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_artifact", arguments: { artifactId } }
      }
    ];
    const child = spawnSync(process.execPath, ["dist/daemon/src/mcp/server.js"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`
    });
    if (child.status !== 0) throw new Error(child.stderr || `MCP exited ${child.status}`);
    const replies = child.stdout.trim().split(/\n/).map((line) => JSON.parse(line));
    const search = JSON.parse(replies[0]?.result?.content?.[0]?.text ?? "{}");
    const detail = JSON.parse(replies[1]?.result?.content?.[0]?.text ?? "{}");
    const artifactRead = detail.artifact?.capsule?.artifactId === artifactId;
    return { artifactRead, ok: search.total === 1 && artifactRead, searchResults: search.total ?? 0 };
  } catch (error) {
    return { artifactRead: false, error: error instanceof Error ? error.message : String(error), ok: false, searchResults: 0 };
  }
}

function seedSession(db, id, overrides = {}) {
  const now = "2026-07-08T16:00:00.000Z";
  const sourceId = `source:${id}`;
  const hostId = "host:ops-dogfood";
  const runtimeId = "runtime:ops-dogfood";
  const title = overrides.title ?? "Workbench ops dogfood session";
  const objective =
    overrides.objective ?? "Prove check → quality → enrich → publish on a temporary database";

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
    `source-session-${id}`,
    "Masthead",
    repoRoot,
    repoRoot,
    "main",
    title,
    objective,
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

  seedSessionEvidence(db, id, now);
}

function seedSessionEvidence(db, id, now = "2026-07-08T16:00:00.000Z") {
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
