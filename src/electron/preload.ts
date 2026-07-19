import { contextBridge, ipcRenderer } from "electron";
import type { DesktopNotificationResult, DesktopSessionTransitionNotificationInput } from "../app/desktopBridge";
import { ELECTRON_CHANNELS, LEGACY_COMMAND_TO_CHANNEL } from "./channels";

const runtimeProcess = globalThis.process as { env?: Record<string, string | undefined>; platform?: string } | undefined;
const projectionPort = runtimeProcess?.env?.MASTHEAD_PORT || "17373";
const rendererConfig = ipcRenderer.sendSync(ELECTRON_CHANNELS.rendererConfig) as { projectionUrl?: string } | undefined;

contextBridge.exposeInMainWorld("mastheadDesktop", {
  platform: runtimeProcess?.platform,
  invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const channel = LEGACY_COMMAND_TO_CHANNEL[command];
    if (!channel) {
      throw new Error(`Unsupported Masthead desktop command: ${command}`);
    }
    return ipcRenderer.invoke(channel, args) as Promise<T>;
  },
  notifySessionTransition: (input: DesktopSessionTransitionNotificationInput): Promise<DesktopNotificationResult> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.notifySessionTransition, input) as Promise<DesktopNotificationResult>,
  projectionUrl: rendererConfig?.projectionUrl || `http://127.0.0.1:${projectionPort}/projection`
});
