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

export type MastheadWindowChromeOptions = {
  autoHideMenuBar: boolean;
  backgroundColor: string;
  frame: boolean;
  titleBarStyle: "hidden";
};

export type RendererUrlPolicy = {
  allowDevServer?: boolean;
  devServerUrl?: string;
};

export function mastheadWindowChromeOptions(): MastheadWindowChromeOptions {
  return {
    autoHideMenuBar: true,
    backgroundColor: "#031019",
    frame: false,
    titleBarStyle: "hidden"
  };
}

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
  if (policy.allowDevServer) {
    origins.push("http://localhost:5173", "http://127.0.0.1:5173");
    const devServerOrigin = rendererDevServerOrigin(policy);
    if (devServerOrigin && !origins.includes(devServerOrigin)) origins.push(devServerOrigin);
  }
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
  return rendererTrustedOrigins(policy).includes(url.origin);
}

export function rendererEntryUrl(): string {
  const devServerUrl = rendererDevServerUrl();
  if (devServerUrl) {
    return devServerUrl;
  }
  return "masthead://app/index.html";
}

export function mainPreloadPath(dirname: string): string {
  return join(dirname, "preload.cjs");
}

function rendererDevServerOrigin(policy: RendererUrlPolicy = {}): string | undefined {
  const devServerUrl = policy.devServerUrl ?? rendererDevServerUrl();
  if (!devServerUrl) return undefined;

  try {
    const url = new URL(devServerUrl);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function rendererDevServerUrl(): string | undefined {
  const launcherUrl = process.env.MASTHEAD_ELECTRON_DEV === "1" ? process.env.MASTHEAD_ELECTRON_RENDERER_URL : undefined;
  if (launcherUrl && isLocalHttpUrl(launcherUrl)) {
    return launcherUrl;
  }
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }
  return undefined;
}

function isLocalHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
