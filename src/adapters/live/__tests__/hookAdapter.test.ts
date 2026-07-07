import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { RuntimeKind } from "../../types.ts";
import { adapterRecordFromLiveHook, liveHookSourceForRuntime } from "../hookAdapter.ts";

const fixtureDir = join(process.cwd(), "src/adapters/live/__fixtures__");

const liveCases: Array<{
  fixture?: string;
  raw?: string;
  runtime: RuntimeKind;
  runtimeVersion: string;
  sourceId: string;
}> = [
  { runtime: "claude_code", fixture: "claude-user-prompt-submit.json", sourceId: "claude-code-hook-local", runtimeVersion: "hook-v1" },
  {
    runtime: "codex",
    raw: JSON.stringify({
      hookEventName: "SessionStart",
      session_id: "codex-session-1",
      timestamp: "2026-07-05T12:00:00.000Z",
      cwd: "/workspace/masthead"
    }),
    sourceId: "codex-hook-local",
    runtimeVersion: "hook-v1"
  },
  { runtime: "cursor", fixture: "cursor-before-submit-prompt.json", sourceId: "cursor-hook-local", runtimeVersion: "hook-v1" },
  { runtime: "grok", fixture: "grok-pre-tool-use.json", sourceId: "grok-hook-local", runtimeVersion: "hook-v1" },
  { runtime: "opencode", fixture: "opencode-chat-message.json", sourceId: "opencode-plugin-local", runtimeVersion: "plugin-v1" },
  { runtime: "omp", fixture: "omp-session-start.json", sourceId: "omp-extension-local", runtimeVersion: "plugin-v1" },
  {
    runtime: "pi",
    raw: JSON.stringify({
      type: "session_start",
      sessionId: "pi-session-1",
      timestamp: "2026-07-05T12:00:00.000Z",
      cwd: "/workspace/masthead"
    }),
    sourceId: "pi-live-local",
    runtimeVersion: "plugin-v1"
  },
  {
    runtime: "hermes",
    raw: JSON.stringify({
      type: "session_start",
      sessionId: "hermes-session-1",
      timestamp: "2026-07-05T12:00:00.000Z",
      directory: "/workspace/masthead"
    }),
    sourceId: "hermes-live-local",
    runtimeVersion: "plugin-v1"
  }
];

describe("live hook adapter records", () => {
  test.each(liveCases)("retains source and event id contracts for $runtime", ({ runtime, fixture, raw, sourceId, runtimeVersion }) => {
    const record = adapterRecordFromLiveHook(
      raw ?? readFileSync(join(fixtureDir, fixture!), "utf8"),
      "2026-07-05T12:10:00.000Z",
      runtime
    );

    expect(record.source).toMatchObject({
      sourceId,
      runtime,
      schemaVersion: "masthead.normalized-event.v1",
      runtimeVersion
    });
    expect(record.sourceRecordKey).toMatch(new RegExp(`^${runtime}:`));
    expect(record.normalized.confidence).toBe("authoritative");
    expect(record.normalized.sourceRef).toMatchObject({
      endpoint: "http://127.0.0.1:17373/ingest",
      runtimeVersion,
      schemaVersion: "masthead.normalized-event.v1"
    });
  });

  test("returns adapter diagnostics for a runtime outside the supported live profiles", () => {
    const unsupportedRuntime = "unsupported_runtime" as RuntimeKind;
    const record = adapterRecordFromLiveHook("{}", "2026-07-05T12:10:00.000Z", unsupportedRuntime);

    expect(record.source).toMatchObject({
      sourceId: "unsupported_runtime-live-local",
      runtime: "unsupported_runtime",
      confidence: "heuristic"
    });
    expect(record.normalized.confidence).toBe("heuristic");
    expect(record.normalized.value).toBeUndefined();
    expect(record.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported_runtime",
        severity: "error",
        message: "Unsupported live hook runtime: unsupported_runtime."
      })
    ]);
  });

  test("throws when constructing a source for a runtime without a live profile", () => {
    expect(() => liveHookSourceForRuntime("unsupported_runtime" as RuntimeKind)).toThrow(
      "Unsupported live runtime: unsupported_runtime"
    );
  });
});
