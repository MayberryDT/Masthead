import { describe, expect, test } from "vitest";
import { adapterRecordFromCodexHook } from "../hookAdapter.ts";

describe("codex hook adapter", () => {
  test("retains source provenance and authoritative confidence", () => {
    const record = adapterRecordFromCodexHook(
      JSON.stringify({
        provider_event_id: "hook-1",
        event: "approval_requested",
        session_id: "session-1",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Adapter contract"
      }),
      "2026-06-24T12:00:01.000Z"
    );

    expect(record.source.runtime).toBe("codex");
    expect(record.source.sourceKind).toBe("hook");
    expect(record.normalized.confidence).toBe("authoritative");
    expect(record.sourceRecordKey).toBe("codex:hook-1");
    expect(record.observedAt).toBe("2026-06-24T12:00:00.000Z");
    expect(record.normalized.sourceRef).toMatchObject({
      schemaVersion: "masthead.normalized-event.v1",
      sourceKind: "hook"
    });
  });

  test("returns adapter diagnostics for malformed hook payloads", () => {
    const record = adapterRecordFromCodexHook("{ bad json", "2026-06-24T12:00:01.000Z");

    expect(record.normalized.confidence).toBe("heuristic");
    expect(record.diagnostics).toEqual([
      expect.objectContaining({
        code: "malformed_json",
        severity: "error"
      })
    ]);
    expect(record.sourceRecordKey).toMatch(/^malformed:/);
  });
});
