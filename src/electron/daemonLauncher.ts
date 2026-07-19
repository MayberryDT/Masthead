import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import {
  assertGuidedAuthoringExpectedIdentity,
  canonicalInstancePaths,
  identityFromCapabilities,
  identityFromManifest,
  readMastheadInstanceManifest,
  type GuidedAuthoringExpectedIdentity
} from "../shared/instanceIdentity";
import {
  isAbsoluteAuthoringCommand,
  isWorkbenchAuthoringCapabilitiesDto
} from "../shared/workbenchAuthoring";
import { packagedDaemonPaths } from "./pathPolicy";

const DEFAULT_CONNECTOR_PORT = 17373;
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
}): Record<string, string> {
  return {
    MASTHEAD_ALLOWED_ORIGINS: input.allowedOrigins.join(","),
    MASTHEAD_CLI_COMMAND: input.cliCommand,
    MASTHEAD_INSTANCE_DIR: input.instanceDir,
    MASTHEAD_INSTANCE_MANIFEST: input.instanceManifest,
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DB_PATH: input.databasePath,
    MASTHEAD_HOST: "127.0.0.1",
    ...(input.hookScript ? { MASTHEAD_HOOK_SCRIPT: input.hookScript } : {}),
    MASTHEAD_MCP_COMMAND: input.mcpCommand,
    MASTHEAD_MCP_ENTRY: input.mcpEntry,
    MASTHEAD_PORT: String(input.port),
    MASTHEAD_STORE_PATH: input.legacyStorePath
  };
}

export function parseCompatibleHealth(value: unknown): MastheadHealthSummary | undefined {
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
    await (options.verifyAuthoringManifest ?? verifyDaemonOwnedManifest)(target.instanceManifest, initialProbe.health);
    await warmProjection(baseUrl);
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
    port
  });
  const child = spawn(target.nodePath, [target.entryPath], {
    cwd: target.cwd,
    env: { ...process.env, ...input.env, ...env },
    stdio: "ignore"
  });
  ownedChildren.add(child);
  child.once("exit", () => {
    ownedChildren.delete(child);
  });

  const health = await waitForCompatibleCollector(port, target.dataDirectory, target.databasePath, cliCommand);
  await (options.verifyAuthoringManifest ?? verifyDaemonOwnedManifest)(target.instanceManifest, health);
  await warmProjection(baseUrl);
  return connectorStartResult(true, baseUrl, "Started local Masthead collector.", health);
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
    observedIdentity.dataDirectory !== expectedDataDirectory
  ) return { state: "incompatible" };

  try {
    const capabilitiesResponse = await fetch(`${connectorBaseUrl(port)}/workbench/authoring/capabilities`, {
      signal: AbortSignal.timeout(500)
    });
    const capabilities = capabilitiesResponse.ok ? await capabilitiesResponse.json() : undefined;
    if (!isWorkbenchAuthoringCapabilitiesDto(capabilities, { expectedCommand: expectedCliCommand })) {
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

async function warmProjection(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/projection`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    await response.arrayBuffer();
  } catch {
    // Projection warmup is best-effort; the renderer can still surface live connection errors.
  }
}

async function waitForCompatibleCollector(
  port: number,
  expectedDataDirectory: string,
  expectedDatabasePath: string,
  expectedCliCommand: string
): Promise<MastheadHealthSummary> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const probe = await probeCollector(port, expectedDataDirectory, expectedDatabasePath, expectedCliCommand);
    if (probe.state === "compatible") return probe.health;
    await delay(200);
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
