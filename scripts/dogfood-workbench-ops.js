#!/usr/bin/env node
/**
 * Prove the durable and operational invariants of daemon-owned authoring.
 * Never touches the developer database.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const requiredModules = [
  "dist/daemon/src/daemon/server.js",
  "dist/daemon/src/daemon/db/workbenchPipelineRepository.js",
  "dist/daemon/src/mcp/server.js"
];
const BODY_ONLY_PHRASE = "cobalt-orbit durable authoring sentinel";

for (const relativePath of requiredModules) {
  if (!existsSync(resolve(repoRoot, relativePath))) {
    console.error(`Missing built module ${relativePath}. Run npm run build:daemon first.`);
    process.exit(1);
  }
}

const { createMastheadDaemon } = await import("../dist/daemon/src/daemon/server.js");
const {
  markWorkbenchArtifactSatisfied,
  markWorkbenchQuality,
  markWorkbenchSessionEnrichmentSatisfied,
  markWorkbenchTranscriptStatus,
  publishWorkbenchSession,
  readWorkbenchSessionState,
  setWorkbenchArtifactApplicability
} = await import("../dist/daemon/src/daemon/db/workbenchPipelineRepository.js");

const actor = { kind: "agent", id: "dogfood-ops" };
const steps = [];
const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-ops-"));
let daemon;
let restartedDaemon;
let sessionId;

try {
  const databasePath = join(tempDir, "masthead.sqlite");
  const config = daemonConfig(databasePath);
  daemon = await createMastheadDaemon(config);
  const baseUrl = await listen(daemon);
  sessionId = "session:authoring-ops";
  const appliedSessionId = "session:authoring-applied-only";
  seedSession(daemon.database, sessionId, "Durable authoring operations");
  seedSession(daemon.database, appliedSessionId, "Applied optional artifact state");

  const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
  const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
    actorId: actor.id,
    databaseId: capabilities.databaseId,
    sessionIds: [sessionId]
  });
  const runId = opened.run?.runId;
  assert(typeof runId === "string", "authoring open did not return a run");
  steps.push({ name: "open", ok: true, runId, databaseId: opened.run.databaseId });

  const firstOpenCounts = authoringCounts(daemon.database, runId);
  const reopened = await postJson(baseUrl, "/workbench/authoring/runs", {
    actorId: actor.id,
    databaseId: capabilities.databaseId,
    sessionIds: [sessionId]
  });
  const secondOpenCounts = authoringCounts(daemon.database, runId);
  const openIdempotent = reopened.run?.runId === runId && sameCounts(firstOpenCounts, secondOpenCounts);
  assert(openIdempotent, "repeat open created another run or live claim");
  steps.push({ name: "open_idempotent", ok: true, counts: secondOpenCounts });

  const evidence = await getJson(
    baseUrl,
    `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence?sessionId=${encodeURIComponent(sessionId)}&order=asc&limit=50`
  );
  const outcomeRef = evidence.items.find((item) => item.role === "assistant")?.itemId;
  const verificationRef = evidence.items.find((item) => item.kind === "tool_result")?.itemId;
  assert(outcomeRef && verificationRef, "canonical outcome and verification evidence were not readable");

  const bundle = authoringBundle({
    evidenceRevision: opened.run.evidenceRevision,
    outcomeRef,
    runId,
    sessionId,
    verificationRef
  });
  const rowsBeforeSubmit = persistedOutputCounts(daemon.database);
  const submitted = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`, bundle);
  const rowsAfterSubmit = persistedOutputCounts(daemon.database);
  assert(submitted.accepted === true, `submission was rejected: ${JSON.stringify(submitted.findings)}`);
  assert(sameCounts(rowsBeforeSubmit, rowsAfterSubmit), "submit created artifact or enrichment rows");
  steps.push({ name: "submit_is_non_mutating", ok: true, counts: rowsAfterSubmit });

  proveAppliedIsNotResolved(daemon.database, appliedSessionId);
  steps.push({
    name: "applied_optional_not_resolved",
    ok: true,
    state: pickState(readWorkbenchSessionState(daemon.database, appliedSessionId))
  });

  const finished = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {});
  const receipt = finished.receipt;
  assert(receipt?.publishedArtifactIds?.length === 2, "finish did not create dossier and runbook");
  const created = daemon.database
    .prepare(
      `SELECT artifact_id AS artifactId, publication_status AS publicationStatus
       FROM session_artifacts
       WHERE created_by = ?
       ORDER BY artifact_id`
    )
    .all(`workbench_authoring:${actor.id}`);
  assert(created.length === receipt.publishedArtifactIds.length, "finish created artifacts outside its receipt");
  assert(created.every((artifact) => artifact.publicationStatus === "published"), "finish left an applied artifact unpublished");
  steps.push({ name: "finish_publishes_every_created_artifact", ok: true, artifactIds: receipt.publishedArtifactIds });

  for (const artifactId of receipt.publishedArtifactIds) {
    const detail = await getJson(baseUrl, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
    assert(detail.artifact?.capsule?.artifactId === artifactId, `receipt artifact ${artifactId} is missing from Logbook detail`);
    assert(detail.artifact?.publicationStatus === "published", `receipt artifact ${artifactId} is not published`);
  }
  steps.push({ name: "receipt_artifacts_visible", ok: true, visible: receipt.publishedArtifactIds.length });

  const bodySearch = await getJson(baseUrl, `/logbook/artifacts?q=${encodeURIComponent(BODY_ONLY_PHRASE)}&limit=10`);
  const runbookId = bodySearch.artifacts?.find((artifact) => artifact.kind === "runbook")?.artifactId;
  assert(receipt.publishedArtifactIds.includes(runbookId), "Logbook did not find a body-only phrase");
  steps.push({ name: "logbook_body_search", ok: true, artifactId: runbookId });

  const mcpSearch = searchArtifactsThroughMcp(databasePath, BODY_ONLY_PHRASE, runbookId);
  assert(mcpSearch.ok, `search_artifacts did not find the body-only phrase: ${mcpSearch.error ?? "unknown error"}`);
  steps.push({ name: "mcp_search_artifacts_body_only", ok: true, artifactId: runbookId });

  const beforeRestart = durableCounts(daemon.database, runId);
  await daemon.close();
  daemon = undefined;
  restartedDaemon = await createMastheadDaemon(config);
  const restartedBaseUrl = await listen(restartedDaemon);
  const afterRestart = durableCounts(restartedDaemon.database, runId);
  assert(beforeRestart.completedRuns === 1 && afterRestart.completedRuns === 1, "restart did not preserve exactly one completed run receipt");
  assert(beforeRestart.lineages === beforeRestart.currentLineages, "finish produced multiple current artifacts per lineage");
  assert(sameCounts(beforeRestart, afterRestart), "restart changed authoring run or lineage counts");

  const restartedStatus = await getJson(restartedBaseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}`);
  const restartedRetry = await postJson(
    restartedBaseUrl,
    `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`,
    {}
  );
  assert(restartedStatus.run?.status === "completed", "completed run status did not survive restart");
  assert(JSON.stringify(restartedRetry.receipt) === JSON.stringify(receipt), "finish retry after restart returned a different receipt");
  for (const artifactId of receipt.publishedArtifactIds) {
    await getJson(restartedBaseUrl, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
  }
  steps.push({ name: "restart_persistence", ok: true, before: beforeRestart, after: afterRestart });

  const failedSteps = steps.filter((step) => !step.ok);
  assert(failedSteps.length === 0, `failed steps: ${failedSteps.map((step) => step.name).join(", ")}`);
  console.log(JSON.stringify({ ok: true, sessionId, runId, receipt, steps }, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      { ok: false, sessionId, steps, error: error instanceof Error ? error.message : String(error) },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  if (daemon) await daemon.close();
  if (restartedDaemon) await restartedDaemon.close();
  if (!process.env.MASTHEAD_KEEP_DOGFOOD_DB) await rm(tempDir, { force: true, recursive: true });
}

function daemonConfig(databasePath) {
  return {
    allowedOrigins: ["http://127.0.0.1:5180"],
    codexHomeDir: join(tempDir, "codex-home"),
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "legacy", "events.ndjson")
  };
}

function listen(instance) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    instance.server.once("error", onError);
    instance.server.listen(0, "127.0.0.1", () => {
      instance.server.off("error", onError);
      const address = instance.server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function searchArtifactsThroughMcp(databasePath, query, artifactId) {
  try {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_artifacts", arguments: { query, limit: 10 } }
    };
    const child = spawnSync(process.execPath, [resolve(repoRoot, "dist/daemon/src/mcp/server.js")], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
      input: `${JSON.stringify(request)}\n`,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15_000
    });
    if (child.error || child.status !== 0) {
      const reason = child.error?.message
        ?? (child.signal === "SIGTERM" ? "MCP probe timed out" : undefined)
        ?? child.stderr
        ?? `MCP exited ${child.status}`;
      throw new Error(reason);
    }
    const reply = JSON.parse(child.stdout.trim());
    const result = JSON.parse(reply.result?.content?.[0]?.text ?? "{}");
    return { ok: result.artifacts?.some((artifact) => artifact.artifactId === artifactId) === true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  }
}

function proveAppliedIsNotResolved(db, appliedSessionId) {
  markWorkbenchTranscriptStatus(db, {
    actor,
    eventType: "dogfood_transcript_available",
    sessionId: appliedSessionId,
    status: "available",
    summary: "Dogfood transcript available"
  });
  markWorkbenchQuality(db, { actor, sessionId: appliedSessionId, status: "passed" });
  markWorkbenchSessionEnrichmentSatisfied(db, { actor, sessionId: appliedSessionId });
  markWorkbenchArtifactSatisfied(db, { actor, artifactKind: "session_dossier", sessionId: appliedSessionId });
  setWorkbenchArtifactApplicability(db, {
    actor,
    artifactKind: "adr",
    reason: "Applied-status dogfood has no durable architecture decision.",
    sessionId: appliedSessionId,
    status: "not_applicable"
  });
  setWorkbenchArtifactApplicability(db, {
    actor,
    artifactKind: "incident_timeline",
    reason: "Applied-status dogfood has no incident timeline.",
    sessionId: appliedSessionId,
    status: "not_applicable"
  });
  const published = publishWorkbenchSession(db, { actor, sessionId: appliedSessionId });
  assert(published.ok, "applied-status session package did not publish");
  const applied = markWorkbenchArtifactSatisfied(db, {
    actor,
    artifactKind: "runbook",
    sessionId: appliedSessionId
  });
  assert(applied.state.runbookStatus === "applied", "runbook did not reach applied status");
  assert(applied.state.resolutionStatus === "compile_ready", "applied runbook incorrectly counted as automatic resolution");
}

function authoringBundle({ evidenceRevision, outcomeRef, runId, sessionId, verificationRef }) {
  const refs = [outcomeRef, verificationRef];
  return {
    artifacts: [
      {
        kind: "runbook",
        output: {
          changedFiles: ["scripts/dogfood-workbench-ops.js"],
          claimEvidence: [
            { evidenceRefs: [outcomeRef], path: "fixSteps[0]" },
            { evidenceRefs: [outcomeRef], path: "rootCause" },
            { evidenceRefs: [verificationRef], path: "validationChecks[0]" }
          ],
          commands: ["node scripts/dogfood-workbench-ops.js"],
          confidence: "high",
          deadEnds: [],
          environmentRequirements: ["A temporary Masthead daemon"],
          evidenceRefs: refs,
          fixSteps: ["Submit without output writes, then finish every output in one transaction."],
          missingEvidence: [],
          preconditions: ["A grounded bundle is ready to finish."],
          preventionNotes: [`Keep the ${BODY_ONLY_PHRASE} indexed across daemon restarts.`],
          problemSignature: {
            affectedScope: "Durable authoring publication",
            errorStrings: ["authoring_finish_visibility_failed"],
            symptoms: ["A receipt or current artifact disappears after restart"]
          },
          provenanceSessionIds: [sessionId],
          reproSteps: ["Finish a bundle, restart the daemon, and query the same run and artifact lineages."],
          risksOrGaps: [],
          rootCause: "Durable acceptance requires the receipt and all current artifact lineages to commit together.",
          signatureKey: "durable-authoring-ops",
          title: "Preserve atomic authoring receipts",
          validationChecks: ["The passed tool result verifies one durable receipt and one current artifact per lineage."]
        },
        provenanceSessionIds: [sessionId],
        seedSessionId: sessionId
      }
    ],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: [
      {
        evidenceRefs: [outcomeRef],
        kind: "adr",
        reason: "The reviewed operations evidence does not record a durable architecture decision.",
        sessionId
      },
      {
        evidenceRefs: [outcomeRef],
        kind: "incident_timeline",
        reason: "The reviewed operations evidence does not describe a production incident timeline.",
        sessionId
      }
    ],
    runId,
    sessionPackages: [
      {
        dossier: {
          approach: ["Submitted a grounded bundle", "Finished it atomically", "Restarted the daemon"],
          claimEvidence: [
            { evidenceRefs: [outcomeRef], path: "keyDecisions[0]" },
            { evidenceRefs: refs, path: "outcome" },
            { evidenceRefs: [verificationRef], path: "verification[0]" }
          ],
          commandsAndTools: [{ label: "authoring HTTP API", purpose: "Exercise durable operations", status: "passed" }],
          confidence: "high",
          context: "A temporary daemon isolates durability checks from developer data.",
          evidenceRefs: refs,
          filesTouched: [{ label: "scripts/dogfood-workbench-ops.js", role: "operations acceptance" }],
          keyDecisions: ["Treat applied optional artifacts as compile-ready until publication."],
          lessonsLearned: ["Restart verification must inspect both receipts and artifact lineages."],
          missingEvidence: [],
          outcome: "One submission produced no outputs; one finish published every created artifact and one durable receipt.",
          problemStatement: "Prove atomic and restart-safe daemon-owned authoring operations.",
          risksOrGaps: [],
          title: "Durable authoring operations dossier",
          verification: ["The passed tool result verifies durable artifact reuse after restart."]
        },
        enrichment: {
          claimEvidence: [{ evidenceRefs: refs, path: "outcome" }],
          confidence: "high",
          evidenceRefs: refs,
          missingEvidence: [],
          outcome: "The daemon preserved one completion receipt and one current artifact per lineage.",
          searchPhrases: ["durable authoring receipt", "atomic artifact publication"],
          summary: "The operations dogfood proves non-mutating submission, atomic publication, idempotent retry, and restart-safe artifact reuse.",
          technologies: ["TypeScript", "SQLite", "HTTP"],
          title: "Prove durable authoring operations",
          topics: ["Workbench", "durability", "Logbook"]
        },
        sessionId
      }
    ]
  };
}

function seedSession(db, sessionId, title) {
  const now = "2026-07-10T16:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:authoring-ops",
    "authoring-ops-host",
    now,
    now
  );
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run("runtime:authoring-ops", "codex", "dogfood", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    "host:authoring-ops",
    "runtime:authoring-ops",
    `source:${sessionId}`,
    "Masthead",
    repoRoot,
    repoRoot,
    "main",
    title,
    "Prove daemon-owned authoring operations",
    "ended",
    "completed",
    now,
    now,
    now,
    "authoritative",
    now,
    now
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertMessage.run(
    `${sessionId}:message-user`,
    sessionId,
    "user",
    "Prove non-mutating submit, atomic finish, and restart-safe artifact reuse.",
    `${sessionId}:message-user-hash`,
    now,
    "{}",
    "authoritative"
  );
  insertMessage.run(
    `${sessionId}:message-assistant`,
    sessionId,
    "assistant",
    "Completed daemon-owned authoring operations with a durable receipt and published artifacts.",
    `${sessionId}:message-assistant-hash`,
    "2026-07-10T16:00:01.000Z",
    "{}",
    "authoritative"
  );
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${sessionId}:tool-call`,
    sessionId,
    "node scripts/dogfood-workbench-ops.js",
    "2026-07-10T16:00:02.000Z",
    "{}"
  );
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, exit_code, completed_at, output_redacted, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:tool-result`,
    `${sessionId}:tool-call`,
    sessionId,
    "succeeded",
    0,
    "2026-07-10T16:00:03.000Z",
    "Durable authoring operations passed.",
    "{}"
  );
}

function persistedOutputCounts(db) {
  return {
    artifacts: countRows(db, "session_artifacts"),
    enrichments: countRows(db, "session_enrichments")
  };
}

function authoringCounts(db, runId) {
  return {
    activeClaims: db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM workbench_claims
         WHERE released_at IS NULL AND session_id IN (
           SELECT session_id FROM workbench_authoring_run_sessions WHERE run_id = ?
         )`
      )
      .get(runId).count,
    runs: db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs WHERE run_id = ?").get(runId).count
  };
}

function durableCounts(db, runId) {
  const lineages = db
    .prepare(
      `SELECT lineage_id AS lineageId,
        SUM(CASE WHEN status = 'current' THEN 1 ELSE 0 END) AS currentArtifacts
       FROM session_artifacts
       WHERE created_by = ?
       GROUP BY lineage_id`
    )
    .all(`workbench_authoring:${actor.id}`);
  return {
    completedRuns: db
      .prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs WHERE run_id = ? AND status = 'completed' AND receipt_json IS NOT NULL")
      .get(runId).count,
    currentLineages: lineages.filter((lineage) => lineage.currentArtifacts === 1).length,
    lineages: lineages.length,
    publishedArtifacts: db
      .prepare("SELECT COUNT(*) AS count FROM session_artifacts WHERE created_by = ? AND status = 'current' AND publication_status = 'published'")
      .get(`workbench_authoring:${actor.id}`).count
  };
}

function pickState(state) {
  return {
    publicationStatus: state?.publicationStatus,
    runbookStatus: state?.runbookStatus,
    resolutionStatus: state?.resolutionStatus,
    sessionPackageStatus: state?.sessionPackageStatus
  };
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function sameCounts(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
