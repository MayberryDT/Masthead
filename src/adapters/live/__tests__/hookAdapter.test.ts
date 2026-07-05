import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { RuntimeKind } from "../../types.ts";
import { adapterRecordFromLiveHook, liveHookSourceForRuntime } from "../hookAdapter.ts";

const fixtureDir = join(process.cwd(), "src/adapters/live/__fixtures__");

describe("live hook adapter records", () => {
  test.each([
    ["codex", "codex-session-start.json", "codex-hook-local", "hook-v1"],
    ["claude_code", "claude-user-prompt-submit.json", "claude-code-hook-local", "hook-v1"],
    ["cursor", "cursor-before-submit-prompt.json", "cursor-hook-local", "hook-v1"],
    ["grok", "grok-pre-tool-use.json", "grok-hook-local", "hook-v1"],
    ["opencode", "opencode-chat-message.json", "opencode-plugin-local", "plugin-v1"]
  ] satisfies Array<[RuntimeKind, string, string, string]>)(
    "retains source and event id contracts for %s",
    (runtime, fixture, sourceId, runtimeVersion) => {
      const record = adapterRecordFromLiveHook(
        readFileSync(join(fixtureDir, fixture), "utf8"),
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
    }
  );

  test("returns adapter diagnostics for valid but unsupported live runtimes", () => {
    const record = adapterRecordFromLiveHook("{}", "2026-07-05T12:10:00.000Z", "aider");

    expect(record.source).toMatchObject({
      sourceId: "aider-live-local",
      runtime: "aider",
      confidence: "heuristic"
    });
    expect(record.normalized.confidence).toBe("heuristic");
    expect(record.normalized.value).toBeUndefined();
    expect(record.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported_runtime",
        severity: "error",
        message: "Unsupported live hook runtime: aider."
      })
    ]);
  });

  test("throws when constructing a source for a runtime without a live profile", () => {
    expect(() => liveHookSourceForRuntime("aider")).toThrow("Unsupported live runtime: aider");
  });
});
