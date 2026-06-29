import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpStatusDto } from "../../app/daemonClient";
import { getMcpStatus } from "../../app/daemonClient";
import {
  getMcpLaunchConfig,
  testMcpConnection,
  validateMcpLaunchConfig,
  type McpLaunchConfigDto,
  type McpLaunchValidationDto,
  type McpTestConnectionDto
} from "../../app/mcpLaunchClient";
import { AppButton } from "../primitives/AppButton";
import { CodeBlock } from "../primitives/CodeBlock";
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsSection } from "./SettingsSection";

type McpSettingsProps = {
  baseUrl?: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";
type TestState = "idle" | "testing" | "passed" | "failed";

const clients = ["Codex", "Claude Code", "Cursor", "Generic stdio"];

export function McpSettings({ baseUrl }: McpSettingsProps) {
  const [launchConfig, setLaunchConfig] = useState<McpLaunchConfigDto>();
  const [launchValidation, setLaunchValidation] = useState<McpLaunchValidationDto>();
  const [loadError, setLoadError] = useState<string>();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [status, setStatus] = useState<McpStatusDto>();
  const [testResult, setTestResult] = useState<McpTestConnectionDto>();
  const [testState, setTestState] = useState<TestState>("idle");

  const loadMcp = useCallback((signal?: AbortSignal) => {
    setLoadState("loading");
    void (async () => {
      try {
        const [nextStatus, nextLaunchConfig] = await Promise.all([
          getMcpStatus(baseUrl, { signal }),
          getMcpLaunchConfig(baseUrl, { signal })
        ]);
        const nextValidation = await validateMcpLaunchConfig(nextLaunchConfig, baseUrl, { signal });
        if (signal?.aborted) return;
        setStatus(nextStatus);
        setLaunchConfig(nextLaunchConfig);
        setLaunchValidation(nextValidation);
        setLoadError(undefined);
        setLoadState("ready");
      } catch (error: unknown) {
        if (signal?.aborted) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoadState("error");
      }
    })();
  }, [baseUrl]);

  useEffect(() => {
    const controller = new AbortController();
    loadMcp(controller.signal);
    return () => controller.abort();
  }, [loadMcp]);

  const configs = useMemo(() => agentConfigs(launchConfig), [launchConfig]);
  const canCopy = Boolean(launchConfig && launchValidation?.valid);

  async function copyConfig(kind: keyof ReturnType<typeof agentConfigs>): Promise<void> {
    const config = configs[kind];
    if (!config || !canCopy || !globalThis.navigator?.clipboard) return;
    await globalThis.navigator.clipboard.writeText(config);
  }

  async function runLaunchTest(): Promise<void> {
    setTestState("testing");
    setTestResult(undefined);
    try {
      const result = await testMcpConnection(baseUrl);
      setTestResult(result);
      setTestState(result.status === "passed" ? "passed" : "failed");
      if (result.status === "passed") loadMcp();
    } catch (error: unknown) {
      setTestResult({
        message: error instanceof Error ? error.message : String(error),
        status: "failed"
      });
      setTestState("failed");
    }
  }

  return (
    <SettingsSection
      className="settings-section-wide settings-section-mcp"
      eyebrow="MCP"
      title="Connect MCP agents"
      description="Read-only session retrieval for local agents. Copy a config, add it to the agent, then test the launch."
    >
      <div className="settings-row">
        <div className="settings-row-copy">
          <span>Status</span>
          <p>{statusSummary(status, loadState, loadError)}</p>
        </div>
        <div className="settings-row-value">
          <StatusBadge tone={statusTone(status, loadState)}>{statusLabel(status, loadState)}</StatusBadge>
        </div>
        <div className="settings-row-control">
          <div className="settings-inline-actions">
            <AppButton onClick={() => loadMcp()} variant="quiet">
              Refresh MCP
            </AppButton>
            <AppButton disabled={testState === "testing"} onClick={() => void runLaunchTest()} variant="quiet">
              {testState === "testing" ? "Testing MCP launch..." : "Test MCP launch"}
            </AppButton>
          </div>
        </div>
      </div>

      <div className="settings-mcp-clients" aria-label="MCP agent connection options">
        <div className="settings-mcp-client-list" aria-label="Supported MCP clients">
          {clients.map((client) => (
            <span key={client}>{client}</span>
          ))}
        </div>
        <CodeBlock code={configs.codex ?? "MCP launch configuration is loading."} label="Codex config.toml" />
        <div className="settings-inline-actions">
          <AppButton disabled={!canCopy} onClick={() => void copyConfig("codex")}>
            Copy Codex config
          </AppButton>
        </div>
        <details className="settings-mcp-secondary">
          <summary>Other MCP clients</summary>
          <CodeBlock code={configs.claude ?? "MCP launch configuration is loading."} label="Claude Code / Cursor JSON" />
          <CodeBlock code={configs.generic ?? "MCP launch configuration is loading."} label="Generic stdio JSON" />
          <div className="settings-inline-actions">
            <AppButton disabled={!canCopy} onClick={() => void copyConfig("claude")} variant="quiet">
              Copy Claude/Cursor JSON
            </AppButton>
            <AppButton disabled={!canCopy} onClick={() => void copyConfig("generic")} variant="quiet">
              Copy generic stdio JSON
            </AppButton>
          </div>
        </details>
      </div>

      {testResult ? (
        <div className="settings-mcp-result" role="status">
          <StatusBadge tone={testResult.status === "passed" ? "active" : "danger"}>
            {testResult.status === "passed" ? "Launch passed" : "Launch failed"}
          </StatusBadge>
          <p>{testResult.message}</p>
          {testResult.toolCount !== undefined ? <p>{testResult.toolCount} MCP tools responded.</p> : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}

function agentConfigs(launchConfig?: McpLaunchConfigDto): { codex?: string; claude?: string; generic?: string } {
  if (!launchConfig) return {};
  const jsonConfig = JSON.stringify({ mcpServers: { masthead: launchConfig } }, null, 2);
  return {
    codex: [
      "[mcp_servers.masthead]",
      `command = ${JSON.stringify(launchConfig.command)}`,
      `args = ${JSON.stringify(launchConfig.args)}`,
      `env = ${JSON.stringify(launchConfig.env)}`
    ].join("\n"),
    claude: jsonConfig,
    generic: JSON.stringify(launchConfig, null, 2)
  };
}

function statusLabel(status: McpStatusDto | undefined, loadState: LoadState): string {
  if (loadState === "loading" && !status) return "Loading";
  if (!status?.ready) return "Unavailable";
  if (!status.globalAccessEnabled) return "Disabled";
  if (!status.readOnly) return "Write access";
  return "Ready";
}

function statusSummary(status: McpStatusDto | undefined, loadState: LoadState, error?: string): string {
  if (error) return error;
  if (loadState === "loading" && !status) return "Checking the local MCP launch configuration.";
  if (!status?.ready) return "The local daemon has not reported a ready MCP server.";
  if (!status.globalAccessEnabled) return "MCP retrieval is disabled by local privacy settings.";
  if (!status.readOnly) return "MCP is not in read-only mode. Masthead should only expose read tools.";
  return `${status.toolCount} read-only tools available. Database: ${status.databasePath}`;
}

function statusTone(status: McpStatusDto | undefined, loadState: LoadState): "active" | "danger" | "neutral" | "warning" {
  if (loadState === "loading" && !status) return "neutral";
  if (!status?.ready || !status.globalAccessEnabled) return "warning";
  if (!status.readOnly) return "danger";
  return "active";
}
