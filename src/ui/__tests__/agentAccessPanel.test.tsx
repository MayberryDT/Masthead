import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentAccessPanel } from "../AgentAccessPanel";
import type { McpAuditRowDto, McpStatusDto, McpToolDto } from "../../app/daemonClient";

describe("AgentAccessPanel", () => {
  test("shows setup, permissions, tools, exclusions, and audit without fixed cards", () => {
    const html = renderToStaticMarkup(
      <AgentAccessPanel
        audit={audit}
        status={status}
        tools={tools}
      />
    );

    expect(html).toContain("MCP server");
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
  launchConfig: {
    args: ["/opt/Masthead/resources/daemon/dist/src/mcp/server.js"],
    command: "/opt/Masthead/resources/daemon/node",
    env: {
      MASTHEAD_DB_PATH: "/home/tyler/.local/share/masthead/masthead.sqlite"
    }
  },
  mode: "stdio",
  queryCount: 1,
  readOnly: true,
  ready: true,
  toolCount: 2
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
