import { describe, expect, test } from "vitest";
import { adapterCapabilityProfile, ADAPTER_CAPABILITY_PROFILES, canImportMetadata, canImportTranscripts } from "../capabilities.ts";
import { activeImportRuntimes } from "../harnessCatalog.ts";
import { RUNTIME_KINDS } from "../types.ts";

const SUPPORTED_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;

describe("adapter capabilities", () => {
  test("defines the focused supported runtime set in product order", () => {
    expect(RUNTIME_KINDS).toEqual(SUPPORTED_RUNTIMES);
  });

  test("exposes capability profiles for import runtimes plus live-capable Codex", () => {
    expect(ADAPTER_CAPABILITY_PROFILES.map((profile) => profile.runtime)).toEqual([...SUPPORTED_RUNTIMES, "codex"]);
    expect(ADAPTER_CAPABILITY_PROFILES.filter((profile) => profile.runtime !== "codex").map((profile) => profile.runtime)).toEqual(
      activeImportRuntimes()
    );
    expect(
      ADAPTER_CAPABILITY_PROFILES.filter((profile) => profile.runtime !== "codex").every((profile) => profile.lifecycle === "active")
    ).toBe(true);
    expect(
      ADAPTER_CAPABILITY_PROFILES.filter((profile) => profile.runtime !== "codex").every(
        (profile) => profile.runtimeStatus === "import_adapter"
      )
    ).toBe(true);
  });

  test("marks Codex as live-capable without inventing Sources bulk import", () => {
    expect(adapterCapabilityProfile("codex")).toMatchObject({
      label: "Codex",
      lifecycle: "scan_target",
      runtime: "codex",
      runtimeStatus: "scan_target",
      supportsLiveWatch: true,
      supportsMetadataImport: false,
      supportsTranscriptImport: false
    });
  });

  test("marks Grok as a transcript-capable live import adapter", () => {
    expect(adapterCapabilityProfile("grok")).toMatchObject({
      label: "Grok Build",
      lifecycle: "active",
      maturity: "transcript",
      runtime: "grok",
      runtimeStatus: "import_adapter",
      sourceKinds: ["hook", "jsonl"],
      supportsLiveWatch: true,
      supportsMetadataImport: true,
      supportsTranscriptImport: true
    });
  });

  test("keeps OMP importable after schema verification", () => {
    const profile = adapterCapabilityProfile("omp");

    expect(profile).toMatchObject({
      lifecycle: "active",
      maturity: "transcript",
      runtime: "omp",
      runtimeStatus: "import_adapter",
      supportsMetadataImport: true,
      supportsTranscriptImport: true
    });
    expect(canImportMetadata(profile)).toBe(true);
    expect(canImportTranscripts(profile)).toBe(true);
  });
});
