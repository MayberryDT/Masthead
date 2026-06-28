import { contextBridge, ipcRenderer } from "electron";
import { LEGACY_COMMAND_TO_CHANNEL } from "./channels";

contextBridge.exposeInMainWorld("mastheadDesktop", {
  invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const channel = LEGACY_COMMAND_TO_CHANNEL[command];
    if (!channel) {
      throw new Error(`Unsupported Masthead desktop command: ${command}`);
    }
    return ipcRenderer.invoke(channel, args) as Promise<T>;
  }
});
