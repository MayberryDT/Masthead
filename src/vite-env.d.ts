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

type MastheadDesktopBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  platform?: string;
  notifySessionTransition?: (
    input: MastheadDesktopSessionTransitionNotificationInput
  ) => Promise<MastheadDesktopNotificationResult>;
  projectionUrl?: string;
};

interface Window {
  mastheadDesktop?: MastheadDesktopBridge;
}
