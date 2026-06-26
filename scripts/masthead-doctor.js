#!/usr/bin/env node

import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_HOOK_EVENTS = ["SessionStart", "PermissionRequest", "PostToolUse", "Stop"];
const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const REQUIRED_CAPABILITIES = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "mcp_status",
  "settings"
];
const PRODUCT_ENDPOINTS = [
  "/adapters",
  "/sources",
  "/sessions",
  "/logbook/summary",
  "/mcp/status",
  "/mcp/tools",
  "/settings",
  "/data/summary"
];
const EXPECTED_MCP_TOOLS = [
  "get_masthead_coverage",
  "get_project_history",
  "get_session",
  "get_session_excerpt",
  "list_project_sessions",
  "search_sessions"
];

const baseUrl = normalizeBaseUrl(process.env.MASTHEAD_BASE_URL || process.env.MASTHEAD_HEALTH_URL || "http://127.0.0.1:17373");
const hookConfigPath = resolve(process.env.MASTHEAD_CODEX_HOOKS || join(homedir(), ".codex/hooks.json"));
const jsonOutput = process.argv.includes("--json");
const strictHooks = process.env.MASTHEAD_DOCTOR_STRICT_HOOKS === "1";

const checks = [];
let health;

checks.push(await checkNodeRuntime());
checks.push(await checkDaemonBuild());
checks.push(await checkSqliteRuntime());
const protocol = await checkProtocol();
checks.push(protocol.check);
health = protocol.health;
checks.push(checkDatabaseIdentity(health));
checks.push(await checkEndpoints());
checks.push(await checkSources());
checks.push(await checkMcp());
checks.push(await checkLogbook());
checks.push(await checkHooks());

const report = {
  ok: checks.every((check) => check.status !== "fail"),
  checkedAt: new Date().toISOString(),
  baseUrl,
  checks
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const result of checks) {
    console.log(`${result.status} ${result.label}: ${result.message}`);
  }
}

process.exitCode = report.ok ? 0 : 1;

async function checkNodeRuntime() {
  const minimum = [24, 15, 0];
  const current = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));
  const ok = compareVersions(current, minimum) >= 0;
  return {
    id: "node-runtime",
    label: "node runtime",
    status: ok ? "ok" : "fail",
    message: ok ? `Node ${process.versions.node}` : `Node ${process.versions.node}; expected >= 24.15.0`,
    details: { current: process.versions.node, minimum: "24.15.0" }
  };
}

async function checkDaemonBuild() {
  const entry = resolve("dist/daemon/src/daemon/main.js");
  try {
    await access(entry);
    return { id: "daemon-build", label: "daemon build", status: "ok", message: entry, details: { entry } };
  } catch (error) {
    return {
      id: "daemon-build",
      label: "daemon build",
      status: "fail",
      message: `missing ${entry}; run npm run build:daemon`,
      details: { entry, error: errorMessage(error) }
    };
  }
}

async function checkSqliteRuntime() {
  const dir = await mkdtemp(join(tmpdir(), "masthead-doctor-sqlite-"));
  const databasePath = join(dir, "doctor.sqlite");
  try {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("CREATE VIRTUAL TABLE doctor_fts USING fts5(text);");
      db.prepare("INSERT INTO doctor_fts(text) VALUES (?)").run("masthead sqlite doctor");
      const row = db.prepare("SELECT COUNT(*) AS count FROM doctor_fts WHERE doctor_fts MATCH ?").get("masthead");
      assert(row.count === 1, "FTS5 query did not return the inserted row");
    } finally {
      db.close();
    }
    return {
      id: "sqlite-runtime",
      label: "sqlite runtime",
      status: "ok",
      message: "node:sqlite opens WAL databases with FTS5",
      details: { databasePath }
    };
  } catch (error) {
    return { id: "sqlite-runtime", label: "sqlite runtime", status: "fail", message: errorMessage(error), details: { databasePath } };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function checkProtocol() {
  try {
    const body = await getJson("/health");
    const missingCapabilities = REQUIRED_CAPABILITIES.filter((capability) => !arrayStrings(body.capabilities).includes(capability));
    const ok = body.ok === true && body.product === "masthead" && body.apiVersion === 1 && missingCapabilities.length === 0;
    return {
      health: body,
      check: {
        id: "daemon-protocol",
        label: "daemon protocol",
        status: ok ? "ok" : "fail",
        message: ok ? "Masthead protocol identity and capabilities are current." : "Health is missing required Masthead protocol identity or capabilities.",
        details: {
          product: body.product,
          apiVersion: body.apiVersion,
          missingCapabilities
        }
      }
    };
  } catch (error) {
    return {
      health: undefined,
      check: {
        id: "daemon-protocol",
        label: "daemon protocol",
        status: "fail",
        message: `cannot reach ${new URL("/health", baseUrl).toString()}: ${errorMessage(error)}`,
        details: { baseUrl }
      }
    };
  }
}

function checkDatabaseIdentity(body) {
  const data = isRecord(body?.data) ? body.data : undefined;
  if (!data) {
    return {
      id: "database-identity",
      label: "database identity",
      status: "fail",
      message: "Health did not include data identity.",
      details: { baseUrl }
    };
  }
  const failed = data.migrationState === "failed";
  return {
    id: "database-identity",
    label: "database identity",
    status: failed ? "fail" : "ok",
    message: failed ? "Database migration state is failed." : `${data.databaseId ?? "unknown database"} at ${data.databasePath ?? "unknown path"}`,
    details: {
      dataDirectory: data.dataDirectory,
      databasePath: data.databasePath,
      databaseId: data.databaseId,
      migrationState: data.migrationState,
      sessions: data.sessions,
      sources: data.sources
    }
  };
}

async function checkEndpoints() {
  const results = [];
  for (const path of PRODUCT_ENDPOINTS) {
    try {
      await getJson(path);
      results.push({ path, ok: true });
    } catch (error) {
      results.push({ path, ok: false, error: errorMessage(error) });
    }
  }
  const failed = results.filter((result) => !result.ok);
  return {
    id: "product-endpoints",
    label: "product endpoints",
    status: failed.length === 0 ? "ok" : "fail",
    message: failed.length === 0 ? `${results.length} product endpoints responded.` : `${failed.length} product endpoints failed.`,
    details: results
  };
}

async function checkSources() {
  try {
    const body = await getJson("/adapters");
    const adapters = Array.isArray(body.adapters) ? body.adapters : [];
    const codex = adapters.find((adapter) => isRecord(adapter) && adapter.runtime === "codex");
    const plannedAdapters = adapters.filter((adapter) => isRecord(adapter) && (adapter.state === "planned" || adapter.implementationState === "planned"));
    const diagnosticsCount = adapters.reduce((total, adapter) => total + (Array.isArray(adapter.diagnostics) ? adapter.diagnostics.length : 0), 0);
    const details = {
      codexState: codex?.state ?? "missing",
      discoveredSessions: numberValue(codex?.discoveredSessions ?? codex?.discoveredCount) ?? 0,
      importedSessions: numberValue(codex?.importedSessions ?? codex?.importedCount) ?? 0,
      diagnosticsCount,
      plannedAdapters: plannedAdapters.length
    };
    const missingCodex = !codex || codex.state === "not_detected";
    return {
      id: "source-discovery",
      label: "source discovery",
      status: missingCodex ? "warn" : "ok",
      message: missingCodex ? "Codex source is not detected." : `Codex source ${details.codexState}; ${details.importedSessions}/${details.discoveredSessions} sessions imported.`,
      details
    };
  } catch (error) {
    return { id: "source-discovery", label: "source discovery", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkMcp() {
  try {
    const [statusBody, toolsBody] = await Promise.all([getJson("/mcp/status"), getJson("/mcp/tools")]);
    const status = isRecord(statusBody.status) ? statusBody.status : {};
    const toolNames = Array.isArray(toolsBody.tools)
      ? toolsBody.tools.map((tool) => tool.name).filter((name) => typeof name === "string").sort()
      : [];
    const missingTools = EXPECTED_MCP_TOOLS.filter((tool) => !toolNames.includes(tool));
    return {
      id: "mcp",
      label: "mcp",
      status: missingTools.length === 0 && toolNames.length === EXPECTED_MCP_TOOLS.length ? "ok" : "fail",
      message:
        missingTools.length === 0 && toolNames.length === EXPECTED_MCP_TOOLS.length
          ? `MCP exposes ${toolNames.length} read-only tools.`
          : `MCP tool catalog mismatch; missing ${missingTools.join(", ") || "none"}.`,
      details: {
        toolCount: toolNames.length,
        toolNames,
        globalAccessEnabled: status.globalAccessEnabled,
        queryCount: status.queryCount
      }
    };
  } catch (error) {
    return { id: "mcp", label: "mcp", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkLogbook() {
  try {
    const body = await getJson("/logbook/summary");
    const summary = isRecord(body.summary) ? body.summary : {};
    const sessions = numberValue(summary.sessions) ?? 0;
    return {
      id: "logbook",
      label: "logbook",
      status: sessions === 0 ? "warn" : "ok",
      message: sessions === 0 ? "Logbook has zero sessions." : `Logbook has ${sessions} sessions.`,
      details: {
        sessions,
        projects: summary.projects,
        messages: summary.messages,
        toolCalls: summary.toolCalls
      }
    };
  } catch (error) {
    return { id: "logbook", label: "logbook", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkHooks() {
  try {
    const raw = await readFile(hookConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    const verified = verifyHookConfig(parsed, expectedHookOptions());
    const fileStat = await stat(hookConfigPath);
    const mode = fileStat.mode & 0o777;
    const privateMode = (mode & 0o077) === 0;
    const ok = verified.installed && privateMode;
    return {
      id: "codex-hooks",
      label: "codex hooks",
      status: ok ? "ok" : strictHooks ? "fail" : "warn",
      message: ok
        ? `installed in ${hookConfigPath}`
        : `missing ${verified.missingEvents.join(", ") || "none"}; mismatched ${verified.mismatchedEvents.join(", ") || "none"}; mode ${mode.toString(8)}`,
      details: { hookConfigPath, strict: strictHooks, ...verified, mode: mode.toString(8), privateMode }
    };
  } catch (error) {
    return {
      id: "codex-hooks",
      label: "codex hooks",
      status: strictHooks ? "fail" : "warn",
      message: errorMessage(error),
      details: { hookConfigPath, strict: strictHooks }
    };
  }
}

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function expectedHookOptions() {
  const expected = {};
  if (process.env.MASTHEAD_EXPECTED_HOOK_COMMAND) expected.command = process.env.MASTHEAD_EXPECTED_HOOK_COMMAND;
  if (process.env.MASTHEAD_EXPECTED_HOOK_TIMEOUT) expected.timeout = Number.parseInt(process.env.MASTHEAD_EXPECTED_HOOK_TIMEOUT, 10);
  if (process.env.MASTHEAD_EXPECTED_HOOK_STATUS_MESSAGE) expected.statusMessage = process.env.MASTHEAD_EXPECTED_HOOK_STATUS_MESSAGE;
  return Object.keys(expected).length > 0 ? expected : undefined;
}

function verifyHookConfig(config, expected) {
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  const missingEvents = [];
  const mismatchedEvents = [];
  for (const eventName of REQUIRED_HOOK_EVENTS) {
    const handlers = Array.isArray(hooks[eventName])
      ? hooks[eventName].flatMap((group) => (isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [])).filter(isMastheadHook)
      : [];
    if (handlers.length === 0) {
      missingEvents.push(eventName);
      continue;
    }
    if (expected && !handlers.some((handler) => matchesExpectedHook(handler, expected))) mismatchedEvents.push(eventName);
  }
  return { installed: missingEvents.length === 0 && mismatchedEvents.length === 0, missingEvents, mismatchedEvents };
}

function isMastheadHook(entry) {
  return isRecord(entry) && entry.type === "command" && typeof entry.command === "string" && entry.command.includes(MASTHEAD_HOOK_MARKER);
}

function matchesExpectedHook(handler, expected) {
  if (expected.command && handler.command !== expected.command) return false;
  if (expected.timeout !== undefined && handler.timeout !== expected.timeout) return false;
  if (expected.statusMessage !== undefined && handler.statusMessage !== expected.statusMessage) return false;
  return true;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.pathname === "/health") url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
