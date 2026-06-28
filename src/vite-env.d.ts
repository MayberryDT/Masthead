/// <reference types="vite/client" />
/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare const __APP_VERSION__: string;

type MastheadDesktopBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

interface Window {
  mastheadDesktop?: MastheadDesktopBridge;
}
