import { describe, expect, test } from "vitest";
import {
  displayStateForLiveState,
  liveStateKey,
  normalizeLiveState,
  normalizeLiveStateReport,
  reportIsFresh
} from "../liveState.ts";

describe("live runtime state", () => {
  test("normalizes runtime aliases without treating user input as blocked", () => {
    expect(normalizeLiveState("running")).toBe("working");
    expect(normalizeLiveState("thinking")).toBe("working");
    expect(normalizeLiveState("waiting_for_approval")).toBe("blocked");
    expect(normalizeLiveState("approval_requested")).toBe("blocked");
    expect(normalizeLiveState("permission_requested")).toBe("blocked");
    expect(normalizeLiveState("needsInput")).toBeUndefined();
    expect(normalizeLiveState("waiting_for_user")).toBeUndefined();
    expect(normalizeLiveState("needs_user")).toBeUndefined();
    expect(normalizeLiveState("question_requested")).toBeUndefined();
    expect(normalizeLiveState("completed")).toBe("idle");
    expect(normalizeLiveState("stopped")).toBe("idle");
    expect(normalizeLiveState("ended")).toBe("idle");
    expect(normalizeLiveState("garbage")).toBeUndefined();
  });

  test("normalizes reports with defaults, TTLs, and stable report IDs", () => {
    const report = normalizeLiveStateReport(
      {
        runtime: "opencode",
        source: "masthead:opencode-plugin",
        sourceSessionId: "source-1",
        state: "running",
        observedAt: "2026-07-07T12:00:00.000Z"
      },
      new Date("2026-07-07T12:00:01.000Z")
    );

    expect(report).toMatchObject({
      runtime: "opencode",
      source: "masthead:opencode-plugin",
      sourceSessionId: "source-1",
      state: "working",
      authority: "inferred",
      observedAt: "2026-07-07T12:00:00.000Z",
      expiresAt: "2026-07-07T12:00:30.000Z"
    });
    expect(report.reportId).toMatch(/^live_state:/);
  });

  test("validates required fields and runtime support", () => {
    expect(() => normalizeLiveStateReport({ source: "test", state: "working" })).toThrow(/runtime/i);
    expect(() => normalizeLiveStateReport({ runtime: "unsupported", source: "test", state: "working" })).toThrow(/runtime/i);
    expect(() => normalizeLiveStateReport({ runtime: "codex", source: "test", state: "weird" })).toThrow(/state/i);
  });

  test("uses TTL to determine freshness", () => {
    const report = normalizeLiveStateReport({
      runtime: "codex",
      source: "masthead:codex-hook",
      sourceSessionId: "source-1",
      state: "working",
      observedAt: "2026-07-07T12:00:00.000Z",
      ttlMs: 1_000
    });

    expect(reportIsFresh(report, new Date("2026-07-07T12:00:00.999Z"))).toBe(true);
    expect(reportIsFresh(report, new Date("2026-07-07T12:00:01.001Z"))).toBe(false);
  });

  test("computes display done from idle with unseen completed turn", () => {
    expect(displayStateForLiveState("idle", { unseenCompletedTurn: true })).toBe("done");
    expect(displayStateForLiveState("idle", { unseenCompletedTurn: false })).toBe("idle");
    expect(displayStateForLiveState("working", { unseenCompletedTurn: true })).toBe("working");
  });

  test("builds stable keys from source session or session refs", () => {
    expect(
      liveStateKey({
        runtime: "codex",
        source: "hook",
        sourceSessionId: "source-1"
      })
    ).toBe("codex:hook:source:source-1");
    expect(
      liveStateKey({
        runtime: "codex",
        source: "hook",
        sessionRef: { kind: "path", value: "/tmp/session.json" }
      })
    ).toBe("codex:hook:path:/tmp/session.json");
  });
});
