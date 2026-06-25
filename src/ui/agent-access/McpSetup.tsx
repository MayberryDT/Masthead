import { useMemo, useState } from "react";
import type { McpStatusDto } from "../../app/daemonClient";
import type { McpLaunchConfigDto, McpLaunchValidationDto, McpTestConnectionDto } from "../../app/mcpLaunchClient";
import { AppButton } from "../primitives/AppButton";
import { CodeBlock } from "../primitives/CodeBlock";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

type ClientId = "codex" | "claude" | "cursor" | "generic";
type TestConnectionState = "idle" | "testing" | "passed" | "failed";

type McpSetupProps = {
  launchConfig?: McpLaunchConfigDto;
  onTestConnection?: () => Promise<McpTestConnectionDto>;
  status: McpStatusDto;
  testConnectionResult?: McpTestConnectionDto;
  testConnectionState?: TestConnectionState;
  validation?: McpLaunchValidationDto;
  validationError?: string;
};

const clients: Array<{ id: ClientId; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "generic", label: "Generic stdio" }
];

export function McpSetup({
  launchConfig,
  onTestConnection,
  status,
  testConnectionResult,
  testConnectionState,
  validation,
  validationError
}: McpSetupProps) {
  const [selectedClient, setSelectedClient] = useState<ClientId>("codex");
  const [localTestConnectionResult, setLocalTestConnectionResult] = useState<McpTestConnectionDto | undefined>();
  const [localTestConnectionState, setLocalTestConnectionState] = useState<TestConnectionState>("idle");
  const effectiveLaunchConfig = launchConfig ?? unavailableLaunchConfig(status.databasePath);
  const config = useMemo(() => clientConfig(selectedClient, effectiveLaunchConfig), [selectedClient, effectiveLaunchConfig]);
  const configProblems = validationProblems(launchConfig, validation, validationError);
  const canCopyConfig = Boolean(launchConfig && validation?.valid);
  const visibleTestConnectionResult = testConnectionResult ?? localTestConnectionResult;
  const visibleTestConnectionState = testConnectionState ?? localTestConnectionState;

  async function copyConfig(): Promise<void> {
    if (!canCopyConfig || !globalThis.navigator?.clipboard) return;
    await globalThis.navigator.clipboard.writeText(config);
  }

  async function runTestConnection(): Promise<void> {
    if (!onTestConnection) return;
    setLocalTestConnectionState("testing");
    setLocalTestConnectionResult(undefined);
    try {
      const result = await onTestConnection();
      setLocalTestConnectionResult(result);
      setLocalTestConnectionState(result.status === "passed" ? "passed" : "failed");
    } catch (error: unknown) {
      setLocalTestConnectionResult({
        message: error instanceof Error ? error.message : String(error),
        status: "failed"
      });
      setLocalTestConnectionState("failed");
    }
  }

  return (
    <section className="agent-access-section" aria-labelledby="mcp-setup-title">
      <div className="agent-access-section-head">
        <div>
          <p className="mono-label">Set up a client</p>
          <h2 id="mcp-setup-title">Local stdio configuration</h2>
        </div>
        <StatusBadge tone={status.ready && validation?.valid ? "active" : "warning"}>
          {status.ready && validation?.valid ? "Launch config valid" : "Check launch config"}
        </StatusBadge>
      </div>

      <div className="agent-access-tabs" role="tablist" aria-label="MCP client configuration">
        {clients.map((client) => (
          <AppButton
            aria-pressed={client.id === selectedClient}
            className={client.id === selectedClient ? "agent-access-tab-active" : ""}
            key={client.id}
            onClick={() => setSelectedClient(client.id)}
            variant={client.id === selectedClient ? "primary" : "quiet"}
          >
            {client.label}
          </AppButton>
        ))}
      </div>

      <CodeBlock code={config} label={`${clients.find((client) => client.id === selectedClient)?.label ?? "Client"} configuration`} />

      <div className="agent-access-checks" aria-label="MCP launch config validation">
        <ValidationCheck label="Command" ok={validation?.commandExists} value={effectiveLaunchConfig.command} />
        <ValidationCheck label="Entry" ok={validation?.entryExists} value={effectiveLaunchConfig.args[0] ?? "Missing server entry"} />
        <ValidationCheck
          label="Database"
          ok={validation?.databaseMatches}
          value={effectiveLaunchConfig.env.MASTHEAD_DB_PATH ?? "Missing MASTHEAD_DB_PATH"}
        />
      </div>

      {configProblems.length > 0 ? (
        <div className="agent-access-problems" role="status">
          <p className="mono-label">Configuration problems</p>
          <ul>
            {configProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="agent-access-actions">
        <AppButton disabled={!canCopyConfig} onClick={copyConfig}>
          Copy configuration
        </AppButton>
        <AppButton disabled={!onTestConnection || visibleTestConnectionState === "testing"} onClick={runTestConnection} variant="quiet">
          {visibleTestConnectionState === "testing" ? "Testing connection…" : "Test connection"}
        </AppButton>
      </div>

      <TestConnectionEvidence result={visibleTestConnectionResult} state={visibleTestConnectionState} />
    </section>
  );
}

function ValidationCheck({ label, ok, value }: { label: string; ok?: boolean; value: string }) {
  const tone: StatusBadgeTone = ok === undefined ? "neutral" : ok ? "active" : "danger";
  const text = ok === undefined ? "Not checked" : ok ? "OK" : "Problem";
  return (
    <div className="agent-access-check">
      <StatusBadge tone={tone}>{text}</StatusBadge>
      <div>
        <span>{label}</span>
        <code>{value}</code>
      </div>
    </div>
  );
}

function TestConnectionEvidence({ result, state }: { result?: McpTestConnectionDto; state: TestConnectionState }) {
  if (state === "idle" && !result) return null;
  if (state === "testing") {
    return (
      <div className="agent-access-test-evidence" aria-live="polite">
        <StatusBadge tone="info">Testing</StatusBadge>
        <p>Starting the MCP server with the active launch configuration…</p>
      </div>
    );
  }
  if (!result) return null;

  const outputBlocks = [
    { label: "Output", value: result.output },
    { label: "stdout", value: result.stdout },
    { label: "stderr", value: result.stderr }
  ].filter((block): block is { label: string; value: string } => Boolean(block.value));

  return (
    <div className="agent-access-test-evidence" aria-live="polite">
      <StatusBadge tone={result.status === "passed" ? "active" : "danger"}>
        {result.status === "passed" ? "Connection passed" : "Connection failed"}
      </StatusBadge>
      <p>{result.message}</p>
      {result.toolCount !== undefined ? <p>{result.toolCount} MCP tools responded.</p> : null}
      {result.problems && result.problems.length > 0 ? (
        <ul>
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {outputBlocks.map((block) => (
        <CodeBlock code={block.value} key={block.label} label={block.label} />
      ))}
    </div>
  );
}

function validationProblems(
  launchConfig: McpLaunchConfigDto | undefined,
  validation: McpLaunchValidationDto | undefined,
  validationError: string | undefined
): string[] {
  if (!launchConfig) return ["Launch configuration has not loaded yet."];
  if (validationError) return [`Launch configuration validation failed: ${validationError}`];
  if (!validation) return ["Launch configuration has not been validated yet."];
  const problems = new Set(validation.problems);
  if (!validation.commandExists) problems.add("Command path does not exist or is not executable.");
  if (!validation.entryExists) problems.add("MCP server entry file does not exist.");
  if (!validation.databaseMatches) {
    const configured = validation.configuredDatabasePath ?? launchConfig.env.MASTHEAD_DB_PATH ?? "missing";
    const expected = validation.expectedDatabasePath ?? "active canonical database";
    problems.add(`MASTHEAD_DB_PATH points at ${configured}; expected ${expected}.`);
  }
  return [...problems];
}

function unavailableLaunchConfig(databasePath: string): McpLaunchConfigDto {
  return {
    args: ["Masthead MCP server entry unavailable"],
    command: "Masthead MCP server unavailable",
    env: {
      MASTHEAD_DB_PATH: databasePath
    }
  };
}

function clientConfig(client: ClientId, launchConfig: McpLaunchConfigDto): string {
  if (client === "codex") {
    return [
      "[mcp_servers.masthead]",
      `command = ${JSON.stringify(launchConfig.command)}`,
      `args = ${JSON.stringify(launchConfig.args)}`,
      `env = ${JSON.stringify(launchConfig.env)}`
    ].join("\n");
  }

  const jsonConfig =
    client === "generic"
      ? launchConfig
      : {
          mcpServers: {
            masthead: launchConfig
          }
        };

  return JSON.stringify(jsonConfig, null, 2);
}
