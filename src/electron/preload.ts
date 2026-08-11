import { contextBridge, ipcRenderer } from "electron";
import type { DesktopNotificationResult, DesktopSessionTransitionNotificationInput } from "../app/desktopBridge";
import type {
  CreatePublicLogbookRequestV1,
  PublishPageBatchResultV1,
  PublicLogbookSummaryV1,
  RemovePageResultV1
} from "../mastheadPages/types";
import type { CoverPreview } from "./mastheadPagesCover";
import type { CoverUploadInput, CoverUploadResult } from "./mastheadPagesRemoteClient";
import type { PagesConnectionState } from "./mastheadPagesCredentials";
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
  getMastheadPagesConnection: (): Promise<PagesConnectionState> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesGetConnection) as Promise<PagesConnectionState>,
  connectMastheadPages: (): Promise<PagesConnectionState> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesConnect) as Promise<PagesConnectionState>,
  disconnectMastheadPages: (): Promise<void> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesDisconnect) as Promise<void>,
  listMastheadPagesLogbooks: (): Promise<PublicLogbookSummaryV1[]> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesListLogbooks) as Promise<PublicLogbookSummaryV1[]>,
  createMastheadPagesLogbook: (input: CreatePublicLogbookRequestV1): Promise<PublicLogbookSummaryV1> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesCreateLogbook, input) as Promise<PublicLogbookSummaryV1>,
  chooseMastheadPagesCover: (): Promise<CoverPreview | { canceled: true } | { error: string }> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesChooseCover) as Promise<
      CoverPreview | { canceled: true } | { error: string }
    >,
  clearMastheadPagesCover: (args?: { selectionId?: string }): Promise<void> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesClearCover, args) as Promise<void>,
  uploadMastheadPagesCover: (input: CoverUploadInput): Promise<CoverUploadResult> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesUploadCover, input) as Promise<CoverUploadResult>,
  publishStagedToMastheadPages: (args: {
    refs: Array<{ artifactId: string; requestDigest: string }>;
  }): Promise<PublishPageBatchResultV1> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesPublishStaged, args) as Promise<PublishPageBatchResultV1>,
  removeStagedFromMastheadPages: (args: {
    ref: { artifactId: string; requestDigest: string };
  }): Promise<RemovePageResultV1> =>
    ipcRenderer.invoke(ELECTRON_CHANNELS.mastheadPagesRemoveStaged, args) as Promise<RemovePageResultV1>,
  projectionUrl: rendererConfig?.projectionUrl || `http://127.0.0.1:${projectionPort}/projection`
});
