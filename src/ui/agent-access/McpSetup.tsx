import { useMemo, useState } from "react";
import type { McpLaunchConfigDto, McpStatusDto } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { CodeBlock } from "../primitives/CodeBlock";
import { StatusBadge } from "../primitives/StatusBadge";

type ClientId = "codex" | "claude" | "cursor" | "generic";

type McpSetupProps = {
  status: McpStatusDto;
};

const clients: Array<{ id: ClientId; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "generic", label: "Generic stdio" }
];

export function McpSetup({ status }: McpSetupProps) {
  const [selectedClient, setSelectedClient] = useState<ClientId>("codex");
  const config = useMemo(() => clientConfig(selectedClient, status.launchConfig), [selectedClient, status.launchConfig]);

  async function copyConfig(): Promise<void> {
    if (!globalThis.navigator?.clipboard) return;
    await globalThis.navigator.clipboard.writeText(config);
  }

  return (
    <section className="agent-access-section" aria-labelledby="mcp-setup-title">
      <div className="agent-access-section-head">
        <div>
          <p className="mono-label">Set up a client</p>
          <h2 id="mcp-setup-title">Local stdio configuration</h2>
        </div>
        <StatusBadge tone={status.ready ? "active" : "warning"}>{status.ready ? "Ready" : "Waiting"}</StatusBadge>
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

      <div className="agent-access-actions">
        <AppButton onClick={copyConfig}>Copy configuration</AppButton>
        <AppButton variant="quiet">Test connection</AppButton>
      </div>
    </section>
  );
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
