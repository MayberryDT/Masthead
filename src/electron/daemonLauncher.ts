import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import {
  assertGuidedAuthoringExpectedIdentity,
  canonicalInstancePaths,
  identityFromCapabilities,
  identityFromManifest,
  readMastheadInstanceManifest,
  type GuidedAuthoringExpectedIdentity
} from "../shared/instanceIdentity";
import {
  isAbsoluteAuthoringCommand
} from "../shared/workbenchAuthoring";
import { isWorkbenchAuthoringV5CapabilitiesDto } from "../shared/workbenchAuthoringV5";
import { packagedDaemonPaths } from "./pathPolicy";
import { renderLiveDevInstanceLauncher } from "../core/liveDevLauncher";
import { classifyDaemonHealth } from "../shared/protocol";
import { readReleaseJsonFile, releaseJsonPathBesideMcpEntry } from "../daemon/releaseIdentity.ts";

const DEFAULT_CONNECTOR_PORT = 17373;
export const DAEMON_STARTUP_HEALTH_TIMEOUT_MS = 300_000;
const CONNECTOR_STARTUP_INTERVAL_MS = 200;
const CONNECTOR_STARTUP_TIMEOUT_MS = DAEMON_STARTUP_HEALTH_TIMEOUT_MS;
const execFileAsync = promisify(execFile);
const REQUIRED_CAPABILITIES = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "mcp_status",
  "settings",
  "artifact_authoring"
];

export type MastheadHealthSummary = {
  apiVersion?: number;
  buildSha?: string;
  buildVersion?: string;
  databaseId?: string;
  databasePath?: string;
  dataDirectory?: string;
  mode?: string;
  baseUrl?: string;
  instanceId?: string;
  instanceManifest?: string;
  authoringCommand?: string;
  pid?: number;
};

export type DaemonLaunchTarget = {
  cwd: string;
  dataDirectory: string;
  databasePath: string;
  entryPath: string;
  hookScript?: string;
  legacyStorePath: string;
  mcpEntry: string;
  nodePath: string;
  port: number;
  instanceDir: string;
  instanceManifest: string;
  cliCommand: string;
};

export type StartLiveConnectorResult = {
  ok: true;
  started: boolean;
  baseUrl: string;
  command: string;
  health: MastheadHealthSummary;
  message: string;
  projectionUrl: string;
};

export function connectorStartupPollPolicy(): { intervalMs: number; timeoutMs: number } {
  return {
    intervalMs: CONNECTOR_STARTUP_INTERVAL_MS,
    timeoutMs: CONNECTOR_STARTUP_TIMEOUT_MS
  };
}

export type McpLaunchValidationResult = {
  ready: boolean;
  valid: boolean;
  commandExists: boolean;
  entryExists: boolean;
  databaseMatches: boolean;
  problems: string[];
  commandPath: string;
  entryPath: string;
  configuredDatabasePath: string;
  expectedDatabasePath: string;
};

export type McpLaunchConfigResult = {
  command: string;
  args: string[];
  env: Record<string, string>;
  databasePath: string;
  validation: McpLaunchValidationResult;
};

export type ResolveDaemonLaunchTargetInput = {
  currentDir: string;
  defaultDataDir?: string;
  env: NodeJS.ProcessEnv;
  resourcesPath: string;
  userDataDir: string;
};

export type StartLiveConnectorOptions = {
  prepareAuthoringLauncher?: (input: { baseUrl: string; port: number; instanceManifest: string; launcherPath: string }) => Promise<void>;
  verifyAuthoringManifest?: (path: string, health: MastheadHealthSummary) => Promise<void>;
  findAvailablePort?: (startPort: number) => Promise<number>;
  spawnChild?: typeof spawn;
  waitForCollector?: typeof waitForCompatibleCollector;
  verifyAuthoringLauncher?: (launcherPath: string, manifestPath: string, nodePath: string, cliEntry: string) => Promise<void>;
  childTerminationGraceMs?: number;
  readProcessStartIdentity?: (pid: number) => Promise<string | undefined>;
};

type SpawnedProcessIdentity = {
  pid: number;
  processStartIdentity: string;
};

export function connectorBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function resolveDaemonLaunchTarget(input: ResolveDaemonLaunchTargetInput): DaemonLaunchTarget {
  const port = parsePort(input.env.MASTHEAD_PORT, DEFAULT_CONNECTOR_PORT);
  const dataDirectory = resolve(input.env.MASTHEAD_DATA_DIR || input.defaultDataDir || input.userDataDir);
  const databasePath = resolve(input.env.MASTHEAD_DB_PATH || join(dataDirectory, "masthead.sqlite"));
  const legacyStorePath = resolve(input.env.MASTHEAD_STORE_PATH || join(dataDirectory, "legacy", "events.ndjson"));
  const instancePaths = canonicalInstancePaths(resolve(input.env.MASTHEAD_INSTANCE_DIR || dataDirectory));
  const instanceManifest = resolve(input.env.MASTHEAD_INSTANCE_MANIFEST || instancePaths.instanceManifest);
  const cliCommand = resolve(input.env.MASTHEAD_CLI_COMMAND || instancePaths.launcherPath);
  const canonicalPaths = canonicalInstancePaths(dataDirectory);
  if (instancePaths.instanceDir !== dataDirectory || instanceManifest !== canonicalPaths.instanceManifest || cliCommand !== canonicalPaths.launcherPath) {
    throw new Error("Masthead instance directory, manifest, and CLI command must be derived exactly from MASTHEAD_DATA_DIR");
  }
  const mcpEntryOverride = input.env.MASTHEAD_MCP_ENTRY;

  if (input.env.MASTHEAD_DAEMON_ENTRY) {
    return {
      cwd: input.env.MASTHEAD_PROJECT_DIR || input.currentDir,
      dataDirectory,
      databasePath,
      entryPath: input.env.MASTHEAD_DAEMON_ENTRY,
      hookScript: input.env.MASTHEAD_HOOK_SCRIPT || join(input.currentDir, "scripts", "masthead-hook.js"),
      legacyStorePath,
      mcpEntry: mcpEntryOverride || join(input.currentDir, "dist", "daemon", "src", "mcp", "server.js"),
      nodePath: input.env.MASTHEAD_NODE_PATH || process.execPath,
      port,
      instanceDir: instancePaths.instanceDir,
      instanceManifest,
      cliCommand
    };
  }

  const packaged = packagedDaemonPaths(input.resourcesPath);
  return {
    cwd: dataDirectory,
    dataDirectory,
    databasePath,
    entryPath: packaged.daemonEntry,
    hookScript: input.env.MASTHEAD_HOOK_SCRIPT || packaged.hookScript,
    legacyStorePath,
    mcpEntry: mcpEntryOverride || packaged.mcpEntry,
    nodePath: input.env.MASTHEAD_NODE_PATH || packaged.nodePath,
    port,
    instanceDir: instancePaths.instanceDir,
    instanceManifest,
    cliCommand
  };
}

export function buildDaemonEnv(input: {
  allowedOrigins: string[];
  cliCommand: string;
  dataDirectory: string;
  databasePath: string;
  hookScript?: string;
  legacyStorePath: string;
  mcpCommand: string;
  mcpEntry: string;
  port: number;
  instanceDir: string;
  instanceManifest: string;
  /** Packaged daemon root containing release.json (resources/daemon). */
  releaseJsonPath?: string;
}): Record<string, string> {
  const release = input.releaseJsonPath
    ? readReleaseJsonFile(input.releaseJsonPath)
    : readReleaseJsonFile(releaseJsonPathBesideMcpEntry(input.mcpEntry));
  return {
    MASTHEAD_ALLOWED_ORIGINS: input.allowedOrigins.join(","),
    MASTHEAD_CLI_COMMAND: input.cliCommand,
    MASTHEAD_INSTANCE_DIR: input.instanceDir,
    MASTHEAD_INSTANCE_MANIFEST: input.instanceManifest,
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DB_PATH: input.databasePath,
    MASTHEAD_DIAGNOSTIC_LOG_FILE: join(input.dataDirectory, "runtime", "daemon-diagnostics.jsonl"),
    MASTHEAD_HOST: "127.0.0.1",
    ...(input.hookScript ? { MASTHEAD_HOOK_SCRIPT: input.hookScript } : {}),
    MASTHEAD_MCP_COMMAND: input.mcpCommand,
    MASTHEAD_MCP_ENTRY: input.mcpEntry,
    MASTHEAD_PORT: String(input.port),
    MASTHEAD_STORE_PATH: input.legacyStorePath,
    ...(release
      ? {
          MASTHEAD_BUILD_SHA: release.gitSha,
          MASTHEAD_BUILD_VERSION: release.version,
          MASTHEAD_RELEASE_JSON: input.releaseJsonPath || releaseJsonPathBesideMcpEntry(input.mcpEntry)
        }
      : {})
  };
}

export function parseCompatibleHealth(value: unknown): MastheadHealthSummary | undefined {
  if (classifyDaemonHealth(value).state !== "compatible") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || record.product !== "masthead") return undefined;
  const apiVersion = typeof record.apiVersion === "number" ? record.apiVersion : undefined;
  if (!apiVersion || apiVersion < 1) return undefined;
  const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  if (!REQUIRED_CAPABILITIES.every((capability) => capabilities.includes(capability))) return undefined;

  const data = objectField(record.data);
  if (data?.migrationState === "failed") return undefined;
  const runtime = objectField(record.runtime);

  return {
    apiVersion,
    buildSha: stringField(record.buildSha),
    buildVersion: stringField(record.buildVersion),
    databaseId: stringField(data?.databaseId),
    databasePath: stringField(data?.databasePath),
    dataDirectory: stringField(data?.dataDirectory),
    mode: stringField(runtime?.mode),
    baseUrl: stringField(runtime?.baseUrl),
    instanceId: stringField(runtime?.daemonInstanceId),
    instanceManifest: stringField(runtime?.instanceManifest),
    authoringCommand: stringField(runtime?.authoringCommand),
    pid: numberField(runtime?.pid)
  };
}

export async function startLiveConnector(
  input: ResolveDaemonLaunchTargetInput,
  allowedOrigins: string[],
  ownedChildren: Set<ChildProcess>,
  options: StartLiveConnectorOptions = {}
): Promise<StartLiveConnectorResult> {
  const target = resolveDaemonLaunchTarget(input);
  const cliCommand = target.cliCommand;
  if (!cliCommand || !isAbsoluteAuthoringCommand(cliCommand)) {
    throw new Error("Masthead connector requires an absolute installed MASTHEAD_CLI_COMMAND");
  }
  const initialProbe = await probeCollector(target.port, target.dataDirectory, target.databasePath, cliCommand);
  if (initialProbe.state === "same_database_authoring_incompatible") {
    throw new Error(
      `A Masthead collector for the same database is running at ${connectorBaseUrl(target.port)} without the expected daemon-owned authoring contract; stop or restart that collector before retrying.`
    );
  }
  if (initialProbe.state === "compatible") {
    const baseUrl = connectorBaseUrl(target.port);
    await options.prepareAuthoringLauncher?.({ baseUrl, port: target.port, instanceManifest: target.instanceManifest, launcherPath: target.cliCommand });
    await (options.verifyAuthoringLauncher ?? verifyInstanceLauncher)(target.cliCommand, target.instanceManifest, target.nodePath, cliEntryForTarget(target));
    await (options.verifyAuthoringManifest ?? verifyDaemonOwnedManifest)(target.instanceManifest, initialProbe.health);
    return connectorStartResult(false, baseUrl, "Local Masthead collector is already running.", initialProbe.health);
  }

  if (!existsSync(target.entryPath)) {
    throw new Error(`Masthead daemon entry not found at ${target.entryPath}`);
  }

  const port = initialProbe.state === "incompatible"
    ? await (options.findAvailablePort ?? findAvailablePort)(target.port + 1)
    : target.port;
  const baseUrl = connectorBaseUrl(port);
  await options.prepareAuthoringLauncher?.({ baseUrl, port, instanceManifest: target.instanceManifest, launcherPath: target.cliCommand });
  await (options.verifyAuthoringLauncher ?? verifyInstanceLauncher)(target.cliCommand, target.instanceManifest, target.nodePath, cliEntryForTarget(target));
  const env = buildDaemonEnv({
    allowedOrigins,
    cliCommand,
    instanceDir: target.instanceDir,
    instanceManifest: target.instanceManifest,
    dataDirectory: target.dataDirectory,
    databasePath: target.databasePath,
    hookScript: target.hookScript,
    legacyStorePath: target.legacyStorePath,
    mcpCommand: target.nodePath,
    mcpEntry: target.mcpEntry,
    port,
    releaseJsonPath: releaseJsonPathBesideMcpEntry(target.mcpEntry)
  });
  const child = (options.spawnChild ?? spawn)(target.nodePath, [target.entryPath], {
    cwd: target.cwd,
    env: { ...process.env, ...input.env, ...env },
    stdio: "ignore"
  });
  ownedChildren.add(child);
  child.once("exit", (code, signal) => {
    appendDaemonExitDiagnostic(env.MASTHEAD_DIAGNOSTIC_LOG_FILE, child.pid, code, signal);
    ownedChildren.delete(child);
  });
  const readProcessStartIdentity = options.readProcessStartIdentity ?? readPlatformProcessStartIdentity;
  let spawnedProcessIdentity: SpawnedProcessIdentity | undefined;

  try {
    spawnedProcessIdentity = await captureSpawnedProcessIdentity(child, readProcessStartIdentity);
    const health = await (options.waitForCollector ?? waitForCompatibleCollector)(port, target.dataDirectory, target.databasePath, cliCommand);
    await (options.verifyAuthoringManifest ?? verifyDaemonOwnedManifest)(target.instanceManifest, health);
    return connectorStartResult(true, baseUrl, "Started local Masthead collector.", health);
  } catch (error) {
    try {
      await stopSpawnedChild(child, spawnedProcessIdentity, readProcessStartIdentity, options.childTerminationGraceMs);
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; spawned child cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, { cause: error });
    }
    throw error;
  }
}

export function mcpLaunchConfig(target: DaemonLaunchTarget): McpLaunchConfigResult {
  const env = {
    MASTHEAD_DATA_DIR: target.dataDirectory,
    MASTHEAD_DB_PATH: target.databasePath
  };
  const validation = validateMcpLaunchConfig(target);
  return {
    command: target.nodePath,
    args: [target.mcpEntry],
    env,
    databasePath: target.databasePath,
    validation
  };
}

export function validateMcpLaunchConfig(target: DaemonLaunchTarget): McpLaunchValidationResult {
  const commandExistsValue = commandExists(target.nodePath);
  const entryExists = existsSync(target.mcpEntry);
  const databaseMatches = target.databasePath === join(target.dataDirectory, "masthead.sqlite");
  const problems: string[] = [];
  if (!commandExistsValue) problems.push(`Command not found: ${target.nodePath}`);
  if (!entryExists) problems.push(`MCP entry not found: ${target.mcpEntry}`);
  if (!databaseMatches) problems.push(`MASTHEAD_DB_PATH does not match active database: ${join(target.dataDirectory, "masthead.sqlite")}`);

  return {
    ready: problems.length === 0,
    valid: problems.length === 0,
    commandExists: commandExistsValue,
    entryExists,
    databaseMatches,
    problems,
    commandPath: target.nodePath,
    entryPath: target.mcpEntry,
    configuredDatabasePath: target.databasePath,
    expectedDatabasePath: join(target.dataDirectory, "masthead.sqlite")
  };
}

export function stopOwnedDaemons(children: Set<ChildProcess>): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

function appendDaemonExitDiagnostic(
  diagnosticLogFile: string | undefined,
  pid: number | undefined,
  code: number | null,
  signal: NodeJS.Signals | null
): void {
  if (!diagnosticLogFile) return;
  try {
    mkdirSync(dirname(diagnosticLogFile), { recursive: true });
    appendFileSync(diagnosticLogFile, `${JSON.stringify({
      at: new Date().toISOString(),
      details: { code, pid, signal },
      kind: "daemon_child_exit",
      message: "Masthead daemon child exited",
      severity: code === 0 || signal === "SIGTERM" ? "info" : "error"
    })}\n`, "utf8");
  } catch {
    // The Electron process must stay usable even if a diagnostic write fails.
  }
}

function connectorStartResult(started: boolean, baseUrl: string, message: string, health: MastheadHealthSummary): StartLiveConnectorResult {
  return {
    ok: true,
    started,
    baseUrl,
    command: "masthead daemon",
    health,
    message,
    projectionUrl: `${baseUrl}/projection`
  };
}

async function probeCollector(
  port: number,
  expectedDataDirectory: string,
  expectedDatabasePath: string,
  expectedCliCommand: string
): Promise<
  | { state: "compatible"; health: MastheadHealthSummary }
  | { state: "incompatible" | "offline" | "same_database_authoring_incompatible" }
> {
  let healthBody: unknown;
  try {
    const response = await fetch(`${connectorBaseUrl(port)}/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return { state: "incompatible" };
    healthBody = await response.json();
  } catch {
    return { state: "offline" };
  }

  const observedIdentity = observedMastheadIdentity(healthBody);
  const health = parseCompatibleHealth(healthBody);
  const sameDatabase = observedIdentity.databasePath
    ? observedIdentity.databasePath === expectedDatabasePath
    : observedIdentity.dataDirectory === expectedDataDirectory;
  if (
    sameDatabase &&
    (!observedIdentity.databasePath || !health || observedIdentity.dataDirectory !== expectedDataDirectory)
  ) {
    return { state: "same_database_authoring_incompatible" };
  }
  if (
    !health ||
    observedIdentity.databasePath !== expectedDatabasePath ||
    observedIdentity.dataDirectory !== expectedDataDirectory ||
    health.mode !== "primary" ||
    health.baseUrl !== connectorBaseUrl(port) ||
    health.dataDirectory !== expectedDataDirectory ||
    health.databasePath !== expectedDatabasePath ||
    health.instanceManifest !== join(expectedDataDirectory, "masthead-instance.json") ||
    health.authoringCommand !== expectedCliCommand
  ) return { state: "incompatible" };

  try {
    const capabilitiesResponse = await fetch(`${connectorBaseUrl(port)}/workbench/authoring/capabilities`, {
      signal: AbortSignal.timeout(500)
    });
    const capabilities = capabilitiesResponse.ok ? await capabilitiesResponse.json() : undefined;
    if (!isWorkbenchAuthoringV5CapabilitiesDto(capabilities) || capabilities.command !== expectedCliCommand) {
      return { state: "same_database_authoring_incompatible" };
    }
    const healthIdentity = identityFromHealth(healthBody);
    assertGuidedAuthoringExpectedIdentity(identityFromCapabilities(capabilities), healthIdentity);
    return { state: "compatible", health };
  } catch {
    return { state: "same_database_authoring_incompatible" };
  }
}

function identityFromHealth(value: unknown): GuidedAuthoringExpectedIdentity {
  const record = objectField(value);
  const runtime = objectField(record?.runtime);
  const data = objectField(record?.data);
  const baseUrl = stringField(runtime?.baseUrl);
  const buildSha = stringField(record?.buildSha);
  const databaseId = stringField(data?.databaseId);
  const instanceId = stringField(runtime?.daemonInstanceId);
  const instanceManifest = stringField(runtime?.instanceManifest);
  if (!baseUrl || !buildSha || !databaseId || !instanceId || !instanceManifest) throw new Error("incomplete daemon identity");
  return { baseUrl, buildSha, databaseId, instanceId, instanceManifest };
}

async function verifyDaemonOwnedManifest(path: string, health: MastheadHealthSummary): Promise<void> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const manifest = await readMastheadInstanceManifest(path);
      const expected: GuidedAuthoringExpectedIdentity = {
        baseUrl: requiredSummaryField(health.baseUrl, "baseUrl"),
        buildSha: requiredSummaryField(health.buildSha, "buildSha"),
        databaseId: requiredSummaryField(health.databaseId, "databaseId"),
        instanceId: requiredSummaryField(health.instanceId, "instanceId"),
        instanceManifest: path
      };
      assertGuidedAuthoringExpectedIdentity(identityFromManifest(manifest, path), expected);
      if (manifest.pid !== health.pid) throw new Error("instance manifest PID mismatch");
      return;
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw new Error(`Masthead daemon instance manifest did not match compatible health: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function requiredSummaryField(value: string | undefined, field: string): string {
  if (!value) throw new Error(`compatible health missing ${field}`);
  return value;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function verifyInstanceLauncher(launcherPath: string, manifestPath: string, nodePath: string, cliEntry: string): Promise<void> {
  const [body, info] = await Promise.all([readFile(launcherPath, "utf8"), stat(launcherPath)]);
  const expected = renderLiveDevInstanceLauncher({ cliEntry, instanceManifest: manifestPath, nodePath, platform: process.platform });
  if (body !== expected || (process.platform !== "win32" && (info.mode & 0o777) !== 0o755)) {
    throw new Error(`Masthead instance launcher does not bind ${manifestPath}`);
  }
}

export function cliEntryForTarget(target: Pick<DaemonLaunchTarget, "entryPath">, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === "win32" ? win32 : posix;
  return paths.join(paths.dirname(paths.dirname(target.entryPath)), "cli", "mastheadctl.js");
}

async function captureSpawnedProcessIdentity(
  child: ChildProcess,
  readProcessStartIdentity: (pid: number) => Promise<string | undefined>
): Promise<SpawnedProcessIdentity> {
  const pid = child.pid;
  if (!Number.isInteger(pid) || !pid || pid <= 0) {
    throw new Error("Spawned Masthead collector did not expose a valid PID");
  }
  const processStartIdentity = await readProcessStartIdentity(pid);
  if (!processStartIdentity) {
    throw new Error(`Could not capture process-start identity for spawned Masthead collector ${pid}`);
  }
  return { pid, processStartIdentity };
}

async function stopSpawnedChild(
  child: ChildProcess,
  spawnedIdentity: SpawnedProcessIdentity | undefined,
  readProcessStartIdentity: (pid: number) => Promise<string | undefined>,
  graceMs = 5_000
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const waitForExactExit = (timeoutMs: number) => new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
  const termExit = waitForExactExit(graceMs);
  if (!child.kill("SIGTERM")) throw new Error(`Could not stop spawned Masthead collector ${child.pid ?? "unknown"}`);
  if (await termExit) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!spawnedIdentity || child.pid !== spawnedIdentity.pid) {
    throw new Error(`Refusing SIGKILL for spawned Masthead collector ${child.pid ?? "unknown"}: captured PID identity is unavailable or changed`);
  }
  const currentProcessStartIdentity = await readProcessStartIdentity(spawnedIdentity.pid);
  if (currentProcessStartIdentity !== spawnedIdentity.processStartIdentity) {
    throw new Error(`Refusing SIGKILL for spawned Masthead collector ${spawnedIdentity.pid}: process-start identity changed`);
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killExit = waitForExactExit(graceMs);
  if (!child.kill("SIGKILL")) throw new Error(`Could not kill spawned Masthead collector ${child.pid ?? "unknown"} after SIGTERM timeout`);
  if (!(await killExit)) throw new Error(`Spawned Masthead collector ${child.pid ?? "unknown"} did not exit after identity-bound SIGKILL`);
}

async function readPlatformProcessStartIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === "linux") {
      const processStat = await readFile(`/proc/${pid}/stat`, "utf8");
      const commandEnd = processStat.lastIndexOf(")");
      if (commandEnd < 0) return undefined;
      const fieldsAfterCommand = processStat.slice(commandEnd + 1).trim().split(/\s+/);
      const kernelStartTicks = fieldsAfterCommand[19];
      return kernelStartTicks ? `linux:${kernelStartTicks}` : undefined;
    }
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
      ], { encoding: "utf8", windowsHide: true });
      const ticks = stdout.trim();
      return ticks ? `win32:${ticks}` : undefined;
    }
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
    const startedAt = stdout.trim();
    return startedAt ? `${process.platform}:${startedAt}` : undefined;
  } catch {
    return undefined;
  }
}

async function waitForCompatibleCollector(
  port: number,
  expectedDataDirectory: string,
  expectedDatabasePath: string,
  expectedCliCommand: string
): Promise<MastheadHealthSummary> {
  const policy = connectorStartupPollPolicy();
  const deadline = Date.now() + policy.timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeCollector(port, expectedDataDirectory, expectedDatabasePath, expectedCliCommand);
    if (probe.state === "compatible") return probe.health;
    await delay(policy.intervalMs);
  }
  throw new Error(`Started Masthead collector but it did not become compatible at ${connectorBaseUrl(port)}/health`);
}

function observedMastheadIdentity(value: unknown): { dataDirectory?: string; databasePath?: string } {
  const record = objectField(value);
  if (record?.ok !== true || record.product !== "masthead") return {};
  const data = objectField(record.data);
  const dataDirectory = stringField(data?.dataDirectory);
  const databasePath = stringField(data?.databasePath);
  return {
    ...(dataDirectory ? { dataDirectory: resolve(dataDirectory) } : {}),
    ...(databasePath ? { databasePath: resolve(databasePath) } : {})
  };
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available Masthead connector port found from ${startPort}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    server.once("error", () => resolveAvailable(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveAvailable(true));
    });
  });
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function commandExists(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  return (process.env.PATH || "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .some((directory) => existsSync(join(directory, command)) || (process.platform === "win32" && ["exe", "cmd", "bat"].some((ext) => existsSync(join(directory, `${command}.${ext}`)))));
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
