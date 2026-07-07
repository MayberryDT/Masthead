import { existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { RuntimeKind } from "../adapters/types.ts";
import {
  CLAUDE_STYLE_HOOK_EVENTS,
  installMastheadHookConfig,
  uninstallMastheadHookConfig,
  verifyMastheadHookConfig,
  type CodexHookConfig
} from "../core/hookAdmin.ts";
import type { DaemonConfig } from "./config.ts";

export const LIVE_CONNECTOR_RUNTIMES = ["codex", "claude_code", "cursor", "grok", "opencode", "omp", "pi", "hermes"] as const satisfies readonly RuntimeKind[];

export type LiveConnectorRuntime = (typeof LIVE_CONNECTOR_RUNTIMES)[number];

export type LiveConnectorSettings = {
  runtime: LiveConnectorRuntime;
  label: string;
  configPath: string;
  configExists: boolean;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  command: string;
  endpoint: string;
  latestBackupPath?: string;
  error?: string;
};

export type LiveConnectorTestResult = {
  testedAt: string;
  status: "passed" | "failed";
  message: string;
};

type JsonConfigRead<T> = {
  config: T;
  existed: boolean;
};

type CursorHookEntry = {
  command?: string;
  [key: string]: unknown;
};

type CursorHookConfig = {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
  [key: string]: unknown;
};

const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const OPENCODE_PLUGIN_MARKER = "masthead-live-connector";
const OMP_EXTENSION_MARKER = "masthead-live-connector";
const PI_EXTENSION_MARKER = "masthead-live-connector";
const HERMES_PLUGIN_MARKER = "masthead-live-connector";
const CLAUDE_STYLE_EVENTS = CLAUDE_STYLE_HOOK_EVENTS;
const CURSOR_EVENTS = ["sessionStart", "beforeSubmitPrompt", "beforeShellExecution", "afterShellExecution", "afterFileEdit", "postToolUse", "stop"] as const;

const LABELS: Record<LiveConnectorRuntime, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  grok: "Grok Build",
  opencode: "OpenCode",
  omp: "Oh My Pi",
  pi: "Pi",
  hermes: "Hermes"
};

export async function getLiveConnectorSettings(config: DaemonConfig): Promise<LiveConnectorSettings[]> {
  return Promise.all(LIVE_CONNECTOR_RUNTIMES.map((runtime) => getLiveConnectorSetting(config, runtime)));
}

export async function getLiveConnectorSetting(config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<LiveConnectorSettings> {
  const configPath = liveConnectorConfigPath(config, runtime);
  const command = liveConnectorCommand(config, runtime);
  const endpoint = liveConnectorEndpoint(config, runtime);
  const latestBackupPath = await latestHookBackupPath(configPath).catch(() => undefined);

  try {
    if (runtime === "cursor") {
      const { config: hookConfig, existed } = await readJsonConfig<CursorHookConfig>(configPath, { allowMissing: true });
      const verification = verifyCursorHookConfig(hookConfig, { command, events: CURSOR_EVENTS });
      return stateFromVerification(runtime, { command, configPath, endpoint, existed, latestBackupPath, verification });
    }

    const marker = markedConnectorMarker(runtime);
    if (marker) {
      const verification = await verifyMarkedPluginFile(configPath, endpoint, marker);
      return {
        command,
        configExists: verification.configExists,
        configPath,
        endpoint,
        installed: verification.installed,
        label: LABELS[runtime],
        latestBackupPath,
        mismatchedEvents: verification.mismatchedEvents,
        missingEvents: verification.missingEvents,
        runtime
      };
    }

    const { config: hookConfig, existed } = await readJsonConfig<CodexHookConfig>(configPath, { allowMissing: true });
    const verification = verifyMastheadHookConfig(hookConfig, { command, events: CLAUDE_STYLE_EVENTS });
    return stateFromVerification(runtime, { command, configPath, endpoint, existed, latestBackupPath, verification });
  } catch (error) {
    return {
      command,
      configExists: false,
      configPath,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      installed: false,
      label: LABELS[runtime],
      latestBackupPath,
      mismatchedEvents: [],
      missingEvents: [],
      runtime
    };
  }
}

export async function installLiveConnectors(config: DaemonConfig): Promise<void> {
  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    await installLiveConnector(config, runtime);
  }
}

export async function uninstallLiveConnectors(config: DaemonConfig): Promise<void> {
  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    await uninstallLiveConnector(config, runtime);
  }
}

export function isLiveConnectorRuntime(value: string): value is LiveConnectorRuntime {
  return (LIVE_CONNECTOR_RUNTIMES as readonly string[]).includes(value);
}

export async function runLiveConnectorRoundTrip(
  config: DaemonConfig,
  options: { endpoint?: string; runtimes?: readonly LiveConnectorRuntime[] } = {}
): Promise<LiveConnectorTestResult> {
  const testedAt = new Date().toISOString();
  const runtimes = options.runtimes ?? LIVE_CONNECTOR_RUNTIMES;
  const failures: string[] = [];

  for (const runtime of runtimes) {
    const endpoint = liveConnectorValidationEndpoint(config, runtime, options.endpoint);
    const sourceEventId = `masthead-settings-${runtime}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(syntheticPayload(runtime, sourceEventId, testedAt)),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => undefined)) as { status?: string } | undefined;
      if (!response.ok || body?.status !== "accepted") {
        failures.push(`${LABELS[runtime]} returned ${response.ok ? body?.status ?? "unknown status" : response.status}`);
      }
    } catch (error) {
      failures.push(`${LABELS[runtime]} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    return {
      message: `Hook round-trip failed: ${failures.join("; ")}.`,
      status: "failed",
      testedAt
    };
  }

  return {
    message: `Hook round-trip passed: Masthead accepted synthetic live events for ${runtimes.map((runtime) => LABELS[runtime]).join(", ")}.`,
    status: "passed",
    testedAt
  };
}

export function liveConnectorConfigPath(config: DaemonConfig, runtime: LiveConnectorRuntime): string {
  const homeDir = resolve(config.codexHomeDir);
  switch (runtime) {
    case "codex":
      return resolve(process.env.MASTHEAD_CODEX_HOOKS || join(homeDir, ".codex", "hooks.json"));
    case "claude_code":
      return resolve(process.env.MASTHEAD_CLAUDE_SETTINGS || join(homeDir, ".claude", "settings.json"));
    case "cursor":
      return resolve(process.env.MASTHEAD_CURSOR_HOOKS || join(homeDir, ".cursor", "hooks.json"));
    case "grok":
      return resolve(process.env.MASTHEAD_GROK_HOOKS || join(homeDir, ".grok", "hooks", "masthead.json"));
    case "opencode":
      return resolve(process.env.MASTHEAD_OPENCODE_PLUGIN || join(homeDir, ".config", "opencode", "plugins", "masthead-live.js"));
    case "omp":
      return resolve(process.env.MASTHEAD_OMP_EXTENSION || join(homeDir, ".omp", "agent", "extensions", "masthead-live.js"));
    case "pi":
      return resolve(process.env.MASTHEAD_PI_EXTENSION || join(homeDir, ".pi", "agent", "extensions", "masthead-live.js"));
    case "hermes":
      return resolve(process.env.MASTHEAD_HERMES_PLUGIN || join(homeDir, ".hermes", "plugins", "masthead-live", "index.js"));
  }
}

export function liveConnectorCommand(config: DaemonConfig, runtime: LiveConnectorRuntime, endpoint?: string): string {
  const { nodePath, scriptPath } = resolveLiveConnectorCommandPaths();
  return `MASTHEAD_INGEST_URL=${quoteShell(liveConnectorEndpoint(config, runtime, endpoint))} MASTHEAD_HOOK_TIMEOUT_MS=750 ${quoteShell(nodePath)} ${quoteShell(scriptPath)}`;
}

export function resolveLiveConnectorCommandPaths(
  options: {
    env?: NodeJS.ProcessEnv;
    execPath?: string;
    exists?: (path: string) => boolean;
    homeDir?: string;
  } = {}
): { nodePath: string; scriptPath: string } {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  if (env.MASTHEAD_HOOK_SCRIPT) {
    const scriptPath = resolve(env.MASTHEAD_HOOK_SCRIPT);
    const stable = looksLikePackagedHookScript(scriptPath) ? stablePackagedCommandPaths(execPath, options) : undefined;
    if (stable) return stable;
    return {
      nodePath: execPath,
      scriptPath
    };
  }

  const stable = stablePackagedCommandPaths(execPath, options);
  if (stable) return stable;

  return {
    nodePath: execPath,
    scriptPath: resolve("scripts/masthead-hook.js")
  };
}

function stablePackagedCommandPaths(
  execPath: string,
  options: { exists?: (path: string) => boolean; homeDir?: string }
): { nodePath: string; scriptPath: string } | undefined {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  if (!looksLikePackagedDaemonNode(execPath, nodeName)) return undefined;

  const currentRoot = join(options.homeDir ?? homedir(), ".local", "share", "masthead-production", "current");
  const nodePath = join(currentRoot, "resources", "daemon", nodeName);
  const scriptPath = join(currentRoot, "resources", "daemon", "scripts", "masthead-hook.js");
  const exists = options.exists ?? existsSync;
  if (!exists(nodePath) || !exists(scriptPath)) return undefined;
  return { nodePath, scriptPath };
}

function looksLikePackagedDaemonNode(execPath: string, nodeName: string): boolean {
  const normalized = execPath.replace(/\\/g, "/");
  return normalized.includes("/.local/share/masthead-production/") && normalized.endsWith(`/resources/daemon/${nodeName}`);
}

function looksLikePackagedHookScript(scriptPath: string): boolean {
  const normalized = scriptPath.replace(/\\/g, "/");
  return normalized.includes("/.local/share/masthead-production/") && normalized.endsWith("/resources/daemon/scripts/masthead-hook.js");
}

export function liveConnectorEndpoint(config: DaemonConfig, runtime: LiveConnectorRuntime, endpoint = baseIngestEndpoint(config)): string {
  const url = new URL(endpoint);
  url.searchParams.set("runtime", runtime);
  return url.toString();
}

function liveConnectorValidationEndpoint(config: DaemonConfig, runtime: LiveConnectorRuntime, endpoint = baseIngestEndpoint(config)): string {
  const url = new URL(liveConnectorEndpoint(config, runtime, endpoint));
  url.searchParams.set("validate", "1");
  return url.toString();
}

export function baseIngestEndpoint(config: DaemonConfig): string {
  return `http://${config.host}:${config.port}/ingest`;
}

export async function latestLiveConnectorBackupPath(config: DaemonConfig): Promise<string | undefined> {
  const backups = await Promise.all(
    LIVE_CONNECTOR_RUNTIMES.map(async (runtime) => {
      const path = await latestHookBackupPath(liveConnectorConfigPath(config, runtime)).catch(() => undefined);
      if (!path) return undefined;
      const info = await stat(path);
      return { mtimeMs: info.mtimeMs, path };
    })
  );
  return backups.filter((backup): backup is { mtimeMs: number; path: string } => Boolean(backup)).sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path;
}

export async function installLiveConnector(config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<void> {
  const configPath = liveConnectorConfigPath(config, runtime);
  const command = liveConnectorCommand(config, runtime);

  if (runtime === "cursor") {
    const { config: hookConfig, existed } = await readJsonConfig<CursorHookConfig>(configPath, { allowMissing: true });
    if (existed) await createHookBackup(configPath, "install");
    await writeJsonConfig(configPath, installCursorHookConfig(hookConfig, { command, events: CURSOR_EVENTS }));
    return;
  }

  const markedSource = markedConnectorSource(runtime, liveConnectorEndpoint(config, runtime));
  if (markedSource) {
    if (await pathExists(configPath)) await createHookBackup(configPath, "install");
    await writeTextConfig(configPath, markedSource);
    return;
  }

  const { config: hookConfig, existed } = await readJsonConfig<CodexHookConfig>(configPath, { allowMissing: true });
  if (existed) await createHookBackup(configPath, "install");
  await writeJsonConfig(
    configPath,
    installMastheadHookConfig(hookConfig, {
      command,
      events: CLAUDE_STYLE_EVENTS,
      timeout: 1
    })
  );
}

export async function uninstallLiveConnector(config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<void> {
  const configPath = liveConnectorConfigPath(config, runtime);

  if (runtime === "cursor") {
    const { config: hookConfig, existed } = await readJsonConfig<CursorHookConfig>(configPath, { allowMissing: true });
    if (!existed) return;
    await createHookBackup(configPath, "uninstall");
    await writeJsonConfig(configPath, uninstallCursorHookConfig(hookConfig));
    return;
  }

  const marker = markedConnectorMarker(runtime);
  if (marker) {
    if (!(await pathExists(configPath))) return;
    await assertRegularHookFile(configPath);
    const raw = await readFile(configPath, "utf8");
    if (!raw.includes(marker)) throw new Error(`Refusing to uninstall non-Masthead ${LABELS[runtime]} connector: ${configPath}`);
    await createHookBackup(configPath, "uninstall");
    await rm(configPath, { force: true });
    return;
  }

  const { config: hookConfig, existed } = await readJsonConfig<CodexHookConfig>(configPath, { allowMissing: true });
  if (!existed) return;
  await createHookBackup(configPath, "uninstall");
  await writeJsonConfig(configPath, uninstallMastheadHookConfig(hookConfig));
}

function stateFromVerification(
  runtime: LiveConnectorRuntime,
  input: {
    command: string;
    configPath: string;
    endpoint: string;
    existed: boolean;
    latestBackupPath?: string;
    verification: { installed: boolean; missingEvents: string[]; mismatchedEvents: string[] };
  }
): LiveConnectorSettings {
  return {
    command: input.command,
    configExists: input.existed,
    configPath: input.configPath,
    endpoint: input.endpoint,
    installed: input.verification.installed,
    label: LABELS[runtime],
    latestBackupPath: input.latestBackupPath,
    mismatchedEvents: input.verification.mismatchedEvents,
    missingEvents: input.verification.missingEvents,
    runtime
  };
}

function markedConnectorMarker(runtime: LiveConnectorRuntime): string | undefined {
  switch (runtime) {
    case "opencode":
      return OPENCODE_PLUGIN_MARKER;
    case "omp":
      return OMP_EXTENSION_MARKER;
    case "pi":
      return PI_EXTENSION_MARKER;
    case "hermes":
      return HERMES_PLUGIN_MARKER;
    default:
      return undefined;
  }
}

function markedConnectorSource(runtime: LiveConnectorRuntime, endpoint: string): string | undefined {
  switch (runtime) {
    case "opencode":
      return openCodePluginSource(endpoint);
    case "omp":
      return ompExtensionSource(endpoint);
    case "pi":
      return runtimePluginSource(PI_EXTENSION_MARKER, endpoint, "pi.extension");
    case "hermes":
      return runtimePluginSource(HERMES_PLUGIN_MARKER, endpoint, "hermes.plugin");
    default:
      return undefined;
  }
}

function installCursorHookConfig(config: CursorHookConfig, options: { command: string; events: readonly string[] }): CursorHookConfig {
  const next = structuredClone(config);
  next.version ??= 1;
  next.hooks ??= {};

  for (const eventName of options.events) {
    let repairedExistingHook = false;
    const entries = [...(next.hooks[eventName] ?? [])].map((entry) => {
      if (!isMastheadCursorHook(entry)) return entry;
      repairedExistingHook = true;
      return { ...entry, command: options.command };
    });
    if (!repairedExistingHook) entries.push({ command: options.command });
    next.hooks[eventName] = entries;
  }

  return next;
}

function uninstallCursorHookConfig(config: CursorHookConfig): CursorHookConfig {
  const next = structuredClone(config);
  next.hooks ??= {};
  for (const [eventName, entries] of Object.entries(next.hooks)) {
    next.hooks[eventName] = (entries ?? []).filter((entry) => !isMastheadCursorHook(entry));
  }
  return next;
}

function verifyCursorHookConfig(config: CursorHookConfig, expected: { command: string; events: readonly string[] }): {
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
} {
  const hooks = config.hooks ?? {};
  const missingEvents: string[] = [];
  const mismatchedEvents: string[] = [];

  for (const eventName of expected.events) {
    const handlers = (hooks[eventName] ?? []).filter(isMastheadCursorHook);
    if (handlers.length === 0) {
      missingEvents.push(eventName);
      continue;
    }
    if (!handlers.some((handler) => handler.command === expected.command)) mismatchedEvents.push(eventName);
  }

  return {
    installed: missingEvents.length === 0 && mismatchedEvents.length === 0,
    missingEvents,
    mismatchedEvents
  };
}

async function verifyMarkedPluginFile(configPath: string, endpoint: string, marker: string): Promise<{
  configExists: boolean;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
}> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { configExists: false, installed: false, mismatchedEvents: [], missingEvents: ["event"] };
    }
    throw error;
  }

  const hasMarker = raw.includes(marker);
  const hasEndpoint = raw.includes(endpoint);
  return {
    configExists: true,
    installed: hasMarker && hasEndpoint,
    mismatchedEvents: hasMarker && !hasEndpoint ? ["event"] : [],
    missingEvents: hasMarker ? [] : ["event"]
  };
}

function isMastheadCursorHook(entry: CursorHookEntry): boolean {
  return typeof entry.command === "string" && entry.command.includes(MASTHEAD_HOOK_MARKER);
}

function syntheticPayload(runtime: LiveConnectorRuntime, sourceEventId: string, testedAt: string): Record<string, unknown> {
  const sessionId = `masthead-hook-test-${runtime}-${sourceEventId}`;
  if (runtime === "opencode") {
    return {
      directory: process.cwd(),
      provider_event_id: sourceEventId,
      sessionID: sessionId,
      status: "running",
      time: testedAt,
      type: "session.created"
    };
  }
  if (runtime === "cursor") {
    return {
      cwd: process.cwd(),
      hookEventName: "sessionStart",
      provider_event_id: sourceEventId,
      sessionId,
      status: "running",
      timestamp: testedAt
    };
  }
  if (runtime === "omp" || runtime === "pi") {
    return {
      cwd: process.cwd(),
      provider_event_id: sourceEventId,
      sessionId,
      status: "running",
      timestamp: testedAt,
      type: "session_start"
    };
  }
  if (runtime === "hermes") {
    return {
      directory: process.cwd(),
      provider_event_id: sourceEventId,
      sessionId,
      status: "running",
      timestamp: testedAt,
      type: "session_start"
    };
  }
  return {
    cwd: process.cwd(),
    hookEventName: "SessionStart",
    provider_event_id: sourceEventId,
    sessionId,
    status: "running",
    timestamp: testedAt
  };
}

function openCodePluginSource(endpoint: string): string {
  return `// ${OPENCODE_PLUGIN_MARKER}: installed by Masthead.
const MASTHEAD_ENDPOINT = ${JSON.stringify(endpoint)};

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function propertiesFor(event) {
  return event && typeof event === "object" && event.properties && typeof event.properties === "object" ? event.properties : {};
}

async function postMastheadEvent(event) {
  const properties = propertiesFor(event);
  const session = properties.session && typeof properties.session === "object" ? properties.session : {};
  const tool = properties.tool && typeof properties.tool === "object" ? properties.tool : {};
  const payload = {
    type: firstString(event?.type, event?.name, properties.type),
    sessionID: firstString(properties.sessionID, properties.sessionId, properties.session_id, session.id, event?.sessionID, event?.sessionId),
    time: firstString(event?.time, event?.timestamp, properties.time, properties.timestamp) || new Date().toISOString(),
    directory: firstString(properties.directory, properties.cwd, process.cwd?.()),
    toolName: firstString(properties.toolName, properties.tool_name, tool.name),
    toolUseId: firstString(properties.toolUseId, properties.tool_use_id, tool.id),
    message: properties.message,
  };
  await fetch(MASTHEAD_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export const MastheadLiveConnector = async () => ({
  event: async ({ event }) => {
    try {
      await postMastheadEvent(event);
    } catch {}
  },
});

export default MastheadLiveConnector;
`;
}


function runtimePluginSource(marker: string, endpoint: string, source: string): string {
  return `// ${marker}: installed by Masthead.
const MASTHEAD_ENDPOINT = ${JSON.stringify(endpoint)};
const MASTHEAD_SOURCE = ${JSON.stringify(source)};
let mastheadSequence = 0;

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function objectFor(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sourceEventId(type, event, sessionId) {
  return firstString(
    event?.provider_event_id,
    event?.providerEventId,
    event?.event_id,
    event?.eventId,
    event?.id,
    event?.toolCallId,
    event?.toolUseId
  ) || (sessionId ? sessionId + ":" + type + ":" + (++mastheadSequence) : type + ":" + Date.now() + ":" + (++mastheadSequence));
}

function payloadFor(type, event = {}, ctx = {}) {
  const session = objectFor(event.session);
  const workspace = objectFor(event.workspace);
  const tool = objectFor(event.tool);
  const cwd = firstString(event.cwd, event.directory, workspace.cwd, workspace.directory, ctx.cwd, ctx.directory, process.cwd?.());
  const state = firstString(event.state, event.status, ctx.state, ctx.status);
  const sessionId = firstString(
    event.sessionId,
    event.session_id,
    event.sessionID,
    event.conversationId,
    event.conversation_id,
    session.id,
    session.sessionId,
    ctx.sessionId,
    ctx.session_id,
    ctx.sessionID
  );
  return {
    type: firstString(type, event.type, event.event, event.name),
    sessionId,
    provider_event_id: sourceEventId(type, event, sessionId),
    timestamp: firstString(event.timestamp, event.time, event.createdAt) || new Date().toISOString(),
    cwd,
    directory: firstString(event.directory, workspace.directory, cwd),
    branch: firstString(event.branch, event.gitBranch, workspace.branch, ctx.branch),
    toolName: firstString(event.toolName, event.tool_name, tool.name),
    toolUseId: firstString(event.toolUseId, event.tool_use_id, event.toolCallId, tool.id),
    approvalName: firstString(event.approvalName, event.permissionName),
    state,
    status: firstString(event.status, event.state, ctx.status, ctx.state),
    source: MASTHEAD_SOURCE
  };
}

async function postMastheadEvent(type, event, ctx) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    await fetch(MASTHEAD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFor(type, objectFor(event), objectFor(ctx))),
      signal: controller.signal
    });
  } catch {
  } finally {
    clearTimeout(timeout);
  }
}

function register(host, eventName) {
  const on = typeof host?.on === "function" ? host.on.bind(host) : typeof host?.events?.on === "function" ? host.events.on.bind(host.events) : undefined;
  if (typeof on === "function") on(eventName, (event, ctx) => postMastheadEvent(eventName, event, ctx));
}

export default function MastheadLiveConnector(host = {}) {
  for (const eventName of [
    "session_start",
    "session_created",
    "agent_start",
    "input",
    "user_input",
    "before_agent_start",
    "approval_requested",
    "approval_resolved",
    "permission_requested",
    "tool_approval_requested",
    "tool_approval_resolved",
    "tool_call",
    "tool_start",
    "tool_result",
    "tool_finish",
    "session_stop",
    "session_completed",
    "session_end",
    "session_shutdown"
  ]) {
    register(host, eventName);
  }
}

export const mastheadLiveConnector = MastheadLiveConnector;
`;
}

function ompExtensionSource(endpoint: string): string {
  return `// ${OMP_EXTENSION_MARKER}: installed by Masthead.
const MASTHEAD_ENDPOINT = ${JSON.stringify(endpoint)};
let mastheadSequence = 0;

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function countText(value) {
  if (typeof value !== "string") return undefined;
  return { characters: value.length, lines: value.length === 0 ? 0 : value.split(/\\r?\\n/).length };
}

function summarizeValue(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return { kind: "array", count: value.length };
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value).slice(0, 12) };
  if (typeof value === "string") return countText(value);
  return { kind: typeof value };
}

function pathParts(value) {
  return typeof value === "string" ? value.split("/").filter(Boolean) : [];
}

function stripSessionExtension(value) {
  return typeof value === "string" ? value.replace(/\\.(jsonl|json)$/i, "") : undefined;
}

function isRootSessionToken(value) {
  return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(value);
}

function rootSessionIdFromFile(value) {
  const parts = pathParts(value);
  const file = stripSessionExtension(parts[parts.length - 1]);
  if (isRootSessionToken(file)) return file;
  const parent = parts[parts.length - 2];
  return isRootSessionToken(parent) ? parent : undefined;
}

function childSessionIdFromFile(value) {
  const parts = pathParts(value);
  const file = stripSessionExtension(parts[parts.length - 1]);
  const parent = parts[parts.length - 2];
  if (!file || !isRootSessionToken(parent) || isRootSessionToken(file)) return undefined;
  return file.replace(/^__/, "");
}

function childSessionInfo(sessionFile) {
  const parentSourceSessionId = rootSessionIdFromFile(sessionFile);
  const childSessionId = childSessionIdFromFile(sessionFile);
  return parentSourceSessionId && childSessionId ? { parentSourceSessionId, childSessionId } : undefined;
}

function sessionIdFor(event, ctx) {
  const ctxSessionFile = ctx?.sessionManager?.getSessionFile?.();
  const eventSessionFile = firstString(event?.session_file, event?.sessionFile);
  return firstString(
    event?.sessionId,
    event?.session_id,
    event?.sessionID,
    ctx?.sessionManager?.getSessionId?.(),
    rootSessionIdFromFile(ctxSessionFile),
    rootSessionIdFromFile(eventSessionFile),
    ctxSessionFile,
    eventSessionFile,
    ctx?.sessionManager?.getSessionName?.()
  );
}

function sourceEventIdFor(type, event, sessionId) {
  return firstString(
    event?.provider_event_id,
    event?.providerEventId,
    event?.event_id,
    event?.eventId,
    event?.toolCallId,
    event?.turn_id !== undefined ? \`\${type}:\${event.turn_id}\` : undefined,
    sessionId ? \`\${sessionId}:\${type}:\${++mastheadSequence}\` : undefined
  ) || \`\${type}:\${Date.now()}:\${++mastheadSequence}\`;
}

async function postMastheadEvent(type, event, ctx, extra = {}) {
  const sessionFile = firstString(event?.session_file, event?.sessionFile, ctx?.sessionManager?.getSessionFile?.());
  const childSession = childSessionInfo(sessionFile);
  const sessionId = sessionIdFor(event, ctx);
  const payload = {
    type,
    sessionId,
    provider_event_id: sourceEventIdFor(type, event, sessionId),
    timestamp: new Date().toISOString(),
    cwd: firstString(ctx?.cwd, ctx?.sessionManager?.getCwd?.(), event?.cwd),
    sessionFile,
    parentSourceSessionId: childSession?.parentSourceSessionId,
    childSessionId: childSession?.childSessionId,
    sessionName: firstString(ctx?.sessionManager?.getSessionName?.()),
    source: "masthead-live-connector",
    ...extra
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    await fetch(MASTHEAD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch {
  } finally {
    clearTimeout(timeout);
  }
}

export default function MastheadLiveConnector(pi) {
  pi.on("session_start", (event, ctx) => postMastheadEvent("session_start", event, ctx));
  pi.on("input", (event, ctx) =>
    postMastheadEvent("input", event, ctx, {
      inputSource: event?.source,
      messageSummary: countText(event?.text),
      imageCount: Array.isArray(event?.images) ? event.images.length : 0
    })
  );
  pi.on("tool_approval_requested", (event, ctx) =>
    postMastheadEvent("tool_approval_requested", event, ctx, {
      toolCallId: event?.toolCallId,
      toolName: event?.toolName,
      approvalMode: event?.approvalMode
    })
  );
  pi.on("tool_call", (event, ctx) =>
    postMastheadEvent("tool_call", event, ctx, {
      toolCallId: event?.toolCallId,
      toolName: event?.toolName,
      inputSummary: summarizeValue(event?.input)
    })
  );
  pi.on("tool_result", (event, ctx) =>
    postMastheadEvent("tool_result", event, ctx, {
      toolCallId: event?.toolCallId,
      toolName: event?.toolName,
      isError: event?.isError === true,
      contentSummary: summarizeValue(event?.content),
      detailsSummary: summarizeValue(event?.details)
    })
  );
  pi.on("session_stop", (event, ctx) =>
    postMastheadEvent("session_stop", event, ctx, {
      turnId: event?.turn_id,
      messageCount: Array.isArray(event?.messages) ? event.messages.length : undefined,
      hasLastAssistantMessage: Boolean(event?.last_assistant_message)
    })
  );
  pi.on("session_shutdown", (event, ctx) => postMastheadEvent("session_shutdown", event, ctx));
}
`;
}

async function readJsonConfig<T extends object>(configPath: string, options: { allowMissing: boolean }): Promise<JsonConfigRead<T>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") && options.allowMissing) return { config: {} as T, existed: false };
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Hook config must contain a JSON object: ${configPath}`);
  }
  return { config: parsed as T, existed: true };
}

async function writeJsonConfig(configPath: string, config: object): Promise<void> {
  await writeTextConfig(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function writeTextConfig(configPath: string, contents: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const mode = await targetMode(configPath);
  const extension = extname(configPath) || ".tmp";
  const tmpPath = join(dirname(configPath), `.${basename(configPath)}.masthead-tmp-${backupStamp()}${extension}`);
  await writeFile(tmpPath, contents, "utf8");
  await chmod(tmpPath, mode);
  await rename(tmpPath, configPath);
}

async function createHookBackup(configPath: string, operation: string): Promise<string> {
  await assertRegularHookFile(configPath);
  const extension = extname(configPath) || ".bak";
  const backupPath = `${configPath}.masthead-backup-${backupStamp()}-${operation}${extension}`;
  await copyFile(configPath, backupPath);
  return backupPath;
}

async function latestHookBackupPath(configPath: string): Promise<string | undefined> {
  const dir = dirname(configPath);
  const prefix = `${basename(configPath)}.masthead-backup-`;
  const entries = await readdir(dir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map(async (entry) => {
        const path = join(dir, entry.name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs, name: entry.name };
      })
  );
  backups.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  return backups[0]?.path;
}

async function targetMode(configPath: string): Promise<number> {
  try {
    const info = await lstat(configPath);
    if (info.isSymbolicLink()) throw new Error(`Refusing to mutate symlinked hook config: ${configPath}`);
    if (!info.isFile()) throw new Error(`Hook config path is not a regular file: ${configPath}`);
    return info.mode & 0o777;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return 0o600;
    throw error;
  }
}

async function assertRegularHookFile(configPath: string): Promise<void> {
  const info = await lstat(configPath);
  if (info.isSymbolicLink()) throw new Error(`Refusing to mutate symlinked hook config: ${configPath}`);
  if (!info.isFile()) throw new Error(`Hook config path is not a regular file: ${configPath}`);
}

async function pathExists(configPath: string): Promise<boolean> {
  try {
    await lstat(configPath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

function backupStamp(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${process.hrtime.bigint()}`;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
