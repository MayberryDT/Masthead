import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import {
  getMcpQuerySummary,
  globalMcpAccessEnabled,
  listMcpExclusions,
  listMcpSourcePolicies,
  type McpExclusionDto,
  type McpSourcePolicyDto
} from "./db/mcpQueryRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

export type McpLaunchConfigDto = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type McpLaunchValidationDto = {
  ready: boolean;
  valid: boolean;
  commandExists: boolean;
  entryExists: boolean;
  databaseMatches: boolean;
  problems: string[];
  commandPath: string;
  entryPath?: string;
  configuredDatabasePath?: string;
  expectedDatabasePath: string;
};

export type McpTestConnectionDto = {
  ok: boolean;
  status: "passed" | "failed";
  attemptedAt: string;
  testedAt: string;
  validation: McpLaunchValidationDto;
  serverInfo?: {
    name?: string;
    version?: string;
  };
  protocolVersion?: string;
  toolCount?: number;
  toolNames?: string[];
  message: string;
  problems?: string[];
  stderr?: string;
};

export type McpStatusDto = {
  ready: boolean;
  databasePath: string;
  mode: "stdio";
  readOnly: true;
  toolCount: number;
  queryCount: number;
  lastQueryAt?: string;
  globalAccessEnabled: boolean;
  permissions: McpPermissionsDto;
};

export type McpPermissionsDto = {
  globalAccessEnabled: boolean;
  allowed: string[];
  blocked: string[];
  exclusions: McpExclusionDto[];
  sourcePolicies: McpSourcePolicyDto[];
};

export type McpToolDto = {
  name: string;
  purpose: string;
  arguments: string;
  dataReturned: string;
  permission: "Read only";
};

export const MCP_TOOL_CATALOG: McpToolDto[] = [
  {
    arguments: "optional query, kind, project, dateFrom, dateTo, limit, offset",
    dataReturned: "Published knowledge capsules (artifactId, kind, title, summary, provenance)",
    name: "search_knowledge",
    permission: "Read only",
    purpose: "PRIMARY: Search published Logbook knowledge for reuse"
  },
  {
    arguments: "optional kind, project, dateFrom, dateTo, limit, offset",
    dataReturned: "Published knowledge capsules without text query",
    name: "list_knowledge",
    permission: "Read only",
    purpose: "PRIMARY: Browse published knowledge"
  },
  {
    arguments: "artifactId",
    dataReturned: "Full artifact with artifactId, body, provenance, evidence refs",
    name: "get_knowledge",
    permission: "Read only",
    purpose: "PRIMARY: Read one published knowledge artifact"
  },
  {
    arguments: "artifactId",
    dataReturned: "Provenance session ids and join rationale",
    name: "get_provenance",
    permission: "Read only",
    purpose: "PRIMARY: List provenance for a published artifact"
  },
  {
    arguments: "sessionId, optional artifactId, query, limit, maxBytes",
    dataReturned: "Bounded historical excerpt (optionally provenance-gated)",
    name: "get_evidence_excerpt",
    permission: "Read only",
    purpose: "EVIDENCE: Bounded transcript excerpt for claim verification"
  },
  {
    arguments: "sessionId, optional artifactId, role, limit, maxBytes",
    dataReturned: "Bounded transcript rows (optionally provenance-gated)",
    name: "get_evidence_transcript",
    permission: "Read only",
    purpose: "EVIDENCE: Bounded transcript rows for claim verification"
  },
  {
    arguments: "none",
    dataReturned: "Published artifact counts by kind plus session coverage",
    name: "get_corpus_stats",
    permission: "Read only",
    purpose: "PRIMARY: Corpus statistics (artifacts first)"
  },
  {
    arguments: "optional query, kind, project, limit, offset",
    dataReturned: "Published artifact capsules (v1 alias of search_knowledge)",
    name: "search_artifacts",
    permission: "Read only",
    purpose: "Alias of search_knowledge"
  },
  {
    arguments: "artifactId",
    dataReturned: "Artifact body with stable artifactId (v1 alias of get_knowledge)",
    name: "get_artifact",
    permission: "Read only",
    purpose: "Alias of get_knowledge"
  },
  {
    arguments: "query, optional project/runtime/model/host/state/date filters, limit",
    dataReturned: "Session summaries (legacy; can be slow on broad queries)",
    name: "search_sessions",
    permission: "Read only",
    purpose: "LEGACY: Find sessions for evidence (prefer search_knowledge)"
  },
  {
    arguments: "sessionId, maxBytes",
    dataReturned: "Bounded session detail with transcript context",
    name: "get_session",
    permission: "Read only",
    purpose: "LEGACY: Read one bounded session record"
  },
  {
    arguments: "sessionId, optional query, limit, maxBytes",
    dataReturned: "Bounded transcript excerpts",
    name: "get_session_excerpt",
    permission: "Read only",
    purpose: "LEGACY alias of get_evidence_excerpt"
  },
  {
    arguments: "sessionId, optional limit, maxBytes, role",
    dataReturned: "Bounded canonical transcript rows with coverage",
    name: "get_session_transcript",
    permission: "Read only",
    purpose: "LEGACY alias of get_evidence_transcript"
  },
  {
    arguments: "project, limit",
    dataReturned: "Recent session summaries for a project",
    name: "list_project_sessions",
    permission: "Read only",
    purpose: "LEGACY: List sessions by project"
  },
  {
    arguments: "project, limit",
    dataReturned: "Project session timeline with relevant excerpts",
    name: "get_project_history",
    permission: "Read only",
    purpose: "LEGACY: Read project history"
  },
  {
    arguments: "none",
    dataReturned: "Counts for indexed sessions, projects, messages, and audit rows",
    name: "get_masthead_coverage",
    permission: "Read only",
    purpose: "LEGACY session coverage (prefer get_corpus_stats)"
  }
];

const allowedPermissions = [
  "Search published knowledge artifacts",
  "Read published artifact bodies with provenance",
  "Read provenance-gated historical evidence",
  "Search session summaries for evidence",
  "Read project history"
];
const blockedPermissions = ["Execute shell commands", "Mutate files or Git", "Modify harness sessions"];
const testConnectionTimeoutMs = 2_500;
const expectedMcpToolNames = MCP_TOOL_CATALOG.map((tool) => tool.name);

export function getMcpStatus(db: MastheadDatabase, databasePath: string, dataDirectory?: string): McpStatusDto {
  const summary = getMcpQuerySummary(db);
  const globalAccess = globalMcpAccessEnabled(db);
  return {
    databasePath,
    globalAccessEnabled: globalAccess,
    lastQueryAt: summary.lastQueryAt,
    mode: "stdio",
    permissions: {
      allowed: allowedPermissions,
      blocked: blockedPermissions,
      exclusions: listMcpExclusions(db),
      globalAccessEnabled: globalAccess,
      sourcePolicies: listMcpSourcePolicies(db)
    },
    queryCount: summary.queryCount,
    readOnly: true,
    ready: true,
    toolCount: MCP_TOOL_CATALOG.length
  };
}

export function listMcpTools(): McpToolDto[] {
  return MCP_TOOL_CATALOG;
}

export function getMcpLaunchConfig(databasePath: string, dataDirectory?: string): McpLaunchConfigDto {
  const command = process.env.MASTHEAD_MCP_COMMAND || process.env.MASTHEAD_NODE_PATH || process.execPath;
  const entryPath = process.env.MASTHEAD_MCP_ENTRY || resolve(process.cwd(), "dist/daemon/src/mcp/server.js");
  return {
    args: [entryPath],
    command,
    env: {
      ...(dataDirectory ? { MASTHEAD_DATA_DIR: dataDirectory } : {}),
      MASTHEAD_DB_PATH: databasePath
    }
  };
}

function mcpSpawnEnv(launchEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...launchEnv };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.PATHEXT) env.PATHEXT = process.env.PATHEXT;
  if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  return env;
}

export function coerceMcpLaunchConfig(value: unknown, fallback: McpLaunchConfigDto): McpLaunchConfigDto {
  const record = objectRecord(value) ?? {};
  const candidate = objectRecord(record.launchConfig) ?? record;
  const command = typeof candidate?.command === "string" && candidate.command.trim() ? candidate.command : fallback.command;
  const args = Array.isArray(candidate?.args) && candidate.args.every((arg) => typeof arg === "string") ? candidate.args : fallback.args;
  const env = objectRecord(candidate?.env);
  return {
    args,
    command,
    env: {
      ...fallback.env,
      ...(env ? stringRecord(env) : {})
    }
  };
}

export async function validateMcpLaunchConfig(
  launchConfig: McpLaunchConfigDto,
  activeDatabasePath: string
): Promise<McpLaunchValidationDto> {
  const problems: string[] = [];
  const commandExists = await executableExists(launchConfig.command);
  const entryPath = launchConfig.args[0];
  const entryExists = typeof entryPath === "string" && entryPath.trim() ? await readableFileExists(entryPath) : false;
  const configuredDatabasePath = launchConfig.env.MASTHEAD_DB_PATH;
  const databaseMatches = typeof configuredDatabasePath === "string" && resolve(configuredDatabasePath) === resolve(activeDatabasePath);

  if (!commandExists) problems.push(`Command not found: ${launchConfig.command}`);
  if (!entryExists) problems.push(entryPath ? `MCP entry not found: ${entryPath}` : "MCP entry argument is missing.");
  if (!configuredDatabasePath) problems.push("MASTHEAD_DB_PATH is required in the MCP environment.");
  else if (!databaseMatches) problems.push(`MASTHEAD_DB_PATH does not match active database: ${activeDatabasePath}`);

  const ready = problems.length === 0;
  return {
    commandExists,
    commandPath: launchConfig.command,
    configuredDatabasePath,
    databaseMatches,
    entryExists,
    entryPath,
    expectedDatabasePath: activeDatabasePath,
    problems,
    ready,
    valid: ready
  };
}

export async function testMcpConnection(
  activeDatabasePath: string,
  dataDirectory?: string,
  timeoutMs = testConnectionTimeoutMs
): Promise<McpTestConnectionDto> {
  const launchConfig = getMcpLaunchConfig(activeDatabasePath, dataDirectory);
  const attemptedAt = new Date().toISOString();
  const validation = await validateMcpLaunchConfig(launchConfig, activeDatabasePath);
  if (!validation.ready) {
    return {
      attemptedAt,
      testedAt: attemptedAt,
      ok: false,
      status: "failed",
      validation,
      message: validation.problems.join(" ") || "MCP launch config is invalid.",
      problems: validation.problems
    };
  }

  const child = spawn(launchConfig.command, launchConfig.args, {
    env: mcpSpawnEnv(launchConfig.env),
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdoutBuffer = "";
  let stderr = "";
  const onStderr = (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  };
  child.stderr.on("data", onStderr);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");

  type ProbeResult = Omit<McpTestConnectionDto, "attemptedAt" | "testedAt" | "validation" | "status">;
  const readResponse = async (): Promise<ProbeResult> => {
    let initialized:
      | {
          protocolVersion?: string;
          serverInfo?: { name?: string; version?: string };
        }
      | undefined;

    for await (const chunk of child.stdout) {
      stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");
        if (!line) continue;
        try {
          const response = JSON.parse(line) as {
            result?: {
              protocolVersion?: string;
              serverInfo?: { name?: string; version?: string };
              tools?: Array<{ name?: unknown }>;
            };
            error?: { message?: string };
          };

          if (!initialized) {
            if (response.result?.serverInfo?.name !== "masthead") {
              return {
                ok: false,
                message: response.error?.message || "MCP server returned an unexpected initialize response.",
                stderr: stderr.trim() || undefined
              };
            }
            initialized = {
              protocolVersion: response.result.protocolVersion,
              serverInfo: response.result.serverInfo
            };
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
            child.stdin.end();
            continue;
          }

          const toolNames = Array.isArray(response.result?.tools)
            ? response.result.tools.map((tool) => tool.name).filter((name): name is string => typeof name === "string").sort()
            : [];
          const missingTools = expectedMcpToolNames.filter((name) => !toolNames.includes(name));
          if (missingTools.length > 0) {
            return {
              ok: false,
              message: `MCP server tools/list missing tools: ${missingTools.join(", ")}`,
              protocolVersion: initialized.protocolVersion,
              serverInfo: initialized.serverInfo,
              stderr: stderr.trim() || undefined,
              toolCount: toolNames.length,
              toolNames
            };
          }
          return {
            ok: true,
            message: `MCP server initialized and returned ${toolNames.length} tools.`,
            protocolVersion: initialized.protocolVersion,
            serverInfo: initialized.serverInfo,
            stderr: stderr.trim() || undefined,
            toolCount: toolNames.length,
            toolNames
          };
        } catch (error) {
          return {
            ok: false,
            message: `MCP server returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            protocolVersion: initialized?.protocolVersion,
            serverInfo: initialized?.serverInfo,
            stderr: stderr.trim() || undefined
          };
        }
      }
    }
    return {
      ok: false,
      message: initialized ? "MCP server stdout closed before tools/list response." : "MCP server stdout closed before initialize response.",
      protocolVersion: initialized?.protocolVersion,
      serverInfo: initialized?.serverInfo,
      stderr: stderr.trim() || undefined
    };
  };

  const exitResult = once(child, "exit").then(([code, signal]) => ({
    ok: false,
    message: `MCP server exited before initialize response (${code ?? signal ?? "unknown"}).`,
    stderr: stderr.trim() || undefined
  }));
  const errorResult = once(child, "error").then(([error]) => ({
    ok: false,
    message: `MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`,
    stderr: stderr.trim() || undefined
  }));
  const timeoutResult = delay(timeoutMs).then(() => ({
    ok: false,
    message: `MCP server did not respond within ${timeoutMs}ms.`,
    stderr: stderr.trim() || undefined
  }));

  const result = await Promise.race([readResponse(), exitResult, errorResult, timeoutResult]);
  child.stderr.off("data", onStderr);
  if (!child.killed) child.kill();
  return { attemptedAt, testedAt: attemptedAt, validation, status: result.ok ? "passed" : "failed", ...result };
}

async function executableExists(command: string): Promise<boolean> {
  if (!command.trim()) return false;
  if (looksLikePath(command)) return fileExists(command, constants.X_OK);

  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of pathDirs) {
    for (const extension of extensions) {
      const candidate = resolve(directory, command.endsWith(extension) ? command : `${command}${extension}`);
      if (await fileExists(candidate, constants.X_OK)) return true;
    }
  }
  return false;
}

async function readableFileExists(path: string): Promise<boolean> {
  return fileExists(path, constants.R_OK);
}

async function fileExists(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function looksLikePath(command: string): boolean {
  return isAbsolute(command) || command.startsWith(".") || command.includes("/") || command.includes("\\");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
