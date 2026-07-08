// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HarnessConnectorsSnapshotDto } from "../../../shared/harnessConnectors";
import { SourcesPanel } from "../../SourcesPanel";
import { SourcesConnectOnboarding } from "../SourcesConnectOnboarding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

describe("SourcesConnectOnboarding", () => {
  test("shows Discover/Enable language without Import jobs or bulk transcript import", () => {
    const html = renderToStaticMarkup(
      <SourcesConnectOnboarding
        open
        snapshot={sampleSnapshot()}
        busy={false}
        onClose={noop}
        onSkip={noop}
        onDiscover={noop}
        onEnable={noop}
        onConfirmActivation={noop}
      />
    );

    expect(html).toContain("Connect live harnesses");
    expect(html).toContain("Wire local harnesses for live capture");
    expect(html).toContain("Discover");
    expect(html).toContain("Enable");
    expect(html).toContain("Activate");
    expect(html).toContain("live capture");
    expect(html).not.toContain("Import jobs");
    expect(html).not.toContain("bulk transcript");
    expect(html).not.toContain("Import history");
    expect(html).not.toContain("metadata import");
    expect(html).not.toContain("Start setup");
    expect(html).not.toContain("Check local sources");
  });

  test("SourcesPanel V2 renders connect onboarding instead of import-centric setup", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        sources={[]}
        busy={false}
        connectorsSnapshot={sampleSnapshot()}
        onboardingOpen
        onDiscoverConnectors={noop}
        onEnableConnector={noop}
        onConfirmConnectorActivation={noop}
        onCloseOnboarding={noop}
        onSkipOnboarding={noop}
        onExcludePath={noop}
        onRefresh={noop}
      />
    );

    expect(html).toContain("Connect live harnesses");
    expect(html).toContain("Wire local harnesses for live capture");
    expect(html).toContain("Discover");
    expect(html).toContain("Enable");
    expect(html).not.toContain("Import jobs");
    expect(html).not.toContain("Set up sources");
    expect(html).not.toContain("Check local sources");
    expect(html).not.toContain("import selected session history");
  });

  test("auto-discovers on open and defaults selected found harnesses on select step", async () => {
    const onDiscover = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    try {
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <SourcesConnectOnboarding
            open
            snapshot={sampleSnapshot()}
            busy={false}
            onClose={noop}
            onSkip={noop}
            onDiscover={onDiscover}
            onEnable={noop}
          />
        );
      });

      expect(onDiscover).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Wire local harnesses for live capture");

      const continueButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Continue"
      );
      expect(continueButton).toBeTruthy();
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.textContent).toContain("Select found harnesses");
      expect(container.textContent).toContain("Codex");
      expect(container.textContent).toContain("Claude Code");
      expect(container.textContent).not.toContain("Import jobs");

      const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes.every((box) => box.checked)).toBe(true);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

function sampleSnapshot(): HarnessConnectorsSnapshotDto {
  return {
    generatedAt: "2026-07-08T12:00:00.000Z",
    summary: {
      ready: 0,
      needsAction: 1,
      notInstalled: 1,
      notFound: 0,
      error: 0
    },
    connectors: [
      {
        runtime: "codex",
        label: "Codex",
        presence: "found",
        live: "needs_action",
        actionRequired: "trust_hooks",
        actionMessage: "Trust hooks in Codex (/hooks) after install.",
        supportsActions: true
      },
      {
        runtime: "claude_code",
        label: "Claude Code",
        presence: "found",
        live: "not_installed",
        supportsActions: true
      },
      {
        runtime: "cursor",
        label: "Cursor",
        presence: "not_found",
        live: "not_installed",
        supportsActions: true
      }
    ]
  };
}
