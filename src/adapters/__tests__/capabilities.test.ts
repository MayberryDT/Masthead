import { describe, expect, test } from "vitest";
import { adapterCapabilityProfile, ADAPTER_CAPABILITY_PROFILES, canImportMetadata, canImportTranscripts } from "../capabilities.ts";
import { activeImportRuntimes } from "../harnessCatalog.ts";
import { RUNTIME_KINDS } from "../types.ts";

describe("adapter capabilities", () => {
  test("defines the full catalog runtime set", () => {
    expect(RUNTIME_KINDS).toEqual([
      "codex",
      "cursor",
      "claude_code",
      "opencode",
      "aider",
      "openclaw",
      "hermes",
      "pi",
      "omp",
      "cline",
      "roo_code",
      "kilo_code",
      "continue_dev",
      "openhands",
      "github_copilot",
      "windsurf",
      "zed_ai",
      "amazon_q",
      "sourcegraph_amp",
      "jetbrains_ai",
      "qodo",
      "tabnine",
      "ibm_bob",
      "devin",
      "jules",
      "gemini_cli",
      "crush"
    ]);
  });

  test("marks all required scan adapters as active capability profiles", () => {
    expect(adapterCapabilityProfile("codex")).toMatchObject({
      label: "Codex",
      lifecycle: "active",
      maturity: "full",
      runtime: "codex",
      sourceKinds: ["hook", "jsonl"],
      supportsMetadataImport: true,
      supportsTranscriptImport: true
    });

    const activeProfiles = ADAPTER_CAPABILITY_PROFILES.filter((profile) => profile.lifecycle === "active");
    expect(activeProfiles.map((profile) => profile.runtime)).toEqual(activeImportRuntimes());
  });

  test("marks OMP as importable after schema verification", () => {
    expect(adapterCapabilityProfile("omp")).toMatchObject({
      lifecycle: "active",
      maturity: "transcript",
      runtime: "omp",
      runtimeStatus: "import_adapter",
      supportsMetadataImport: true,
      supportsTranscriptImport: true
    });
    expect(canImportMetadata(adapterCapabilityProfile("omp"))).toBe(true);
    expect(canImportTranscripts(adapterCapabilityProfile("omp"))).toBe(true);
    expect(adapterCapabilityProfile("devin")).toMatchObject({
      lifecycle: "cloud_reference",
      maturity: "planned",
      runtimeStatus: "cloud_reference",
      supportsMcpExposure: false
    });
  });

  test("keeps Gemini CLI as legacy planned only", () => {
    expect(adapterCapabilityProfile("gemini_cli")).toMatchObject({
      lifecycle: "legacy_planned",
      maturity: "planned",
      runtime: "gemini_cli",
      supportsMetadataImport: false,
      supportsTranscriptImport: false
    });
  });
});
