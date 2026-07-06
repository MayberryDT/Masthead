import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpStatusDto, SettingsStateDto } from "../../app/daemonClient";
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
  privacy?: SettingsStateDto["privacy"];
};

type LoadState = "idle" | "loading" | "ready" | "error";
type TestState = "idle" | "testing" | "passed" | "failed";
type ConfigKind = "json" | "codex" | "stdio";

const configTabs: Array<{ kind: ConfigKind; label: string; description: string }> = [
  { kind: "json", label: "MCP JSON", description: "Works for Claude Code, Cursor, and most MCP clients." },
  { kind: "codex", label: "MCP TOML", description: "Use when a client expects TOML server entries." },
  { kind: "stdio", label: "stdio", description: "Raw command, args, and environment for custom launchers." }
];

export function McpSettings({ baseUrl, privacy }: McpSettingsProps) {
  const [activeConfig, setActiveConfig] = useState<ConfigKind>("json");
  const [launchConfig, setLaunchConfig] = useState<McpLaunchConfigDto>();
  const [launchValidation, setLaunchValidation] = useState<McpLaunchValidationDto>();
  const [loadError, setLoadError] = useState<string>();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [status, setStatus] = useState<McpStatusDto>();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
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
  const activeTab = configTabs.find((tab) => tab.kind === activeConfig) ?? configTabs[0];
  const activeCode = configs[activeConfig] ?? "MCP launch configuration is loading.";
  const canCopy = Boolean(launchConfig && launchValidation?.valid);

  async function copyConfig(): Promise<void> {
    if (!canCopy || !globalThis.navigator?.clipboard) return;
    try {
      await globalThis.navigator.clipboard.writeText(activeCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
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
      title="MCP server"
      description="Read-only local session retrieval for agents that support MCP."
    >
      <div className="settings-mcp-summary">
        <div>
          <span className="settings-mcp-label">Status</span>
          <p>{statusSummary(status, loadState, loadError)}</p>
        </div>
        <div className="settings-mcp-actions">
          <AppButton className="settings-mcp-refresh-button" onClick={() => loadMcp()} variant="quiet">
            Refresh MCP
          </AppButton>
          <StatusBadge className="settings-mcp-status" tone={statusTone(status, loadState)}>
            {statusLabel(status, loadState)}
          </StatusBadge>
          <AppButton
            className="settings-mcp-test-button"
            disabled={testState === "testing"}
            onClick={() => void runLaunchTest()}
            variant="quiet"
          >
            {testState === "testing" ? "Testing..." : "Test MCP launch"}
          </AppButton>
        </div>
      </div>

      <div className="settings-mcp-access">
        <div>
          <span className="settings-mcp-label">MCP access</span>
          <p>Allow read-only MCP clients to query sessions that are not excluded by source or session policy.</p>
        </div>
        <StatusBadge tone={privacy?.mcpAccessEnabled ?? status?.globalAccessEnabled ? "active" : "neutral"}>
          {privacy?.mcpAccessEnabled ?? status?.globalAccessEnabled ? "Enabled" : "Disabled"}
        </StatusBadge>
      </div>

      <div className="settings-mcp-config" aria-label="MCP config formats">
        <div className="settings-mcp-tabs" role="tablist" aria-label="MCP config format">
          {configTabs.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              className={tab.kind === activeConfig ? "active" : ""}
              role="tab"
              aria-selected={tab.kind === activeConfig}
              onClick={() => setActiveConfig(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="settings-mcp-tab-panel" role="tabpanel">
          <div className="settings-mcp-tab-meta">
            <p>{activeTab.description}</p>
            <AppButton disabled={!canCopy} onClick={() => void copyConfig()} variant="quiet">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy config"}
            </AppButton>
          </div>
          <CodeBlock code={activeCode} label={activeTab.label} />
        </div>
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

function agentConfigs(launchConfig?: McpLaunchConfigDto): Record<ConfigKind, string | undefined> {
  if (!launchConfig) return { codex: undefined, json: undefined, stdio: undefined };
  const jsonConfig = JSON.stringify({ mcpServers: { masthead: launchConfig } }, null, 2);
  return {
    codex: [
      "[mcp_servers.masthead]",
      `command = ${JSON.stringify(launchConfig.command)}`,
      `args = ${JSON.stringify(launchConfig.args)}`,
      `env = ${JSON.stringify(launchConfig.env)}`
    ].join("\n"),
    json: jsonConfig,
    stdio: [
      launchConfig.command,
      ...launchConfig.args.map((arg) => JSON.stringify(arg)),
      "",
      JSON.stringify({ env: launchConfig.env }, null, 2)
    ].join(" ")
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
