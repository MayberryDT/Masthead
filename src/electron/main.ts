import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
import { collectGpuDiagnostics } from "./gpuDiagnostics";
import { ELECTRON_CHANNELS, registerMastheadIpc } from "./ipc";
import {
  mcpLaunchConfig,
  resolveDaemonLaunchTarget,
  startLiveConnector,
  stopOwnedDaemons,
  validateMcpLaunchConfig
} from "./daemonLauncher";
import { isMastheadOwnedDirectory } from "./pathPolicy";
import { resolveProtocolPath } from "./protocol";
import { createMastheadTray } from "./tray";
import {
  isAllowedRendererUrl,
  mainPreloadPath,
  mastheadWindowPreferences,
  rendererEntryUrl,
  rendererTrustedOrigins
} from "./window";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "masthead",
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);

const ownedDaemonChildren = new Set<ChildProcess>();
let mainWindow: BrowserWindow | undefined;
let tray: unknown;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerRendererProtocol();
    registerDesktopIpc();
    mainWindow = await createMainWindow();
    tray = await createMastheadTray(trayIconPath(), {
      onOpenDataDirectory: () => {
        void openDataDirectory(app.getPath("userData"));
      },
      onQuit: () => app.quit(),
      onShow: showMainWindow
    });
    void tray;
    if (process.env.MASTHEAD_ELECTRON_SMOKE === "1") {
      void runSmokeAndQuit(mainWindow);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then((window) => {
        mainWindow = window;
      });
      return;
    }
    showMainWindow();
  });

  app.on("before-quit", () => {
    stopOwnedDaemons(ownedDaemonChildren);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

function trayIconPath(): string {
  const sourceIcon = join(app.getAppPath(), "public", "assets", "masthead-logo-sail.png");
  if (existsSync(sourceIcon)) return sourceIcon;
  return join(process.resourcesPath, "masthead-logo-sail.png");
}

async function runSmokeAndQuit(window: BrowserWindow): Promise<void> {
  try {
    const connector = await startLiveConnector(
      {
        currentDir: process.cwd(),
        env: electronDaemonEnv(),
        resourcesPath: process.resourcesPath,
        userDataDir: app.getPath("userData")
      },
      rendererTrustedOrigins({ allowDevServer: isElectronDevMode() }),
      ownedDaemonChildren
    );
    const renderer = await window.webContents.executeJavaScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('[data-session-card], .session-card, .observability-card, .session-card-shell'));
        const samples = [];
        for (const card of cards.slice(0, 12)) {
          const start = performance.now();
          card.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
        const p95 = samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] : 0;
        return {
          cardCount: cards.length,
          hasDesktopBridge: typeof window.mastheadDesktop?.invoke === 'function',
          hasNodeProcess: typeof window.process !== 'undefined',
          hasRawIpc: typeof window.ipcRenderer !== 'undefined',
          hasRequire: typeof window.require !== 'undefined',
          hoverMedianMs: median,
          hoverP95Ms: p95
        };
      })()
    `);
    console.log(
      JSON.stringify({
        smoke: "electron",
        electron: process.versions.electron,
        connector,
        gpu: collectGpuDiagnostics(app),
        renderer
      })
    );
    await stopSmokeDaemons();
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await stopSmokeDaemons().catch(() => undefined);
    app.exit(1);
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    height: 900,
    minHeight: 720,
    minWidth: 1024,
    title: "Masthead",
    webPreferences: mastheadWindowPreferences(mainPreloadPath(__dirname)),
    width: 1400
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    return isAllowedRendererUrl(url, { allowDevServer: isElectronDevMode() }) ? { action: "allow" } : { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url, { allowDevServer: isElectronDevMode() })) event.preventDefault();
  });

  await window.loadURL(rendererEntryUrl());
  return window;
}

function showMainWindow(): void {
  const window = mainWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function stopSmokeDaemons(timeoutMs = 5_000): Promise<void> {
  const children = [...ownedDaemonChildren].filter(isChildRunning);
  stopOwnedDaemons(ownedDaemonChildren);
  if (!children.length) return;

  await Promise.race([Promise.all(children.map(waitForChildExit)), delay(timeoutMs)]);
  for (const child of children) {
    if (isChildRunning(child)) child.kill("SIGKILL");
  }
  await Promise.race([Promise.all(children.map(waitForChildExit)), delay(1_000)]);
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (!isChildRunning(child)) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerRendererProtocol(): void {
  protocol.handle("masthead", (request) => {
    const filePath = resolveProtocolPath(join(app.getAppPath(), ".vite", "renderer", MAIN_WINDOW_VITE_NAME), request.url);
    if (!filePath || !existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerDesktopIpc(): void {
  const targetInput = () => ({
    currentDir: process.cwd(),
    env: electronDaemonEnv(),
    resourcesPath: process.resourcesPath,
    userDataDir: app.getPath("userData")
  });

  registerMastheadIpc(
    ipcMain,
    {
      [ELECTRON_CHANNELS.startLiveConnector]: () =>
        startLiveConnector(targetInput(), rendererTrustedOrigins({ allowDevServer: isElectronDevMode() }), ownedDaemonChildren),
      [ELECTRON_CHANNELS.openDataDirectory]: (args) => openDataDirectory(stringArg(args, "path")),
      [ELECTRON_CHANNELS.mcpLaunchConfig]: () => mcpLaunchConfig(resolveDaemonLaunchTarget(targetInput())),
      [ELECTRON_CHANNELS.mcpValidateLaunchConfig]: () => validateMcpLaunchConfig(resolveDaemonLaunchTarget(targetInput())),
      [ELECTRON_CHANNELS.exportStoreRecords]: (args) =>
        JSON.stringify({
          metadata: {
            format: "masthead.native-store.v1",
            schemaVersion: 1,
            exportedAt: stringArg(args, "exportedAt") || new Date().toISOString(),
            recordCount: 0
          },
          records: []
        }),
      [ELECTRON_CHANNELS.clearLocalData]: () => ({ removedRecords: 0, touchedExternalState: false }),
      [ELECTRON_CHANNELS.pruneLocalData]: () => ({
        removedRecords: 0,
        removedRecordIds: [],
        removedByType: { event: 0, git_snapshot: 0, attention_item: 0, conflict_card: 0, review_disposition: 0 },
        retainedRecords: 0,
        touchedExternalState: false
      }),
      [ELECTRON_CHANNELS.readStoreRecords]: () => [],
      [ELECTRON_CHANNELS.appendStoreRecords]: () => undefined
    },
    { allowDevRenderer: isElectronDevMode() }
  );
}

function electronDaemonEnv(): NodeJS.ProcessEnv {
  if (!isElectronDevMode()) return process.env;
  return {
    ...process.env,
    MASTHEAD_DAEMON_ENTRY: process.env.MASTHEAD_DAEMON_ENTRY || join(process.cwd(), "dist", "daemon", "src", "daemon", "main.js"),
    MASTHEAD_MCP_ENTRY: process.env.MASTHEAD_MCP_ENTRY || join(process.cwd(), "dist", "daemon", "src", "mcp", "server.js"),
    MASTHEAD_NODE_PATH: process.env.MASTHEAD_NODE_PATH || process.env.npm_node_execpath || process.env.NODE || "node",
    MASTHEAD_PROJECT_DIR: process.env.MASTHEAD_PROJECT_DIR || process.cwd()
  };
}

function isElectronDevMode(): boolean {
  return Boolean(process.env.MASTHEAD_ELECTRON_DEV === "1" || (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL));
}

async function openDataDirectory(path: string): Promise<void> {
  if (!path) throw new Error("Data directory path is required.");
  const info = await stat(path).catch(() => undefined);
  if (!info) throw new Error(`Data directory does not exist: ${path}`);
  if (!info.isDirectory()) throw new Error(`Data path is not a directory: ${path}`);
  if (!isMastheadOwnedDirectory(path)) throw new Error(`Refusing to open a non-Masthead data directory: ${path}`);
  const error = await shell.openPath(path);
  if (error) throw new Error(`failed to open data directory: ${error}`);
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  return typeof value === "string" ? value : "";
}
