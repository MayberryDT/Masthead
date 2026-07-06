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

  test("uses the focused supported set for required scan adapters", () => {
    expect(requiredScanRuntimes()).toEqual(SUPPORTED_RUNTIMES);
    expect(requiredScanRuntimes()).toEqual(scanTargetHarnesses().map((entry) => entry.runtime));
    expect(scanAdapters.map((adapter) => adapter.runtime)).toEqual(SUPPORTED_RUNTIMES);
    expect(scanAdapters.find((adapter) => adapter.runtime === "grok")).toBeDefined();
  });
});
