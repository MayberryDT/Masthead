import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { packagedDaemonPaths } from "./pathPolicy";

const DEFAULT_CONNECTOR_PORT = 17373;
const REQUIRED_CAPABILITIES = ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings"];

export type MastheadHealthSummary = {
  apiVersion?: number;
  buildSha?: string;
  databaseId?: string;
  databasePath?: string;
  dataDirectory?: string;
  mode?: string;
};

export type DaemonLaunchTarget = {
  cwd: string;
  dataDirectory: string;
  databasePath: string;
  entryPath: string;
  legacyStorePath: string;
  mcpEntry: string;
  nodePath: string;
  port: number;
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
  appDataDir: string;
  currentDir: string;
  env: NodeJS.ProcessEnv;
  resourcesPath: string;
};

export function connectorBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function resolveDaemonLaunchTarget(input: ResolveDaemonLaunchTargetInput): DaemonLaunchTarget {
  const port = parsePort(input.env.MASTHEAD_PORT, DEFAULT_CONNECTOR_PORT);
  const dataDirectory = input.env.MASTHEAD_DATA_DIR || input.appDataDir;
  const databasePath = input.env.MASTHEAD_DB_PATH || join(dataDirectory, "masthead.sqlite");
  const legacyStorePath = input.env.MASTHEAD_STORE_PATH || join(dataDirectory, "legacy", "events.ndjson");
  const mcpEntryOverride = input.env.MASTHEAD_MCP_ENTRY;

  if (input.env.MASTHEAD_DAEMON_ENTRY) {
    return {
      cwd: input.env.MASTHEAD_PROJECT_DIR || input.currentDir,
      dataDirectory,
      databasePath,
      entryPath: input.env.MASTHEAD_DAEMON_ENTRY,
      legacyStorePath,
      mcpEntry: mcpEntryOverride || join(input.currentDir, "dist", "daemon", "src", "mcp", "server.js"),
      nodePath: input.env.MASTHEAD_NODE_PATH || process.execPath,
      port
    };
  }

  const packaged = packagedDaemonPaths(input.resourcesPath);
  return {
    cwd: dataDirectory,
    dataDirectory,
    databasePath,
    entryPath: packaged.daemonEntry,
    legacyStorePath,
    mcpEntry: mcpEntryOverride || packaged.mcpEntry,
    nodePath: input.env.MASTHEAD_NODE_PATH || packaged.nodePath,
    port
  };
}

export function buildDaemonEnv(input: {
  allowedOrigins: string[];
  dataDirectory: string;
  databasePath: string;
  legacyStorePath: string;
  mcpCommand: string;
  mcpEntry: string;
  port: number;
}): Record<string, string> {
  return {
    MASTHEAD_ALLOWED_ORIGINS: input.allowedOrigins.join(","),
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DB_PATH: input.databasePath,
    MASTHEAD_HOST: "127.0.0.1",
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
    databaseId: stringField(data?.databaseId),
    databasePath: stringField(data?.databasePath),
    dataDirectory: stringField(data?.dataDirectory),
    mode: stringField(runtime?.mode)
  };
}

export async function startLiveConnector(input: ResolveDaemonLaunchTargetInput, allowedOrigins: string[], ownedChildren: Set<ChildProcess>): Promise<StartLiveConnectorResult> {
  const target = resolveDaemonLaunchTarget(input);
  const initialProbe = await probeCollector(target.port, target.dataDirectory);
  if (initialProbe.state === "compatible") {
    const baseUrl = connectorBaseUrl(target.port);
    return connectorStartResult(false, baseUrl, "Local Masthead collector is already running.", initialProbe.health);
  }

  if (!existsSync(target.entryPath)) {
    throw new Error(`Masthead daemon entry not found at ${target.entryPath}`);
  }

  const port = initialProbe.state === "incompatible" ? await findAvailablePort(target.port + 1) : target.port;
  const baseUrl = connectorBaseUrl(port);
  const env = buildDaemonEnv({
    allowedOrigins,
    dataDirectory: target.dataDirectory,
    databasePath: target.databasePath,
    legacyStorePath: target.legacyStorePath,
    mcpCommand: target.nodePath,
    mcpEntry: target.mcpEntry,
    port
  });
  const child = spawn(target.nodePath, [target.entryPath], {
    cwd: target.cwd,
    env: { ...process.env, ...env },
    stdio: "ignore"
  });
  ownedChildren.add(child);
  child.once("exit", () => {
    ownedChildren.delete(child);
  });

  const health = await waitForCompatibleCollector(port, target.dataDirectory);
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

async function probeCollector(port: number, expectedDataDirectory: string): Promise<{ state: "compatible"; health: MastheadHealthSummary } | { state: "incompatible" | "offline" }> {
  try {
    const response = await fetch(`${connectorBaseUrl(port)}/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return { state: "incompatible" };
    const health = parseCompatibleHealth(await response.json());
    if (!health || health.dataDirectory !== expectedDataDirectory) return { state: "incompatible" };
    return { state: "compatible", health };
  } catch {
    return { state: "offline" };
  }
}

async function waitForCompatibleCollector(port: number, expectedDataDirectory: string): Promise<MastheadHealthSummary> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const probe = await probeCollector(port, expectedDataDirectory);
    if (probe.state === "compatible") return probe.health;
    await delay(200);
  }
  throw new Error(`Started Masthead collector but it did not become compatible at ${connectorBaseUrl(port)}/health`);
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
