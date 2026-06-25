import { resolve } from "node:path";
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

export type McpStatusDto = {
  ready: boolean;
  databasePath: string;
  mode: "stdio";
  readOnly: true;
  toolCount: number;
  queryCount: number;
  lastQueryAt?: string;
  globalAccessEnabled: boolean;
  launchConfig: McpLaunchConfigDto;
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
    arguments: "query, optional project/runtime/model/host/state/date filters, limit",
    dataReturned: "Session summaries with IDs, titles, projects, models, and snippets",
    name: "search_sessions",
    permission: "Read only",
    purpose: "Find session records"
  },
  {
    arguments: "sessionId, maxBytes",
    dataReturned: "Bounded session detail with transcript context",
    name: "get_session",
    permission: "Read only",
    purpose: "Read one bounded session record"
  },
  {
    arguments: "sessionId, optional query, limit, maxBytes",
    dataReturned: "Bounded transcript excerpts",
    name: "get_session_excerpt",
    permission: "Read only",
    purpose: "Read bounded historical excerpts"
  },
  {
    arguments: "project, limit",
    dataReturned: "Recent session summaries for a project",
    name: "list_project_sessions",
    permission: "Read only",
    purpose: "List sessions by project"
  },
  {
    arguments: "project, limit",
    dataReturned: "Project session timeline with relevant excerpts",
    name: "get_project_history",
    permission: "Read only",
    purpose: "Read project history"
  },
  {
    arguments: "none",
    dataReturned: "Counts for indexed sessions, projects, messages, and audit rows",
    name: "get_masthead_coverage",
    permission: "Read only",
    purpose: "Inspect Masthead coverage"
  }
];

const allowedPermissions = ["Search session summaries", "Read bounded historical excerpts", "Read project history"];
const blockedPermissions = ["Execute shell commands", "Mutate files or Git", "Modify harness sessions"];

export function getMcpStatus(db: MastheadDatabase, databasePath: string): McpStatusDto {
  const summary = getMcpQuerySummary(db);
  const globalAccess = globalMcpAccessEnabled(db);
  return {
    databasePath,
    globalAccessEnabled: globalAccess,
    lastQueryAt: summary.lastQueryAt,
    launchConfig: mcpLaunchConfig(databasePath),
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

function mcpLaunchConfig(databasePath: string): McpLaunchConfigDto {
  const command = process.env.MASTHEAD_MCP_COMMAND || process.env.MASTHEAD_NODE_PATH || process.execPath;
  const entryPath = process.env.MASTHEAD_MCP_ENTRY || resolve(process.cwd(), "dist/daemon/src/mcp/server.js");
  return {
    args: [entryPath],
    command,
    env: {
      MASTHEAD_DB_PATH: databasePath
    }
  };
}
