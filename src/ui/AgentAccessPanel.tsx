import type { McpLaunchConfigDto, McpLaunchValidationDto, McpTestConnectionDto } from "../app/mcpLaunchClient";
import type { McpAuditRowDto, McpStatusDto, McpToolDto } from "../app/daemonClient";
import { McpAuditTable } from "./agent-access/McpAuditTable";
import { McpPermissions } from "./agent-access/McpPermissions";
import { McpSetup } from "./agent-access/McpSetup";
import { McpToolsTable } from "./agent-access/McpToolsTable";
import { AppButton } from "./primitives/AppButton";
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
      <header className="agent-access-overview">
        <div>
          <p className="mono-label">Agent Access</p>
          <h2>Can agents read Masthead?</h2>
          <p>{accessSummary(status)}</p>
        </div>
        <div className="agent-access-overview-actions">
          <StatusBadge tone={status.ready && status.globalAccessEnabled && status.readOnly ? "active" : "warning"}>
            {status.ready ? "MCP ready" : "MCP unavailable"}
          </StatusBadge>
          {onRefresh ? (
            <AppButton onClick={onRefresh} variant="quiet">
              Refresh status
            </AppButton>
          ) : null}
        </div>
      </header>

      {loadState === "error" ? <p className="agent-access-error">{error ?? "MCP status could not be loaded."}</p> : null}

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

function accessSummary(status: McpStatusDto): string {
  if (!status.ready) return "MCP server is unavailable";
  if (!status.globalAccessEnabled) return "Read-only MCP access is disabled";
  if (!status.readOnly) return "MCP is running with write access, which Masthead should not expose";
  return "Read-only MCP access is enabled";
}
