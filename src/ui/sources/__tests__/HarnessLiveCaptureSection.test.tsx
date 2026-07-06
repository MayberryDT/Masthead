// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { SettingsStateDto } from "../../../app/daemonClient";
import { HarnessLiveCaptureSection } from "../HarnessLiveCaptureSection";

describe("HarnessLiveCaptureSection", () => {
  test("renders OpenCode hook state and invokes hook actions from Sources", async () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<HarnessLiveCaptureSection hooks={hookSettings()} runtime="opencode" onAction={onAction} />);
    });

    expect(container.textContent).toContain("Live capture");
    expect(container.textContent).toContain("Installed");
    expect(container.textContent).toContain("/home/tyler/.opencode/config.toml");
    expect(container.textContent).toContain("http://127.0.0.1:17373/ingest");

    await act(async () => {
      buttonByText(container, "Test live connectors").click();
    });

    expect(onAction).toHaveBeenCalledWith("opencode", "test");
    await act(async () => root.unmount());
  });

  test("renders non-OpenCode live capture status and shared hook actions", async () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<HarnessLiveCaptureSection hooks={hookSettings()} runtime="cursor" onAction={onAction} />);
    });

    expect(container.textContent).toContain("Live capture");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Installed");
    expect(container.textContent).toContain("/home/tyler/.cursor/hooks.json");
    expect(container.textContent).toContain("http://127.0.0.1:17373/ingest?runtime=cursor");

    await act(async () => {
      buttonByText(container, "Install/repair live connectors").click();
    });

    expect(onAction).toHaveBeenCalledWith("cursor", "install");
    await act(async () => root.unmount());
  });
});

function hookSettings(): SettingsStateDto["hooks"] {
  return {
    command: "masthead hook",
    configExists: true,
    configPath: "/home/tyler/.opencode/config.toml",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    integrations: [
      {
        actionSurface: "settings",
        captureMode: "live_hook",
        configPath: "/home/tyler/.cursor/hooks.json",
        description: "Cursor live hooks",
        endpoint: "http://127.0.0.1:17373/ingest?runtime=cursor",
        label: "Cursor",
        runtime: "cursor",
        status: "installed",
        supportsActions: true
      },
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: "OpenCode live hooks",
        label: "OpenCode",
        runtime: "opencode",
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
