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

const ENDPOINTS = [
  "/health",
  "/projection",
  "/events",
  "/sources",
  "/adapters",
  "/sessions",
  "/logbook/summary",
  "/mcp/status",
  "/mcp/tools",
  "/mcp/audit",
  "/settings",
  "/settings/hooks/codex",
  "/data/summary"
];

const REQUIRED_ENDPOINTS = new Set(ENDPOINTS);

async function main() {
  const baseUrl = process.argv[2] ?? DEFAULT_BASE_URL;
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const rows = [];
  let healthBody;

  for (const path of ENDPOINTS) {
    const result = await probeEndpoint(normalizedBaseUrl, path);
    if (path === "/health") {
      healthBody = result.body;
    }
    rows.push({
      method: "GET",
      path,
      status: result.status,
      contentType: formatContentType(result.contentType),
      contract: classifyEndpoint(path, result)
    });
  }

  printFingerprint(healthBody);
  printRows(rows);

  const missingRequiredEndpoint = rows.some((row) => REQUIRED_ENDPOINTS.has(row.path) && row.contract === "missing");
  const incompatibleHealth = rows.find((row) => row.path === "/health")?.contract !== "current-compatible";

  if (missingRequiredEndpoint || incompatibleHealth) {
    process.exitCode = 1;
  }
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

    return {
      status: String(response.status),
      contentType,
      body
    };
  } catch (error) {
    return {
      status: "ERR",
      contentType: "",
      body: error instanceof Error ? error.message : String(error)
    };
  }
}

function classifyEndpoint(path, result) {
  if (result.status === "ERR") return "offline";
  if (result.status === "404") return "missing";
  if (path === "/health") return classifyHealth(result.body);
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
  for (const row of rows) {
    console.log(formatRow([row.method, row.path, row.status, row.contentType, row.contract], widths));
  }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
