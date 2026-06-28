import { applyRetentionPolicy, countRecordsByType, type PruneLocalDataResult, type RetentionPolicy } from "../core/retention";
import type { StoreRecord } from "../core/store";
import { invokeDesktopCommand, isDesktopBridgeAvailable } from "./desktopBridge";

export type ClearLocalDataResult = {
  removedRecords: number;
  touchedExternalState: boolean;
};

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const browserStoreKey = "masthead.localStoreRecords.v1";

export async function exportLocalData(exportedAt = new Date(), invoke?: Invoke): Promise<string> {
  const desktopInvoke = invoke ?? (isDesktopBridgeAvailable() ? invokeDesktopCommand : undefined);
  if (!desktopInvoke) {
    return JSON.stringify({
      metadata: {
        format: "masthead.native-store.v1",
        schemaVersion: 1,
        exportedAt: exportedAt.toISOString(),
        recordCount: readBrowserRecords().length
      },
      records: readBrowserRecords()
    });
  }
  return desktopInvoke<string>("export_store_records_command", { exportedAt: exportedAt.toISOString() }) as Promise<string>;
}

export async function clearLocalData(invoke?: Invoke): Promise<ClearLocalDataResult> {
  const desktopInvoke = invoke ?? (isDesktopBridgeAvailable() ? invokeDesktopCommand : undefined);
  if (!desktopInvoke) {
    const removedRecords = readBrowserRecords().length;
    writeBrowserRecords([]);
    return { removedRecords, touchedExternalState: false };
  }

  const result = await desktopInvoke<ClearLocalDataResult>("clear_local_data_command");
  if (!result) throw new Error("Native clear command returned no result.");
  if (result.touchedExternalState) {
    throw new Error("Native clear reported external state mutation.");
  }
  return result;
}

export async function pruneLocalData(policy: RetentionPolicy, invoke?: Invoke): Promise<PruneLocalDataResult> {
  const desktopInvoke = invoke ?? (isDesktopBridgeAvailable() ? invokeDesktopCommand : undefined);
  if (!desktopInvoke) {
    const { retainedRecords, removedRecords } = applyRetentionPolicy(readBrowserRecords(), policy);
    writeBrowserRecords(retainedRecords);
    return {
      removedRecords: removedRecords.length,
      removedRecordIds: removedRecords.map((record) => record.recordId),
      removedByType: countRecordsByType(removedRecords),
      retainedRecords: retainedRecords.length,
      touchedExternalState: false
    };
  }

  const result = await desktopInvoke<PruneLocalDataResult>("prune_local_data_command", { policy });
  if (!result) throw new Error("Native retention command returned no result.");
  if (result.touchedExternalState) {
    throw new Error("Native retention reported external state mutation.");
  }
  return result;
}

export async function readLocalRecords(invoke?: Invoke): Promise<StoreRecord[]> {
  const desktopInvoke = invoke ?? (isDesktopBridgeAvailable() ? invokeDesktopCommand : undefined);
  if (!desktopInvoke) return readBrowserRecords();
  return (await desktopInvoke<StoreRecord[]>("read_store_records_command")) ?? [];
}

export async function appendLocalRecords(records: StoreRecord[], invoke?: Invoke): Promise<void> {
  const desktopInvoke = invoke ?? (isDesktopBridgeAvailable() ? invokeDesktopCommand : undefined);
  if (!desktopInvoke) {
    writeBrowserRecords([...readBrowserRecords(), ...records]);
    return;
  }
  await desktopInvoke<void>("append_store_records_command", { records });
}

export function exportedRecordCount(exported: string): number | undefined {
  try {
    const parsed = JSON.parse(exported) as { metadata?: { recordCount?: unknown } };
    return typeof parsed.metadata?.recordCount === "number" ? parsed.metadata.recordCount : undefined;
  } catch {
    return undefined;
  }
}

function readBrowserRecords(): StoreRecord[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(browserStoreKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoreRecord[]) : [];
  } catch {
    return [];
  }
}

function writeBrowserRecords(records: StoreRecord[]): void {
  if (typeof window === "undefined") return;
  if (records.length === 0) {
    window.localStorage.removeItem(browserStoreKey);
    return;
  }
  window.localStorage.setItem(browserStoreKey, JSON.stringify(records));
}
