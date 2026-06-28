/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

type MastheadDesktopBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

interface Window {
  __TAURI_INTERNALS__?: unknown;
  mastheadDesktop?: MastheadDesktopBridge;
}
