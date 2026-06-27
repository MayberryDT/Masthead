import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentAccessPanel } from "../AgentAccessPanel";
import type { McpAuditRowDto, McpStatusDto, McpToolDto } from "../../app/daemonClient";
import type { McpLaunchConfigDto, McpLaunchValidationDto } from "../../app/mcpLaunchClient";

describe("AgentAccessPanel", () => {
  test("shows setup, permissions, tools, exclusions, and audit without fixed cards", () => {
    const html = renderToStaticMarkup(
      <AgentAccessPanel
        audit={audit}
        launchConfig={launchConfig}
        launchValidation={validLaunchConfig}
        status={status}
        tools={tools}
      />
    );

    expect(html).toContain("MCP server");
    expect(html).toContain("agent-access-layout");
    expect(html).toContain("agent-access-setup-section");
    expect(html).toContain("agent-access-policy-section");
    expect(html).toContain("agent-access-tools-section");
    expect(html).toContain("agent-access-audit-section");
    expect(html).toContain("2 read-only");
    expect(html).toContain("Access");
    expect(html).toContain("Enabled");
    expect(html).toContain("MASTHEAD_DB_PATH");
    expect(html).toContain("Search session summaries");
    expect(html).toContain("search_sessions");
    expect(html).toContain("get_session_excerpt");
    expect(html).toContain("mcp_query_log");
    expect(html).toContain("Excluded projects and sessions");
    expect(html).toContain("session:agent");
    expect(html).not.toContain("npm run mcp");
    expect(html).not.toContain("surface-card-grid");
    expect(html).not.toContain("surface-data-card");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
  });
});

const status: McpStatusDto = {
  databasePath: "/home/tyler/.local/share/masthead/masthead.sqlite",
  globalAccessEnabled: true,
  lastQueryAt: "2026-06-25T12:00:00.000Z",
  mode: "stdio",
  queryCount: 1,
  readOnly: true,
  ready: true,
  toolCount: 2
};

const launchConfig: McpLaunchConfigDto = {
  args: ["/opt/Masthead/resources/daemon/dist/src/mcp/server.js"],
  command: "/opt/Masthead/resources/daemon/node",
  env: {
    MASTHEAD_DB_PATH: "/home/tyler/.local/share/masthead/masthead.sqlite"
  }
};

const validLaunchConfig: McpLaunchValidationDto = {
  commandExists: true,
  databaseMatches: true,
  entryExists: true,
  problems: [],
  valid: true
};

const tools: McpToolDto[] = [
  {
    arguments: "query, filters, limit",
    dataReturned: "Session summaries",
    name: "search_sessions",
    permission: "Read only",
    purpose: "Find session records"
  },
  {
    arguments: "sessionId, query, limit, maxBytes",
    dataReturned: "Bounded transcript excerpts",
    name: "get_session_excerpt",
    permission: "Read only",
    purpose: "Read bounded historical excerpts"
  }
];

const audit: McpAuditRowDto[] = [
  {
    boundedBytes: 8000,
    mcpQueryId: "mcp_query:1",
    requestedAt: "2026-06-25T12:00:00.000Z",
    resultCount: 1,
    sessionIds: ["session:agent"],
    status: "succeeded",
    toolName: "get_session_excerpt"
  }
];
