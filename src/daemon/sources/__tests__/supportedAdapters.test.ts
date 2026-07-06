import { describe, expect, test } from "vitest";
import { canImportMetadata, canImportTranscripts } from "../../../adapters/capabilities.ts";
import { activeImportRuntimes, scanTargetHarnesses } from "../../../adapters/harnessCatalog.ts";
import { RUNTIME_KINDS } from "../../../adapters/types.ts";
import { supportedAdapters } from "../supportedAdapters.ts";

describe("supportedAdapters", () => {
  test("matches the full runtime kind registry", () => {
    const runtimes = supportedAdapters.map((adapter) => adapter.runtime);
    expect(runtimes).toEqual([...RUNTIME_KINDS]);
  });


  test("marks import adapters separately from detector scan targets", () => {
    const importAdapters = supportedAdapters.filter((adapter) => adapter.implementationState === "active");
    expect(importAdapters.map((adapter) => adapter.runtime)).toEqual(activeImportRuntimes());
    expect(importAdapters.every((adapter) => adapter.enabled)).toBe(true);
    expect(importAdapters.every((adapter) => adapter.supportsMcpExposure)).toBe(true);
    expect(canImportTranscripts(supportedAdapters.find((adapter) => adapter.runtime === "cursor")!)).toBe(true);
    expect(supportedAdapters.map((adapter) => adapter.runtime)).not.toContain("antigravity");

    const omp = supportedAdapters.find((adapter) => adapter.runtime === "omp")!;
    expect(omp.implementationState).toBe("active");
    expect(omp.enabled).toBe(true);
    expect(canImportMetadata(omp)).toBe(true);
    expect(canImportTranscripts(omp)).toBe(true);
    expect(scanTargetHarnesses().map((entry) => entry.runtime)).toContain("omp");
  });
});
