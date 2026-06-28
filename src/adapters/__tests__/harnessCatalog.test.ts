import { describe, expect, test } from "vitest";
import { advancedHarnesses, cloudReferenceHarnesses, harnessForRuntime, onboardingHarnesses } from "../harnessCatalog.ts";

describe("harness catalog", () => {
  test("includes the required onboarding harnesses", () => {
    const runtimes = onboardingHarnesses().map((entry) => entry.runtime);
    expect(runtimes).toEqual(
      expect.arrayContaining([
        "codex",
        "cursor",
        "claude_code",
        "antigravity",
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
        "ibm_bob"
      ])
    );
  });

  test("represents OMP as detector-only until local storage schema is verified", () => {
    const omp = harnessForRuntime("omp");
    expect(omp?.label).toBe("Oh My Pi");
    expect(omp?.supportLevel).toBe("detector_only");
    expect(omp?.aliases).toEqual(expect.arrayContaining(["OMP", "oh-my-pi", "pi-coding-agent"]));
    expect(omp?.knownCandidatePaths).toEqual(expect.arrayContaining(["~/.omp", "~/.oh-my-pi"]));
  });

  test("keeps cloud-first tools out of onboarding scans", () => {
    const onboardingRuntimes = onboardingHarnesses().map((entry) => entry.runtime);
    expect(onboardingRuntimes).not.toContain("devin");
    expect(onboardingRuntimes).not.toContain("jules");
    expect(cloudReferenceHarnesses().map((entry) => entry.runtime)).toEqual(expect.arrayContaining(["devin", "jules"]));
  });

  test("keeps legacy Gemini CLI hidden from default onboarding", () => {
    expect(onboardingHarnesses().map((entry) => entry.runtime)).not.toContain("gemini_cli");
    expect(advancedHarnesses().map((entry) => entry.runtime)).not.toContain("gemini_cli");
    expect(harnessForRuntime("gemini_cli")?.supportLevel).toBe("legacy");
  });
});
