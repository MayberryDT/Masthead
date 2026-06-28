import { join } from "node:path";

export type MastheadWindowPreferences = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  nodeIntegrationInWorker: boolean;
  preload: string;
  sandbox: boolean;
  webSecurity: boolean;
  webviewTag: boolean;
};

export type RendererUrlPolicy = {
  allowDevServer?: boolean;
};

export function mastheadWindowPreferences(preload: string): MastheadWindowPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    preload,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  };
}

export function rendererTrustedOrigins(policy: RendererUrlPolicy = {}): string[] {
  const origins = ["masthead://app"];
  if (policy.allowDevServer) origins.push("http://localhost:5173", "http://127.0.0.1:5173");
  return origins;
}

export function isAllowedRendererUrl(rawUrl: string | undefined, policy: RendererUrlPolicy = {}): boolean {
  if (!rawUrl) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "masthead:" && url.hostname === "app") return true;
  if (!policy.allowDevServer) return false;
  if (url.protocol !== "http:") return false;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  return url.port === "5173";
}

export function rendererEntryUrl(): string {
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }
  return "masthead://app/index.html";
}

export function mainPreloadPath(dirname: string): string {
  return join(dirname, "preload.cjs");
}
