/// <reference types="vite/client" />
/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare const __APP_VERSION__: string;

type MastheadDesktopSessionTransitionNotificationInput = {
  sessionId: string;
  transition: "idle" | "blocked" | "ended";
  title: string;
  body?: string;
};

type MastheadDesktopNotificationResult =
  | { ok: true; shown: true }
  | { ok: true; shown: false; reason: "bridge_unavailable" | "unsupported" };

type MastheadPagesConnectionState =
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

type MastheadPagesStagedRef = {
  artifactId: string;
  requestDigest: string;
};

type MastheadDesktopBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  platform?: string;
  notifySessionTransition?: (
    input: MastheadDesktopSessionTransitionNotificationInput
  ) => Promise<MastheadDesktopNotificationResult>;
  getMastheadPagesConnection?: () => Promise<MastheadPagesConnectionState>;
  connectMastheadPages?: () => Promise<MastheadPagesConnectionState>;
  disconnectMastheadPages?: () => Promise<void>;
  listMastheadPagesLogbooks?: () => Promise<unknown[]>;
  createMastheadPagesLogbook?: (input: unknown) => Promise<unknown>;
  publishStagedToMastheadPages?: (args: { refs: MastheadPagesStagedRef[] }) => Promise<unknown>;
  removeStagedFromMastheadPages?: (args: { ref: MastheadPagesStagedRef }) => Promise<unknown>;
  projectionUrl?: string;
};

interface Window {
  mastheadDesktop?: MastheadDesktopBridge;
}
