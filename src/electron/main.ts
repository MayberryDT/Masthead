import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, net, Notification, protocol, shell } from "electron";
import { collectGpuDiagnostics } from "./gpuDiagnostics";
import { headlessDesktopPlan } from "./headless";
import { installMastheadCliLauncher, resolveMastheadCliLaunchTarget } from "./cliLauncher";
import { resolveMastheadAppIconPath } from "./icon";
import { ELECTRON_CHANNELS, isAllowedIpcSender, registerMastheadIpc } from "./ipc";
import { showSessionTransitionNotification } from "./notifications";
import {
  type StartLiveConnectorResult,
  connectorBaseUrl,
  mcpLaunchConfig,
  resolveDaemonLaunchTarget,
  startLiveConnector,
  stopOwnedDaemons,
  validateMcpLaunchConfig
} from "./daemonLauncher";
import { assertSafeMastheadDataDirectory } from "./pathPolicy";
import { resolveProtocolPath } from "./protocol";
import { configureElectronRuntime } from "./runtime";
import { createMastheadTray, trayTooltipLabel } from "./tray";
import {
  isAllowedRendererUrl,
  mainPreloadPath,
  mastheadWindowChromeOptions,
  mastheadWindowPreferences,
  rendererEntryUrl,
  rendererTrustedOrigins
} from "./window";
import { shouldHideWindowOnClose } from "./windowCloseBehavior";

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

configureElectronRuntime(app, process.platform, process.env);

const ownedDaemonChildren = new Set<ChildProcess>();
const desktopPlan = headlessDesktopPlan(process.env);
let mainWindow: BrowserWindow | undefined;
let tray: unknown;
let keepRunningInTray = true;
let quitting = false;
let smokeRendererConnectorResult: StartLiveConnectorResult | undefined;
let smokeRendererConnectorError: unknown;
const smokeRendererConnectorWaiters = new Set<{
  reject: (error: unknown) => void;
  resolve: (result: StartLiveConnectorResult) => void;
}>();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (desktopPlan.createWindow) showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerRendererProtocol();
    await configureCliLauncher();
    if (desktopPlan.registerDesktopIpc) registerDesktopIpc();
    const appIconPath = mastheadAppIconPath();
    if (desktopPlan.startConnectorInMain) await startHeadlessConnector();
    if (desktopPlan.createWindow) mainWindow = await createMainWindow(appIconPath);
    if (desktopPlan.createTray) {
      tray = await createMastheadTray(
        appIconPath,
        {
          onOpenDataDirectory: () => {
            void openDataDirectory(electronDataDirectory());
          },
          onQuit: () => app.quit(),
          onShow: showMainWindow
        },
        { tooltip: trayTooltipLabel(isElectronDevMode()) }
      );
      void tray;
    }
    if (process.env.MASTHEAD_ELECTRON_SMOKE === "1") {
      if (!mainWindow) throw new Error("Electron renderer smoke is unavailable in headless production mode.");
      void runSmokeAndQuit(mainWindow);
    }
  }).catch((error) => {
    console.error(`Masthead Electron startup failed: ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  });

  app.on("activate", () => {
    if (!desktopPlan.createWindow) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then((window) => {
        mainWindow = window;
      });
      return;
    }
    showMainWindow();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopOwnedDaemons(ownedDaemonChildren);
  });

  app.on("window-all-closed", () => {
    if (desktopPlan.createWindow && process.platform !== "darwin") app.quit();
  });
}

async function startHeadlessConnector(): Promise<void> {
  await startLiveConnector(
    connectorTargetInput(),
    rendererTrustedOrigins({ allowDevServer: false }),
    ownedDaemonChildren,
    { prepareAuthoringLauncher: () => configureCliLauncher(true) }
  );
}

async function configureCliLauncher(required = false): Promise<void> {
  try {
    const target = resolveMastheadCliLaunchTarget({
      devNodePath:
        process.env.MASTHEAD_NODE_PATH || process.env.npm_node_execpath || process.env.NODE || process.execPath,
      devProjectDir: process.env.MASTHEAD_PROJECT_DIR || process.cwd(),
      instanceDir: electronDataDirectory(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath
    });
    await installMastheadCliLauncher(target);
    process.env.MASTHEAD_INSTANCE_MANIFEST = target.instanceManifest;
    process.env.MASTHEAD_CLI_COMMAND = target.launcherPath;
  } catch (error) {
    delete process.env.MASTHEAD_CLI_COMMAND;
    console.error(
      `Masthead CLI launcher installation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    if (required) throw error;
  }
}

function configuredDaemonBaseUrl(): string {
  const target = resolveDaemonLaunchTarget({
    currentDir: process.cwd(),
    defaultDataDir: isElectronDevMode() ? electronDevDataDirectory() : undefined,
    env: electronDaemonEnv(),
    resourcesPath: process.resourcesPath,
    userDataDir: app.getPath("userData")
  });
  return connectorBaseUrl(target.port);
}

function connectorTargetInput() {
  return {
    currentDir: process.cwd(),
    defaultDataDir: isElectronDevMode() ? electronDevDataDirectory() : undefined,
    env: electronDaemonEnv(),
    resourcesPath: process.resourcesPath,
    userDataDir: app.getPath("userData")
  };
}

function mastheadAppIconPath(): string {
  return resolveMastheadAppIconPath({
    appPath: app.getAppPath(),
    exists: existsSync,
    isDev: isElectronDevMode(),
    resourcesPath: process.resourcesPath
  });
}

async function runSmokeAndQuit(window: BrowserWindow): Promise<void> {
  try {
    const smokeMode = process.env.MASTHEAD_ELECTRON_SMOKE_MODE || "main-start";
    const connector =
      smokeMode === "renderer-autostart"
        ? await waitForRendererStartedConnector()
        : smokeMode === "main-start"
          ? await startLiveConnector(
              {
                currentDir: process.cwd(),
                defaultDataDir: isElectronDevMode() ? electronDevDataDirectory() : undefined,
                env: electronDaemonEnv(),
                resourcesPath: process.resourcesPath,
                userDataDir: app.getPath("userData")
              },
              rendererTrustedOrigins({ allowDevServer: isElectronDevMode() }),
              ownedDaemonChildren,
              {
                prepareAuthoringLauncher: () => configureCliLauncher(true)
              }
            )
          : unsupportedSmokeMode(smokeMode);
    const renderer = await window.webContents.executeJavaScript(`
      (async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
          hasTypedNotify: typeof window.mastheadDesktop?.notifySessionTransition === 'function',
          hasRendererTitleBar: document.querySelector('.masthead-shell.desktop-chrome .masthead-window-bar') !== null,
          hasRendererWindowControls: document.querySelector('.masthead-window-control') !== null,
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
        connector:
          smokeMode === "renderer-autostart"
            ? { ...connector, message: `Renderer autostart: ${connector.message}`, smokeMode }
            : connector,
        gpu: collectGpuDiagnostics(app),
        renderer
      })
    );
    const smokeHoldMs = Number(process.env.MASTHEAD_ELECTRON_SMOKE_HOLD_MS || 0);
    if (Number.isFinite(smokeHoldMs) && smokeHoldMs > 0) {
      await delay(Math.min(smokeHoldMs, 15_000));
    }
    await stopSmokeDaemons();
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await stopSmokeDaemons().catch(() => undefined);
    app.exit(1);
  }
}

async function createMainWindow(iconPath = mastheadAppIconPath()): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...mastheadWindowChromeOptions(),
    height: 900,
    icon: iconPath,
    minHeight: 720,
    minWidth: 1024,
    title: "Masthead",
    webPreferences: mastheadWindowPreferences(mainPreloadPath(__dirname)),
    width: 1400
  });
  window.setMenuBarVisibility(false);
  window.on("close", (event) => {
    if (!shouldHideWindowOnClose({ keepRunningInTray, quitting })) return;
    event.preventDefault();
    window.hide();
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

function unsupportedSmokeMode(mode: string): never {
  throw new Error(`Unsupported Masthead Electron smoke mode: ${mode}`);
}

function recordRendererStartedConnector(result: StartLiveConnectorResult): void {
  smokeRendererConnectorResult = result;
  for (const waiter of smokeRendererConnectorWaiters) waiter.resolve(result);
  smokeRendererConnectorWaiters.clear();
}

function recordRendererStartedConnectorError(error: unknown): void {
  smokeRendererConnectorError = error;
  for (const waiter of smokeRendererConnectorWaiters) waiter.reject(error);
  smokeRendererConnectorWaiters.clear();
}

function waitForRendererStartedConnector(timeoutMs = 30_000): Promise<StartLiveConnectorResult> {
  if (smokeRendererConnectorResult) return Promise.resolve(smokeRendererConnectorResult);
  if (smokeRendererConnectorError) return Promise.reject(smokeRendererConnectorError);

  return new Promise((resolve, reject) => {
    let waiter: {
      reject: (error: unknown) => void;
      resolve: (result: StartLiveConnectorResult) => void;
    };
    const timeout = setTimeout(() => {
      smokeRendererConnectorWaiters.delete(waiter);
      reject(new Error("Timed out waiting for renderer collector autostart."));
    }, timeoutMs);
    waiter = {
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      }
    };
    smokeRendererConnectorWaiters.add(waiter);
  });
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
  const targetInput = connectorTargetInput;

  ipcMain.on(ELECTRON_CHANNELS.rendererConfig, (event) => {
    if (!isAllowedIpcSender(event.senderFrame?.url, { allowDevRenderer: isElectronDevMode() })) {
      event.returnValue = { projectionUrl: "http://127.0.0.1:17373/projection" };
      return;
    }
    const target = resolveDaemonLaunchTarget(targetInput());
    event.returnValue = { projectionUrl: `${connectorBaseUrl(target.port)}/projection` };
  });

  registerMastheadIpc(
    ipcMain,
    {
      [ELECTRON_CHANNELS.startLiveConnector]: async () => {
        try {
          const result = await startLiveConnector(
            targetInput(),
            rendererTrustedOrigins({ allowDevServer: isElectronDevMode() }),
            ownedDaemonChildren,
            {
              prepareAuthoringLauncher: () => configureCliLauncher(true)
            }
          );
          if (process.env.MASTHEAD_ELECTRON_SMOKE === "1" && process.env.MASTHEAD_ELECTRON_SMOKE_MODE === "renderer-autostart") {
            recordRendererStartedConnector(result);
          }
          return result;
        } catch (error) {
          if (process.env.MASTHEAD_ELECTRON_SMOKE === "1" && process.env.MASTHEAD_ELECTRON_SMOKE_MODE === "renderer-autostart") {
            recordRendererStartedConnectorError(error);
          }
          throw error;
        }
      },
      [ELECTRON_CHANNELS.windowClose]: () => {
        mainWindow?.close();
        return { ok: true };
      },
      [ELECTRON_CHANNELS.setKeepRunningInTray]: (args) => {
        keepRunningInTray = args?.enabled !== false;
        return { ok: true, enabled: keepRunningInTray };
      },
      [ELECTRON_CHANNELS.windowMaximize]: () => {
        if (mainWindow?.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow?.maximize();
        }
        return { ok: true };
      },
      [ELECTRON_CHANNELS.windowMinimize]: () => {
        mainWindow?.minimize();
        return { ok: true };
      },
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
      [ELECTRON_CHANNELS.notifySessionTransition]: (args) => showSessionTransitionNotification(Notification, args),
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

function electronDataDirectory(): string {
  return process.env.MASTHEAD_DATA_DIR || (isElectronDevMode() ? electronDevDataDirectory() : app.getPath("userData"));
}

function electronDevDataDirectory(): string {
  return join(process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"), "masthead-dev");
}

function isElectronDevMode(): boolean {
  return Boolean(process.env.MASTHEAD_ELECTRON_DEV === "1" || (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL));
}

async function openDataDirectory(path: string): Promise<void> {
  const safePath = await assertSafeMastheadDataDirectory(path, {
    additionalRoots: [electronDataDirectory()],
    env: process.env
  });
  // Re-check leaf after resolution so a TOCTOU swap to a non-directory fails closed.
  const info = await lstat(safePath).catch(() => undefined);
  if (!info) throw new Error(`Data directory does not exist: ${path}`);
  if (info.isSymbolicLink()) throw new Error(`Refusing to open a symlinked data directory: ${path}`);
  if (!info.isDirectory()) throw new Error(`Data path is not a directory: ${path}`);
  const error = await shell.openPath(safePath);
  if (error) throw new Error(`failed to open data directory: ${error}`);
}


function stringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  return typeof value === "string" ? value : "";
}
