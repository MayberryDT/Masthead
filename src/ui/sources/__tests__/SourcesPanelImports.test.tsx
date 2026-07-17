// @vitest-environment happy-dom

import { act, useState } from "react";
import { readFileSync } from "node:fs";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, ImportJob, SourcesImportPreview } from "../../../app/daemonClient";
import type { SourcesOnboardingScanDto, SourcesSetupDto } from "../../../shared/sourcesSetup";
import type { SourceScanResult } from "../../../daemon/sources/sourceScanService";
import { scanResultToOnboardingScan } from "../../../daemon/sources/sourceSetupService";
import { SourcesPanel } from "../../SourcesPanel";
import { WorkbenchPanel } from "../../workbench/WorkbenchPanel";
import type { ImportCompletionReportDto } from "../../../shared/sourceImport";

const noop = () => undefined;

describe("SourcesPanel import controls", () => {
  test("closing a pending exact receipt invalidates its request while a later intent still loads", async () => {
    document.documentElement.style.setProperty("--modal-close-dur", "1ms");
    const firstLoad = deferred<ImportCompletionReportDto | undefined>();
    const onLoadImportReport = vi.fn((importJobId: string) =>
      importJobId === "job-first"
        ? firstLoad.promise
        : Promise.resolve(completionReport("job-later", "cursor", 2))
    );
    const onConsumed = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<AsyncReceiptHarness onConsumed={onConsumed} onLoadImportReport={onLoadImportReport} />);
    });
    expect(container.textContent).toContain("Loading import receipt job-first");

    await act(async () => {
      buttonByText(container, "Close").click();
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });
    expect(onConsumed).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstLoad.resolve(completionReport("job-first", "opencode", 9));
      await firstLoad.promise;
    });

    expect(container.querySelector('[aria-label="Import receipt"]')).toBeNull();
    expect(container.textContent).not.toContain("9 sessions need import repair");

    await act(async () => buttonByText(container, "Open later receipt").click());
    expect(container.querySelector('[aria-label="cursor import report"]')).not.toBeNull();
    expect(container.textContent).toContain("2 sessions need import repair");

    document.documentElement.style.removeProperty("--modal-close-dur");
    await act(async () => root.unmount());
  });

  test("keeps an exact receipt load error visible before consuming the intent", async () => {
    const onConsumed = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          importReceiptIntent={{ importJobId: "job-missing" }}
          imports={[]}
          onExcludePath={noop}
          onImportReceiptIntentConsumed={onConsumed}
          onLoadImportReport={async () => { throw new Error("receipt endpoint unavailable"); }}
          onRefresh={noop}
          sources={[]}
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("job-missing");
    expect(container.textContent).toContain("receipt endpoint unavailable");
    expect(onConsumed).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  test("opens the exact terminal receipt requested from Workbench and consumes the navigation intent", async () => {
    const reports = [completionReport("job-opencode", "opencode", 12), completionReport("job-cursor", "cursor", 3)];
    const imports = reports.map((report) => importJob({
      completionReport: report,
      importJobId: report.importJobId,
      sourceId: `${report.runtime}:history`,
      status: "succeeded_with_issues"
    }));
    const visibleImports = [imports[0]];
    const onLoadImportReport = vi.fn(async (importJobId: string) => reports.find((report) => report.importJobId === importJobId));
    const onPreviewImportRepair = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ReceiptNavigationHarness
          importJobIds={imports.map((job) => job.importJobId)}
          onLoadImportReport={onLoadImportReport}
          onPreviewImportRepair={onPreviewImportRepair}
          visibleImports={visibleImports}
        />
      );
    });
    await act(async () => {
      const buttons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Open import receipt");
      (buttons[1] as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("job-cursor");
    expect(container.textContent).toContain("3 sessions need import repair");
    expect(container.textContent).not.toContain("12 sessions need import repair");
    expect(container.querySelector('[aria-label="cursor import report"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="opencode import report"]')).toBeNull();
    expect(onLoadImportReport).toHaveBeenCalledWith("job-cursor");
    await act(async () => buttonByText(container, "Preview import repair").click());
    expect(onPreviewImportRepair).toHaveBeenCalledWith("job-cursor");
    await act(async () => root.unmount());
  });

  test("opens import history modal from the connected-source dashboard", async () => {
    const onPreviewImport = vi.fn(async () => []);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onPreviewImport={onPreviewImport}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Import data").click();
    });

    expect(container.textContent).toContain("Import history");
    expect(container.textContent).toContain("Last 30 days");

    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Preview")).toBe(false);
    expect(onPreviewImport).toHaveBeenCalledWith(expect.objectContaining({ runtimes: ["opencode"] }));
    await act(async () => root.unmount());
  });

  test("loads preview-backed harness choices as soon as the import modal opens", async () => {
    const setup = connectedSetup();
    setup.advanced.adapters = [];
    const onPreviewImport = vi.fn(async () => [previewForRuntime("opencode", 500, 912, 5_614_987_264, 742), previewForRuntime("cursor", 2, 0, 1_153_433, 28)]);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onPreviewImport={onPreviewImport}
          onRefresh={noop}
          setup={setup}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Import data").click();
      await Promise.resolve();
    });

    expect(onPreviewImport).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("2 harnesses");
    expect(container.textContent).toContain("2 selected");
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Sessions to import");
    expect(container.textContent).toContain("742");
    expect(container.textContent).toContain("28");
    expect(container.textContent).not.toContain("Coding harness");
    expect(container.textContent).not.toContain("OpenCode local hook");
    expect(container.textContent).not.toContain("No importable harnesses found.");
    expect(buttonByText(container, "Import data").disabled).toBe(false);
    await act(async () => root.unmount());
  });

  test("refresh detection does not queue imports from the connected dashboard", async () => {
    const onRefresh = vi.fn();
    const onSyncSources = vi.fn();
    const onRunSetup = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={onRefresh}
          onRunSetup={onRunSetup}
          onSyncSources={onSyncSources}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Refresh detection").click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSyncSources).not.toHaveBeenCalled();
    expect(onRunSetup).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Repair missing data");
    await act(async () => root.unmount());
  });

  test("read-only mode disables write actions without teaching copy", async () => {
    const onRefresh = vi.fn();
    const onRunSetup = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={onRefresh}
          onRunSetup={onRunSetup}
          readOnly
          sources={[]}
        />
      );
    });

    expect(container.textContent).not.toContain("Read-only bridge");
    expect(container.textContent).not.toContain("Start the writable Masthead collector");
    expect(container.textContent).not.toContain("Source inventory is loaded");
    expect(container.textContent).not.toContain("History import starts only from Import history");
    expect(buttonByText(container, "Import data").disabled).toBe(true);
    expect(buttonByText(container, "Refresh detection").disabled).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onRunSetup).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("keeps refresh and import facts as compact toolbar facts", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[importJob({ heartbeatAt: "2026-06-25T12:00:00.000Z", stage: "transcript", status: "running" })]}
          lastRefreshAt="2026-06-25T12:01:00.000Z"
          onExcludePath={noop}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    expect(container.querySelector(".sources-status-band")).toBeNull();
    const toolbarFacts = container.querySelector(".sources-toolbar-facts");
    expect(toolbarFacts?.textContent).toContain("Last refresh");
    expect(toolbarFacts?.textContent).toContain("Active import");
    expect(toolbarFacts?.textContent).not.toContain("heartbeat");
    expect(toolbarFacts?.querySelector("small")).toBeNull();
    expect(toolbarFacts?.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).not.toContain("Source inventory is loaded");
    expect(container.textContent).not.toContain("History import starts only from Import history");
    await act(async () => root.unmount());
  });

  test("renders active import progress in the production Sources panel", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[importJob({ progressCurrent: 2, progressTotal: 5, stage: "metadata", status: "running" })]}
          onExcludePath={noop}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    const activeStrip = container.querySelector(".sources-active-imports");
    expect(activeStrip).not.toBeNull();
    expect(activeStrip?.textContent).toContain("metadata");
    expect(activeStrip?.textContent).toContain("40%");
    expect(activeStrip?.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("2");
    await act(async () => root.unmount());
  });

  test("keeps terminal import jobs out of the active progress strip", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          imports={[importJob({ processedCount: 10, queuedCount: 0, status: "succeeded" })]}
          onExcludePath={noop}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    expect(container.querySelector(".sources-active-imports")).toBeNull();
    expect(container.textContent).toContain("metadata");
    await act(async () => root.unmount());
  });

  test("shows runtime import filter copy and clears back to unfiltered imports", async () => {
    const onClearImportJobsFilter = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[opencodeAdapter()]}
          busy={false}
          importFilterRuntime="claude_code"
          imports={[importJob({ sourceId: "claude-code-sessions", status: "succeeded" })]}
          onClearImportJobsFilter={onClearImportJobsFilter}
          onExcludePath={noop}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    expect(container.textContent).toContain("Import activity — Claude Code only");

    await act(async () => {
      buttonByText(container, "Clear import filter").click();
    });

    expect(onClearImportJobsFilter).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  test("view diagnostics reveals raw adapter errors outside the default inventory", async () => {
    const setup = connectedSetup();
    setup.advanced.adapters = [
      {
        ...opencodeAdapter(),
        diagnostics: [
          {
            code: "sqlite_locked",
            message: "SQLite database is locked",
            path: "/home/tyler/.config/harness/state.vscdb",
            severity: "warning"
          }
        ],
        state: "degraded"
      }
    ];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} setup={setup} sources={[]} />);
    });

    expect(container.textContent).not.toContain("SQLite database is locked");

    await act(async () => {
      buttonByText(container, "View diagnostics").click();
    });

    expect(container.textContent).toContain("Diagnostics");
    expect(container.textContent).toContain("SQLite database is locked");
    expect(container.textContent).toContain("/home/tyler/.config/harness/state.vscdb");
    await act(async () => root.unmount());
  });

  test("polls while imports are queued or running and stops after completion", async () => {
    vi.useFakeTimers();
    const onPollImports = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[opencodeAdapter()]} busy={false} imports={[importJob({ status: "running" })]} onExcludePath={noop} onPollImports={onPollImports} onRefresh={noop} sources={[]} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onPollImports).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<SourcesPanel adapters={[opencodeAdapter()]} busy={false} imports={[importJob({ status: "succeeded" })]} onExcludePath={noop} onPollImports={onPollImports} onRefresh={noop} sources={[]} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onPollImports).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  test("connect opens setup onboarding from an empty setup state", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} setup={emptySetup()} sources={[]} />);
    });

    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });

    expect(container.textContent).toContain("Set up sources");
    expect(container.textContent).toContain("Check local sources");
    expect(container.textContent).toContain("Live capture can start without importing old sessions.");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Claude Code");
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Grok Build");
    expect(container.textContent).toContain("Hermes");
    expect(container.textContent).toContain("Pi");
    expect(container.textContent).toContain("Oh My Pi");
    expect(container.textContent).not.toContain("Legacy history");
    await act(async () => root.unmount());
  });

  test("controlled setup action requests the app-owned onboarding state", async () => {
    const onOpenOnboarding = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[detectedOpenCodeAdapter(), notDetectedHermesAdapter()]}
          busy={false}
          imports={[]}
          onboardingOpen={false}
          onCloseOnboarding={noop}
          onExcludePath={noop}
          onOpenOnboarding={onOpenOnboarding}
          onRefresh={noop}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });

    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  test("detected-only setup keeps onboarding available and hides the adapter catalog", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={noop}
          setup={detectedOnlySetup()}
          sources={[]}
        />
      );
    });

    expect(container.textContent).toContain("No sources set up");
    expect(container.textContent).toContain("Set up sources");
    expect(container.textContent).not.toContain("Import data");
    expect(container.textContent).not.toContain("ADAPTERS");
    expect(container.querySelector(".adapter-list")).toBeNull();
    expect(container.querySelector(".connected-source-list")).toBeNull();
    expect(container.textContent).not.toContain("Hermes");

    await act(async () => {
      buttonByText(container, "Set up sources").click();
      await Promise.resolve();
    });

    expect(container.querySelector(".sources-onboarding-modal")).not.toBeNull();
    expect(container.textContent).toContain("Sources setup");
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("742 sessions");
    expect(container.textContent).not.toContain("Legacy history");
    await act(async () => root.unmount());
  });

  test("first-run onboarding uses the command console spine layout without premature review", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onboardingOpen
          onCloseOnboarding={noop}
          onExcludePath={noop}
          onRefresh={noop}
          onSkipOnboarding={noop}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });

    expect(container.querySelector(".sources-onboarding-command-layout")).not.toBeNull();
    expect(container.querySelector(".sources-onboarding-step-rail")).not.toBeNull();
    expect(container.querySelector(".sources-onboarding-workspace")).not.toBeNull();
    expect(container.querySelector(".sources-onboarding-review-rail")).toBeNull();
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("Detect");
    expect(container.textContent).toContain("Configure");
    expect(container.textContent).toContain("Provider");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).not.toContain("Review before start");
    expect(container.textContent).not.toContain("On Dossier open");
    await act(async () => root.unmount());
  });

  test("first-run onboarding shows setup review only on the apply step", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container);

    expect(container.textContent).not.toContain("Review before start");

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });

    expect(container.textContent).toContain("Review setup");
    expect(container.textContent).toContain("Sources");
    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Last 30 days");
    expect(container.textContent).toContain("Live capture");
    expect(container.textContent).toContain("Required");
    expect(container.textContent).toContain("Transcripts");
    expect(container.textContent).toContain("When opened");
    expect(container.textContent).not.toContain("Metadata only");
    expect(container.textContent).not.toContain("On Dossier open");
    await act(async () => root.unmount());
  });

  test("scan step renders importable setup sources only", async () => {
    const onScanSetup = vi.fn(async () => scanDto());
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={noop}
          onScanSetup={onScanSetup}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });
    await act(async () => {
      buttonByText(container, "Check local sources").click();
    });

    expect(onScanSetup).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("742 sessions");
    expect(container.textContent).toContain("1 location");
    expect(container.textContent).not.toContain("Legacy history");
    await act(async () => root.unmount());
  });

  test("scan step groups multiple importable sources into one card per detected harness", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const onScanSetup = vi.fn(async () => multiSourceScanDto());
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={noop}
          onRunSetup={onRunSetup}
          onScanSetup={onScanSetup}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });
    await act(async () => {
      buttonByText(container, "Check local sources").click();
    });

    expect(container.querySelectorAll(".source-select-card")).toHaveLength(2);
    expect(container.querySelectorAll(".source-select-card .mono-label")).toHaveLength(0);
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).not.toContain("opencodeOpenCode");
    expect(container.textContent).not.toContain("cursorCursor");
    expect(container.textContent).toContain("2 locations");
    expect(container.textContent).toContain("1 location");
    expect(container.textContent).toContain("/home/tyler/.opencode");
    expect(container.textContent).toContain("/home/tyler/.config/Cursor");
    expect(container.textContent).not.toContain("session_index.jsonl");
    expect(container.textContent).not.toContain("2026-07-04.jsonl");
    expect(container.textContent).not.toContain("state.vscdb");
    expect(container.textContent).not.toContain("globalStorage");
    expect(container.textContent).not.toContain("OpenCode archived sessions");

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledTimes(2);
    expect(onRunSetup).toHaveBeenNthCalledWith(1, expect.objectContaining({
      importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      runtimes: ["opencode"],
      sourceIds: ["opencode-sessions", "opencode-archive"]
    }));
    expect(onRunSetup).toHaveBeenNthCalledWith(2, expect.objectContaining({
      importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      runtimes: ["cursor"],
      sourceIds: ["cursor-sessions"]
    }));
    await act(async () => root.unmount());
  });

  test("real setup scan mapping makes discovered OpenCode sources selectable", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const onScanSetup = vi.fn(async () => scanResultToOnboardingScan(realisticScanResult()));
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={noop}
          onRunSetup={onRunSetup}
          onScanSetup={onScanSetup}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });
    await act(async () => {
      buttonByText(container, "Check local sources").click();
    });

    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("/home/tyler/.opencode");
    expect(container.textContent).not.toContain("/home/tyler/.opencode/sessions");
    expect(container.textContent).toContain("Oh My Pi");
    expect(container.textContent).toContain("/home/tyler/.omp");
    expect(container.textContent).not.toContain("/home/tyler/.omp/agent/sessions");
    expect(container.textContent).not.toContain("No importable local sources found yet");

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledTimes(2);
    expect(onRunSetup).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        enrichmentMode: "skip",
        importMetadata: true,
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        queueEnrichment: false,
        runtimes: ["opencode"],
        sourceIds: ["opencode-sessions"]
      })
    );
    expect(onRunSetup).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        enrichmentMode: "skip",
        importMetadata: true,
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        queueEnrichment: false,
        runtimes: ["omp"],
        sourceIds: ["omp-sessions"]
      })
    );
    expect(container.querySelector(".sources-onboarding-modal")).toBeNull();
    await act(async () => root.unmount());
  });

  test("setup choices only ask for session history source and import range", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onRefresh={noop}
          onScanSetup={async () => scanResultToOnboardingScan(realisticScanResult())}
          setup={emptySetup()}
          sources={[]}
        />
      );
    });
    await act(async () => {
      buttonByText(container, "Set up sources").click();
    });
    await act(async () => {
      buttonByText(container, "Check local sources").click();
    });

    await act(async () => {
      buttonByText(container, "Continue").click();
    });

    const activeStep = container.querySelector(".sources-onboarding-step-content") as HTMLElement;
    expect(activeStep.textContent).toContain("Setup choices");
    expect(activeStep.textContent).toContain("Which harnesses' session history do you want to import?");
    expect(activeStep.textContent).toContain("Last 30 days");
    expect(activeStep.textContent).toContain("Everything");
    expect(activeStep.textContent).toContain("OpenCode");
    expect(activeStep.textContent).toContain("Oh My Pi");
    expect(activeStep.querySelectorAll(".sources-history-harness-card")).toHaveLength(2);
    expect(activeStep.textContent).not.toContain("Metadata only");
    expect(activeStep.textContent).not.toContain("Live capture");
    expect(activeStep.textContent).not.toContain("Transcripts hydrate when a Dossier opens");
    expect(activeStep.textContent).not.toContain("Enrich Dossiers when opened");
    expect(activeStep.textContent).not.toContain("Include OpenCode live capture setup");
    expect(activeStep.textContent).not.toContain("Not wired yet");
    expect(activeStep.querySelectorAll(".harness-live-capture")).toHaveLength(0);
    expect(activeStep.textContent).not.toContain("Transcript approval");
    await act(async () => root.unmount());
  });

  test("enrichment step reuses provider configuration without queuing library enrichment", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container);

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });

    expect(container.textContent).toContain("Enrichment");
    expect(container.textContent).toContain("Configure provider settings now if you want.");
    expect(container.textContent).toContain("Remote enrichment");
    expect(container.textContent).toContain("Save provider");
    expect(
      [...container.querySelectorAll(".settings-section-head .mono-label")].map((node) => node.textContent)
    ).toEqual(["Enrichment", "Enrichment"]);
    expect(container.querySelectorAll(".settings-section-head > div")).toHaveLength(2);

    const css = readFileSync("src/styles/settings.css", "utf8");
    expect(css).toMatch(/\.settings-section\s*\{[\s\S]*gap: 10px;[\s\S]*overflow: hidden;[\s\S]*border-radius: 5px;[\s\S]*background: #081d2b;[\s\S]*padding: 14px;/);
    expect(css).toMatch(/\.settings-section::before\s*\{[\s\S]*height: 2px;[\s\S]*background: var\(--blue, #2ea7ff\);/);
    expect(css).toMatch(/\.settings-section-head h2\s*\{[\s\S]*margin: 2px 0 0;/);
    expect(css).toMatch(/\.settings-section-head \.mono-label\s*\{[\s\S]*margin: 0;[\s\S]*text-transform: uppercase;/);
    expect(css).toMatch(/\.settings-section-body\s*\{[\s\S]*display: grid;\s*\}/);
    expect(css).toMatch(/\.settings-row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*align-items: start;[\s\S]*border-bottom: 1px solid rgba\(194, 221, 241, 0\.08\);[\s\S]*padding: 8px 0;/);
    expect(css).toMatch(/\.settings-panel \.settings-spine-sections \.settings-row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(180px, 360px\);/);
    expect(css).toMatch(/\.settings-provider-field input\s*\{[\s\S]*min-height: 36px;/);
    expect(css).toContain(".settings-provider-field input:focus {");
    expect(css).not.toContain(".settings-provider-field input:focus-visible {");
    await act(async () => root.unmount());
  });

  test("build invokes setup run callback with selected source and choices", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container, { onRunSetup });

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledWith(expect.objectContaining({
      enrichmentMode: "skip",
      importMetadata: true,
      importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      queueEnrichment: false,
      runtimes: ["opencode"],
      sourceIds: ["opencode-sessions"]
    }));
    await act(async () => root.unmount());
  });

  test("connected dashboard keeps import jobs visible without advanced diagnostics", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[]} busy={false} imports={[importJob({ status: "succeeded" })]} onExcludePath={noop} onRefresh={noop} setup={connectedSetup()} sources={[]} />);
    });

    expect(container.textContent).toContain("Import activity");
    expect(container.textContent).toContain("metadata");
    expect(container.textContent).not.toContain("Advanced diagnostics");
    expect(container.textContent).not.toContain("Adapter inventory");
    expect(container.textContent).not.toContain("harnesses in catalog");
    await act(async () => root.unmount());
  });

  test("setup automatically installs required live capture and imports selected history", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const onRuntimeHookAction = vi.fn(async () => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container, { onRuntimeHookAction, onRunSetup });

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start setup").click();
    });

    expect(onRuntimeHookAction).toHaveBeenCalledWith("opencode", "install");
    expect(onRunSetup).toHaveBeenCalledWith(expect.objectContaining({
      importMetadata: true,
      importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      queueEnrichment: false,
      runtimes: ["opencode"],
      sourceIds: ["opencode-sessions"]
    }));
    await act(async () => root.unmount());
  });

  test("start setup closes onboarding so Sources shows import progress", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container, { onRunSetup });

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start setup").click();
    });

    expect(onRunSetup).toHaveBeenCalled();
    expect(container.querySelector(".sources-onboarding-modal")).toBeNull();
    expect(container.textContent).not.toContain("Session library build started");
    expect(container.textContent).not.toContain("Setup needs attention");
    await act(async () => root.unmount());
  });
});

function opencodeAdapter(): AdapterStatus {
  return {
    runtime: "opencode",
    name: "OpenCode",
    state: "connected",
    discoveredSessions: 742,
    importedSessions: 120,
    policies: {
      metadataImport: true,
      transcriptImport: true,
      enrichment: false,
      mcpAccess: true
    },
    sourceLocations: [
      {
        confidence: "authoritative",
        failures: 0,
        importedCount: 120,
        path: "/home/tyler/.opencode/session_index.jsonl",
        queuedCount: 0,
        runtime: "opencode",
        sessionCount: 742,
        sourceId: "opencode-sessions",
        sourceKind: "jsonl"
      }
    ]
  };
}

function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    discoveredCount: 10,
    failureCount: 0,
    importJobId: "job-1",
    importedCount: 3,
    importKind: "metadata",
    queuedCount: 7,
    sourceId: "opencode-sessions",
    status: "running",
    updatedAt: "2026-06-25T12:00:00.000Z",
    ...overrides
  };
}

function ReceiptNavigationHarness({ importJobIds, onLoadImportReport, onPreviewImportRepair, visibleImports }: {
  importJobIds: string[];
  onLoadImportReport: (importJobId: string) => Promise<ImportCompletionReportDto | undefined>;
  onPreviewImportRepair: (importJobId: string) => void;
  visibleImports: ImportJob[];
}) {
  const [surface, setSurface] = useState<"workbench" | "sources">("workbench");
  const [receiptIntent, setReceiptIntent] = useState<{ importJobId: string }>();
  if (surface === "workbench") {
    return (
      <WorkbenchPanel
        importHealthSummary={{
          ok: true,
          importJobIds,
          repairImports: importJobIds.map((importJobId, index) => ({
            importJobId,
            reasons: [{ count: 1, reason: "partial_parse" }],
            repairRequired: 1,
            runtime: index === 0 ? "opencode" : "cursor",
            sourceId: `source:receipt-${index}`
          })),
          reasons: [],
          repairRequired: importJobIds.length
        }}
        onOpenImportReceipt={(importJobId) => {
          setReceiptIntent({ importJobId });
          setSurface("sources");
        }}
      />
    );
  }
  return (
    <SourcesPanel
      adapters={[opencodeAdapter()]}
      busy={false}
      importFilterRuntime="opencode"
      importReceiptIntent={receiptIntent}
      imports={visibleImports}
      importTotal={99}
      onExcludePath={noop}
      onImportReceiptIntentConsumed={() => setReceiptIntent(undefined)}
      onLoadImportReport={onLoadImportReport}
      onPreviewImportRepair={onPreviewImportRepair}
      onRefresh={noop}
      sources={[]}
    />
  );
}

function AsyncReceiptHarness({ onConsumed, onLoadImportReport }: {
  onConsumed: () => void;
  onLoadImportReport: (importJobId: string) => Promise<ImportCompletionReportDto | undefined>;
}) {
  const [receiptIntent, setReceiptIntent] = useState<{ importJobId: string } | undefined>({ importJobId: "job-first" });
  return (
    <>
      <button type="button" onClick={() => setReceiptIntent({ importJobId: "job-later" })}>Open later receipt</button>
      <SourcesPanel
        adapters={[]}
        busy={false}
        importReceiptIntent={receiptIntent}
        imports={[]}
        onExcludePath={noop}
        onImportReceiptIntentConsumed={() => {
          onConsumed();
          setReceiptIntent(undefined);
        }}
        onLoadImportReport={onLoadImportReport}
        onRefresh={noop}
        sources={[]}
      />
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function completionReport(importJobId: string, runtime: ImportCompletionReportDto["runtime"], repair: number): ImportCompletionReportDto {
  return {
    anomalies: [], cappedUnits: 0, dossierReadySessions: 0, enrichedSessions: 0, failedUnits: 0,
    generatedAt: runtime === "cursor" ? "2026-07-15T13:00:00.000Z" : "2026-07-15T12:00:00.000Z",
    importJobId, logbookSearchableSessions: 0, mcpVisibleSessions: 0, nextActions: ["repair_import"],
    outOfRangeSessions: 0, recordsFailed: 0, recordsImported: 20, recordsRecognized: 20, recordsRejected: 0,
    recordsSkipped: 0, runtime, sessionsCreated: 20, sessionsDiscovered: 20, sessionsFinalized: 20,
    sessionsOnPackagePath: 20 - repair, sessionsRepairRequired: repair, sessionsSuppressed: 0, sessionsUpdated: 0,
    skippedUnits: 0, status: "succeeded_with_issues", timestampBasis: { file_modified: 0, semantic: 20, source_path: 0, unknown: 0 },
    transcriptsImported: 20
  };
}

function previewForRuntime(runtime: SourcesImportPreview["summary"]["runtime"], includedUnits: number, excludedUnits: number, totalBytes: number, estimatedRecords: number): SourcesImportPreview {
  return {
    runtime,
    summary: {
      cappedUnits: 0,
      excludedUnits,
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: `preview:${runtime}`,
      importKind: "transcript",
      includedUnits,
      manifestId: "",
      runtime,
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      estimatedRecords,
      totalBytes,
      totalUnits: includedUnits + excludedUnits
    }
  };
}

function emptySetup(): SourcesSetupDto {
  return {
    advanced: {
      adapters: [],
      imports: [],
      sources: []
    },
    connectedSources: [],
    setupId: "setup-empty",
    status: "empty",
    updatedAt: "2026-06-27T12:00:00.000Z"
  };
}

function detectedOnlySetup(): SourcesSetupDto {
  return {
    ...emptySetup(),
    connectedSources: [
      {
        discoveredSessions: 0,
        importedSessions: 0,
        label: "OpenCode",
        path: "/home/tyler/.opencode/session_index.jsonl",
        runtime: "opencode",
        sourceId: "opencode-sessions",
        state: "connected"
      }
    ],
    scan: scanDto(),
    status: "detected"
  };
}

function detectedOpenCodeAdapter(): AdapterStatus {
  return {
    discoveredSessions: 0,
    importedSessions: 0,
    policies: {
      enrichment: false,
      mcpAccess: false,
      metadataImport: true,
      transcriptImport: false
    },
    runtime: "opencode",
    sourceLocationCount: 4,
    sourceLocations: [
      {
        confidence: "authoritative",
        failures: 0,
        importedCount: 0,
        path: "/home/tyler/.opencode/session_index.jsonl",
        queuedCount: 0,
        runtime: "opencode",
        sessionCount: 0,
        sourceId: "opencode-sessions",
        sourceKind: "jsonl"
      }
    ],
    state: "connected"
  };
}

function notDetectedHermesAdapter(): AdapterStatus {
  return {
    discoveredSessions: 0,
    importedSessions: 0,
    policies: {
      enrichment: false,
      mcpAccess: false,
      metadataImport: false,
      transcriptImport: false
    },
    runtime: "hermes",
    sourceLocations: [],
    state: "not_detected"
  };
}

function diagnosticSetup(): SourcesSetupDto {
  return {
    ...emptySetup(),
    advanced: {
      adapters: [opencodeAdapter()],
      imports: [importJob({ status: "succeeded" })],
      sources: []
    }
  };
}

function connectedSetup(): SourcesSetupDto {
  return {
    ...diagnosticSetup(),
    connectedSources: [
      {
        discoveredSessions: 742,
        importedSessions: 742,
        label: "OpenCode sessions",
        lastSyncAt: "2026-06-27T12:00:00.000Z",
        runtime: "opencode",
        sourceId: "opencode-sessions",
        state: "connected",
        transcriptSessions: 510
      }
    ],
    coverage: {
      enriched: 320,
      failures: 0,
      queued: 0,
      sessions: 742,
      transcripts: 510
    },
    status: "ready"
  };
}

function scanDto(): SourcesOnboardingScanDto {
  return {
    adapters: [],
    foundSources: [
      {
        discoveredSessions: 742,
        importable: true,
        label: "OpenCode sessions",
        path: "/home/tyler/.opencode/sessions",
        runtime: "opencode",
        sourceId: "opencode-sessions",
        transcriptApproval: {
          approved: false,
          required: true,
          summary: "Prompts, code, command output"
        }
      },
      {
        discoveredSessions: 0,
        importable: false,
        label: "Legacy history",
        path: "/home/tyler/.legacy/history",
        runtime: "legacy_harness",
        sourceId: "legacy-history",
        transcriptApproval: {
          approved: false,
          required: false
        }
      }
    ],
    generatedAt: "2026-06-27T12:00:00.000Z",
    scanId: "scan-1",
    status: "completed",
    summary: {
      detectedHarnesses: 1,
      foundSources: 2,
      scannedHarnesses: 2
    }
  };
}

function multiSourceScanDto(): SourcesOnboardingScanDto {
  return {
    adapters: [],
    foundSources: [
      {
        discoveredSessions: 742,
        importable: true,
        label: "OpenCode sessions",
        path: "/home/tyler/.opencode/sessions",
        runtime: "opencode",
        sourceId: "opencode-sessions"
      },
      {
        discoveredSessions: 31,
        importable: true,
        label: "OpenCode archived sessions",
        path: "/home/tyler/.opencode/archive/2026-07-04.jsonl",
        runtime: "opencode",
        sourceId: "opencode-archive"
      },
      {
        discoveredSessions: 28,
        importable: true,
        label: "Cursor sessions",
        path: "/home/tyler/.config/Cursor/User/globalStorage/state.vscdb",
        runtime: "cursor",
        sourceId: "cursor-sessions"
      },
      {
        discoveredSessions: 9,
        importable: false,
        label: "Legacy history",
        path: "/home/tyler/.legacy/history",
        runtime: "legacy_harness",
        sourceId: "legacy-history"
      }
    ],
    generatedAt: "2026-06-27T12:00:00.000Z",
    scanId: "scan-multi-source",
    status: "completed",
    summary: {
      detectedHarnesses: 3,
      foundSources: 4,
      scannedHarnesses: 3
    }
  };
}

function realisticScanResult(): SourceScanResult {
  return {
    adapters: [
      {
        checkedPaths: [],
        diagnostics: [],
        discoveredSessions: 7,
        label: "OpenCode",
        maturity: "full",
        runtime: "opencode",
        sources: [
          {
            confidence: "authoritative",
            path: "/home/tyler/.opencode/sessions",
            runtime: "opencode",
            schemaVersion: "opencode-local-jsonl",
            sourceId: "opencode-sessions",
            sourceKind: "jsonl"
          }
        ],
        state: "connected"
      },
      {
        checkedPaths: [],
        diagnostics: [],
        discoveredSessions: 38,
        label: "Oh My Pi",
        maturity: "transcript",
        runtime: "omp",
        sources: [
          {
            confidence: "heuristic",
            path: "/home/tyler/.omp/agent/sessions",
            runtime: "omp",
            schemaVersion: "omp-jsonl-tree",
            sourceId: "omp-sessions",
            sourceKind: "jsonl"
          }
        ],
        state: "connected"
      }
    ],
    generatedAt: "2026-06-27T12:00:00.000Z",
    scanId: "scan-realistic"
  };
}

async function renderOpenScannedOnboarding(
  root: ReturnType<typeof createRoot>,
  container: HTMLElement,
  props: Partial<React.ComponentProps<typeof SourcesPanel>> = {}
) {
  await act(async () => {
    root.render(
      <SourcesPanel
        adapters={[]}
        busy={false}
        imports={[]}
        onExcludePath={noop}
        onRefresh={noop}
        onScanSetup={async () => scanDto()}
        setup={emptySetup()}
        sources={[]}
        {...props}
      />
    );
  });
  await act(async () => {
    buttonByText(container, "Set up sources").click();
  });
  await act(async () => {
    buttonByText(container, "Check local sources").click();
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button")).filter((candidate) => candidate.textContent === text);
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.at(-1) as HTMLButtonElement;
}
