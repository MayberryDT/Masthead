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
  test("shows the five-stage live-connect and history-import coordinator", () => {
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
    expect(html).toContain("Find local harnesses and their history");
    expect(html).toContain("Discover");
    expect(html).toContain("Connect");
    expect(html).toContain("Import history");
    expect(html).toContain("Reconcile");
    expect(html).toContain("Ready");
    expect(html).toContain("live capture");
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
    expect(html).toContain("Find local harnesses and their history");
    expect(html).toContain("Discover");
    expect(html).toContain("Enable");
    expect(html).toContain("Import history");
    expect(html).toContain("Reconcile");
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
      expect(container.textContent).toContain("Find local harnesses and their history");

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
      expect(container.textContent).toContain("Import history");

      const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes.every((box) => box.checked)).toBe(true);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  test("defaults history capture to Everything and stays open on durable progress", async () => {
    const onImportHistory = vi.fn(async () => ({
      jobs: [
        {
          importJobId: "job-transcript",
          importKind: "transcript",
          sourceId: "codex-sessions",
          status: "queued"
        }
      ]
    }));
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
            imports={[]}
            onClose={noop}
            onSkip={noop}
            onDiscover={noop}
            onEnable={noop}
            onImportHistory={onImportHistory}
          />
        );
      });

      for (const label of ["Continue", "Continue", "Enable selected", "Continue"]) {
        const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
        expect(button, label).toBeTruthy();
        await act(async () => {
          button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await Promise.resolve();
        });
      }

      expect(container.textContent).toContain("Import local history");
      const everything = container.querySelector<HTMLInputElement>('input[value="everything"]');
      expect(everything?.checked).toBe(true);
      const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start history import");
      await act(async () => {
        start?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(onImportHistory).toHaveBeenCalledWith(expect.objectContaining({
        importMetadata: true,
        importScope: { includeChangedSinceCursor: true, mode: "transcript_full" },
        runtimes: ["codex", "claude_code"]
      }));
      expect(container.textContent).toContain("Import and reconciliation progress");
      expect(container.querySelector(".sources-onboarding-modal")).not.toBeNull();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  test("reopens directly on durable reconciliation progress after an app restart", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourcesConnectOnboarding
        open
        snapshot={sampleSnapshot()}
        busy={false}
        imports={[
          {
            importJobId: "job-resume",
            importKind: "transcript",
            sourceId: "codex-sessions",
            status: "running",
            discoveredCount: 1_570,
            processedCount: 400,
            importedCount: 400,
            queuedCount: 1_170,
            failureCount: 0,
            totalWorkUnits: 1_570,
            completedWorkUnits: 400,
            failedWorkUnits: 0,
            skippedWorkUnits: 0,
            scope: { includeChangedSinceCursor: true, mode: "transcript_full" },
            updatedAt: "2026-07-10T00:00:00.000Z"
          }
        ]}
        onClose={noop}
        onSkip={noop}
        onDiscover={noop}
        onEnable={noop}
      />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Import and reconciliation progress");
    expect(container.textContent).toContain("1170");
    expect(container.textContent).toContain("running");
    await act(async () => root.unmount());
    container.remove();
  });

  test("offers Import remaining after a bounded recent import defers units", async () => {
    const onImportHistory = vi.fn(async () => ({
      jobs: [{ importJobId: "job-full", importKind: "transcript", sourceId: "codex-sessions", status: "queued" }]
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourcesConnectOnboarding
        open
        snapshot={sampleSnapshot()}
        imports={[{
          importJobId: "job-recent",
          importKind: "transcript",
          sourceId: "codex-sessions",
          status: "succeeded",
          discoveredCount: 500,
          importedCount: 500,
          queuedCount: 0,
          failureCount: 0,
          skippedWorkUnits: 1_070,
          scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
          completionReport: {
            importJobId: "job-recent",
            runtime: "codex",
            status: "succeeded",
            generatedAt: "2026-07-10T00:00:00.000Z",
            sessionsDiscovered: 500,
            sessionsCreated: 500,
            sessionsUpdated: 0,
            transcriptsImported: 500,
            recordsImported: 500,
            recordsSkipped: 1_070,
            recordsFailed: 0,
            logbookSearchableSessions: 0,
            dossierReadySessions: 500,
            enrichedSessions: 0,
            mcpVisibleSessions: 500,
            failedUnits: 0,
            skippedUnits: 1_070,
            nextActions: ["import_full_archive"]
          },
          updatedAt: "2026-07-10T00:00:00.000Z"
        }]}
        onClose={noop}
        onSkip={noop}
        onDiscover={noop}
        onEnable={noop}
        onImportHistory={onImportHistory}
      />);
      await Promise.resolve();
    });

    const importRemaining = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Import remaining");
    expect(importRemaining).toBeTruthy();
    await act(async () => {
      importRemaining?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onImportHistory).toHaveBeenCalledWith(expect.objectContaining({
      importScope: { includeChangedSinceCursor: true, mode: "transcript_full" },
      queueEnrichment: false,
      runtimes: ["codex"]
    }));
    await act(async () => root.unmount());
    container.remove();
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
