import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsActionFeedback } from "./SettingsActionFeedback";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type McpSettingsProps = {
  baseUrl?: string;
  privacy?: SettingsStateDto["privacy"];
};

type LoadState = "idle" | "loading" | "ready" | "error";
type TestState = "idle" | "testing" | "passed" | "failed";
type ConfigKind = "json" | "codex" | "stdio";

const configTabs: Array<{ kind: ConfigKind; label: string }> = [
  { kind: "json", label: "MCP JSON" },
  { kind: "codex", label: "MCP TOML" },
  { kind: "stdio", label: "stdio" }
];

export function McpSettings({ baseUrl, privacy }: McpSettingsProps) {
  const [activeConfig, setActiveConfig] = useState<ConfigKind>("json");
  const [launchConfig, setLaunchConfig] = useState<McpLaunchConfigDto>();
  const [launchValidation, setLaunchValidation] = useState<McpLaunchValidationDto>();
  const [loadError, setLoadError] = useState<string>();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [status, setStatus] = useState<McpStatusDto>();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyRequestRef = useRef(0);
  const feedbackOperationRef = useRef(0);
  const loadOperationRef = useRef(0);
  const [testResult, setTestResult] = useState<McpTestConnectionDto>();
  const [testState, setTestState] = useState<TestState>("idle");

  const loadMcp = useCallback((signal?: AbortSignal) => {
    const loadOperationId = ++loadOperationRef.current;
    const feedbackOperationId = ++feedbackOperationRef.current;
    setLoadState("loading");
    void (async () => {
      try {
        const [nextStatus, nextLaunchConfig] = await Promise.all([
          getMcpStatus(baseUrl, { signal }),
          getMcpLaunchConfig(baseUrl, { signal })
        ]);
        const nextValidation = await validateMcpLaunchConfig(nextLaunchConfig, baseUrl, { signal });
        if (signal?.aborted || loadOperationId !== loadOperationRef.current) return;
        setStatus(nextStatus);
        setLaunchConfig(nextLaunchConfig);
        setLaunchValidation(nextValidation);
        if (feedbackOperationId === feedbackOperationRef.current) setLoadError(undefined);
        setLoadState("ready");
      } catch (error: unknown) {
        if (signal?.aborted || loadOperationId !== loadOperationRef.current) return;
        if (feedbackOperationId === feedbackOperationRef.current) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
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
  const activeCode = configs[activeConfig];
  const canCopy = Boolean(launchConfig && launchValidation?.valid);
  const accessEnabled = privacy?.mcpAccessEnabled ?? status?.globalAccessEnabled ?? false;

  async function copyConfig(): Promise<void> {
    if (!canCopy || !activeCode) return;
    const requestId = ++copyRequestRef.current;
    if (!globalThis.navigator?.clipboard) {
      setCopyState("failed");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(activeCode);
      if (requestId !== copyRequestRef.current) return;
      setCopyState("copied");
    } catch {
      if (requestId !== copyRequestRef.current) return;
      setCopyState("failed");
    }
  }

  async function runLaunchTest(): Promise<void> {
    feedbackOperationRef.current += 1;
    setLoadError(undefined);
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

  const serverFeedback = loadError
    ? { message: loadError, tone: "error" as const }
    : testState === "testing"
      ? { message: "Testing connection…", tone: "neutral" as const }
      : testState === "passed"
        ? { message: testResult?.message ?? "Connection passed.", tone: "success" as const }
        : testState === "failed" && testResult?.message
          ? { message: testResult.message, tone: "error" as const }
          : undefined;

  return (
    <SettingsSection title="Agent access">
      <SettingsRow
        label="MCP server"
        value={
          <StatusBadge tone={statusTone(status, loadState)}>
            {statusLabel(status, loadState)}
          </StatusBadge>
        }
        control={
          <div className="settings-inline-actions">
            <AppButton
              disabled={testState === "testing"}
              onClick={() => void runLaunchTest()}
              variant="quiet"
            >
              {testState === "testing" ? "Testing…" : "Test connection"}
            </AppButton>
            <SettingsActionFeedback feedback={serverFeedback} />
          </div>
        }
      />

      <SettingsRow
        label="Access"
        value={
          <StatusBadge tone={accessEnabled ? "active" : "neutral"}>
            {accessEnabled ? "Enabled" : "Disabled"}
          </StatusBadge>
        }
      />

      <SettingsRow
        label="Client setup"
        control={
          <div className="settings-mcp-setup">
            <div className="settings-mcp-tabs" role="tablist" aria-label="MCP config format">
              {configTabs.map((tab) => (
                <button
                  key={tab.kind}
                  type="button"
                  className={tab.kind === activeConfig ? "active" : ""}
                  role="tab"
                  aria-selected={tab.kind === activeConfig}
                  onClick={() => {
                    copyRequestRef.current += 1;
                    setActiveConfig(tab.kind);
                    setCopyState("idle");
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <AppButton disabled={!canCopy} onClick={() => void copyConfig()} variant="quiet">
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy configuration"}
            </AppButton>
          </div>
        }
      />
      {copyState === "failed" ? (
        <p className="settings-mcp-inline-result error" role="status">
          Could not copy configuration.
        </p>
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

function statusTone(status: McpStatusDto | undefined, loadState: LoadState): "active" | "danger" | "neutral" | "warning" {
  if (loadState === "loading" && !status) return "neutral";
  if (!status?.ready || !status.globalAccessEnabled) return "warning";
  if (!status.readOnly) return "danger";
  return "active";
}
