import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorActionRequired } from "../../shared/harnessConnectors.ts";

const STORE_FILENAME = "connector-activation.json";
const FILE_MODE = 0o600;

export type StoredConnectorActivation = {
  required: ConnectorActionRequired;
  message: string;
  setAt: string;
};

type ActivationStoreFile = Record<string, StoredConnectorActivation>;

export async function setConnectorActivation(
  dataDirectory: string,
  runtime: string,
  activation: { required: ConnectorActionRequired; message: string }
): Promise<void> {
  const store = await readStore(dataDirectory);
  store[runtime] = {
    required: activation.required,
    message: activation.message,
    setAt: new Date().toISOString()
  };
  await writeStore(dataDirectory, store);
}

export async function getConnectorActivation(
  dataDirectory: string,
  runtime: string
): Promise<StoredConnectorActivation | undefined> {
  const store = await readStore(dataDirectory);
  return store[runtime];
}

export async function clearConnectorActivation(dataDirectory: string, runtime: string): Promise<void> {
  const store = await readStore(dataDirectory);
  if (!(runtime in store)) return;
  delete store[runtime];
  await writeStore(dataDirectory, store);
}

export async function listConnectorActivations(
  dataDirectory: string
): Promise<Record<string, StoredConnectorActivation>> {
  return readStore(dataDirectory);
}

function storePath(dataDirectory: string): string {
  return join(dataDirectory, STORE_FILENAME);
}

async function readStore(dataDirectory: string): Promise<ActivationStoreFile> {
  try {
    const raw = await readFile(storePath(dataDirectory), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return sanitizeStore(parsed as Record<string, unknown>);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return {};
    // Fail-open on corrupt or unreadable stores.
    return {};
  }
}

async function writeStore(dataDirectory: string, store: ActivationStoreFile): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const path = storePath(dataDirectory);
  const tmpPath = join(dataDirectory, `.${STORE_FILENAME}.tmp-${process.pid}-${Date.now()}`);
  const contents = `${JSON.stringify(store, null, 2)}\n`;
  await writeFile(tmpPath, contents, { encoding: "utf8", mode: FILE_MODE });
  await rename(tmpPath, path);
}

function sanitizeStore(raw: Record<string, unknown>): ActivationStoreFile {
  const result: ActivationStoreFile = {};
  for (const [runtime, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.required !== "string" || typeof entry.message !== "string" || typeof entry.setAt !== "string") {
      continue;
    }
    result[runtime] = {
      required: entry.required as ConnectorActionRequired,
      message: entry.message,
      setAt: entry.setAt
    };
  }
  return result;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}
