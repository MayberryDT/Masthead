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
import { LIVE_CONNECTOR_RUNTIMES } from "../liveRuntimes.ts";

const IMPORT_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;
const CATALOG_ONBOARDING_RUNTIMES = ["codex", ...IMPORT_RUNTIMES] as const;

describe("harness catalog", () => {
  test("catalog covers every live connector runtime", () => {
    for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
      expect(harnessForRuntime(runtime), runtime).toBeTruthy();
    }
  });

  test("codex is present as a live-capable catalog entry", () => {
    const codex = harnessForRuntime("codex");
    expect(codex?.supportsLiveWatch).toBe(true);
    expect(codex?.visibility).not.toBe("hidden_legacy");
    expect(codex?.label).toBe("Codex");
    expect(codex?.sourceKinds).toEqual(expect.arrayContaining(["hook", "jsonl"]));
    expect(codex?.supportLevel).toBe("detector_only");
    expect(codex?.runtimeStatus).toBe("scan_target");
    expect(codex?.supportsMetadataImport).toBe(false);
    expect(codex?.supportsTranscriptImport).toBe(false);
    expect(codex?.envOverrides).toEqual(["CODEX_HOME"]);
    expect(codex?.envOverrides).not.toContain("MASTHEAD_CODEX_HOME");
    expect(codex?.knownCandidatePaths).toEqual(["~/.codex/sessions", "~/.codex/hooks.json"]);
  });

  test("onboards live-capable and import runtimes in catalog order", () => {
    expect(onboardingHarnesses().map((entry) => entry.runtime)).toEqual(CATALOG_ONBOARDING_RUNTIMES);
    expect(advancedHarnesses().map((entry) => entry.runtime)).toEqual(CATALOG_ONBOARDING_RUNTIMES);
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

  test("keeps SessionAdapter-backed imports separate from live-only Codex", () => {
    expect(activeImportRuntimes()).toEqual(IMPORT_RUNTIMES);
    expect(importAdapterHarnesses().map((entry) => entry.runtime)).toEqual(IMPORT_RUNTIMES);
    expect(scanTargetHarnesses().map((entry) => entry.runtime)).toEqual(CATALOG_ONBOARDING_RUNTIMES);
    expect(canImportHarness(harnessForRuntime("codex")!)).toBe(false);
    expect(canScanHarness(harnessForRuntime("codex")!)).toBe(true);
    expect(catalogOnlyHarnesses()).toEqual([]);
    expect(cloudReferenceHarnesses()).toEqual([]);
  });
});
