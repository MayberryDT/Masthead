import { afterEach, describe, expect, test } from "vitest";
import {
  appendLocalRecords,
  clearLocalData,
  exportedRecordCount,
  exportLocalData,
  pruneLocalData,
  readLocalRecords
} from "../nativeStoreClient";
import type { StoreRecord } from "../../core/store";

describe("native store client", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true
    });
  });

  test("exports records with an explicit timestamp", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const exported = await exportLocalData(new Date("2026-06-23T04:30:00.000Z"), async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return "{\"metadata\":{\"recordCount\":2},\"records\":[]}" as T;
    });

    expect(exportedRecordCount(exported)).toBe(2);
    expect(calls).toEqual([
      {
        command: "export_store_records_command",
        args: { exportedAt: "2026-06-23T04:30:00.000Z" }
      }
    ]);
  });

  test("clears local data only when native command reports external state untouched", async () => {
    const result = await clearLocalData(async <T>(command: string) => {
      expect(command).toBe("clear_local_data_command");
      return { removedRecords: 3, touchedExternalState: false } as T;
    });

    expect(result).toEqual({ removedRecords: 3, touchedExternalState: false });
  });

  test("rejects clear results that claim external state was touched", async () => {
    await expect(
      clearLocalData(async <T>() => ({ removedRecords: 1, touchedExternalState: true }) as T)
    ).rejects.toThrow("external state mutation");
  });

  test("prunes local data through the Tauri command boundary", async () => {
    const policy = {
      cutoffAt: "2026-06-01T00:00:00.000Z",
      recordTypes: ["review_disposition" as const],
      keepUnresolvedAttention: true
    };
    const result = await pruneLocalData(policy, async <T>(command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("prune_local_data_command");
      expect(args).toEqual({ policy });
      return {
        removedRecords: 1,
        removedRecordIds: ["record:review_disposition:old"],
        removedByType: { event: 0, git_snapshot: 0, attention_item: 0, conflict_card: 0, review_disposition: 1 },
        retainedRecords: 2,
        touchedExternalState: false
      } as T;
    });

    expect(result.removedRecords).toBe(1);
  });

  test("rejects prune results that claim external state was touched", async () => {
    await expect(
      pruneLocalData({ cutoffAt: "2026-06-01T00:00:00.000Z" }, async <T>() => ({
        removedRecords: 1,
        removedRecordIds: ["record:event:old"],
        removedByType: { event: 1, git_snapshot: 0, attention_item: 0, conflict_card: 0, review_disposition: 0 },
        retainedRecords: 0,
        touchedExternalState: true
      }) as T)
    ).rejects.toThrow("external state mutation");
  });

  test("reads native store records through the Tauri command boundary", async () => {
    const records: StoreRecord[] = [reviewDispositionRecord()];
    const read = await readLocalRecords(async <T>(command: string) => {
      expect(command).toBe("read_store_records_command");
      return records as T;
    });

    expect(read).toEqual(records);
  });

  test("appends native store records through the Tauri command boundary", async () => {
    const records: StoreRecord[] = [reviewDispositionRecord()];
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];

    await appendLocalRecords(records, async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return undefined as T;
    });

    expect(calls).toEqual([
      {
        command: "append_store_records_command",
        args: { records }
      }
    ]);
  });

  test("round-trips local records through the browser fallback without touching external state", async () => {
    const localStorage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => localStorage.get(key) ?? null,
          setItem: (key: string, value: string) => localStorage.set(key, value),
          removeItem: (key: string) => localStorage.delete(key)
        }
      },
      writable: true
    });
    const records = [reviewDispositionRecord()];

    await appendLocalRecords(records);
    expect(await readLocalRecords()).toEqual(records);
    const exported = await exportLocalData(new Date("2026-06-23T08:00:00.000Z"));
    expect(exportedRecordCount(exported)).toBe(1);

    const result = await clearLocalData();
    expect(result).toEqual({ removedRecords: 1, touchedExternalState: false });
    expect(await readLocalRecords()).toEqual([]);
  });

  test("prunes browser fallback records with the shared local retention policy", async () => {
    const localStorage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => localStorage.get(key) ?? null,
          setItem: (key: string, value: string) => localStorage.set(key, value),
          removeItem: (key: string) => localStorage.delete(key)
        }
      },
      writable: true
    });
    const oldRecord = reviewDispositionRecord("old", "2026-05-01T00:00:00.000Z");
    const recentRecord = reviewDispositionRecord("recent", "2026-06-20T00:00:00.000Z");

    await appendLocalRecords([oldRecord, recentRecord]);
    const result = await pruneLocalData({
      cutoffAt: "2026-06-01T00:00:00.000Z",
      recordTypes: ["review_disposition"]
    });

    expect(result).toMatchObject({
      removedRecords: 1,
      removedRecordIds: [oldRecord.recordId],
      retainedRecords: 1,
      touchedExternalState: false
    });
    expect(await readLocalRecords()).toEqual([recentRecord]);
  });
});

function reviewDispositionRecord(id = "session-1", observedAt = "2026-06-23T05:30:00.000Z"): StoreRecord {
  return {
    recordId: `record:review_disposition:review:session:${id}`,
    recordType: "review_disposition",
    observedAt,
    value: {
      dispositionId: `review:session:${id}`,
      subjectId: id,
      subjectType: "session",
      status: "reviewed",
      recordedAt: observedAt,
      reason: "Reviewed from test."
    }
  };
}
