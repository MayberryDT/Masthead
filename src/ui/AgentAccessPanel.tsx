import type { McpAuditRowDto, McpStatusDto, McpToolDto } from "../app/daemonClient";
import { McpAuditTable } from "./agent-access/McpAuditTable";
import { McpPermissions } from "./agent-access/McpPermissions";
import { McpSetup } from "./agent-access/McpSetup";
import { McpToolsTable } from "./agent-access/McpToolsTable";
import { AppButton } from "./primitives/AppButton";
import { PageHeader } from "./primitives/PageHeader";
import { StatStrip } from "./primitives/StatStrip";
import { StatusBadge } from "./primitives/StatusBadge";

type AgentAccessPanelProps = {
  audit?: McpAuditRowDto[];
  error?: string;
  loadState?: "loading" | "ready" | "error";
  onRefresh?: () => void;
  status?: McpStatusDto;
  tools?: McpToolDto[];
};

export function AgentAccessPanel({
  audit = [],
  error,
  loadState = "ready",
  onRefresh,
  status = defaultStatus,
  tools = []
}: AgentAccessPanelProps) {
  return (
    <section className="agent-access-panel surface-panel" aria-label="Agent Access">
      <PageHeader
        description="Give existing agents read-only access to Masthead history through the local MCP server."
        eyebrow="Agent Access"
        title="Read-only session retrieval"
        trailing={
          <div className="agent-access-header-actions">
            <StatusBadge tone={status.ready ? "active" : "warning"}>{status.ready ? "MCP server ready" : "MCP server unavailable"}</StatusBadge>
            {onRefresh ? (
              <AppButton onClick={onRefresh} variant="quiet">
                Refresh
              </AppButton>
            ) : null}
          </div>
        }
      />

      {loadState === "error" ? <p className="agent-access-error">{error ?? "MCP status could not be loaded."}</p> : null}

      <StatStrip
        items={[
          { label: "MCP server", value: status.ready ? "Ready" : "Unavailable" },
          { label: "Database", value: status.databasePath },
          { label: "Mode", value: `${status.mode} / ${status.readOnly ? "read-only" : "write-enabled"}` },
          { label: "Queries", value: `${status.queryCount} total` }
        ]}
        label="MCP status"
      />

      <McpSetup status={status} />
      <McpPermissions status={status} />
      <McpToolsTable tools={tools} />
      <McpAuditTable audit={audit} />
    </section>
  );
}

const defaultStatus: McpStatusDto = {
  databasePath: "Waiting for local daemon",
  globalAccessEnabled: false,
  launchConfig: {
    args: [],
    command: "Masthead MCP server unavailable",
    env: {
      MASTHEAD_DB_PATH: "Waiting for local daemon"
    }
  },
  mode: "stdio",
  queryCount: 0,
  readOnly: true,
  ready: false,
  toolCount: 0
};
