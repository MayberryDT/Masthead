import { randomUUID } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";

export const MAX_COVER_SOURCE_BYTES = 10 * 1024 * 1024;

export type CoverImageType = "image/png" | "image/jpeg" | "image/webp";

export type CoverPreview = {
  selectionId: string;
  contentType: CoverImageType;
  byteLength: number;
  previewDataUrl: string;
};

export type CoverSourceBytes = {
  contentType: CoverImageType;
  bytes: Buffer;
};

export type CoverValidationResult =
  | { ok: true; contentType: CoverImageType; bytes: Buffer }
  | { ok: false; reason: "too_large" | "unsupported_type" | "empty" };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIG = [0xff, 0xd8, 0xff] as const;
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_WEBP = [0x57, 0x45, 0x42, 0x50] as const;

export type OpenDialogResult = { canceled: boolean; filePaths: string[] };

export type CoverDialogLike = {
  showOpenDialog: (options: {
    properties?: Array<"openFile" | "openDirectory" | "multiSelections" | string>;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<OpenDialogResult>;
};

export function detectCoverImageType(bytes: Uint8Array): CoverImageType | null {
  if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && JPEG_SIG.every((b, i) => bytes[i] === b)) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    WEBP_RIFF.every((b, i) => bytes[i] === b) &&
    WEBP_WEBP.every((b, i) => bytes[8 + i] === b)
  ) {
    return "image/webp";
  }
  return null;
}

export function validateCoverSourceBytes(input: Uint8Array | Buffer): CoverValidationResult {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_COVER_SOURCE_BYTES) return { ok: false, reason: "too_large" };
  const contentType = detectCoverImageType(bytes);
  if (!contentType) return { ok: false, reason: "unsupported_type" };
  return { ok: true, contentType, bytes };
}

export function buildCoverPreviewDataUrl(bytes: Buffer, contentType: CoverImageType): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export function toCoverPreview(selectionId: string, source: CoverSourceBytes): CoverPreview {
  return {
    selectionId,
    contentType: source.contentType,
    byteLength: source.bytes.byteLength,
    previewDataUrl: buildCoverPreviewDataUrl(source.bytes, source.contentType)
  };
}

export async function readCoverSourceFile(
  filePath: string,
  options?: { maxBytes?: number }
): Promise<CoverValidationResult> {
  const maxBytes = options?.maxBytes ?? MAX_COVER_SOURCE_BYTES;
  const info = await stat(filePath);
  if (info.size > maxBytes) return { ok: false, reason: "too_large" };
  if (info.size === 0) return { ok: false, reason: "empty" };

  // Read at most maxBytes + 1 so oversized files are rejected even if size is wrong/racy.
  const handle = await open(filePath, "r");
  try {
    const budget = maxBytes + 1;
    const buffer = Buffer.allocUnsafe(Math.min(info.size + 1, budget));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maxBytes) return { ok: false, reason: "too_large" };
    return validateCoverSourceBytes(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function createCoverSelectionStore() {
  const selections = new Map<string, CoverSourceBytes>();

  return {
    put(source: CoverSourceBytes): CoverPreview {
      const selectionId = randomUUID();
      selections.set(selectionId, source);
      return toCoverPreview(selectionId, source);
    },
    get(selectionId: string): CoverSourceBytes | undefined {
      return selections.get(selectionId);
    },
    take(selectionId: string): CoverSourceBytes | undefined {
      const value = selections.get(selectionId);
      if (value) selections.delete(selectionId);
      return value;
    },
    clear(selectionId?: string): void {
      if (selectionId) selections.delete(selectionId);
      else selections.clear();
    },
    size(): number {
      return selections.size;
    }
  };
}

export type CoverSelectionStore = ReturnType<typeof createCoverSelectionStore>;

export async function chooseCoverFile(options: {
  dialog: CoverDialogLike;
  store: CoverSelectionStore;
  readFile?: (path: string) => Promise<CoverValidationResult>;
}): Promise<CoverPreview | { canceled: true } | { error: string }> {
  const result = await options.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const filePath = result.filePaths[0]!;
  const reader = options.readFile ?? ((path) => readCoverSourceFile(path));
  const validated = await reader(filePath);
  if (!validated.ok) {
    return { error: `cover_${validated.reason}` };
  }

  // Never return the filesystem path to the renderer.
  return options.store.put({ contentType: validated.contentType, bytes: validated.bytes });
}

/** @internal test helper — keeps path out of public preview objects */
export async function loadCoverFromPathForTests(
  filePath: string,
  store: CoverSelectionStore
): Promise<CoverPreview> {
  const bytes = await readFile(filePath);
  const validated = validateCoverSourceBytes(bytes);
  if (!validated.ok) throw new Error(`cover_${validated.reason}`);
  return store.put({ contentType: validated.contentType, bytes: validated.bytes });
}
