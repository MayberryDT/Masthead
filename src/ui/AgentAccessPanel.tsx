import type { McpLaunchConfigDto, McpLaunchValidationDto, McpTestConnectionDto } from "../app/mcpLaunchClient";
import type { McpAuditRowDto, McpStatusDto, McpToolDto } from "../app/daemonClient";
import { McpAuditTable } from "./agent-access/McpAuditTable";
import { McpPermissions } from "./agent-access/McpPermissions";
import { McpSetup } from "./agent-access/McpSetup";
import { McpToolsTable } from "./agent-access/McpToolsTable";
import { AppButton } from "./primitives/AppButton";
import { StatStrip } from "./primitives/StatStrip";
import { StatusBadge } from "./primitives/StatusBadge";

type AgentAccessPanelProps = {
  audit?: McpAuditRowDto[];
  error?: string;
  launchConfig?: McpLaunchConfigDto;
  launchValidation?: McpLaunchValidationDto;
  launchValidationError?: string;
  loadState?: "loading" | "ready" | "error";
  onRefresh?: () => void;
  onTestConnection?: () => Promise<McpTestConnectionDto>;
  status?: McpStatusDto;
  testConnectionResult?: McpTestConnectionDto;
  testConnectionState?: "idle" | "testing" | "passed" | "failed";
  tools?: McpToolDto[];
};

export function AgentAccessPanel({
  audit = [],
  error,
  launchConfig,
  launchValidation,
  launchValidationError,
  loadState = "ready",
  onRefresh,
  onTestConnection,
  status = defaultStatus,
  testConnectionResult,
  testConnectionState,
  tools = []
}: AgentAccessPanelProps) {
  return (
    <section className="agent-access-panel surface-panel" aria-label="Agent Access">
      <div className="agent-access-command-row">
        <StatusBadge tone={status.ready ? "active" : "warning"}>{status.ready ? "MCP server ready" : "MCP server unavailable"}</StatusBadge>
        {onRefresh ? (
          <AppButton onClick={onRefresh} variant="quiet">
            Refresh
          </AppButton>
        ) : null}
      </div>

      {loadState === "error" ? <p className="agent-access-error">{error ?? "MCP status could not be loaded."}</p> : null}

      <StatStrip
        items={[
          { label: "MCP server", value: status.ready ? "Ready" : "Unavailable" },
          { label: "Database", value: status.databasePath },
          { label: "Mode", value: `${status.mode} / ${status.readOnly ? "read-only" : "write-enabled"}` },
          { label: "Tools", value: `${status.toolCount} read-only` },
          { label: "Access", value: status.globalAccessEnabled ? "Enabled" : "Disabled" },
          { label: "Queries", value: status.lastQueryAt ? `${status.queryCount} total / ${formatDateTime(status.lastQueryAt)}` : `${status.queryCount} total` }
        ]}
        label="MCP status"
      />

      <div className="agent-access-layout">
        <McpSetup
          launchConfig={launchConfig}
          onTestConnection={onTestConnection}
          status={status}
          testConnectionResult={testConnectionResult}
          testConnectionState={testConnectionState}
          validation={launchValidation}
          validationError={launchValidationError}
        />
        <McpPermissions status={status} />
        <McpToolsTable tools={tools} />
        <McpAuditTable audit={audit} />
      </div>
    </section>
  );
}

const defaultStatus: McpStatusDto = {
  databasePath: "Waiting for local daemon",
  globalAccessEnabled: false,
  mode: "stdio",
  queryCount: 0,
  readOnly: true,
  ready: false,
  toolCount: 0
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
