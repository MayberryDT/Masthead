import { describe, expect, test } from "vitest";
import { adapterCapabilityProfile, ADAPTER_CAPABILITY_PROFILES } from "../capabilities.ts";
import { RUNTIME_KINDS } from "../types.ts";

describe("adapter capabilities", () => {
  test("defines the supported runtime set without Crush", () => {
    expect(RUNTIME_KINDS).toEqual([
      "codex",
      "cursor",
      "claude_code",
      "antigravity",
      "opencode",
      "aider",
      "openclaw",
      "hermes",
      "pi",
      "gemini_cli"
    ]);
    expect(RUNTIME_KINDS).not.toContain("crush");
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
    expect(activeProfiles.map((profile) => profile.runtime)).toEqual([
      "codex",
      "cursor",
      "claude_code",
      "antigravity",
      "opencode",
      "aider",
      "openclaw",
      "hermes",
      "pi"
    ]);
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
