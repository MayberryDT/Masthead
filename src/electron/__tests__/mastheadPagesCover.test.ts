import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MAX_COVER_SOURCE_BYTES,
  chooseCoverFile,
  createCoverSelectionStore,
  detectCoverImageType,
  readCoverSourceFile,
  toCoverPreview,
  validateCoverSourceBytes
} from "../mastheadPagesCover";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function pngBytes(size = 64): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const rest = Buffer.alloc(Math.max(0, size - header.byteLength), 0x11);
  return Buffer.concat([header, rest]);
}

function jpegBytes(size = 64): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const rest = Buffer.alloc(Math.max(0, size - header.byteLength), 0x22);
  return Buffer.concat([header, rest]);
}

function webpBytes(size = 64): Buffer {
  const header = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
  ]);
  const rest = Buffer.alloc(Math.max(0, size - header.byteLength), 0x33);
  return Buffer.concat([header, rest]);
}

describe("mastheadPagesCover", () => {
  test("detects PNG, JPEG, and WebP signatures", () => {
    expect(detectCoverImageType(pngBytes())).toBe("image/png");
    expect(detectCoverImageType(jpegBytes())).toBe("image/jpeg");
    expect(detectCoverImageType(webpBytes())).toBe("image/webp");
    expect(detectCoverImageType(Buffer.from("not-an-image"))).toBeNull();
  });

  test("rejects empty, oversized, and spoofed sources", () => {
    expect(validateCoverSourceBytes(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
    expect(validateCoverSourceBytes(Buffer.alloc(MAX_COVER_SOURCE_BYTES + 1, 1))).toEqual({
      ok: false,
      reason: "too_large"
    });
    expect(validateCoverSourceBytes(Buffer.from("GIF89a"))).toEqual({
      ok: false,
      reason: "unsupported_type"
    });
    const ok = validateCoverSourceBytes(pngBytes(128));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.contentType).toBe("image/png");
  });

  test("preview objects never include filesystem paths", () => {
    const store = createCoverSelectionStore();
    const preview = store.put({ contentType: "image/png", bytes: pngBytes() });
    expect(preview.selectionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(preview.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(JSON.stringify(preview)).not.toMatch(/\/home\/|\\\\|C:\\\\|filePath|path/i);
    expect(Object.keys(preview).sort()).toEqual([
      "byteLength",
      "contentType",
      "previewDataUrl",
      "selectionId"
    ]);
  });

  test("reads at most 10 MiB plus one byte and rejects oversized files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-cover-"));
    tempDirs.push(dir);
    const path = join(dir, "big.png");
    await writeFile(path, Buffer.concat([pngBytes(8), Buffer.alloc(MAX_COVER_SOURCE_BYTES, 7)]));
    await expect(readCoverSourceFile(path)).resolves.toEqual({ ok: false, reason: "too_large" });

    const okPath = join(dir, "ok.png");
    await writeFile(okPath, pngBytes(256));
    const ok = await readCoverSourceFile(okPath);
    expect(ok.ok).toBe(true);
  });

  test("chooseCoverFile stores bytes and returns path-free preview", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-cover-dialog-"));
    tempDirs.push(dir);
    const path = join(dir, "cover.jpg");
    await writeFile(path, jpegBytes(120));
    const store = createCoverSelectionStore();
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [path] }))
    };

    const result = await chooseCoverFile({ dialog, store });
    expect(result).toMatchObject({
      contentType: "image/jpeg",
      byteLength: 120
    });
    if ("selectionId" in result) {
      expect(store.get(result.selectionId)?.bytes.byteLength).toBe(120);
      expect(JSON.stringify(result)).not.toContain(path);
    }
  });

  test("chooseCoverFile cancellation does not store bytes", async () => {
    const store = createCoverSelectionStore();
    const result = await chooseCoverFile({
      dialog: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      },
      store
    });
    expect(result).toEqual({ canceled: true });
    expect(store.size()).toBe(0);
  });

  test("toCoverPreview builds exact data URL for the selected bytes", () => {
    const bytes = pngBytes(32);
    const preview = toCoverPreview("sel-1", { contentType: "image/png", bytes });
    expect(preview.previewDataUrl).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });
});
