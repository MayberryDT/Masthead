#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repoRoot, "dist/daemon/src/cli/mastheadctl.js");

if (!existsSync(cliPath)) {
  console.error("Missing built mastheadctl. Run npm run build:daemon first.");
  process.exit(1);
}

const { migrateDatabase } = await import("../dist/daemon/src/daemon/db/schema.js");
const { openMastheadDatabase } = await import("../dist/daemon/src/daemon/db/sqlite.js");

const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-v1-"));
try {
  const dbPath = join(tempDir, "masthead.sqlite");
  const enrichmentPath = join(tempDir, "enrichment.json");
  const dossierPath = join(tempDir, "dossier.json");
  const batchDir = join(tempDir, "batch-001");
  const sessionId = "session:dogfood";
  const db = await openMastheadDatabase(dbPath);
  migrateDatabase(db);
  seedSession(db, sessionId);
  db.close();

  await cli(["workbench", "status", "--db", dbPath, "--json"]);
  await cli(["workbench", "queue", "--kind", "session_enrichment", "--scope", "missing", "--limit", "5", "--db", dbPath, "--json"]);
  await cli(["workbench", "next", "--kind", "session_enrichment", "--scope", `session:${sessionId}`, "--db", dbPath, "--json"]);
  await cli(["workbench", "schema", "session_enrichment", "--json"]);
  await cli(["workbench", "evidence", "--kind", "session_enrichment", "--session", sessionId, "--db", dbPath, "--json"]);

  await writeFile(enrichmentPath, JSON.stringify(enrichmentOutput(sessionId)), "utf8");
  await cli(["workbench", "validate", "--kind", "session_enrichment", "--session", sessionId, "--file", enrichmentPath, "--db", dbPath, "--json"]);
  await cli(["workbench", "apply", "--kind", "session_enrichment", "--session", sessionId, "--file", enrichmentPath, "--db", dbPath, "--json"]);

  await writeFile(dossierPath, JSON.stringify(dossierOutput(sessionId)), "utf8");
  await cli(["workbench", "validate", "--kind", "session_dossier", "--session", sessionId, "--file", dossierPath, "--db", dbPath, "--json"]);
  await cli(["workbench", "apply", "--kind", "session_dossier", "--session", sessionId, "--file", dossierPath, "--db", dbPath, "--json"]);
  await cli(["workbench", "artifacts", "--session", sessionId, "--db", dbPath, "--json"]);

  await cli(["workbench", "batch", "prepare", "--kind", "session_enrichment", "--scope", `session:${sessionId}`, "--limit", "1", "--out", batchDir, "--db", dbPath, "--json"]);
  await writeFile(join(batchDir, "session-001", "output.json"), JSON.stringify(enrichmentOutput(sessionId, "Batch dogfood enrichment")), "utf8");
  await cli(["workbench", "batch", "apply", batchDir, "--db", dbPath, "--json"]);

  const verifyDb = await openMastheadDatabase(dbPath);
  const currentWorkbenchEnrichments = verifyDb
    .prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE session_id = ? AND provider = 'workbench_cli' AND status = 'current'")
    .get(sessionId).count;
  const currentArtifacts = verifyDb
    .prepare("SELECT COUNT(*) AS count FROM session_artifacts WHERE session_id = ? AND status = 'current'")
    .get(sessionId).count;
  verifyDb.close();

  if (currentWorkbenchEnrichments < 3) throw new Error(`Expected at least 3 current Workbench enrichment rows, found ${currentWorkbenchEnrichments}.`);
  if (currentArtifacts < 1) throw new Error(`Expected at least 1 current Workbench artifact, found ${currentArtifacts}.`);

  console.log(JSON.stringify({ ok: true, dbPath, currentWorkbenchEnrichments, currentArtifacts }, null, 2));
} finally {
  if (!process.env.MASTHEAD_KEEP_DOGFOOD_DB) await rm(tempDir, { force: true, recursive: true });
}

async function cli(args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd: repoRoot });
  if (stderr) throw new Error(stderr);
  return stdout ? JSON.parse(stdout) : undefined;
}

function seedSession(db, sessionId) {
  const now = "2026-07-07T12:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run("host:dogfood", "dogfood-host", now, now);
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run("runtime:dogfood", "opencode", "dogfood", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "host:dogfood", "runtime:dogfood", "source-dogfood", "Masthead", repoRoot, repoRoot, "main", "Workbench dogfood session", "Dogfood Workbench V1", "ended", "completed", now, now, now, "authoritative", now, now);
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(`${sessionId}:message`, sessionId, "user", "Dogfood the Workbench V1 CLI flow.", `${sessionId}:message-hash`, now, "{}", "authoritative");
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(`${sessionId}:file`, sessionId, "src/workbench/batch.ts", "modified", now, "{}");
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(`${sessionId}:tool`, sessionId, "npm test", now, "{}");
  db.prepare("INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, output_redacted, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`${sessionId}:tool-result`, `${sessionId}:tool`, sessionId, "succeeded", now, "Workbench focused tests passed.", "{}");
  db.prepare("INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(`${sessionId}:usage`, sessionId, "gpt-5", "openai", now, "{}");
}

function enrichmentOutput(sessionId, title = "Dogfood Workbench V1") {
  return {
    confidence: "medium",
    evidenceRefs: [`message:${sessionId}:message`, `tool_result:${sessionId}:tool-result`],
    missingEvidence: [],
    searchPhrases: ["workbench v1 dogfood", "cli workbench"],
    summary: "Dogfooded Workbench V1 with validation, apply, artifacts, and batch flow.",
    technologies: ["TypeScript", "SQLite"],
    title,
    topics: ["Workbench", "Masthead"]
  };
}

function dossierOutput(sessionId) {
  return {
    approach: ["Seeded a temporary canonical session", "Ran real mastheadctl workbench commands"],
    commandsAndTools: [{ label: "mastheadctl workbench apply", status: "passed" }],
    confidence: "medium",
    context: "Workbench V1 dogfood",
    evidenceRefs: [`message:${sessionId}:message`, `tool_result:${sessionId}:tool-result`],
    filesTouched: [{ label: "scripts/dogfood-workbench-v1.js", role: "dogfood script" }],
    keyDecisions: ["Keep Workbench writes in the CLI"],
    lessonsLearned: [],
    missingEvidence: [],
    outcome: "Workbench V1 dogfood completed against a temporary local database.",
    problemStatement: "V1 needs end-to-end evidence for CLI enrichment and artifacts.",
    risksOrGaps: [],
    title: "Dogfood Workbench V1 artifact",
    verification: ["node scripts/dogfood-workbench-v1.js"]
  };
}
