import { describe, expect, test } from "vitest";
import { activeImportRuntimes, scanTargetHarnesses } from "../harnessCatalog.ts";
import { adapterForRuntime, requiredScanRuntimes, scanAdapters, sessionAdapters } from "../registry.ts";

const SUPPORTED_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;

describe("adapter registry", () => {
  test("registers every active import runtime in catalog order", () => {
    expect(sessionAdapters.map((adapter) => adapter.runtime)).toEqual(SUPPORTED_RUNTIMES);
    expect(sessionAdapters.map((adapter) => adapter.runtime)).toEqual(activeImportRuntimes());
  });

  test("resolves each supported import runtime adapter", () => {
    for (const runtime of SUPPORTED_RUNTIMES) {
      expect(adapterForRuntime(runtime)?.runtime).toBe(runtime);
    }
  });

  test("uses catalog scan targets for required scan adapters, including live-only Codex", () => {
    const scanRuntimes = ["codex", ...SUPPORTED_RUNTIMES] as const;
    expect(requiredScanRuntimes()).toEqual(scanRuntimes);
    expect(requiredScanRuntimes()).toEqual(scanTargetHarnesses().map((entry) => entry.runtime));
    expect(scanAdapters.map((adapter) => adapter.runtime)).toEqual(scanRuntimes);
    expect(scanAdapters.find((adapter) => adapter.runtime === "grok")).toBeDefined();
    expect(scanAdapters.find((adapter) => adapter.runtime === "codex")).toBeDefined();
    expect(adapterForRuntime("codex")).toBeUndefined();
  });
});
