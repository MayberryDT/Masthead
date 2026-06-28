export type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type DesktopBridge = {
  invoke: DesktopInvoke;
  kind: "electron";
};

export function getDesktopBridge(): DesktopBridge | undefined {
  const candidate = typeof window === "undefined" ? undefined : window.mastheadDesktop;
  if (!candidate || typeof candidate.invoke !== "function") return undefined;
  return {
    invoke: candidate.invoke,
    kind: "electron"
  };
}

export function isDesktopBridgeAvailable(): boolean {
  return Boolean(getDesktopBridge()) || canUseTauri();
}

export async function invokeDesktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.invoke<T>(command, args);
  if (!canUseTauri()) return undefined;

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function canUseTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
