import { constants, type Stats } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeKind } from "../../adapters/types.ts";
import type {
  SourceDiagnosticDto,
  SourceObserverCapabilityDto,
  SourceObserverDto,
  SourceObserverObservationDto,
  SourceObserverPathDto
} from "../../shared/sourcesSetup.ts";
import type { DiscoveryContext } from "../../adapters/types.ts";

const HERDR_SERVER_LOG = ".config/herdr/herdr-server.log";
const HERDR_SESSION_JSON = ".config/herdr/session.json";
const HERDR_CLIENT_LOG = ".config/herdr/herdr-client.log";
const HERDR_BINARY = ".local/bin/herdr";
const HERDR_OBSERVER_PATHS = [HERDR_SERVER_LOG, HERDR_SESSION_JSON, HERDR_CLIENT_LOG, HERDR_BINARY] as const;
const DEFAULT_MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_MAX_LOG_LINES = 500;
const DEFAULT_MAX_OBSERVATIONS = 50;
const SENSITIVE_LINE_PATTERN = /\b(prompt|transcript|scrollback|terminal|stdout|stderr|message|messages|tokens?|model|provider)\b/i;

const HERDR_CAPABILITIES: SourceObserverCapabilityDto = {
  callsSocket: false,
  createsSessions: false,
  passivePaneEvidence: true,
  providesModel: false,
  providesTokens: false,
  providesTranscript: false
};

type HerdrKnownAgent = "Omp" | "Codex" | "Claude" | "Grok" | "Hermes";
type HerdrMappedRuntime = Extract<RuntimeKind, "omp" | "codex" | "claude_code" | "grok" | "hermes">;

const HERDR_AGENT_RUNTIME_MAP = {
  Claude: "claude_code",
  Codex: "codex",
  Grok: "grok",
  Hermes: "hermes",
  Omp: "omp"
} satisfies Record<HerdrKnownAgent, HerdrMappedRuntime>;

type HerdrObservationKind = SourceObserverObservationDto["kind"];

export type HerdrParseOptions = {
  sourcePath: string;
  now: string;
  maxObservations?: number;
};

export type HerdrParseResult = {
  observations: SourceObserverObservationDto[];
  diagnostics: SourceDiagnosticDto[];
};

export type HerdrObserverScanOptions = {
  maxLogBytes?: number;
  maxLogLines?: number;
  maxObservations?: number;
};

export function mapHerdrAgentToRuntime(agentLabel: string | undefined): HerdrMappedRuntime | undefined {
  if (!agentLabel || !isKnownHerdrAgent(agentLabel)) return undefined;
  return HERDR_AGENT_RUNTIME_MAP[agentLabel];
}

export function parseHerdrServerLogLines(lines: string[], options: HerdrParseOptions): HerdrParseResult {
  const observations: SourceObserverObservationDto[] = [];
  const currentAgentsByPane = new Map<string, SourceObserverObservationDto>();
  const workspaceByPane = new Map<string, string>();
  let sensitiveIgnored = 0;

  for (const line of lines) {
    if (SENSITIVE_LINE_PATTERN.test(line)) {
      sensitiveIgnored += 1;
      continue;
    }
    const observation = parseHerdrServerLogLine(line, options);
    if (!observation) continue;
    observations.push(observation);
    updateHerdrCurrentAgentState(line, observation, currentAgentsByPane, workspaceByPane);
  }

  const diagnostics: SourceDiagnosticDto[] = [];
  if (sensitiveIgnored > 0) {
    diagnostics.push({
      code: "herdr_observer_sensitive_lines_ignored",
      count: sensitiveIgnored,
      message: "Ignored Herdr log lines that looked like raw prompt, transcript, terminal, model, or token content.",
      observedAt: options.now,
      path: options.sourcePath,
      severity: "info"
    });
  }

  const recentObservations = observations.slice(-(options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS));
  const recentObservationKeys = new Set(
    recentObservations.map((observation) => [observation.kind, observation.paneId ?? "", observation.agentLabel ?? "", observation.observedAt].join("|"))
  );
  const currentAgentObservations = Array.from(currentAgentsByPane.values()).filter((observation) => {
    const key = [observation.kind, observation.paneId ?? "", observation.agentLabel ?? "", observation.observedAt].join("|");
    return !recentObservationKeys.has(key);
  });

  return {
    diagnostics,
    observations: [...currentAgentObservations, ...recentObservations]
  };
}

export async function scanLocalObservers(context: DiscoveryContext, options: HerdrObserverScanOptions = {}): Promise<SourceObserverDto[]> {
  return [await scanHerdrObserver(context, options)];
}

export async function scanHerdrObserver(context: DiscoveryContext, options: HerdrObserverScanOptions = {}): Promise<SourceObserverDto> {
  const checkedPaths = await Promise.all(HERDR_OBSERVER_PATHS.map((relativePath) => checkObserverPath(context, relativePath)));
  const diagnostics = checkedPaths.flatMap((path) => path.diagnostics);
  const serverLogPath = checkedPaths.find((path) => path.path.endsWith(HERDR_SERVER_LOG));
  let observations: SourceObserverObservationDto[] = [];

  if (serverLogPath?.exists && serverLogPath.readable && serverLogPath.kind === "file") {
    try {
      const logText = await readTail(serverLogPath.path, options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES);
      const lines = logText.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-(options.maxLogLines ?? DEFAULT_MAX_LOG_LINES));
      const parsed = parseHerdrServerLogLines(lines, {
        maxObservations: options.maxObservations,
        now: context.now,
        sourcePath: serverLogPath.path
      });
      observations = parsed.observations;
      diagnostics.push(...parsed.diagnostics);
    } catch (error) {
      diagnostics.push({
        code: "herdr_observer_log_unreadable",
        details: errorMessage(error),
        message: "Herdr server log could not be read for passive observer metadata.",
        observedAt: context.now,
        path: serverLogPath.path,
        severity: "warning"
      });
    }
  }

  const hasKnownPath = checkedPaths.some((path) => path.exists);
  if (!hasKnownPath) {
    diagnostics.push({
      code: "herdr_observer_not_detected",
      message: "No Herdr observer files were found in known local locations.",
      observedAt: context.now,
      severity: "warning"
    });
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    capabilities: HERDR_CAPABILITIES,
    checkedPaths,
    diagnostics,
    label: "Herdr",
    observations,
    observer: "herdr",
    state: hasErrors ? "degraded" : hasKnownPath ? "available" : "not_detected"
  };
}

function parseHerdrServerLogLine(line: string, options: HerdrParseOptions): SourceObserverObservationDto | undefined {
  const kind = classifyHerdrLogLine(line);
  if (!kind) return undefined;

  const agentLabel = extractAgentLabel(line);
  const mappedRuntime = mapHerdrAgentToRuntime(agentLabel);
  const observedAt = extractObservedAt(line) ?? options.now;
  const workspaceId = extractKeyedValue(line, ["workspace", "workspace_id", "workspaceId"]);
  const paneId = extractKeyedValue(line, ["pane", "pane_id", "paneId"]);
  const cwd = extractKeyedValue(line, ["cwd", "working_directory", "workingDirectory"]);
  const pid = extractKeyedNumber(line, "pid");
  const pgid = extractKeyedNumber(line, "pgid");

  const observation: SourceObserverObservationDto = {
    confidence: agentLabel === "Claude" ? "inferred" : "heuristic",
    kind,
    observedAt,
    observer: "herdr"
  };
  if (workspaceId) observation.workspaceId = workspaceId;
  if (paneId) observation.paneId = paneId;
  if (cwd) observation.cwd = cwd;
  if (typeof pid === "number") observation.pid = pid;
  if (typeof pgid === "number") observation.pgid = pgid;
  if (agentLabel) observation.agentLabel = agentLabel;
  if (mappedRuntime) observation.mappedRuntime = mappedRuntime;
  return observation;
}

function updateHerdrCurrentAgentState(
  line: string,
  observation: SourceObserverObservationDto,
  currentAgentsByPane: Map<string, SourceObserverObservationDto>,
  workspaceByPane: Map<string, string>
): void {
  if (observation.paneId && observation.workspaceId) {
    workspaceByPane.set(observation.paneId, observation.workspaceId);
    const currentAgent = currentAgentsByPane.get(observation.paneId);
    if (currentAgent && !currentAgent.workspaceId) currentAgent.workspaceId = observation.workspaceId;
  }

  if (observation.kind === "exit" && observation.paneId) {
    currentAgentsByPane.delete(observation.paneId);
    return;
  }

  if (observation.kind !== "agent" || !observation.paneId) return;
  if (/\bagent\s*=\s*None\b/i.test(line) || /->\s*None\b/i.test(line)) {
    currentAgentsByPane.delete(observation.paneId);
    return;
  }
  if (!observation.agentLabel || !observation.mappedRuntime) return;

  const workspaceId = observation.workspaceId ?? workspaceByPane.get(observation.paneId);
  currentAgentsByPane.set(observation.paneId, workspaceId ? { ...observation, workspaceId } : observation);
}


function classifyHerdrLogLine(line: string): HerdrObservationKind | undefined {
  if (/agent\s+(?:changed|process)|Some\((?:Omp|Codex|Claude|Grok|Hermes)\)/i.test(line)) return "agent";
  if (/\bpid\s*[=:]|\bpgid\s*[=:]/i.test(line)) return "process";
  if (/\bfocus(?:ed)?\b|\bfocused\b/i.test(line)) return "focus";
  if (/\bapi\s+socket\b|\bsocket\s+path\b|\bherdr\.sock\b/i.test(line)) return "socket";
  if (/\bsession\b.*\bsav(?:e|ed|ing)\b/i.test(line)) return "session_save";
  if (/\bpane\b.*\b(?:exit|exited|closed)\b/i.test(line)) return "exit";
  if (/\bserver\b.*\bstart(?:ed|ing)?\b|\bstart(?:ed|ing)?\b.*\bserver\b/i.test(line)) return "server";
  if (/\bworkspace\b/i.test(line)) return "workspace";
  if (/\bpane\b/i.test(line)) return "pane";
  return undefined;
}

function extractObservedAt(line: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?)/.exec(line.trim());
  if (!match) return undefined;
  const candidate = match[1].includes("T") ? match[1] : match[1].replace(" ", "T");
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function extractAgentLabel(line: string): string | undefined {
  const currentAgentMatch = /\bagent\s*=\s*(?:Some\((Omp|Codex|Claude|Grok|Hermes)\)|None)\b/i.exec(line);
  if (currentAgentMatch) return currentAgentMatch[1] ? canonicalAgentLabel(currentAgentMatch[1]) : undefined;
  const someMatches = [...line.matchAll(/Some\((Omp|Codex|Claude|Grok|Hermes)\)/g)];
  const latestSomeMatch = someMatches.at(-1);
  if (latestSomeMatch?.[1]) return latestSomeMatch[1];
  const agentMatch = /\bagent(?:Label)?\s*[=:]\s*"?(Omp|Codex|Claude|Grok|Hermes)"?/i.exec(line);
  if (!agentMatch) return undefined;
  return canonicalAgentLabel(agentMatch[1]);
}

function canonicalAgentLabel(value: string): HerdrKnownAgent {
  const normalized = value.toLowerCase();
  if (normalized === "omp") return "Omp";
  if (normalized === "codex") return "Codex";
  if (normalized === "claude") return "Claude";
  if (normalized === "grok") return "Grok";
  return "Hermes";
}

function isKnownHerdrAgent(value: string): value is HerdrKnownAgent {
  return value === "Omp" || value === "Codex" || value === "Claude" || value === "Grok" || value === "Hermes";
}

function extractKeyedValue(line: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const quoted = new RegExp(`(?:^|[\\s,])${key}\\s*[=:]\\s*"([^"]{1,512})"`, "i").exec(line);
    const quotedValue = quoted ? sanitizeMetadataValue(quoted[1]) : undefined;
    if (quotedValue) return quotedValue;

    const unquoted = new RegExp(`(?:^|[\\s,])${key}\\s*[=:]\\s*([^\\s,;]{1,512})`, "i").exec(line);
    const unquotedValue = unquoted ? sanitizeMetadataValue(unquoted[1]) : undefined;
    if (unquotedValue) return unquotedValue;
  }
  return undefined;
}

function extractKeyedNumber(line: string, key: string): number | undefined {
  const value = extractKeyedValue(line, [key]);
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sanitizeMetadataValue(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || SENSITIVE_LINE_PATTERN.test(trimmed)) return undefined;
  return trimmed.slice(0, 512);
}

async function checkObserverPath(context: DiscoveryContext, relativePath: (typeof HERDR_OBSERVER_PATHS)[number]): Promise<SourceObserverPathDto> {
  const absolutePath = join(context.homeDir, relativePath);
  try {
    const stats = await stat(absolutePath);
    const readable = await isReadable(absolutePath);
    const diagnostics: SourceDiagnosticDto[] = [];
    if (!readable) {
      diagnostics.push({
        code: "herdr_observer_path_unreadable",
        message: "Herdr observer path exists but is not readable.",
        observedAt: context.now,
        path: absolutePath,
        severity: "warning"
      });
    }
    return {
      byteCount: stats.size,
      diagnostics,
      exists: true,
      kind: pathKind(stats),
      lastModifiedAt: stats.mtime.toISOString(),
      path: absolutePath,
      readable
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        byteCount: 0,
        diagnostics: [],
        exists: false,
        kind: "missing",
        path: absolutePath,
        readable: false
      };
    }
    return {
      byteCount: 0,
      diagnostics: [
        {
          code: "herdr_observer_path_check_failed",
          details: errorMessage(error),
          message: "Herdr observer path could not be checked.",
          observedAt: context.now,
          path: absolutePath,
          severity: "warning"
        }
      ],
      exists: false,
      kind: "other",
      path: absolutePath,
      readable: false
    };
  }
}

function pathKind(stats: Stats): SourceObserverPathDto["kind"] {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  return "other";
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readTail(path: string, maxBytes: number): Promise<string> {
  const stats = await stat(path);
  const length = Math.min(stats.size, Math.max(0, maxBytes));
  if (length === 0) return "";
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, stats.size - length);
    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("message" in error)) return undefined;
  const message = error.message;
  return typeof message === "string" ? message : undefined;
}
