#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let id = 0;
let ownedTempDir;
let databasePath = process.env.MASTHEAD_DB_PATH;
let mcp;

try {
  if (!databasePath) {
    const seeded = await createSmokeDatabase();
    databasePath = seeded.databasePath;
    ownedTempDir = seeded.tempDir;
  }

  mcp = spawn(process.execPath, ["dist/daemon/src/mcp/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const initialized = await rpc(mcp, "initialize", {});
  assert(initialized.result?.serverInfo?.name === "masthead", "initialize failed");
  const tools = await rpc(mcp, "tools/list", {});
  const toolNames = tools.result.tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(toolNames) === JSON.stringify([
    "get_artifact",
    "get_corpus_stats",
    "get_evidence_excerpt",
    "get_evidence_transcript",
    "get_knowledge",
    "get_masthead_coverage",
    "get_project_history",
    "get_provenance",
    "get_session",
    "get_session_excerpt",
    "get_session_transcript",
    "list_knowledge",
    "list_project_sessions",
    "search_artifacts",
    "search_knowledge",
    "search_sessions"
  ]), `unexpected MCP tools: ${toolNames.join(", ")}`);
  assert(toolNames.every((name) => !/write|delete|clear|import|install|uninstall|approve|run|execute/i.test(name)), "MCP exposed a write-capable tool name");

  const knowledgeSearch = await callTool(mcp, "search_knowledge", { query: "MCP smoke", limit: 5 });
  assert(knowledgeSearch.artifacts.length === 1, "MCP knowledge search returned no published dossier");
  const knowledge = await callTool(mcp, "get_knowledge", { artifactId: knowledgeSearch.artifacts[0].artifactId });
  assert(knowledge.artifact?.artifactId === knowledgeSearch.artifacts[0].artifactId, "MCP knowledge detail missing stable artifactId");
  assert(knowledge.artifact?.provenanceSessionIds?.length === 1, "MCP knowledge detail missing session provenance");

  const artifactSearch = await callTool(mcp, "search_artifacts", { query: "MCP smoke", limit: 5 });
  assert(artifactSearch.artifacts.length === 1, "MCP artifact search returned no published dossier");
  const artifact = await callTool(mcp, "get_artifact", { artifactId: artifactSearch.artifacts[0].artifactId });
  assert(artifact.artifact?.artifactId === artifactSearch.artifacts[0].artifactId, "MCP artifact detail missing stable artifactId");
  assert(artifact.artifact?.provenanceSessionIds?.length === 1, "MCP artifact detail missing session provenance");

  const search = await callTool(mcp, "search_sessions", { query: "MCP smoke", limit: 5 });
  assert(search.sessions.length > 0, "MCP search returned no sessions");
  assert(search.sessions[0].sourceRefs?.length > 0, "MCP search missing source refs");
  const sessionId = search.sessions[0].sessionId;
  const project = search.sessions[0].project || "Masthead";

  const session = await callTool(mcp, "get_session", { sessionId, maxBytes: 4_000 });
  assert(session.sourceRefs?.length > 0, "MCP session missing source refs");
  assert(JSON.stringify(session).includes("Historical untrusted"), "MCP session missing historical-untrusted label");

  const excerpt = await callTool(mcp, "get_session_excerpt", { sessionId, query: "MCP smoke", maxBytes: 512 });
  assert(excerpt.sourceRefs?.length > 0, "MCP excerpt missing source refs");
  assert(Buffer.byteLength(excerpt.text, "utf8") <= 512 + 128, "MCP excerpt exceeded response bound");
  assert(excerpt.text.includes("Historical untrusted"), "MCP excerpt missing historical-untrusted label");

  const transcript = await callTool(mcp, "get_session_transcript", { sessionId, limit: 10, maxBytes: 512 });
  assert(transcript.items.length >= 2, "MCP transcript returned no canonical conversation");
  assert(transcript.sourceRefs.length >= 2, "MCP transcript missing source refs");

  const projectSessions = await callTool(mcp, "list_project_sessions", { project, limit: 5 });
  assert(projectSessions.sessions.length > 0, "MCP project session list returned no sessions");

  const history = await callTool(mcp, "get_project_history", { project, limit: 5 });
  assert(history.sessions.length > 0, "MCP project history returned no sessions");

  const coverage = await callTool(mcp, "get_masthead_coverage", {});
  assert(coverage.sessions >= search.sessions.length, "MCP coverage did not include imported sessions");
  const stats = await callTool(mcp, "get_corpus_stats", {});
  assert(stats.publishedArtifacts >= 1, "MCP corpus stats missing published artifacts");

  assert(dbCount(databasePath, "mcp_query_log") >= 11, "MCP query audit log was not written");

  const output = { ok: true, databasePath, tools: toolNames, auditRows: dbCount(databasePath, "mcp_query_log") };
  if (process.argv.includes("--json")) console.log(JSON.stringify(output, null, 2));
  else console.log(`Masthead MCP smoke passed. DB: ${databasePath}`);
} finally {
  if (mcp) await stopProcess(mcp);
  if (ownedTempDir && process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") await rm(ownedTempDir, { force: true, recursive: true });
}

async function createSmokeDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-smoke-"));
  const databasePath = join(tempDir, "masthead.sqlite");
  try {
    const { migrateDatabase } = await import("../dist/daemon/src/daemon/db/schema.js");
    const { openMastheadDatabase } = await import("../dist/daemon/src/daemon/db/sqlite.js");
    const { upsertSessionEnrichment } = await import("../dist/daemon/src/daemon/db/enrichmentRepository.js");
    const { indexCanonicalSessionSearch } = await import("../dist/daemon/src/daemon/db/searchRepository.js");
    const { applySessionArtifact } = await import("../dist/daemon/src/daemon/db/sessionArtifactRepository.js");
    const { markWorkbenchPublished } = await import("../dist/daemon/src/daemon/db/workbenchPipelineRepository.js");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    const sessionId = "session:mcp-smoke";
    const sourceId = "source:mcp-smoke";
    const now = "2026-07-09T12:00:00.000Z";
    db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run("host:mcp-smoke", "mcp-smoke-host", now, now);
    db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run("runtime:mcp-smoke", "opencode", "smoke", now, now);
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
        branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
        source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, "host:mcp-smoke", "runtime:mcp-smoke", "mcp-smoke-source-session", "Masthead", "/workspace/masthead", "/workspace/masthead", "main", "MCP smoke published session", "Verify artifact-first MCP", "ended", "completed", now, now, now, "authoritative", now, now);
    db.prepare(
      `INSERT INTO ingest_sources (source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sourceId, "opencode", "jsonl", "/tmp/mcp-smoke.jsonl", "authoritative", now, now);
    db.prepare(
      `INSERT INTO session_sources (session_id, source_id, first_seen_at, last_seen_at, imported_record_count)
       VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId, sourceId, now, now, 2);
    db.prepare(
      `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("message:mcp-smoke:user", sessionId, "user", "Verify the MCP smoke artifact path.", "hash:mcp-smoke:user", now, JSON.stringify({ sourceId, sourceRecordKey: "mcp-smoke:1" }), "authoritative");
    db.prepare(
      `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("message:mcp-smoke:assistant", sessionId, "assistant", "The MCP smoke dossier was published successfully.", "hash:mcp-smoke:assistant", now, JSON.stringify({ sourceId, sourceRecordKey: "mcp-smoke:2" }), "authoritative");
    db.prepare("INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run("usage:mcp-smoke", sessionId, "gpt-5", "openai", now, "{}");
    db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run("file:mcp-smoke", sessionId, "scripts/masthead-mcp-smoke.js", "modified", now, "{}");
    db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run("tool:mcp-smoke", sessionId, "npm run smoke:mcp", now, "{}");
    db.prepare("INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, output_redacted, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run("tool-result:mcp-smoke", "tool:mcp-smoke", sessionId, "succeeded", now, "MCP smoke passed", "{}");
    upsertSessionEnrichment(db, {
      content: { objective: "Verify artifact-first MCP", searchPhrases: ["MCP smoke"], technologies: ["SQLite"], title: "MCP smoke published session", topics: ["MCP"] },
      contentFingerprint: "mcp-smoke-enrichment-v1",
      enrichmentKind: "session_capsule",
      generatedAt: now,
      promptVersion: "session-capsule-v4",
      provider: "smoke",
      sessionId,
      sourceRefs: ["message:mcp-smoke:user", "message:mcp-smoke:assistant"],
      status: "current"
    });
    indexCanonicalSessionSearch(db, sessionId);
    applySessionArtifact(db, {
      artifactKind: "session_dossier",
      confidence: "high",
      content: { outcome: "Artifact-first MCP smoke passed.", verification: ["npm run smoke:mcp"] },
      contentFingerprint: "mcp-smoke-dossier-v1",
      createdBy: "masthead-mcp-smoke",
      evidenceRefs: ["message:mcp-smoke:user", "message:mcp-smoke:assistant"],
      highlight: "Published dossier is available through read-only MCP.",
      projectLabel: "Masthead",
      schemaVersion: "session-dossier-v1",
      sessionId,
      summary: "Verifies published artifact retrieval and bounded session evidence.",
      title: "MCP smoke dossier",
      validation: { valid: true }
    });
    markWorkbenchPublished(db, { actor: { kind: "system", id: "mcp-smoke" }, publishedVia: "mcp_smoke", sessionId });
    db.close();
    return { databasePath, tempDir };
  } catch (error) {
    await rm(tempDir, { force: true, recursive: true });
    throw error;
  }
}

function rpc(process, method, params) {
  return sendLine(process, { jsonrpc: "2.0", id: nextId(), method, params });
}

async function callTool(process, name, args) {
  const response = await rpc(process, "tools/call", { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  assert(typeof text === "string", `${name} returned no text content`);
  return JSON.parse(text);
}

function nextId() {
  id += 1;
  return id;
}

function sendLine(process, payload) {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => settle(reject, new Error(`MCP timeout waiting for ${payload.method}; stderr=${stderr}`)), 8_000);
    const cleanup = () => {
      clearTimeout(timeout);
      process.stdout.off("data", onStdout);
      process.stderr.off("data", onStderr);
      process.off("error", onError);
      process.off("exit", onExit);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onStdout = (chunk) => {
      output += chunk.toString();
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      const line = output.slice(0, newline).trim();
      if (!line) {
        output = output.slice(newline + 1);
        return;
      }
      try {
        settle(resolve, JSON.parse(line));
      } catch (error) {
        settle(reject, error);
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => settle(reject, error);
    const onExit = (code) => settle(reject, new Error(`MCP server exited ${code}; stderr=${stderr}`));
    process.stdout.on("data", onStdout);
    process.stderr.on("data", onStderr);
    process.on("error", onError);
    process.on("exit", onExit);
    process.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function dbCount(databasePath, table) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (process.exitCode === null) process.kill("SIGKILL");
      resolve();
    }, 2_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
