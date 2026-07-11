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
  test("blocks Continue while automatic discovery is running and reports the completed count", async () => {
    let finishDiscovery: (() => void) | undefined;
    const onDiscover = vi.fn(() => new Promise<void>((resolve) => { finishDiscovery = resolve; }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourcesConnectOnboarding open snapshot={sampleSnapshot()} onClose={noop} onSkip={noop} onDiscover={onDiscover} onEnable={noop} />);
    });

    expect(container.textContent).toContain("Looking for local sources");
    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Continue");
    expect(continueButton?.disabled).toBe(true);

    await act(async () => { finishDiscovery?.(); await Promise.resolve(); });
    expect(container.textContent).toContain("Discovered 2 sources");
    expect(continueButton?.disabled).toBe(false);
    await act(async () => root.unmount());
    container.remove();
  });

  test("connects selected harnesses in one step without redundant enable or empty activation screens", async () => {
    const onEnable = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourcesConnectOnboarding open snapshot={sampleSnapshot()} onClose={noop} onSkip={noop} onDiscover={noop} onEnable={onEnable} />);
      await Promise.resolve();
    });
    const firstContinue = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Continue");
    await act(async () => firstContinue?.click());
    expect(container.textContent).toContain("Connect selected");
    expect(container.textContent).not.toContain("Enable selected connectors");
    const connect = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Connect selected");
    await act(async () => { connect?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(onEnable).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Import local history");
    expect(container.textContent).not.toContain("No host activation remaining");
    await act(async () => root.unmount());
    container.remove();
  });

  test("starts durable imports and exits onboarding instead of waiting on reconciliation", async () => {
    const onClose = vi.fn();
    const onImportHistory = vi.fn(async () => ({ jobs: [{ importJobId: "job-1", importKind: "transcript", sourceId: "codex:one", status: "queued" }] }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourcesConnectOnboarding open snapshot={sampleSnapshot()} onClose={onClose} onSkip={noop} onDiscover={noop} onEnable={noop} onImportHistory={onImportHistory} />);
      await Promise.resolve();
    });
    for (const label of ["Continue", "Connect selected"]) {
      const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
      await act(async () => { button?.click(); await Promise.resolve(); await Promise.resolve(); });
    }
    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start history import");
    await act(async () => { start?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Import and reconciliation progress");
    await act(async () => root.unmount());
    container.remove();
  });

  test("shows the streamlined discovery, connect, background import, and ready stages", () => {
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

    expect(html).toContain("Capture local session history");
    expect(html).toContain("Looking for local sources");
    expect(html).toContain("Discover");
    expect(html).toContain("Connect");
    expect(html).toContain("Import history");
    expect(html).toContain("Ready");
    expect(html).not.toContain("Reconcile");
    expect(html).not.toContain("bulk transcript");
    expect(html).not.toContain("Check local sources");
  });

  test("SourcesPanel V2 renders the unified coordinator instead of the legacy setup wizard", () => {
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

    expect(html).toContain("Capture local session history");
    expect(html).toContain("Looking for local sources");
    expect(html).toContain("Discover");
    expect(html).toContain("Connect");
    expect(html).toContain("Import history");
    expect(html).not.toContain("Reconcile");
    expect(html).not.toContain("Set up sources");
    expect(html).not.toContain("Check local sources");
    expect(html).not.toContain("import selected session history");
  });

  test("auto-discovers on open and defaults found harnesses to selected", async () => {
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
      expect(container.textContent).toContain("Discovered 2 sources");

      const continueButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Continue"
      );
      expect(continueButton).toBeTruthy();
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.textContent).toContain("Connect found harnesses");
      expect(container.textContent).toContain("Codex");
      expect(container.textContent).toContain("Claude Code");
      expect(container.textContent).toContain("Import history");

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
        supportsActions: true,
        historyFound: true,
        historySessionCount: 1_568,
        historySourceUnitCount: 1_570
      },
      {
        runtime: "claude_code",
        label: "Claude Code",
        presence: "found",
        live: "not_installed",
        supportsActions: true,
        historyFound: true,
        historySessionCount: 18
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
