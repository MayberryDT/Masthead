#!/usr/bin/env node
/**
 * Thorough real-world MCP scenarios against production Masthead data (stdio JSON-RPC).
 *
 * Usage:
 *   node scripts/masthead-production-mcp-scenarios.mjs
 *   MASTHEAD_MCP_NODE=... MASTHEAD_MCP_SERVER=... node scripts/masthead-production-mcp-scenarios.mjs
 *
 * Defaults: resolve node + server from ~/.local/share/masthead-production/current
 * and data/db from ~/.config/masthead-production.
 */
import { spawn } from "node:child_process";
import { realpath, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = process.env.HOME || homedir();
const PRODUCTION_ROOT = process.env.MASTHEAD_PRODUCTION_ROOT || join(HOME, ".local/share/masthead-production");
const DATA_DIR = process.env.MASTHEAD_DATA_DIR || join(HOME, ".config/masthead-production");
const DB_PATH = process.env.MASTHEAD_DB_PATH || join(DATA_DIR, "masthead.sqlite");
const REPORT_PATH = process.env.MASTHEAD_MCP_REPORT || "/tmp/masthead-production-mcp-scenarios-report.json";
const RPC_TIMEOUT_MS = Number(process.env.MASTHEAD_MCP_RPC_TIMEOUT_MS || 180_000);

const EXPECTED_TOOLS = [
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
].sort();

let id = 0;
const report = {
  startedAt: new Date().toISOString(),
  config: {},
  scenarios: [],
  summary: { passed: 0, failed: 0, warnings: 0 }
};

function log(msg) {
  console.log(msg);
}

function record(scenario) {
  report.scenarios.push(scenario);
  if (scenario.status === "pass") report.summary.passed += 1;
  else if (scenario.status === "fail") report.summary.failed += 1;
  else report.summary.warnings += 1;
  const icon = scenario.status === "pass" ? "PASS" : scenario.status === "fail" ? "FAIL" : "WARN";
  log(`[${icon}] ${scenario.name}${scenario.detail ? ` — ${scenario.detail}` : ""}`);
}

async function resolvePaths() {
  const current = join(PRODUCTION_ROOT, "current");
  const target = process.env.MASTHEAD_MCP_BUNDLE || (await realpath(current));
  const node = process.env.MASTHEAD_MCP_NODE || join(target, "resources/daemon/node");
  const server = process.env.MASTHEAD_MCP_SERVER || join(target, "resources/daemon/dist/src/mcp/server.js");
  return { target, node, server, dataDir: DATA_DIR, dbPath: DB_PATH };
}

function spawnMcp({ node, server, dataDir, dbPath }) {
  const child = spawn(node, [server], {
    env: {
      ...process.env,
      MASTHEAD_DATA_DIR: dataDir,
      MASTHEAD_DB_PATH: dbPath
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    child._stderr = (child._stderr || "") + chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg);
      }
    }
  });
  function rpc(method, params = {}) {
    const reqId = ++id;
    const payload = JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error(`timeout waiting for ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(reqId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
      child.stdin.write(payload);
    });
  }
  async function callTool(name, args) {
    const res = await rpc("tools/call", { name, arguments: args });
    const content = res.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
      if (res.result?.structuredContent) return res.result.structuredContent;
      if (res.result && !res.result.isError) return res.result;
      throw new Error(`empty tool result for ${name}: ${JSON.stringify(res.result).slice(0, 400)}`);
    }
    const text = content.map((c) => c.text || "").join("");
    if (res.result?.isError) throw new Error(`tool error ${name}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  async function stop() {
    try {
      child.stdin.end();
    } catch {}
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  return { child, rpc, callTool, stop };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function summarizeArtifact(a) {
  return {
    artifactId: a.artifactId,
    kind: a.kind,
    title: (a.title || "").slice(0, 80),
    project: a.project
  };
}

async function main() {
  const paths = await resolvePaths();
  report.config = paths;
  log("Starting production MCP server…");
  log(JSON.stringify({ node: paths.node, server: paths.server, db: paths.dbPath }, null, 2));
  const mcp = spawnMcp(paths);
  try {
    // S0 initialize + inventory
    try {
      const init = await mcp.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "masthead-production-mcp-scenarios", version: "2.0.0" }
      });
      const name = init.result?.serverInfo?.name;
      assert(name === "masthead" || name?.includes("masthead"), `unexpected server ${name}`);
      try {
        await mcp.rpc("notifications/initialized", {});
      } catch {
        /* optional */
      }
      const tools = await mcp.rpc("tools/list", {});
      const toolNames = (tools.result?.tools || []).map((t) => t.name).sort();
      assert(
        JSON.stringify(toolNames) === JSON.stringify(EXPECTED_TOOLS),
        `tool inventory mismatch: got ${toolNames.join(", ")}`
      );
      assert(
        toolNames.every((n) => !/write|delete|clear|import|install|uninstall|approve|run|execute/i.test(n)),
        "write-capable tool name exposed"
      );
      record({
        name: "S0 initialize + read-only tool inventory",
        status: "pass",
        detail: `${toolNames.length} tools; server=${name}`,
        tools: toolNames
      });
    } catch (e) {
      record({ name: "S0 initialize + read-only tool inventory", status: "fail", detail: String(e.message || e) });
      throw e;
    }

    // S1 corpus stats (primary) + coverage (legacy)
    let coverage;
    let corpus;
    try {
      corpus = await mcp.callTool("get_corpus_stats", {});
      assert(typeof corpus.publishedArtifacts === "number" && corpus.publishedArtifacts > 0, "no published artifacts");
      record({
        name: "S1a get_corpus_stats baseline",
        status: "pass",
        detail: `published=${corpus.publishedArtifacts} projects=${corpus.projects} byKind=${JSON.stringify(corpus.byKind)}`
      });
    } catch (e) {
      record({ name: "S1a get_corpus_stats baseline", status: "fail", detail: String(e.message || e) });
    }
    try {
      coverage = await mcp.callTool("get_masthead_coverage", {});
      assert(typeof coverage.sessions === "number" && coverage.sessions > 0, "coverage sessions empty");
      record({
        name: "S1b get_masthead_coverage baseline",
        status: "pass",
        detail: `sessions=${coverage.sessions} projects=${coverage.projects ?? "n/a"}`
      });
    } catch (e) {
      record({ name: "S1b get_masthead_coverage baseline", status: "fail", detail: String(e.message || e) });
    }

    // S2 search_knowledge primary
    const knowledgeQueries = [
      { q: "Nova OS", kind: undefined },
      { q: "Logbook", kind: undefined },
      { q: "service health", kind: undefined },
      { q: "Masthead", kind: "session_dossier" },
      { q: "", kind: "session_dossier" },
      { q: "runbook", kind: "runbook" },
      { q: "ADR", kind: "adr" }
    ];
    let sampleArtifact;
    for (const { q, kind } of knowledgeQueries) {
      const label = `S2 search_knowledge q=${JSON.stringify(q)}${kind ? ` kind=${kind}` : ""}`;
      try {
        const res = await mcp.callTool("search_knowledge", {
          query: q || undefined,
          kind,
          limit: 10
        });
        assert(res.ok !== false, "search_knowledge not ok");
        assert(Array.isArray(res.artifacts), "missing artifacts array");
        assert(typeof res.total === "number", "missing total");
        if (!sampleArtifact && res.artifacts.length > 0) sampleArtifact = res.artifacts[0];
        if (q === "" && kind === "session_dossier") {
          assert(res.total > 0, "expected published dossiers in production");
        }
        record({
          name: label,
          status: "pass",
          detail: `total=${res.total} returned=${res.artifacts.length} sample=${res.artifacts[0]?.title?.slice(0, 60) || "—"}`,
          total: res.total,
          sample: res.artifacts.slice(0, 3).map(summarizeArtifact)
        });
      } catch (e) {
        record({ name: label, status: "fail", detail: String(e.message || e) });
      }
    }

    // S2b v1 alias search_artifacts
    try {
      const res = await mcp.callTool("search_artifacts", { query: "Nova OS", limit: 5 });
      assert(Array.isArray(res.artifacts) && res.total >= 0, "v1 search_artifacts broken");
      record({
        name: "S2b search_artifacts v1 alias",
        status: "pass",
        detail: `total=${res.total} returned=${res.artifacts.length}`
      });
    } catch (e) {
      record({ name: "S2b search_artifacts v1 alias", status: "fail", detail: String(e.message || e) });
    }

    // S3 get_knowledge detail + stable artifactId
    let sampleProvenanceSession;
    try {
      assert(sampleArtifact?.artifactId, "no sample artifact from search");
      const detail = await mcp.callTool("get_knowledge", { artifactId: sampleArtifact.artifactId });
      assert(detail.artifact, "get_knowledge returned empty");
      assert(detail.artifact.artifactId === sampleArtifact.artifactId, "artifact id mismatch on detail");
      assert(detail.artifact.kind && detail.artifact.title, "missing kind/title on detail");
      sampleProvenanceSession = detail.artifact.provenance?.sessionIds?.[0] || detail.artifact.provenanceSessionIds?.[0];
      record({
        name: "S3 get_knowledge detail + stable artifactId",
        status: "pass",
        detail: `id=${detail.artifact.artifactId} kind=${detail.artifact.kind} title=${String(detail.artifact.title).slice(0, 70)} provenance=${(detail.artifact.provenanceSessionIds || []).length}`
      });
    } catch (e) {
      record({ name: "S3 get_knowledge detail + stable artifactId", status: "fail", detail: String(e.message || e) });
    }

    // S3b v1 get_artifact alias
    try {
      assert(sampleArtifact?.artifactId, "no sample");
      const detail = await mcp.callTool("get_artifact", { artifactId: sampleArtifact.artifactId });
      assert(detail.artifact?.artifactId === sampleArtifact.artifactId, "v1 get_artifact missing stable artifactId");
      record({
        name: "S3b get_artifact v1 alias stable artifactId",
        status: "pass",
        detail: `id=${detail.artifact.artifactId}`
      });
    } catch (e) {
      record({ name: "S3b get_artifact v1 alias stable artifactId", status: "fail", detail: String(e.message || e) });
    }

    // S4 missing artifact
    try {
      const missing = await mcp.callTool("get_knowledge", { artifactId: "artifact:definitely-does-not-exist-mcp-test" });
      assert(missing.artifact == null, "expected null artifact for missing id");
      record({ name: "S4 get_knowledge missing id is empty", status: "pass", detail: "artifact=null" });
    } catch (e) {
      record({ name: "S4 get_knowledge missing id is empty", status: "warn", detail: String(e.message || e).slice(0, 200) });
    }

    // S5 keyword searches
    for (const q of ["verification", "production", "authoring", "MCP", "session dossier"]) {
      const label = `S5 keyword search_knowledge q=${JSON.stringify(q)}`;
      try {
        const res = await mcp.callTool("search_knowledge", { query: q, limit: 5 });
        record({
          name: label,
          status: res.total > 0 ? "pass" : "warn",
          detail: `total=${res.total} top=${res.artifacts[0]?.title?.slice(0, 60) || "none"}`
        });
      } catch (e) {
        record({ name: label, status: "fail", detail: String(e.message || e) });
      }
    }

    // S6 session search (legacy — may be slow; 180s timeout)
    let sampleSession;
    for (const q of ["Masthead", "Grok", "Codex", "production", "Workbench"]) {
      const label = `S6 search_sessions q=${JSON.stringify(q)}`;
      try {
        const t0 = Date.now();
        const res = await mcp.callTool("search_sessions", { query: q, limit: 8 });
        const ms = Date.now() - t0;
        assert(Array.isArray(res.sessions), "no sessions array");
        if (!sampleSession && res.sessions[0]) sampleSession = res.sessions[0];
        record({
          name: label,
          status: res.sessions.length > 0 ? "pass" : "warn",
          detail: `returned=${res.sessions.length} ms=${ms} top=${res.sessions[0]?.title?.slice(0, 50) || res.sessions[0]?.sessionId || "none"}`
        });
      } catch (e) {
        record({ name: label, status: "fail", detail: String(e.message || e) });
      }
    }

    const sessionId = sampleProvenanceSession || sampleSession?.sessionId;
    const project = sampleSession?.project;

    // S7 get_session
    try {
      assert(sessionId, "no session id");
      const session = await mcp.callTool("get_session", { sessionId, maxBytes: 4000 });
      assert(session.session || session.sessionId || session.sourceRefs, "empty session payload");
      record({
        name: "S7 get_session evidence payload",
        status: "pass",
        detail: `sessionId=${sessionId} keys=${Object.keys(session).slice(0, 12).join(",")}`
      });
    } catch (e) {
      record({ name: "S7 get_session evidence payload", status: "fail", detail: String(e.message || e) });
    }

    // S8 evidence excerpt (v2)
    try {
      assert(sessionId, "no session id");
      const excerpt = await mcp.callTool("get_evidence_excerpt", {
        sessionId,
        artifactId: sampleArtifact?.artifactId,
        query: "Masthead",
        maxBytes: 1500
      });
      record({
        name: "S8 get_evidence_excerpt (optional provenance gate)",
        status: "pass",
        detail: `ok=${excerpt.ok} textLen=${(excerpt.text || "").length}`
      });
    } catch (e) {
      // provenance gate may fail if sample session not in sample artifact — retry without artifactId
      try {
        assert(sessionId, "no session");
        const excerpt = await mcp.callTool("get_evidence_excerpt", { sessionId, query: "Masthead", maxBytes: 1500 });
        record({
          name: "S8 get_evidence_excerpt (optional provenance gate)",
          status: "pass",
          detail: `ungated ok=${excerpt.ok}; gated attempt: ${String(e.message || e).slice(0, 120)}`
        });
      } catch (e2) {
        record({ name: "S8 get_evidence_excerpt (optional provenance gate)", status: "fail", detail: String(e2.message || e2) });
      }
    }

    // S9 evidence transcript roles
    for (const role of ["all", "user", "assistant", "tool"]) {
      const label = `S9 get_evidence_transcript role=${role}`;
      try {
        assert(sessionId, "no session id");
        const t = await mcp.callTool("get_evidence_transcript", {
          sessionId,
          role,
          limit: 15,
          maxBytes: 800
        });
        assert(Array.isArray(t.items), "no items");
        for (const item of t.items) {
          if (item.text) assert(Buffer.byteLength(item.text, "utf8") <= 800 + 8, "item exceeded maxBytes");
        }
        record({
          name: label,
          status: "pass",
          detail: `total=${t.total} returned=${t.items.length} nextCursor=${Boolean(t.nextCursor)}`
        });
      } catch (e) {
        record({ name: label, status: "fail", detail: String(e.message || e) });
      }
    }

    // S10 project
    const projectsToTry = [...new Set([project, "Masthead", "Nova OS"].filter(Boolean))];
    for (const p of projectsToTry) {
      try {
        const list = await mcp.callTool("list_project_sessions", { project: p, limit: 10 });
        record({
          name: `S10a list_project_sessions project=${p}`,
          status: list.sessions?.length > 0 ? "pass" : "warn",
          detail: `count=${list.sessions?.length ?? 0}`
        });
      } catch (e) {
        record({ name: `S10a list_project_sessions project=${p}`, status: "fail", detail: String(e.message || e) });
      }
      try {
        const hist = await mcp.callTool("get_project_history", { project: p, limit: 10 });
        record({
          name: `S10b get_project_history project=${p}`,
          status: hist.sessions?.length > 0 ? "pass" : "warn",
          detail: `count=${hist.sessions?.length ?? 0}`
        });
      } catch (e) {
        record({ name: `S10b get_project_history project=${p}`, status: "fail", detail: String(e.message || e) });
      }
      try {
        const kn = await mcp.callTool("search_knowledge", { project: p, limit: 5 });
        record({
          name: `S10c search_knowledge project=${p}`,
          status: kn.total > 0 ? "pass" : "warn",
          detail: `total=${kn.total}`
        });
      } catch (e) {
        record({ name: `S10c search_knowledge project=${p}`, status: "fail", detail: String(e.message || e) });
      }
    }

    // S11 agent research loop (knowledge-first)
    try {
      const found = await mcp.callTool("search_knowledge", { query: "Logbook", limit: 5 });
      assert(found.artifacts.length > 0, "need Logbook artifact");
      const art = await mcp.callTool("get_knowledge", { artifactId: found.artifacts[0].artifactId });
      assert(art.artifact?.artifactId === found.artifacts[0].artifactId, "stable id required");
      const prov = await mcp.callTool("get_provenance", { artifactId: found.artifacts[0].artifactId });
      const sessionFromProv = prov.provenance?.sessionIds?.[0];
      assert(sessionFromProv, "artifact lacks provenance session");
      const tr = await mcp.callTool("get_evidence_transcript", {
        sessionId: sessionFromProv,
        artifactId: found.artifacts[0].artifactId,
        role: "user",
        limit: 5,
        maxBytes: 600
      });
      const ex = await mcp.callTool("get_evidence_excerpt", {
        sessionId: sessionFromProv,
        artifactId: found.artifacts[0].artifactId,
        query: "Logbook",
        maxBytes: 800
      });
      record({
        name: "S11 agent research loop knowledge→provenance→evidence",
        status: "pass",
        detail: `artifact=${found.artifacts[0].title?.slice(0, 50)} prov=${sessionFromProv} userItems=${tr.items.length} excerptOk=${Boolean(ex)}`
      });
    } catch (e) {
      record({
        name: "S11 agent research loop knowledge→provenance→evidence",
        status: "fail",
        detail: String(e.message || e)
      });
    }

    // S12 pagination
    try {
      const page0 = await mcp.callTool("search_knowledge", { query: "Masthead", limit: 5, offset: 0 });
      const page1 = await mcp.callTool("search_knowledge", { query: "Masthead", limit: 5, offset: 5 });
      assert(page0.total === page1.total, "total drifted across pages");
      const ids0 = new Set(page0.artifacts.map((a) => a.artifactId));
      const overlap = page1.artifacts.filter((a) => ids0.has(a.artifactId)).length;
      record({
        name: "S12 knowledge search pagination offset",
        status: page0.total > 5 && overlap === 0 ? "pass" : page0.total <= 5 ? "warn" : "fail",
        detail: `total=${page0.total} page0=${page0.artifacts.length} page1=${page1.artifacts.length} overlap=${overlap}`
      });
    } catch (e) {
      record({ name: "S12 knowledge search pagination offset", status: "fail", detail: String(e.message || e) });
    }

    // S13 kind exclusivity
    try {
      const dossiers = await mcp.callTool("list_knowledge", { kind: "session_dossier", limit: 20 });
      const bad = dossiers.artifacts.filter((a) => a.kind && a.kind !== "session_dossier");
      record({
        name: "S13 list_knowledge kind exclusivity (session_dossier)",
        status: bad.length === 0 && dossiers.total > 0 ? "pass" : "fail",
        detail: `total=${dossiers.total} wrongKind=${bad.length}`
      });
    } catch (e) {
      record({ name: "S13 list_knowledge kind exclusivity (session_dossier)", status: "fail", detail: String(e.message || e) });
    }

    // S14 maxBytes ceiling
    try {
      assert(sessionId, "no session");
      const big = await mcp.callTool("get_evidence_transcript", {
        sessionId,
        role: "all",
        limit: 5,
        maxBytes: 100_000
      });
      for (const item of big.items || []) {
        if (item.text) assert(Buffer.byteLength(item.text, "utf8") <= 16_000 + 16, "maxBytes ceiling not enforced");
      }
      record({ name: "S14 maxBytes ceiling (request 100k, cap 16k)", status: "pass", detail: `items=${big.items?.length ?? 0}` });
    } catch (e) {
      record({ name: "S14 maxBytes ceiling (request 100k, cap 16k)", status: "fail", detail: String(e.message || e) });
    }

    // S15 invalid
    try {
      await mcp.callTool("not_a_real_tool", {});
      record({ name: "S15a unknown tool rejected", status: "fail", detail: "should have thrown" });
    } catch {
      record({ name: "S15a unknown tool rejected", status: "pass", detail: "error as expected" });
    }
    try {
      await mcp.callTool("get_knowledge", {});
      record({ name: "S15b get_knowledge missing artifactId", status: "warn", detail: "accepted empty args" });
    } catch {
      record({ name: "S15b get_knowledge missing artifactId", status: "pass", detail: "rejected as expected" });
    }

    // S16 multi-tool turn
    try {
      const cov = await mcp.callTool("get_corpus_stats", {});
      const arts = await mcp.callTool("search_knowledge", { query: "production", limit: 3 });
      const sess = await mcp.callTool("search_sessions", { query: "Masthead", limit: 3 });
      assert(cov.publishedArtifacts > 0 && arts.artifacts && sess.sessions, "multi-tool turn incomplete");
      record({
        name: "S16 multi-tool agent turn (stats+knowledge+sessions)",
        status: "pass",
        detail: `published=${cov.publishedArtifacts} artifacts=${arts.artifacts.length} sessions=${sess.sessions.length}`
      });
    } catch (e) {
      record({
        name: "S16 multi-tool agent turn (stats+knowledge+sessions)",
        status: "fail",
        detail: String(e.message || e)
      });
    }

    // S17 scale
    try {
      const allDossiers = await mcp.callTool("list_knowledge", { kind: "session_dossier", limit: 1 });
      record({
        name: "S17 production scale sanity",
        status: allDossiers.total >= 100 ? "pass" : "warn",
        detail: `session_dossier total=${allDossiers.total} publishedArtifacts=${corpus?.publishedArtifacts} sessions=${coverage?.sessions}`
      });
    } catch (e) {
      record({ name: "S17 production scale sanity", status: "fail", detail: String(e.message || e) });
    }

    // S18 provenance gate negative
    try {
      assert(sampleArtifact?.artifactId, "no artifact");
      await mcp.callTool("get_evidence_transcript", {
        artifactId: sampleArtifact.artifactId,
        sessionId: "session:definitely-not-in-provenance-mcp-test",
        limit: 3
      });
      record({ name: "S18 provenance gate rejects foreign session", status: "fail", detail: "should have thrown" });
    } catch (e) {
      const msg = String(e.message || e);
      record({
        name: "S18 provenance gate rejects foreign session",
        status: /not in provenance|error/i.test(msg) ? "pass" : "warn",
        detail: msg.slice(0, 200)
      });
    }

    report.finishedAt = new Date().toISOString();
    report.databasePath = paths.dbPath;
    report.bundle = paths.target;
  } finally {
    await mcp.stop();
  }

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  log("");
  log("=== SUMMARY ===");
  log(`passed=${report.summary.passed} failed=${report.summary.failed} warnings=${report.summary.warnings}`);
  log(`report: ${REPORT_PATH}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(2);
});
