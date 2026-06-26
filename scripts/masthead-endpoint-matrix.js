#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:17373";

const REQUIRED_CAPABILITIES = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "mcp_status",
  "settings"
];

export const READ_ONLY_ENDPOINTS = [
  { method: "GET", path: "/health", label: "collector health" },
  { method: "GET", path: "/projection", label: "live projection" },
  { method: "GET", path: "/events", label: "live events" },
  { method: "GET", path: "/fixture", label: "fixture replay" },
  { method: "GET", path: "/adapters", label: "adapter status" },
  { method: "GET", path: "/sources", label: "source discovery" },
  { method: "GET", path: "/sessions", label: "session search" },
  { method: "GET", path: "/sessions/session-1", label: "session detail", allowNotFound: true },
  { method: "GET", path: "/sessions/session-1/excerpts?limit=8", label: "session excerpts" },
  { method: "GET", path: "/projects", label: "project list" },
  { method: "GET", path: "/imports", label: "import jobs" },
  { method: "GET", path: "/imports/import-1", label: "import detail", allowNotFound: true },
  { method: "GET", path: "/data/summary", label: "data summary" },
  { method: "GET", path: "/mcp/status", label: "mcp status" },
  { method: "GET", path: "/mcp/launch-config", label: "mcp launch config" },
  { method: "GET", path: "/mcp/tools", label: "mcp tool metadata" },
  { method: "GET", path: "/mcp/audit?limit=1", label: "mcp audit" },
  { method: "GET", path: "/settings", label: "settings state" },
  { method: "GET", path: "/settings/hooks/codex", label: "codex hook settings" },
  { method: "GET", path: "/logbook/summary", label: "logbook summary" },
  { method: "GET", path: "/logbook/search?q=Bridge", label: "logbook search" }
];

export const READ_ONLY_POST_ENDPOINTS = [
  { method: "POST", path: "/mcp/launch-config/validate", label: "mcp launch validation", body: { launchConfig: { command: process.execPath, args: ["server.js"], env: {} } } },
  { method: "POST", path: "/mcp/test-connection", label: "mcp connection test", body: { launchConfig: { command: process.execPath, args: ["server.js"], env: {} } } }
];

export const BLOCKED_MUTATION_ENDPOINTS = [
  { method: "POST", path: "/ingest", label: "hook ingest" },
  { method: "POST", path: "/imports", label: "start import" },
  { method: "POST", path: "/imports/import-1/cancel", label: "cancel import" },
  { method: "POST", path: "/imports/import-1/retry", label: "retry import" },
  { method: "POST", path: "/sources/codex/import-metadata", label: "codex metadata import" },
  { method: "POST", path: "/sources/codex/import-transcripts", label: "codex transcript import" },
  { method: "POST", path: "/settings/hooks/codex/install", label: "install hooks" },
  { method: "POST", path: "/settings/hooks/codex/uninstall", label: "uninstall hooks" },
  { method: "POST", path: "/settings/hooks/codex/test", label: "test hooks" },
  { method: "POST", path: "/review-dispositions", label: "write review disposition" },
  { method: "POST", path: "/retention", label: "retention prune" },
  { method: "POST", path: "/data/delete", label: "delete data" },
  { method: "POST", path: "/data/retention/default", label: "default retention" },
  { method: "POST", path: "/clear", label: "clear store" }
];

export const ENDPOINT_MATRIX = {
  readOnly: READ_ONLY_ENDPOINTS,
  readOnlyPosts: READ_ONLY_POST_ENDPOINTS,
  blockedMutations: BLOCKED_MUTATION_ENDPOINTS
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const firstArg = process.argv.find((arg, index) => index > 1 && /^https?:\/\//.test(arg));
  const lifecycle = process.env.npm_lifecycle_event ?? "";
  if (firstArg || lifecycle.startsWith("probe")) {
    const ok = await probeLiveDaemon(firstArg ?? DEFAULT_BASE_URL);
    process.exitCode = ok ? 0 : 1;
  } else {
    const result = await validateEndpointMatrix({ checkDist: !process.argv.includes("--no-dist-check") });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const check of result.checks) console.log(`${check.ok ? "ok" : "fail"} ${check.label}: ${check.message}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  }
}

export async function validateEndpointMatrix({ checkDist = true } = {}) {
  const checks = [];
  const seen = new Set();
  for (const entry of [...READ_ONLY_ENDPOINTS, ...READ_ONLY_POST_ENDPOINTS, ...BLOCKED_MUTATION_ENDPOINTS]) {
    const key = `${entry.method} ${entry.path}`;
    const ok = !seen.has(key);
    checks.push({ ok, label: key, message: ok ? entry.label : `duplicate endpoint matrix entry for ${key}` });
    seen.add(key);
  }

  if (checkDist) {
    try {
      const connector = await import("../dist/daemon/src/core/worktreeConnector.js");
      const matcher = connector.isAllowedReadOnlyBridgeRequest;
      for (const entry of [...READ_ONLY_ENDPOINTS, ...READ_ONLY_POST_ENDPOINTS]) {
        const pathname = new URL(entry.path, "http://127.0.0.1").pathname;
        const ok = matcher(entry.method, pathname) === true;
        checks.push({ ok, label: `matcher allows ${entry.method} ${entry.path}`, message: ok ? entry.label : "read-only bridge matcher rejects matrix endpoint" });
      }
      for (const entry of BLOCKED_MUTATION_ENDPOINTS) {
        const pathname = new URL(entry.path, "http://127.0.0.1").pathname;
        const ok = matcher(entry.method, pathname) === false;
        checks.push({ ok, label: `matcher blocks ${entry.method} ${entry.path}`, message: ok ? entry.label : "read-only bridge matcher allows mutation endpoint" });
      }
    } catch (error) {
      checks.push({
        ok: false,
        label: "dist matcher",
        message: `could not load built worktree connector; run npm run build:daemon first (${error instanceof Error ? error.message : String(error)})`
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    counts: {
      readOnly: READ_ONLY_ENDPOINTS.length,
      readOnlyPosts: READ_ONLY_POST_ENDPOINTS.length,
      blockedMutations: BLOCKED_MUTATION_ENDPOINTS.length
    },
    checks
  };
}

async function probeLiveDaemon(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const rows = [];
  let healthBody;

  for (const entry of READ_ONLY_ENDPOINTS.filter((candidate) => candidate.method === "GET")) {
    const result = await probeEndpoint(normalizedBaseUrl, entry.path);
    if (entry.path === "/health") healthBody = result.body;
    rows.push({
      method: entry.method,
      path: entry.path,
      status: result.status,
      contentType: formatContentType(result.contentType),
      contract: classifyEndpoint(entry, result)
    });
  }

  printFingerprint(healthBody);
  printRows(rows);

  const missingRequiredEndpoint = rows.some((row) => row.contract === "missing");
  const incompatibleHealth = rows.find((row) => row.path === "/health")?.contract !== "current-compatible";
  return !missingRequiredEndpoint && !incompatibleHealth;
}

async function probeEndpoint(baseUrl, path) {
  const url = new URL(path, baseUrl);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    let body;
    if (contentType.includes("json")) {
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
    } else {
      body = await response.text().catch(() => undefined);
    }
    return { status: String(response.status), contentType, body };
  } catch (error) {
    return { status: "ERR", contentType: "", body: error instanceof Error ? error.message : String(error) };
  }
}

function classifyEndpoint(entry, result) {
  if (result.status === "ERR") return "offline";
  if (result.status === "404" && entry.allowNotFound) return "present-empty";
  if (result.status === "404") return "missing";
  if (entry.path === "/health") return classifyHealth(result.body);
  if (Number(result.status) >= 200 && Number(result.status) < 300) return "present";
  return "unexpected";
}

function classifyHealth(body) {
  if (!isRecord(body)) return "malformed";
  if (body.ok !== true) return "unhealthy";
  if (!("product" in body) || !("apiVersion" in body)) return "legacy";
  if (body.product !== "masthead") return "wrong-product";
  if (typeof body.apiVersion !== "number" || body.apiVersion < 1) return "unsupported-api";

  const capabilities = new Set(Array.isArray(body.capabilities) ? body.capabilities : []);
  const missingCapabilities = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.has(capability));
  if (missingCapabilities.length > 0) return `missing-capabilities:${missingCapabilities.join(",")}`;
  return "current-compatible";
}

function printFingerprint(body) {
  const record = isRecord(body) ? body : {};
  const runtime = isRecord(record.runtime) ? record.runtime : {};
  const data = isRecord(record.data) ? record.data : {};
  console.log("Health fingerprint");
  console.log(`apiVersion: ${formatValue(record.apiVersion)}`);
  console.log(`schemaVersion: ${formatValue(record.schemaVersion)}`);
  console.log(`buildVersion: ${formatValue(record.buildVersion)}`);
  console.log(`buildSha: ${formatValue(record.buildSha)}`);
  console.log(`capabilities: ${Array.isArray(record.capabilities) ? record.capabilities.join(",") : "legacy/unknown"}`);
  console.log(`databasePath: ${formatValue(data.databasePath ?? record.databasePath)}`);
  console.log(`daemonInstanceId: ${formatValue(runtime.daemonInstanceId ?? record.daemonInstanceId)}`);
  console.log("");
}

function printRows(rows) {
  const headers = ["METHOD", "PATH", "STATUS", "CONTENT-TYPE", "CONTRACT"];
  const widths = [
    headers[0].length,
    Math.max(headers[1].length, ...rows.map((row) => row.path.length)),
    headers[2].length,
    headers[3].length,
    Math.max(headers[4].length, ...rows.map((row) => row.contract.length))
  ];
  console.log(formatRow(headers, widths));
  for (const row of rows) console.log(formatRow([row.method, row.path, row.status, row.contentType, row.contract], widths));
}

function formatRow(values, widths) {
  return values.map((value, index) => value.padEnd(widths[index])).join("  ");
}

function formatContentType(contentType) {
  if (!contentType) return "none";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("text")) return "text";
  return contentType.split(";")[0];
}

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "legacy/unknown" : String(value);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
