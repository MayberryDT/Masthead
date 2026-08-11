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

export type MastheadPagesConnectionState =
  | { status: "disconnected" }
  | {
      status: "connected";
      account: {
        protocolVersion: "masthead-pages-account-v1";
        accountId: string;
        handle?: string;
        publisherAccess: "publisher" | "request_required" | "requested" | "suspended";
        defaultLogbookVisibility: "discoverable" | "unlisted";
      };
    }
  | { status: "secure_storage_unavailable"; reason: string };

export type MastheadPagesStagedRef = {
  artifactId: string;
  requestDigest: string;
};

export type DesktopBridge = {
  invoke: DesktopInvoke;
  kind: "electron";
  platform?: string;
  notifySessionTransition?: (input: DesktopSessionTransitionNotificationInput) => Promise<DesktopNotificationResult>;
  getMastheadPagesConnection?: () => Promise<MastheadPagesConnectionState>;
  connectMastheadPages?: () => Promise<MastheadPagesConnectionState>;
  disconnectMastheadPages?: () => Promise<void>;
  listMastheadPagesLogbooks?: () => Promise<unknown[]>;
  createMastheadPagesLogbook?: (input: unknown) => Promise<unknown>;
  publishStagedToMastheadPages?: (args: { refs: MastheadPagesStagedRef[] }) => Promise<unknown>;
  removeStagedFromMastheadPages?: (args: { ref: MastheadPagesStagedRef }) => Promise<unknown>;
};

export function getDesktopBridge(): DesktopBridge | undefined {
  const candidate = typeof window === "undefined" ? undefined : window.mastheadDesktop;
  if (!candidate || typeof candidate.invoke !== "function") return undefined;
  return {
    invoke: candidate.invoke,
    kind: "electron",
    platform: candidate.platform,
    notifySessionTransition:
      typeof candidate.notifySessionTransition === "function" ? candidate.notifySessionTransition : undefined,
    getMastheadPagesConnection:
      typeof candidate.getMastheadPagesConnection === "function" ? candidate.getMastheadPagesConnection : undefined,
    connectMastheadPages: typeof candidate.connectMastheadPages === "function" ? candidate.connectMastheadPages : undefined,
    disconnectMastheadPages:
      typeof candidate.disconnectMastheadPages === "function" ? candidate.disconnectMastheadPages : undefined,
    listMastheadPagesLogbooks:
      typeof candidate.listMastheadPagesLogbooks === "function" ? candidate.listMastheadPagesLogbooks : undefined,
    createMastheadPagesLogbook:
      typeof candidate.createMastheadPagesLogbook === "function" ? candidate.createMastheadPagesLogbook : undefined,
    publishStagedToMastheadPages:
      typeof candidate.publishStagedToMastheadPages === "function" ? candidate.publishStagedToMastheadPages : undefined,
    removeStagedFromMastheadPages:
      typeof candidate.removeStagedFromMastheadPages === "function" ? candidate.removeStagedFromMastheadPages : undefined
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
