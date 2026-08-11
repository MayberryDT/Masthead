import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PublisherAccountV1 } from "../mastheadPages/types.ts";
import { validatePublisherAccountV1 } from "../mastheadPages/contract.ts";

export const SECURE_STORAGE_UNAVAILABLE = "secure_storage_unavailable";
export const CREDENTIAL_STORE_SCHEMA_VERSION = 1 as const;
export const CREDENTIAL_FILENAME = "masthead-pages-credentials.v1.json";

export type LinuxStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export type SafeStorageLike = {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (plainText: string) => Promise<Buffer>;
  decryptStringAsync: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend?: () => LinuxStorageBackend;
};

export type MastheadPagesCredentialRecord = {
  schemaVersion: typeof CREDENTIAL_STORE_SCHEMA_VERSION;
  /** OS-encrypted refresh credential, base64. */
  encryptedRefreshTokenB64: string;
  /** Non-secret account metadata returned to the renderer. */
  account: PublisherAccountV1;
  updatedAt: string;
};

export type PagesConnectionState =
  | { status: "disconnected" }
  | { status: "connected"; account: PublisherAccountV1 }
  | { status: "secure_storage_unavailable"; reason: string };

export type MastheadPagesCredentialStoreOptions = {
  userDataPath: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
};

export function credentialStorePath(userDataPath: string): string {
  return join(userDataPath, CREDENTIAL_FILENAME);
}

export async function assertSecureStorageAvailable(
  safeStorage: SafeStorageLike,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const available = await safeStorage.isAsyncEncryptionAvailable();
  if (!available) {
    throw new Error(SECURE_STORAGE_UNAVAILABLE);
  }
  if (platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === "basic_text" || backend === "unknown") {
      throw new Error(SECURE_STORAGE_UNAVAILABLE);
    }
  }
}

export function createMastheadPagesCredentialStore(options: MastheadPagesCredentialStoreOptions) {
  const path = credentialStorePath(options.userDataPath);
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());

  async function readRecord(): Promise<MastheadPagesCredentialRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Partial<MastheadPagesCredentialRecord>;
    if (record.schemaVersion !== CREDENTIAL_STORE_SCHEMA_VERSION) return undefined;
    if (typeof record.encryptedRefreshTokenB64 !== "string" || !record.encryptedRefreshTokenB64) {
      return undefined;
    }
    if (typeof record.updatedAt !== "string") return undefined;
    const account = validatePublisherAccountV1(record.account);
    if (!account.ok) return undefined;
    return {
      schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION,
      encryptedRefreshTokenB64: record.encryptedRefreshTokenB64,
      account: account.value,
      updatedAt: record.updatedAt
    };
  }

  async function writeAtomic(record: MastheadPagesCredentialRecord): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    const body = `${JSON.stringify(record)}\n`;
    try {
      await writeFile(tempPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    path,

    async getConnectionState(safeStorage: SafeStorageLike): Promise<PagesConnectionState> {
      try {
        await assertSecureStorageAvailable(safeStorage, platform);
      } catch {
        const existing = await readRecord();
        if (existing) {
          return { status: "secure_storage_unavailable", reason: SECURE_STORAGE_UNAVAILABLE };
        }
        return { status: "disconnected" };
      }
      const record = await readRecord();
      if (!record) return { status: "disconnected" };
      return { status: "connected", account: record.account };
    },

    async save(
      refreshToken: string,
      account: PublisherAccountV1,
      safeStorage: SafeStorageLike
    ): Promise<void> {
      if (typeof refreshToken !== "string" || refreshToken.length === 0) {
        throw new Error("invalid_refresh_token");
      }
      await assertSecureStorageAvailable(safeStorage, platform);
      const accountResult = validatePublisherAccountV1(account);
      if (!accountResult.ok) throw new Error("invalid_publisher_account");
      const encrypted = await safeStorage.encryptStringAsync(refreshToken);
      await writeAtomic({
        schemaVersion: CREDENTIAL_STORE_SCHEMA_VERSION,
        encryptedRefreshTokenB64: encrypted.toString("base64"),
        account: accountResult.value,
        updatedAt: now().toISOString()
      });
    },

    async loadRefreshToken(safeStorage: SafeStorageLike): Promise<string | undefined> {
      await assertSecureStorageAvailable(safeStorage, platform);
      const record = await readRecord();
      if (!record) return undefined;
      const encrypted = Buffer.from(record.encryptedRefreshTokenB64, "base64");
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) {
        const reEncrypted = await safeStorage.encryptStringAsync(decrypted.result);
        await writeAtomic({
          ...record,
          encryptedRefreshTokenB64: reEncrypted.toString("base64"),
          updatedAt: now().toISOString()
        });
      }
      return decrypted.result;
    },

    async updateAccount(account: PublisherAccountV1): Promise<void> {
      const accountResult = validatePublisherAccountV1(account);
      if (!accountResult.ok) throw new Error("invalid_publisher_account");
      const record = await readRecord();
      if (!record) throw new Error("credentials_missing");
      await writeAtomic({
        ...record,
        account: accountResult.value,
        updatedAt: now().toISOString()
      });
    },

    async clear(): Promise<void> {
      await rm(path, { force: true });
    },

    async hasCredentials(): Promise<boolean> {
      return Boolean(await readRecord());
    }
  };
}

export type MastheadPagesCredentialStore = ReturnType<typeof createMastheadPagesCredentialStore>;
