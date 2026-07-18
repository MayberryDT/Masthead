export type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type DesktopSessionTransitionNotificationInput = {
  sessionId: string;
  transition: "idle" | "blocked" | "ended";
  title: string;
  body?: string;
};

export type DesktopNotificationResult =
  | { ok: true; shown: true }
  | { ok: true; shown: false; reason: "bridge_unavailable" | "unsupported" };

export type DesktopBridge = {
  invoke: DesktopInvoke;
  kind: "electron";
  platform?: string;
  notifySessionTransition?: (input: DesktopSessionTransitionNotificationInput) => Promise<DesktopNotificationResult>;
};

export function getDesktopBridge(): DesktopBridge | undefined {
  const candidate = typeof window === "undefined" ? undefined : window.mastheadDesktop;
  if (!candidate || typeof candidate.invoke !== "function") return undefined;
  return {
    invoke: candidate.invoke,
    kind: "electron",
    platform: candidate.platform,
    notifySessionTransition:
      typeof candidate.notifySessionTransition === "function" ? candidate.notifySessionTransition : undefined
  };
}

export function isDesktopBridgeAvailable(): boolean {
  return Boolean(getDesktopBridge());
}

export async function invokeDesktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.invoke<T>(command, args);
  return undefined;
}
