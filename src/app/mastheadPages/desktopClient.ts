import type {
  CreatePublicLogbookRequestV1,
  PublishPageBatchResultV1,
  PublicLogbookSummaryV1,
  RemovePageResultV1
} from "../../mastheadPages/types.ts";
import type { CoverPreview } from "../../electron/mastheadPagesCover.ts";
import {
  getDesktopBridge,
  type MastheadPagesConnectionState,
  type MastheadPagesStagedRef
} from "../desktopBridge.ts";

export type { MastheadPagesStagedRef };

export type CoverUploadResult = {
  protocolVersion: "masthead-pages-cover-result-v1";
  coverVersion: string;
};

export type MastheadPagesDesktopClient = {
  getConnection(): Promise<MastheadPagesConnectionState>;
  connect(): Promise<MastheadPagesConnectionState>;
  disconnect(): Promise<void>;
  listPublicLogbooks(): Promise<PublicLogbookSummaryV1[]>;
  createPublicLogbook(input: CreatePublicLogbookRequestV1): Promise<PublicLogbookSummaryV1>;
  chooseCover(): Promise<CoverPreview | { canceled: true } | { error: string }>;
  clearCover(selectionId?: string): Promise<void>;
  uploadCover(input: { publicLogbookId: string; selectionId: string }): Promise<CoverUploadResult>;
  publishStaged(refs: MastheadPagesStagedRef[]): Promise<PublishPageBatchResultV1>;
  withdrawStaged(ref: MastheadPagesStagedRef): Promise<RemovePageResultV1>;
};

function requireBridge() {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("masthead_pages_bridge_unavailable");
  return bridge;
}

export function createMastheadPagesDesktopClient(): MastheadPagesDesktopClient {
  return {
    getConnection: async () => {
      const method = requireBridge().getMastheadPagesConnection;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:getMastheadPagesConnection");
      return method();
    },
    connect: async () => {
      const method = requireBridge().connectMastheadPages;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:connectMastheadPages");
      return method();
    },
    disconnect: async () => {
      const method = requireBridge().disconnectMastheadPages;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:disconnectMastheadPages");
      await method();
    },
    listPublicLogbooks: async () => {
      const method = requireBridge().listMastheadPagesLogbooks;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:listMastheadPagesLogbooks");
      return method() as Promise<PublicLogbookSummaryV1[]>;
    },
    createPublicLogbook: async (input) => {
      const method = requireBridge().createMastheadPagesLogbook;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:createMastheadPagesLogbook");
      return method(input) as Promise<PublicLogbookSummaryV1>;
    },
    chooseCover: async () => {
      const method = requireBridge().chooseMastheadPagesCover;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:chooseMastheadPagesCover");
      return method() as Promise<CoverPreview | { canceled: true } | { error: string }>;
    },
    clearCover: async (selectionId) => {
      const method = requireBridge().clearMastheadPagesCover;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:clearMastheadPagesCover");
      await method(selectionId ? { selectionId } : undefined);
    },
    uploadCover: async (input) => {
      const method = requireBridge().uploadMastheadPagesCover;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:uploadMastheadPagesCover");
      return method(input) as Promise<CoverUploadResult>;
    },
    publishStaged: async (refs) => {
      const method = requireBridge().publishStagedToMastheadPages;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:publishStagedToMastheadPages");
      return method({ refs }) as Promise<PublishPageBatchResultV1>;
    },
    withdrawStaged: async (ref) => {
      const method = requireBridge().removeStagedFromMastheadPages;
      if (!method) throw new Error("masthead_pages_bridge_unavailable:removeStagedFromMastheadPages");
      return method({ ref }) as Promise<RemovePageResultV1>;
    }
  };
}

export function isMastheadPagesDesktopClientAvailable(): boolean {
  return typeof getDesktopBridge()?.getMastheadPagesConnection === "function";
}
