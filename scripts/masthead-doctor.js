#!/usr/bin/env node

import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_HOOK_EVENTS = ["SessionStart", "PermissionRequest", "PostToolUse", "Stop"];
const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const healthUrl = process.env.MASTHEAD_HEALTH_URL || "http://127.0.0.1:17373/health";
const hookConfigPath = resolve(process.env.MASTHEAD_CODEX_HOOKS || join(homedir(), ".codex/hooks.json"));
const jsonOutput = process.argv.includes("--json");

const checks = [];
checks.push(await checkNodeRuntime());
checks.push(await checkDaemonBuild());
checks.push(await checkSqliteRuntime());
checks.push(await checkCollector());
checks.push(await checkHooks());

const report = {
  ok: checks.every((check) => check.status === "ok"),
  checkedAt: new Date().toISOString(),
  checks,
  notes: ["Codex hook trust still has to be reviewed in Codex with /hooks after config changes."]
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const result of checks) {
    console.log(`${result.status} ${result.label}: ${result.message}`);
  }
  for (const note of report.notes) console.log(`note ${note}`);
}

process.exitCode = report.ok ? 0 : 1;

async function checkNodeRuntime() {
  const minimum = [22, 13, 0];
  const current = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));
  const ok = compareVersions(current, minimum) >= 0;
  return {
    id: "node-runtime",
    label: "node runtime",
    status: ok ? "ok" : "fail",
    message: ok ? `Node ${process.versions.node}` : `Node ${process.versions.node}; expected >= 22.13.0`,
    details: { current: process.versions.node, minimum: "22.13.0" }
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
    return { id: "sqlite-runtime", label: "sqlite runtime", status: "ok", message: "node:sqlite opens WAL databases with FTS5", details: { databasePath } };
  } catch (error) {
    return { id: "sqlite-runtime", label: "sqlite runtime", status: "fail", message: errorMessage(error), details: { databasePath } };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function checkCollector() {
  try {
    const response = await fetch(healthUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return { id: "collector", label: "collector", status: "fail", message: `${healthUrl} returned ${response.status}`, details: { healthUrl } };
    }
    const body = await response.json();
    const ok = body.ok === true && typeof body.databasePath === "string" && typeof body.storePath === "string";
    return {
      id: "collector",
      label: "collector",
      status: ok ? "ok" : "fail",
      message: ok
        ? `${body.events ?? 0} events, ${body.gitSnapshots ?? 0} git snapshots, store ${body.storePath}`
        : `${healthUrl} did not return a Masthead health envelope`,
      details: {
        healthUrl,
        databasePath: body.databasePath,
        storePath: body.storePath,
        events: body.events,
        gitSnapshots: body.gitSnapshots,
        llmCopy: body.llmCopy
      }
    };
  } catch (error) {
    return { id: "collector", label: "collector", status: "fail", message: errorMessage(error), details: { healthUrl } };
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
      status: ok ? "ok" : "fail",
      message: ok
        ? `installed in ${hookConfigPath}`
        : `missing ${verified.missingEvents.join(", ") || "none"}; mismatched ${verified.mismatchedEvents.join(", ") || "none"}; mode ${mode.toString(8)}`,
      details: { hookConfigPath, ...verified, mode: mode.toString(8), privateMode }
    };
  } catch (error) {
    return { id: "codex-hooks", label: "codex hooks", status: "fail", message: errorMessage(error), details: { hookConfigPath } };
  }
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
