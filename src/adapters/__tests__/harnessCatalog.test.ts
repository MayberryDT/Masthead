import { describe, expect, test } from "vitest";
import {
  activeImportRuntimes,
  advancedHarnesses,
  canImportHarness,
  canScanHarness,
  catalogOnlyHarnesses,
  cloudReferenceHarnesses,
  harnessForRuntime,
  importAdapterHarnesses,
  onboardingHarnesses,
  scanTargetHarnesses
} from "../harnessCatalog.ts";

const SUPPORTED_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;

describe("harness catalog", () => {
  test("onboards exactly the focused supported runtimes in catalog order", () => {
    expect(onboardingHarnesses().map((entry) => entry.runtime)).toEqual(SUPPORTED_RUNTIMES);
    expect(advancedHarnesses().map((entry) => entry.runtime)).toEqual(SUPPORTED_RUNTIMES);
  });

  test("represents Grok as an importable local hook and transcript source", () => {
    const grok = harnessForRuntime("grok");

    expect(grok?.label).toBe("Grok Build");
    expect(grok?.supportLevel).toBe("active_transcript");
    expect(grok?.runtimeStatus).toBe("import_adapter");
    expect(grok?.sourceKinds).toEqual(["hook", "jsonl"]);
    expect(grok?.knownCandidatePaths).toEqual(["~/.grok/hooks", "~/.grok/sessions"]);
    expect(canScanHarness(grok!)).toBe(true);
    expect(canImportHarness(grok!)).toBe(true);
  });

  test("represents OMP as an importable local session source", () => {
    const omp = harnessForRuntime("omp");
    expect(omp?.label).toBe("Oh My Pi");
    expect(omp?.supportLevel).toBe("active_transcript");
    expect(omp?.runtimeStatus).toBe("import_adapter");
    expect(canScanHarness(omp!)).toBe(true);
    expect(canImportHarness(omp!)).toBe(true);
    expect(omp?.aliases).toEqual(expect.arrayContaining(["OMP", "oh-my-pi", "pi-coding-agent"]));
    expect(omp?.knownCandidatePaths).toEqual(expect.arrayContaining(["~/.omp/agent/sessions", "~/.oh-my-pi/agent/sessions"]));
  });

  test("uses the focused runtime set for imports, scans, and setup lists", () => {
    expect(activeImportRuntimes()).toEqual(SUPPORTED_RUNTIMES);
    expect(importAdapterHarnesses().map((entry) => entry.runtime)).toEqual(SUPPORTED_RUNTIMES);
    expect(scanTargetHarnesses().map((entry) => entry.runtime)).toEqual(SUPPORTED_RUNTIMES);
    expect(catalogOnlyHarnesses()).toEqual([]);
    expect(cloudReferenceHarnesses()).toEqual([]);
  });
});
