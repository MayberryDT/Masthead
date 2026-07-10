#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { findHookTranscriptStuckSessions } from "./masthead-doctor-hook-capture.js";
import { buildPackagedCliInvocation } from "./packaged-cli-command.js";

const REQUIRED_HOOK_EVENTS = ["SessionStart", "PermissionRequest", "PostToolUse", "Stop"];
const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const AUTHORING_OPERATIONS = ["open", "status", "evidence", "submit", "finish"];
const REQUIRED_CAPABILITIES = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "import_jobs",
  "mcp_status",
  "usage_stats",
  "settings",
  "data_lifecycle",
  "artifact_authoring"
];
const PRODUCT_ENDPOINTS = [
  "/adapters",
  "/sources",
  "/sessions",
  "/logbook/summary",
  "/usage/summary?window=today",
  "/mcp/status",
  "/mcp/tools",
  "/settings",
  "/data/summary",
  "/live/state"
];
const baseUrl = normalizeBaseUrl(process.env.MASTHEAD_BASE_URL || process.env.MASTHEAD_HEALTH_URL || "http://127.0.0.1:17373");
const hookConfigPath = resolve(process.env.MASTHEAD_CODEX_HOOKS || join(homedir(), ".codex/hooks.json"));
const jsonOutput = process.argv.includes("--json");
const strictHooks = process.env.MASTHEAD_DOCTOR_STRICT_HOOKS === "1";
let mcpRequestId = 0;
let health;

if (isEntrypoint()) await main();

async function main() {
  const checks = [];
  checks.push(await checkNodeRuntime());
  checks.push(await checkDaemonBuild());
  checks.push(await checkSqliteRuntime());
  const protocol = await checkProtocol();
  checks.push(protocol.check);
  health = protocol.health;
  checks.push(checkDatabaseIdentity(health));
  checks.push(await checkAuthoring());
  checks.push(await checkEndpoints());
  checks.push(await checkSources());
  checks.push(await checkImports());
  checks.push(await checkSourcesPipeline());
  checks.push(await checkMcp());
  checks.push(await checkMcpStdio());
  checks.push(await checkLogbook());
  checks.push(await checkUsage());
  checks.push(await checkHookTranscriptCapture());
  checks.push(await checkSettings());
  checks.push(await checkDestructivePreviewSafety());
  checks.push(await checkLiveConnectors());
  checks.push(await checkHarnessConnectors());
  checks.push(await checkLiveState());
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
}

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

export function inspectAuthoringCapabilities(value, expectedDatabaseId) {
  const capabilities = isRecord(value) ? value : {};
  const problems = [];
  const command = stringValue(capabilities.command);
  const databaseId = stringValue(capabilities.databaseId);
  const operations = Array.isArray(capabilities.operations)
    ? capabilities.operations.filter((operation) => typeof operation === "string")
    : [];

  if (capabilities.capability !== "artifact_authoring") problems.push("artifact_authoring capability is missing");
  if (capabilities.protocol !== "masthead.workbench.authoring/v1") problems.push("authoring protocol is incompatible");
  if (capabilities.transport !== "daemon_http") problems.push("authoring transport is not daemon_http");
  if (capabilities.bundleVersion !== "workbench-authoring-v1") problems.push("authoring bundle version is incompatible");
  if (capabilities.evidencePolicy !== "all_canonical_redacted_evidence") problems.push("authoring evidence policy is incomplete");
  if (!command) problems.push("authoring command is missing");
  if (!databaseId || databaseId !== expectedDatabaseId) problems.push("database identity mismatch");
  if (
    operations.length !== AUTHORING_OPERATIONS.length ||
    !AUTHORING_OPERATIONS.every((operation, index) => operations[index] === operation)
  ) {
    problems.push("authoring operations are incomplete");
  }

  return { command, databaseId, ok: problems.length === 0, operations, problems };
}

export async function resolveAuthoringCommand(command, options = {}) {
  const value = stringValue(command);
  if (!value) return undefined;
  const isExecutable = options.isExecutable;
  if (typeof isExecutable !== "function") throw new Error("resolveAuthoringCommand requires isExecutable");
  if (isAbsolute(value)) return (await isExecutable(value)) ? value : undefined;
  if (value.includes("/") || value.includes("\\")) return undefined;

  // Workbench handoffs require an absolute capability command. Doctor also
  // accepts the documented compatibility form: a genuinely bare command that
  // resolves to an executable on PATH, then invokes that resolved path.
  const pathEntries = Array.isArray(options.pathEntries) ? options.pathEntries : [];
  const extensions = Array.isArray(options.extensions) && options.extensions.length > 0
    ? options.extensions
    : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(directory, `${value}${extension}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

async function checkAuthoring() {
  const data = isRecord(health?.data) ? health.data : {};
  const expectedDatabaseId = stringValue(data.databaseId);
  if (!expectedDatabaseId) {
    return {
      id: "artifact-authoring",
      label: "artifact authoring",
      status: "fail",
      message: "Health did not expose the database identity required by authoring.",
      details: { baseUrl }
    };
  }

  try {
    const capabilities = await getJson("/workbench/authoring/capabilities");
    const inspected = inspectAuthoringCapabilities(capabilities, expectedDatabaseId);
    const commandPath = await resolveAuthoringCommand(inspected.command, {
      extensions: process.platform === "win32"
        ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((extension) => extension.toLowerCase())
        : [""],
      isExecutable: executableFile,
      pathEntries: (process.env.PATH || "").split(delimiter).filter(Boolean)
    });
    const cliCapabilities = commandPath
      ? await runJsonCommand(commandPath, ["workbench", "capabilities", "--json"])
      : undefined;
    const cliInspected = inspectAuthoringCapabilities(cliCapabilities, expectedDatabaseId);
    const ok = inspected.ok && Boolean(commandPath) && cliInspected.ok;
    return {
      id: "artifact-authoring",
      label: "artifact authoring",
      status: ok ? "ok" : "fail",
      message: ok
        ? `Installed authoring CLI is ready for ${expectedDatabaseId}; open, status, evidence, submit, and finish are available.`
        : "Daemon authoring capabilities, installed command, or CLI database identity are invalid.",
      details: {
        capability: capabilities.capability,
        command: inspected.command,
        commandPath,
        daemonDatabaseId: inspected.databaseId,
        cliDatabaseId: cliInspected.databaseId,
        operations: inspected.operations,
        problems: [
          ...inspected.problems,
          ...(commandPath ? [] : ["authoring command is not executable or resolvable on PATH"]),
          ...cliInspected.problems.map((problem) => `installed CLI: ${problem}`)
        ]
      }
    };
  } catch (error) {
    return {
      id: "artifact-authoring",
      label: "artifact authoring",
      status: "fail",
      message: errorMessage(error),
      details: { baseUrl, expectedDatabaseId }
    };
  }
}

async function executableFile(path) {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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
    const adapters = Array.isArray(body.adapters) ? body.adapters.filter(isRecord) : [];
    const importAdapters = adapters.filter((adapter) => adapter.implementationState === "active");
    const scanTargets = adapters.filter((adapter) => adapter.implementationState === "scan_target");
    const detectedAdapters = adapters.filter((adapter) => adapter.state !== "not_detected");
    const plannedAdapters = adapters.filter((adapter) => isRecord(adapter) && (adapter.state === "planned" || adapter.implementationState === "planned"));
    const diagnosticsCount = adapters.reduce((total, adapter) => total + (Array.isArray(adapter.diagnostics) ? adapter.diagnostics.length : 0), 0);
    const details = {
      adapters: adapters.length,
      detectedAdapters: detectedAdapters.length,
      diagnosticsCount,
      importAdapters: importAdapters.length,
      scanTargets: scanTargets.length,
      plannedAdapters: plannedAdapters.length
    };
    return {
      id: "source-discovery",
      label: "source discovery",
      status: adapters.length > 0 && importAdapters.length > 0 ? "ok" : "fail",
      message: `${adapters.length} adapters reported; ${detectedAdapters.length} detected, ${importAdapters.length} import-capable, ${scanTargets.length} scan-only.`,
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
    const tools = Array.isArray(toolsBody.tools) ? toolsBody.tools.filter(isRecord) : [];
    const toolNames = tools.map((tool) => tool.name).filter((name) => typeof name === "string").sort();
    const unsafeTools = toolNames.filter((name) => /write|delete|clear|import|install|uninstall|approve|run|execute/i.test(name));
    const invalidPermissions = tools.filter((tool) => tool.permission !== "Read only").map((tool) => tool.name);
    const statusToolCount = numberValue(status.toolCount);
    const catalogMatchesStatus = statusToolCount === toolNames.length;
    const valid = toolNames.length > 0 && catalogMatchesStatus && unsafeTools.length === 0 && invalidPermissions.length === 0;
    return {
      id: "mcp",
      label: "mcp",
      status: valid ? "ok" : "fail",
      message: valid ? `MCP exposes ${toolNames.length} read-only tools.` : "MCP HTTP tool catalog is inconsistent or exposes unsafe tools.",
      details: {
        catalogMatchesStatus,
        invalidPermissions,
        toolCount: toolNames.length,
        toolNames,
        unsafeTools,
        globalAccessEnabled: status.globalAccessEnabled,
        queryCount: status.queryCount
      }
    };
  } catch (error) {
    return { id: "mcp", label: "mcp", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkMcpStdio() {
  const data = isRecord(health?.data) ? health.data : {};
  const databasePath = stringValue(data.databasePath);
  if (!databasePath) {
    return {
      id: "mcp-stdio",
      label: "mcp stdio",
      status: "fail",
      message: "Health did not expose a database path for MCP stdio verification.",
      details: { baseUrl }
    };
  }

  let child;
  try {
    const catalogBody = await getJson("/mcp/tools");
    const expectedToolNames = Array.isArray(catalogBody.tools)
      ? catalogBody.tools.map((tool) => tool.name).filter((name) => typeof name === "string").sort()
      : [];
    assert(expectedToolNames.length > 0, "HTTP MCP tool catalog is empty");
    child = spawn(process.execPath, ["dist/daemon/src/mcp/server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const initialized = await mcpRpc(child, "initialize", {});
    const serverInfo = isRecord(initialized.result?.serverInfo) ? initialized.result.serverInfo : {};
    assert(serverInfo.name === "masthead", "initialize did not return Masthead server identity");

    const tools = await mcpRpc(child, "tools/list", {});
    const toolEntries = Array.isArray(tools.result?.tools) ? tools.result.tools : [];
    const toolNames = toolEntries.map((tool) => tool.name).filter((name) => typeof name === "string").sort();
    assert(JSON.stringify(toolNames) === JSON.stringify(expectedToolNames), `tool catalog mismatch: ${toolNames.join(", ")}`);

    const coverage = await mcpToolCall(child, "get_masthead_coverage", {});
    assert(numberValue(coverage.sessions) !== undefined, "coverage tool did not return a sessions count");

    return {
      id: "mcp-stdio",
      label: "mcp stdio",
      status: "ok",
      message: `MCP stdio initialized, listed ${toolNames.length} tools, and served coverage.`,
      details: {
        databasePath,
        toolNames,
        coverageSessions: coverage.sessions,
        protocolVersion: initialized.result?.protocolVersion,
        serverInfo
      }
    };
  } catch (error) {
    return {
      id: "mcp-stdio",
      label: "mcp stdio",
      status: "fail",
      message: errorMessage(error),
      details: { databasePath }
    };
  } finally {
    if (child) await stopChild(child);
  }
}

async function checkImports() {
  try {
    const body = await getJson("/imports");
    const jobs = importJobsFromBody(body);
    return {
      id: "imports",
      label: "imports",
      status: "ok",
      message: `Import endpoint responded with ${jobs.length} job${jobs.length === 1 ? "" : "s"}.`,
      details: { jobs: jobs.length }
    };
  } catch (error) {
    return { id: "imports", label: "imports", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkSourcesPipeline() {
  try {
    const [scanBody, adaptersBody, sourcesBody, importsBody, failedImportsBody, logbookBody, usageBody, settingsBody, runtimeDiagnosticsBody] =
      await Promise.all([
        getJson("/sources/scan/latest"),
        getJson("/adapters"),
        getJson("/sources"),
        getJson("/imports?limit=50"),
        getJson("/imports?limit=50&status=failed"),
        getJson("/logbook/summary"),
        getJson("/usage/summary?window=all"),
        getJson("/settings"),
        getJson("/diagnostics/runtime").catch((error) => ({ diagnosticsEndpointError: errorMessage(error) }))
      ]);

    const scan = isRecord(scanBody.scan) ? scanBody.scan : undefined;
    const adapters = Array.isArray(adaptersBody.adapters) ? adaptersBody.adapters.filter(isRecord) : [];
    const sources = Array.isArray(sourcesBody.sources) ? sourcesBody.sources.filter(isRecord) : [];
    const imports = importJobsFromBody(importsBody);
    const failedImports = importJobsFromBody(failedImportsBody);
    const summary = isRecord(logbookBody.summary) ? logbookBody.summary : {};
    const usage = isRecord(usageBody.usage) ? usageBody.usage : {};
    const coverage = isRecord(usage.coverage) ? usage.coverage : {};
    const settings = isRecord(settingsBody.settings) ? settingsBody.settings : {};
    const enrichment = isRecord(settings.enrichment) ? settings.enrichment : {};
    const enrichmentHealth = isRecord(enrichment.health) ? enrichment.health : {};
    const runtimeDiagnostics = isRecord(runtimeDiagnosticsBody) && Array.isArray(runtimeDiagnosticsBody.diagnostics)
      ? runtimeDiagnosticsBody.diagnostics.length
      : undefined;

    if (!scan) {
      return {
        id: "sources-pipeline",
        label: "sources pipeline",
        status: "fail",
        message: "Sources setup endpoint did not return a scan payload.",
        details: { setupEndpoint: "/sources/scan/latest", baseUrl }
      };
    }

    const scanGeneratedAt = stringValue(scan.generatedAt);
    const scanAgeMs = scanGeneratedAt ? Date.now() - Date.parse(scanGeneratedAt) : undefined;
    const scanStale = scanAgeMs === undefined || !Number.isFinite(scanAgeMs) || scanAgeMs > 24 * 60 * 60 * 1000;
    const scanCachedOnly = scan.scanId === "scan:cached";
    const importedSessions = sources.reduce((total, source) => total + (numberValue(source.importedSessions ?? source.sessionCount) ?? 0), 0);
    const sourceFailureCount = sources.reduce((total, source) => total + (numberValue(source.failureCount ?? source.failures) ?? 0), 0);
    const adapterDiagnostics = adapters.flatMap((adapter) => (Array.isArray(adapter.diagnostics) ? adapter.diagnostics.filter(isRecord) : []));
    const unrecognizedDiagnostics = adapterDiagnostics.filter(isUnrecognizedSchemaDiagnostic);
    const unrecognizedSourceCount = unrecognizedDiagnostics.reduce((total, diagnostic) => total + (numberValue(diagnostic.count) ?? 1), 0);
    const sessions = numberValue(summary.sessions) ?? 0;
    const messages = numberValue(summary.messages) ?? 0;
    const toolCalls = numberValue(summary.toolCalls) ?? 0;
    const transcriptHasRows = messages > 0 || toolCalls > 0;
    const enrichmentSessions = numberValue(enrichment.sessionCount) ?? sessions;
    const currentEnrichments = numberValue(enrichment.currentEnrichments ?? coverage.currentEnrichments) ?? 0;
    const enrichmentComplete = numberValue(enrichmentHealth.complete) ?? currentEnrichments;
    const warnings = [];
    const repairRecommendations = [];

    if (scanCachedOnly || scanStale) {
      warnings.push("latest scan is missing or stale");
      repairRecommendations.push("Open Sources and run Scan this computer to refresh bounded local discovery.");
    }
    if (sources.length === 0) {
      warnings.push("no connected sources");
      repairRecommendations.push("Connect selected recognized sources after a scan; Masthead will not crawl the whole home directory.");
    }
    if (sourceFailureCount > 0 || failedImports.length > 0) {
      warnings.push("import failures recorded");
      repairRecommendations.push("Use Sources advanced diagnostics or /imports?status=failed to inspect failures, then retry after fixing path or schema issues.");
    }
    if (sessions > 0 && !transcriptHasRows) {
      warnings.push("no transcript rows for imported sessions");
      repairRecommendations.push("Approve transcript import for trusted sources, then run transcript import or sync connected.");
    }
    if (enrichmentSessions > 0 && enrichmentHealth.status === "partial") {
      warnings.push("enrichment coverage is partial");
      repairRecommendations.push("Keep the daemon running after imports or inspect Settings enrichment health for failed or queued enrichment.");
    }
    if (unrecognizedSourceCount > 0) {
      warnings.push("unrecognized source schemas detected");
      repairRecommendations.push("Leave detector-only or unrecognized sources as diagnostics until their schema is mapped; do not treat them as successful transcript imports.");
    }

    return {
      id: "sources-pipeline",
      label: "sources pipeline",
      status: warnings.length === 0 ? "ok" : "warn",
      message:
        warnings.length === 0
          ? `Sources pipeline responded; ${sources.length} source${sources.length === 1 ? "" : "s"} and ${importedSessions} imported session${importedSessions === 1 ? "" : "s"}.`
          : `Sources pipeline warnings: ${warnings.join("; ")}.`,
      details: {
        setupEndpoint: "/sources/scan/latest",
        latestScan: {
          ageMs: scanAgeMs,
          generatedAt: scanGeneratedAt,
          scanId: scan.scanId,
          stale: Boolean(scanStale),
          cachedOnly: Boolean(scanCachedOnly)
        },
        connectedSourceCount: sources.length,
        importedSessions,
        transcriptCoverage: {
          sessions,
          messages,
          toolCalls,
          hasRows: transcriptHasRows
        },
        enrichmentCoverage: {
          currentEnrichments,
          complete: enrichmentComplete,
          failed: enrichmentHealth.failed,
          gitSnapshotsWithoutFileEffects: enrichmentHealth.gitSnapshotsWithoutFileEffects,
          queued: enrichmentHealth.queued,
          remoteModelEnabled: enrichment.remoteModelEnabled,
          repeatedFailedFingerprints: enrichmentHealth.repeatedFailedFingerprints,
          sessionsWithMessagesButNoEffects: enrichmentHealth.sessionsWithMessagesButNoEffects,
          status: enrichmentHealth.status,
          sessions: enrichmentSessions,
          weakCurrentTitles: enrichmentHealth.weakCurrentTitles
        },
        importFailures: {
          failedPageCount: failedImports.length,
          failedTotal: numberValue(failedImportsBody.total) ?? failedImports.length,
          sourceFailureCount
        },
        unrecognizedSourceCount,
        runtimeDiagnostics,
        recentImportJobs: imports.length,
        repairRecommendations: dedupeStrings(repairRecommendations)
      }
    };
  } catch (error) {
    return {
      id: "sources-pipeline",
      label: "sources pipeline",
      status: "fail",
      message: errorMessage(error),
      details: { baseUrl }
    };
  }
}

async function checkLogbook() {
  try {
    const [summaryBody, searchBody] = await Promise.all([getJson("/logbook/summary"), getJson("/logbook/artifacts?limit=1")]);
    const summary = isRecord(summaryBody.artifactSummary) ? summaryBody.artifactSummary : {};
    const artifactRows = Array.isArray(searchBody.artifacts) ? searchBody.artifacts.filter(isRecord) : [];
    const artifacts = numberValue(summary.artifacts) ?? 0;
    const firstArtifactId = stringValue(artifactRows[0]?.artifactId);
    let detailStatus = "skipped";
    let detailError;
    let provenanceSessions = 0;
    if (firstArtifactId) {
      try {
        const detailBody = await getJson(`/logbook/artifacts/${encodeURIComponent(firstArtifactId)}`);
        const artifact = isRecord(detailBody.artifact) ? detailBody.artifact : {};
        provenanceSessions = Array.isArray(artifact.provenanceSessionIds) ? artifact.provenanceSessionIds.length : 0;
        detailStatus = isRecord(artifact.body) && provenanceSessions > 0 ? "ok" : "invalid";
      } catch (error) {
        detailStatus = "fail";
        detailError = errorMessage(error);
      }
    }
    const status = detailStatus === "fail" || detailStatus === "invalid" || (artifacts > 0 && artifactRows.length === 0) ? "fail" : artifacts === 0 ? "warn" : "ok";
    return {
      id: "logbook",
      label: "logbook",
      status,
      message:
        artifacts === 0
          ? "Logbook has zero published artifacts."
          : detailStatus === "ok"
            ? `Logbook has ${artifacts} published artifact${artifacts === 1 ? "" : "s"}; artifact detail and provenance are readable.`
            : `Logbook has ${artifacts} published artifact${artifacts === 1 ? "" : "s"}; detail ${detailStatus}.`,
      details: {
        artifacts,
        byKind: summary.byKind,
        detailError,
        detailStatus,
        firstArtifactId,
        provenanceSessions,
        projects: summary.projects,
        searchRows: artifactRows.length
      }
    };
  } catch (error) {
    return { id: "logbook", label: "logbook", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkUsage() {
  try {
    const body = await getJson("/usage/summary?window=today");
    const usage = isRecord(body.usage) ? body.usage : {};
    const totals = isRecord(usage.totals) ? usage.totals : {};
    const missing = [];
    if (usage.window !== "today") missing.push("window");
    if (!isRecord(usage.range)) missing.push("range");
    if (numberValue(totals.sessions) === undefined) missing.push("totals.sessions");
    if (numberValue(totals.totalTokens) === undefined) missing.push("totals.totalTokens");
    if (!Array.isArray(usage.byModel)) missing.push("byModel");
    if (!Array.isArray(usage.byProject)) missing.push("byProject");
    if (!Array.isArray(usage.byRuntime)) missing.push("byRuntime");
    if (!Array.isArray(usage.activity)) missing.push("activity");
    if (!isRecord(usage.coverage)) missing.push("coverage");

    const sessions = numberValue(totals.sessions) ?? 0;
    const totalTokens = numberValue(totals.totalTokens) ?? 0;
    return {
      id: "usage-summary",
      label: "usage summary",
      status: missing.length > 0 ? "fail" : sessions === 0 || totalTokens === 0 ? "warn" : "ok",
      message:
        missing.length > 0
          ? `Usage summary missing ${missing.join(", ")}.`
          : sessions === 0
            ? "Usage summary has zero sessions today."
            : totalTokens === 0
              ? `Usage summary has ${sessions} session${sessions === 1 ? "" : "s"} today but zero total tokens.`
              : `Usage summary has ${sessions} session${sessions === 1 ? "" : "s"} and ${totalTokens} tokens today.`,
      details: {
        sessions,
        totalTokens,
        tokenRows: totals.tokenRows,
        toolCalls: totals.toolCalls,
        mcpQueries: totals.mcpQueries,
        missing
      }
    };
  } catch (error) {
    return { id: "usage-summary", label: "usage summary", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkHookTranscriptCapture() {
  const data = isRecord(health?.data) ? health.data : {};
  const databasePath = stringValue(data.databasePath);
  if (!databasePath) {
    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: "Health did not expose a database path for hook transcript capture checks.",
      details: { baseUrl }
    };
  }

  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const { checkedCandidates, stuckSessions } = findHookTranscriptStuckSessions(db, { candidateLimit: 10, stuckLimit: 10 });

    if (stuckSessions.length === 0) {
      return {
        id: "hook-transcript-capture",
        label: "hook transcript capture",
        status: "ok",
        message: "Recent Codex hooks with transcript paths are not stuck in a hook-only tokenless state.",
        details: { checkedHookTranscriptCandidates: checkedCandidates, databasePath, stuckSessions: [] }
      };
    }

    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: `${stuckSessions.length} recent Codex session${stuckSessions.length === 1 ? "" : "s"} have hook transcript paths but no useful transcript messages or token rows.`,
      details: {
        checkedHookTranscriptCandidates: checkedCandidates,
        databasePath,
        repairRecommendations: [
          "Confirm transcript import is approved in Sources.",
          "Restart npm run dev without MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0.",
          "If the warning is for old rows only, run approved transcript import from Sources."
        ],
        stuckSessions
      }
    };
  } catch (error) {
    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: errorMessage(error),
      details: { databasePath }
    };
  } finally {
    if (db) db.close();
  }
}

async function checkSettings() {
  try {
    const body = await getJson("/settings");
    const settings = isRecord(body.settings) ? body.settings : {};
    const data = isRecord(settings.data) ? settings.data : {};
    const runtime = isRecord(settings.runtime) ? settings.runtime : {};
    const hooks = isRecord(settings.hooks) ? settings.hooks : {};
    const storage = isRecord(settings.storage) ? settings.storage : {};
    const privacy = isRecord(settings.privacy) ? settings.privacy : {};
    const enrichment = isRecord(settings.enrichment) ? settings.enrichment : {};
    const deletionTargets = isRecord(settings.deletionTargets) ? settings.deletionTargets : {};
    const missing = [];
    if (settings.product !== "masthead") missing.push("product");
    if (settings.apiVersion !== 1) missing.push("apiVersion");
    if (numberValue(settings.schemaVersion) === undefined) missing.push("schemaVersion");
    if (!stringValue(data.databaseId)) missing.push("data.databaseId");
    if (!stringValue(data.databasePath)) missing.push("data.databasePath");
    if (!stringValue(data.dataDirectory)) missing.push("data.dataDirectory");
    if (!stringValue(runtime.mode)) missing.push("runtime.mode");
    if (!isRecord(storage.dataSummary)) missing.push("storage.dataSummary");
    if (!isRecord(hooks) || !("installed" in hooks)) missing.push("hooks");
    if (!isRecord(privacy) || !("mcpAccessEnabled" in privacy)) missing.push("privacy");
    if (!isRecord(enrichment) || !("provider" in enrichment)) missing.push("enrichment");
    if (!isRecord(deletionTargets)) missing.push("deletionTargets");

    return {
      id: "settings-contract",
      label: "settings contract",
      status: missing.length === 0 ? "ok" : "fail",
      message: missing.length === 0 ? "Settings endpoint exposes runtime, storage, privacy, hooks, and deletion state." : `Settings missing ${missing.join(", ")}.`,
      details: {
        databaseId: data.databaseId,
        databasePath: data.databasePath,
        runtimeMode: runtime.mode,
        schemaVersion: settings.schemaVersion,
        missing
      }
    };
  } catch (error) {
    return { id: "settings-contract", label: "settings contract", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkDestructivePreviewSafety() {
  try {
    const response = await fetch(new URL("/data/summary?databaseId=sqlite:stale-doctor-check", baseUrl), { headers: { accept: "application/json" } });
    const body = await response.text();
    const ok = response.status === 400 && body.includes("Masthead database changed");
    return {
      id: "destructive-preview-safety",
      label: "destructive preview safety",
      status: ok ? "ok" : "fail",
      message: ok ? "Stale database identity is rejected before destructive previews." : `Expected stale database preview to return 400; got ${response.status}.`,
      details: { status: response.status }
    };
  } catch (error) {
    return { id: "destructive-preview-safety", label: "destructive preview safety", status: "fail", message: errorMessage(error), details: { baseUrl } };
  }
}

async function checkHooks() {
  try {
    const daemonHooks = await getJson("/settings/hooks/codex").catch(() => undefined);
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
        ? `installed in ${hookConfigPath}; after reinstall/repair open Codex /hooks to re-trust (untrusted hooks are skipped)`
        : `missing ${verified.missingEvents.join(", ") || "none"}; mismatched ${verified.mismatchedEvents.join(", ") || "none"}; mode ${mode.toString(8)}`,
      details: {
        hookConfigPath,
        strict: strictHooks,
        ...verified,
        daemonInstalled: isRecord(daemonHooks?.hooks) ? daemonHooks.hooks.installed : undefined,
        mode: mode.toString(8),
        privateMode,
        trustNote: "Codex skips untrusted non-managed hooks, including for codex exec. Re-trust via /hooks after hook command changes."
      }
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

async function checkLiveConnectors() {
  try {
    const body = await getJson("/settings/hooks");
    const hooks = isRecord(body.hooks) ? body.hooks : {};
    const integrations = Array.isArray(hooks.integrations) ? hooks.integrations.filter(isRecord) : [];
    const targetRuntimes = ["codex", "claude_code", "cursor", "grok", "omp", "opencode", "hermes", "pi"];
    const targets = targetRuntimes.map((runtime) => {
      const integration = integrations.find((item) => item.runtime === runtime);
      return {
        runtime,
        label: stringValue(integration?.label) ?? runtime,
        status: stringValue(integration?.status) ?? "missing",
        configPath: stringValue(integration?.configPath),
        endpoint: stringValue(integration?.endpoint),
        supportsActions: integration?.supportsActions === true
      };
    });
    const missing = targets.filter((target) => target.status === "missing");
    const needsRepair = targets.filter((target) => target.status === "needs_repair");
    const installed = targets.filter((target) => target.status === "installed");
    const ok = missing.length === 0 && needsRepair.length === 0 && installed.length === targetRuntimes.length;

    return {
      id: "live-connectors",
      label: "live connectors",
      status: ok ? "ok" : strictHooks ? "fail" : "warn",
      message: ok
        ? "All release target live connectors are installed."
        : `${installed.length}/${targetRuntimes.length} release target live connectors installed; ${needsRepair.length} need repair; ${missing.length} missing.`,
      details: {
        strict: strictHooks,
        targets,
        aggregateInstalled: hooks.installed === true,
        missingEvents: Array.isArray(hooks.missingEvents) ? hooks.missingEvents : [],
        mismatchedEvents: Array.isArray(hooks.mismatchedEvents) ? hooks.mismatchedEvents : []
      }
    };
  } catch (error) {
    return {
      id: "live-connectors",
      label: "live connectors",
      status: strictHooks ? "fail" : "warn",
      message: errorMessage(error),
      details: { baseUrl, strict: strictHooks }
    };
  }
}

async function checkHarnessConnectors() {
  try {
    const body = await getJson("/sources/connectors");
    const summary = isRecord(body.summary) ? body.summary : {};
    const ready = numberValue(summary.ready) ?? 0;
    const needsAction = numberValue(summary.needsAction) ?? 0;
    const notInstalled = numberValue(summary.notInstalled) ?? 0;
    const notFound = numberValue(summary.notFound) ?? 0;
    const errorCount = numberValue(summary.error) ?? 0;
    const connectors = Array.isArray(body.connectors) ? body.connectors.filter(isRecord) : [];
    const found = connectors.filter((connector) => connector.presence === "found");
    const attention = found.filter((connector) => {
      const live = stringValue(connector.live);
      return live === "needs_action" || live === "not_installed" || live === "error";
    });
    const summaryMessage = `${ready} ready, ${needsAction} needs action, ${notInstalled} not installed, ${notFound} not found, ${errorCount} error`;
    const ok = attention.length === 0;

    return {
      id: "harness-connectors",
      label: "harness connectors",
      status: ok ? "ok" : "warn",
      message: ok
        ? found.length === 0
          ? `No found harnesses (${summaryMessage}).`
          : `All found harnesses are ready (${summaryMessage}).`
        : `${attention.length} found harness(es) need attention (${summaryMessage}).`,
      details: {
        summary: { ready, needsAction, notInstalled, notFound, error: errorCount },
        found: found.length,
        attention: attention.map((connector) => ({
          runtime: stringValue(connector.runtime),
          live: stringValue(connector.live),
          actionRequired: stringValue(connector.actionRequired)
        })),
        generatedAt: stringValue(body.generatedAt)
      }
    };
  } catch (error) {
    return {
      id: "harness-connectors",
      label: "harness connectors",
      status: "fail",
      message: errorMessage(error),
      details: { baseUrl }
    };
  }
}

async function checkLiveState() {
  try {
    const [stateBody, hooksBody] = await Promise.all([getJson("/live/state"), getJson("/settings/hooks").catch(() => undefined)]);
    const reports = Array.isArray(stateBody.reports) ? stateBody.reports.filter(isRecord) : [];
    const hooks = isRecord(hooksBody?.hooks) ? hooksBody.hooks : {};
    const integrations = Array.isArray(hooks.integrations) ? hooks.integrations.filter(isRecord) : [];
    const integrationStates = integrations
      .map((integration) => ({
        runtime: stringValue(integration.runtime),
        latestState: stringValue(integration.latestState),
        latestStateReportAt: stringValue(integration.latestStateReportAt),
        stateEndpoint: stringValue(integration.stateEndpoint)
      }))
      .filter((integration) => integration.latestStateReportAt || integration.latestState);
    const killSwitches = Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key === "MASTHEAD_LIVE_CAPTURE" || key.startsWith("MASTHEAD_LIVE_CAPTURE_"))
        .map(([key, value]) => [key, value])
    );
    const disabled = Object.values(killSwitches).some((value) => value === "0");
    const latestReportAt =
      reports
        .map((report) => stringValue(report.observedAt))
        .filter(Boolean)
        .sort()
        .at(-1) ?? integrationStates.map((state) => state.latestStateReportAt).filter(Boolean).sort().at(-1);
    return {
      id: "live-state",
      label: "live state",
      status: disabled ? "warn" : stateBody.ok === true ? "ok" : "fail",
      message: disabled
        ? "Live capture has an environment kill switch enabled."
        : latestReportAt
          ? `Live state endpoint responded; latest state report at ${latestReportAt}.`
          : "Live state endpoint responded; no state reports are stored yet.",
      details: {
        reportCount: reports.length,
        latestReportAt,
        integrationStates,
        killSwitches
      }
    };
  } catch (error) {
    return {
      id: "live-state",
      label: "live state",
      status: "fail",
      message: errorMessage(error),
      details: { baseUrl }
    };
  }
}

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function runJsonCommand(command, args) {
  return new Promise((resolve, reject) => {
    const invocation = buildPackagedCliInvocation(command, args, {
      comspec: process.env.ComSpec,
      platform: process.platform,
      systemRoot: process.env.SystemRoot
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...invocation.env, MASTHEAD_DAEMON_URL: baseUrl },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error(`authoring CLI timed out; stderr=${stderr}`));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => settle(reject, error);
    const onExit = (code) => {
      if (code !== 0) {
        settle(reject, new Error(`authoring CLI exited ${code}; stderr=${stderr}`));
        return;
      }
      try {
        settle(resolve, JSON.parse(stdout));
      } catch (error) {
        settle(reject, new Error(`authoring CLI returned invalid JSON: ${errorMessage(error)}`));
      }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
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

function mcpRpc(child, method, params) {
  mcpRequestId += 1;
  return sendMcpLine(child, { jsonrpc: "2.0", id: mcpRequestId, method, params });
}

async function mcpToolCall(child, name, args) {
  const response = await mcpRpc(child, "tools/call", { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  assert(typeof text === "string", `${name} returned no text content`);
  return JSON.parse(text);
}

function sendMcpLine(child, payload) {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => settle(reject, new Error(`MCP timeout waiting for ${payload.method}; stderr=${stderr}`)), 8_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onStdout = (chunk) => {
      output += chunk.toString();
      const newlineIndex = output.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = output.slice(0, newlineIndex).trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error.message || `MCP error for ${payload.method}`);
        settle(resolve, parsed);
      } catch (error) {
        settle(reject, error);
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => settle(reject, error);
    const onExit = (code) => settle(reject, new Error(`MCP server exited ${code}; stderr=${stderr}`));
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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

function importJobsFromBody(body) {
  if (Array.isArray(body?.jobs)) return body.jobs.filter(isRecord);
  if (Array.isArray(body?.imports)) return body.imports.filter(isRecord);
  return [];
}

function isUnrecognizedSchemaDiagnostic(diagnostic) {
  const code = stringValue(diagnostic.code) ?? "";
  const message = stringValue(diagnostic.message) ?? "";
  return code.includes("schema_not_recognized") || /schema not recognized/i.test(message);
}

function dedupeStrings(values) {
  return [...new Set(values)];
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isEntrypoint() {
  const invoked = process.argv[1];
  return Boolean(invoked && import.meta.url === pathToFileURL(resolve(invoked)).href);
}
