import { describe, expect, test } from "vitest";
import { adapterCapabilityProfile } from "../capabilities.ts";
import { adapterForRuntime, requiredScanRuntimes, sessionAdapters } from "../registry.ts";

const activeScanRuntimes = ["codex", "cursor", "claude_code", "antigravity", "opencode", "aider", "openclaw", "hermes", "pi"] as const;

describe("adapter registry", () => {
  test("registers every active scan runtime in scan order", () => {
    expect(requiredScanRuntimes()).toEqual([...activeScanRuntimes]);
    expect(sessionAdapters.map((adapter) => adapter.runtime)).toEqual([...activeScanRuntimes]);
  });

  test("resolves active runtime adapters and excludes Gemini CLI", () => {
    for (const runtime of activeScanRuntimes) {
      expect(adapterForRuntime(runtime)?.runtime).toBe(runtime);
    }

    expect(adapterForRuntime("gemini_cli")).toBeUndefined();
    expect(sessionAdapters.map((adapter) => adapter.runtime)).not.toContain("gemini_cli");
  });

  test("keeps Gemini CLI as legacy planned capability only", () => {
    expect(adapterCapabilityProfile("gemini_cli")).toMatchObject({
      lifecycle: "legacy_planned",
      maturity: "planned",
      runtime: "gemini_cli"
    });
  });
});
