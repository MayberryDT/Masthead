import { describe, expect, test } from "vitest";
import { adapterCapabilityProfile } from "../capabilities.ts";
import { activeImportRuntimes, scanTargetHarnesses } from "../harnessCatalog.ts";
import { adapterForRuntime, requiredScanRuntimes, scanAdapters, sessionAdapters } from "../registry.ts";

describe("adapter registry", () => {
  test("registers every active import runtime in catalog order", () => {
    expect(sessionAdapters.map((adapter) => adapter.runtime)).toEqual(activeImportRuntimes());
  });

  test("resolves import runtime adapters and rejects detector, cloud, and legacy runtimes", () => {
    for (const runtime of activeImportRuntimes()) {
      expect(adapterForRuntime(runtime)?.runtime).toBe(runtime);
    }

    expect(adapterForRuntime("devin")).toBeUndefined();
    expect(adapterForRuntime("gemini_cli")).toBeUndefined();
    expect(sessionAdapters.map((adapter) => adapter.runtime)).not.toContain("gemini_cli");
  });

  test("keeps detector scan adapters out of import adapter lookup", () => {
    expect(requiredScanRuntimes()).toEqual(scanTargetHarnesses().map((entry) => entry.runtime));
    expect(scanAdapters.map((adapter) => adapter.runtime)).toEqual(requiredScanRuntimes());
    expect(scanAdapters.find((adapter) => adapter.runtime === "omp")).toBeDefined();
  });

  test("keeps Gemini CLI as legacy planned capability only", () => {
    expect(adapterCapabilityProfile("gemini_cli")).toMatchObject({
      lifecycle: "legacy_planned",
      maturity: "planned",
      runtime: "gemini_cli"
    });
  });
});
