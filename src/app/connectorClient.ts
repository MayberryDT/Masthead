import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export const LOCAL_CONNECTOR_COMMAND = "npm run dev";

export type ConnectorStartResult =
  | {
      ok: true;
      started: boolean;
      command: string;
      message: string;
    }
  | {
      ok: false;
      supported: false;
      command: string;
      message: string;
    };

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<ConnectorStartResult>;

export async function startLiveConnector(invoke?: Invoke): Promise<ConnectorStartResult> {
  if (!invoke && !canUseTauri()) {
    const devServerResult = await startViaDevServer();
    if (devServerResult) return devServerResult;

    return {
      ok: false,
      supported: false,
      command: LOCAL_CONNECTOR_COMMAND,
      message: "Run npm run dev from /home/tyler/Documents/Masthead, then choose Check again."
    };
  }

  if (invoke) return invoke("start_live_connector_command");
  return tauriInvoke<ConnectorStartResult>("start_live_connector_command");
}

async function startViaDevServer(): Promise<ConnectorStartResult | undefined> {
  if (typeof window === "undefined") return undefined;

  try {
    const response = await fetch("/__masthead/connector/start", {
      method: "POST",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    return isConnectorStartSuccess(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function isConnectorStartSuccess(value: unknown): value is Extract<ConnectorStartResult, { ok: true }> {
  if (typeof value !== "object" || value === null) return false;
  return (
    "ok" in value &&
    value.ok === true &&
    "started" in value &&
    typeof value.started === "boolean" &&
    "command" in value &&
    typeof value.command === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function canUseTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
