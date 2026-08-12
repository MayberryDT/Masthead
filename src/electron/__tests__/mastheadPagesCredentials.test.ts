import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createMastheadPagesCredentialStore,
  SECURE_STORAGE_UNAVAILABLE,
  type LinuxStorageBackend,
  type SafeStorageLike
} from "../mastheadPagesCredentials";
import type { PublisherAccountV1 } from "../../mastheadPages/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const account: PublisherAccountV1 = {
  protocolVersion: "masthead-pages-account-v1",
  accountId: "11111111-1111-4111-8111-111111111111",
  handle: "mayberry",
  publisherAccess: "publisher",
  defaultLogbookVisibility: "discoverable"
};

function fakeSafeStorage(options: {
  backend?: LinuxStorageBackend;
  available?: boolean;
  shouldReEncrypt?: boolean;
}): SafeStorageLike & { plaintexts: string[] } {
  const plaintexts: string[] = [];
  let keyVersion = 1;
  return {
    plaintexts,
    isAsyncEncryptionAvailable: async () => options.available !== false,
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    encryptStringAsync: async (plainText: string) => {
      plaintexts.push(plainText);
      const encrypted = Buffer.from(`v${keyVersion}:${plainText}`, "utf8");
      keyVersion += 1;
      return encrypted;
    },
    decryptStringAsync: async (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      const plain = text.includes(":") ? text.slice(text.indexOf(":") + 1) : text;
      return { result: plain, shouldReEncrypt: Boolean(options.shouldReEncrypt) };
    }
  };
}

describe("mastheadPagesCredentials", () => {
  test.each(["basic_text", "unknown"] as const)("refuses insecure Linux storage backend %s", async (backend) => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-creds-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    await expect(store.save("refresh-token-value", account, fakeSafeStorage({ backend }))).rejects.toThrow(
      SECURE_STORAGE_UNAVAILABLE
    );
  });

  test("refuses when async encryption is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-creds-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "darwin" });
    await expect(
      store.save("refresh-token-value", account, fakeSafeStorage({ available: false }))
    ).rejects.toThrow(SECURE_STORAGE_UNAVAILABLE);
  });

  test("persists encrypted refresh token without writing plaintext", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-creds-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const safeStorage = fakeSafeStorage({ backend: "gnome_libsecret" });
    await store.save("refresh-secret-abc", account, safeStorage);

    const onDisk = await readFile(store.path, "utf8");
    expect(onDisk).not.toContain("refresh-secret-abc");
    expect(onDisk).toContain("encryptedRefreshTokenB64");
    expect(onDisk).toContain("11111111-1111-4111-8111-111111111111");

    const loaded = await store.loadRefreshToken(safeStorage);
    expect(loaded).toBe("refresh-secret-abc");
    await expect(store.getConnectionState(safeStorage)).resolves.toEqual({
      status: "connected",
      account
    });
  });

  test("re-encrypts when decryptStringAsync requests rotation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-creds-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const initial = fakeSafeStorage({ backend: "kwallet6" });
    await store.save("refresh-secret-abc", account, initial);

    const rotating = fakeSafeStorage({ backend: "kwallet6", shouldReEncrypt: true });
    const before = await readFile(store.path, "utf8");
    await expect(store.loadRefreshToken(rotating)).resolves.toBe("refresh-secret-abc");
    const after = await readFile(store.path, "utf8");
    expect(after).not.toEqual(before);
  });

  test("clear removes credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-creds-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const safeStorage = fakeSafeStorage({ backend: "gnome_libsecret" });
    await store.save("refresh-secret-abc", account, safeStorage);
    await store.clear();
    await expect(store.getConnectionState(safeStorage)).resolves.toEqual({ status: "disconnected" });
  });
});
