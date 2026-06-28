import { ELECTRON_CHANNELS, type ElectronChannel } from "./channels";
import { isAllowedRendererUrl } from "./window";

export { ELECTRON_CHANNELS };

export type IpcMainLike = {
  handle: (channel: string, handler: (event: IpcEventLike, ...args: unknown[]) => Promise<unknown> | unknown) => void;
};

export type IpcEventLike = {
  senderFrame?: {
    url?: string;
  } | null;
};

export type IpcHandlers = Partial<Record<ElectronChannel, (args?: Record<string, unknown>) => Promise<unknown> | unknown>>;

const ALLOWED_CHANNELS = new Set<string>(Object.values(ELECTRON_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is ElectronChannel {
  return ALLOWED_CHANNELS.has(channel);
}

export function isAllowedIpcSender(url: string | undefined): boolean {
  return isAllowedRendererUrl(url);
}

export function registerMastheadIpc(ipcMain: IpcMainLike, handlers: IpcHandlers): void {
  for (const channel of Object.values(ELECTRON_CHANNELS)) {
    const handler = handlers[channel];
    if (!handler) continue;
    ipcMain.handle(channel, async (event, args) => {
      if (!isAllowedIpcSender(event.senderFrame?.url)) {
        throw new Error(`Refusing IPC from untrusted sender: ${event.senderFrame?.url ?? "unknown"}`);
      }
      const payload = args && typeof args === "object" ? (args as Record<string, unknown>) : undefined;
      return handler(payload);
    });
  }
}
