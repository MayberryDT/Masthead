import { describe, expect, test } from "vitest";
import {
  deriveLiveStatus,
  summarizeConnectors,
  type HarnessConnectorDto
} from "../harnessConnectors.ts";

describe("deriveLiveStatus", () => {
  test("not installed when connector missing", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: false,
        missingEvents: ["plugin"],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({ live: "not_installed" });
  });

  test("needs_action when activation pending even if installed", () => {
    expect(
      deriveLiveStatus({
        installed: true,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: undefined,
        activation: { required: "trust_hooks", message: "Open Codex and run /hooks" },
        lastLiveEventAt: undefined
      })
    ).toEqual({
      live: "needs_action",
      actionRequired: "trust_hooks",
      actionMessage: "Open Codex and run /hooks"
    });
  });

  test("ready when installed and no activation pending", () => {
    expect(
      deriveLiveStatus({
        installed: true,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: "2026-07-08T12:00:00.000Z"
      })
    ).toEqual({ live: "ready" });
  });

  test("error wins over activation", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: "permission denied",
        activation: { required: "repair", message: "x" },
        lastLiveEventAt: undefined
      })
    ).toEqual({ live: "error", actionMessage: "permission denied" });
  });

  test("enable_plugin when config exists but only enabled is missing", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: true,
        missingEvents: ["enabled"],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({
      live: "needs_action",
      actionRequired: "enable_plugin",
      actionMessage: "Plugin files present but not enabled in host config."
    });
  });

  test("repair when not installed but config has mismatched or missing events", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: true,
        missingEvents: ["SessionStart"],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({
      live: "needs_action",
      actionRequired: "repair",
      actionMessage: "Live connector files need repair."
    });
  });

  test("not_installed when a shared config exists without a Masthead-managed connector", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: true,
        managedConnectorPresent: false,
        missingEvents: ["SessionStart"],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({ live: "not_installed" });
  });

  test("repair when installed with mismatched events", () => {
    expect(
      deriveLiveStatus({
        installed: true,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: ["SessionStart"],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({
      live: "needs_action",
      actionRequired: "repair",
      actionMessage: "Live connector files need repair."
    });
  });
});

describe("summarizeConnectors", () => {
  test("counts ready, needsAction, notInstalled, notFound, and error", () => {
    const connectors: HarnessConnectorDto[] = [
      baseConnector({ runtime: "codex", presence: "found", live: "ready" }),
      baseConnector({
        runtime: "claude_code",
        presence: "found",
        live: "needs_action",
        actionRequired: "trust_hooks"
      }),
      baseConnector({ runtime: "cursor", presence: "found", live: "not_installed" }),
      baseConnector({ runtime: "grok", presence: "not_found", live: "not_installed" }),
      baseConnector({
        runtime: "opencode",
        presence: "found",
        live: "error",
        actionMessage: "permission denied"
      })
    ];

    expect(summarizeConnectors(connectors)).toEqual({
      ready: 1,
      needsAction: 1,
      notInstalled: 2,
      notFound: 1,
      error: 1
    });
  });
});

function baseConnector(
  overrides: Partial<HarnessConnectorDto> &
    Pick<HarnessConnectorDto, "runtime" | "presence" | "live">
): HarnessConnectorDto {
  return {
    label: overrides.runtime,
    supportsActions: true,
    ...overrides
  };
}
