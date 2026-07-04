// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { CodexHookSettingsDto } from "../../../app/daemonClient";
import { HarnessLiveCaptureSection } from "../HarnessLiveCaptureSection";

describe("HarnessLiveCaptureSection", () => {
  test("renders Codex hook state and invokes hook actions from Sources", async () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<HarnessLiveCaptureSection hooks={hookSettings()} runtime="codex" onAction={onAction} />);
    });

    expect(container.textContent).toContain("Live capture");
    expect(container.textContent).toContain("Installed");
    expect(container.textContent).toContain("/home/tyler/.codex/config.toml");
    expect(container.textContent).toContain("http://127.0.0.1:17373/ingest");

    await act(async () => {
      buttonByText(container, "Test hooks").click();
    });

    expect(onAction).toHaveBeenCalledWith("test");
    await act(async () => root.unmount());
  });
});

function hookSettings(): CodexHookSettingsDto {
  return {
    command: "masthead hook",
    configExists: true,
    configPath: "/home/tyler/.codex/config.toml",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    integrations: [
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: "Codex live hooks",
        label: "Codex",
        runtime: "codex",
        status: "installed",
        supportsActions: true
      }
    ],
    lastEventAt: "2026-07-04T12:00:00.000Z",
    lastTest: {
      message: "ok",
      status: "passed",
      testedAt: "2026-07-04T12:01:00.000Z"
    },
    missingEvents: [],
    mismatchedEvents: []
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match as HTMLButtonElement;
}
