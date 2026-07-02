// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, ImportJob, SourcesImportPreview } from "../../../app/daemonClient";
import type { SourcesOnboardingScanDto, SourcesSetupDto } from "../../../shared/sourcesSetup";
import type { SourceScanResult } from "../../../daemon/sources/sourceScanService";
import { scanResultToOnboardingScan } from "../../../daemon/sources/sourceSetupService";
import { SourcesPanel } from "../../SourcesPanel";

const noop = () => undefined;

describe("SourcesPanel import controls", () => {
  test("opens import history modal from the connected-source dashboard", async () => {
    const onPreviewImport = vi.fn(async () => []);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[codexAdapter()]}
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
    expect(onPreviewImport).toHaveBeenCalledWith(expect.objectContaining({ runtimes: ["codex"] }));
    await act(async () => root.unmount());
  });

  test("loads preview-backed harness choices as soon as the import modal opens", async () => {
    const setup = connectedSetup();
    setup.advanced.adapters = [];
    const onPreviewImport = vi.fn(async () => [previewForRuntime("codex", 500, 912, 5_614_987_264, 742), previewForRuntime("cursor", 2, 0, 1_153_433, 28)]);
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
    expect(container.textContent).toContain("Codex");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Sessions to import");
    expect(container.textContent).toContain("742");
    expect(container.textContent).toContain("28");
    expect(container.textContent).not.toContain("Coding harness");
    expect(container.textContent).not.toContain("Codex local hook");
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
          adapters={[codexAdapter()]}
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
          adapters={[codexAdapter()]}
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
          adapters={[codexAdapter()]}
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

  test("view diagnostics reveals raw adapter errors outside the default inventory", async () => {
    const setup = connectedSetup();
    setup.advanced.adapters = [
      {
        ...codexAdapter(),
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
      root.render(<SourcesPanel adapters={[codexAdapter()]} busy={false} imports={[importJob({ status: "running" })]} onExcludePath={noop} onPollImports={onPollImports} onRefresh={noop} sources={[]} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onPollImports).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<SourcesPanel adapters={[codexAdapter()]} busy={false} imports={[importJob({ status: "succeeded" })]} onExcludePath={noop} onPollImports={onPollImports} onRefresh={noop} sources={[]} />);
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
    expect(container.textContent).not.toContain("Gemini CLI");
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
    expect(container.textContent).toContain("Codex sessions");
    expect(container.textContent).toContain("742 sessions");
    expect(container.textContent).not.toContain("Gemini CLI history");
    await act(async () => root.unmount());
  });

  test("real setup scan mapping makes discovered Codex sources selectable", async () => {
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

    expect(container.textContent).toContain("Codex");
    expect(container.textContent).toContain("/home/tyler/.codex/sessions");
    expect(container.textContent).toContain("Oh My Pi");
    expect(container.textContent).toContain("/home/tyler/.omp/agent/sessions");
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
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start source setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIds: ["codex-sessions", "omp-sessions"],
        transcriptApprovals: [
          { approved: true, runtime: "codex", sourceId: "codex-sessions" },
          { approved: true, runtime: "omp", sourceId: "omp-sessions" }
        ]
      })
    );
    await act(async () => root.unmount());
  });

  test("transcript approval is source-specific after selecting found setup sources", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container);

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });

    expect(container.textContent).toContain("Transcript approval");
    expect(container.textContent).toContain("Codex sessions");
    expect(container.textContent).toContain("/home/tyler/.codex/sessions");
    expect(container.textContent).toContain("Prompts, code, command output");
    await act(async () => root.unmount());
  });

  test("enrichment step renders explicit setup choices", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container);

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Continue").click();
    });

    expect(container.textContent).toContain("Local deterministic summaries");
    expect(container.textContent).toContain("Skip enrichment");
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
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      buttonByText(container, "Start source setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledWith({
      enrichmentMode: "local",
      importMetadata: true,
      importTranscripts: true,
      queueEnrichment: true,
      sourceIds: ["codex-sessions"],
      transcriptApprovals: [{ approved: true, runtime: "codex", sourceId: "codex-sessions" }]
    });
    await act(async () => root.unmount());
  });

  test("connected dashboard keeps import jobs visible without advanced diagnostics", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} setup={connectedSetup()} sources={[]} />);
    });

    expect(container.textContent).toContain("Import activity");
    expect(container.textContent).toContain("metadata");
    expect(container.textContent).not.toContain("Advanced diagnostics");
    expect(container.textContent).not.toContain("Adapter inventory");
    expect(container.textContent).not.toContain("harnesses in catalog");
    await act(async () => root.unmount());
  });

  test("live-only setup does not approve historical transcript import", async () => {
    const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container, { onRunSetup });

    await act(async () => {
      buttonByText(container, "Continue").click();
    });
    await act(async () => {
      const liveOnly = [...container.querySelectorAll("input[name='source-history-mode']")][1] as HTMLInputElement;
      liveOnly.click();
    });
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
      buttonByText(container, "Start source setup").click();
    });

    expect(onRunSetup).toHaveBeenCalledWith({
      enrichmentMode: "local",
      importMetadata: false,
      importTranscripts: false,
      queueEnrichment: true,
      sourceIds: ["codex-sessions"],
      transcriptApprovals: [{ approved: false, runtime: "codex", sourceId: "codex-sessions" }]
    });
    await act(async () => root.unmount());
  });
});

function codexAdapter(): AdapterStatus {
  return {
    runtime: "codex",
    name: "Codex",
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
        path: "/home/tyler/.codex/sessions",
        queuedCount: 0,
        runtime: "codex",
        sessionCount: 742,
        sourceId: "codex-sessions",
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
    sourceId: "codex-sessions",
    status: "running",
    updatedAt: "2026-06-25T12:00:00.000Z",
    ...overrides
  };
}

function previewForRuntime(runtime: SourcesImportPreview["summary"]["runtime"], includedUnits: number, excludedUnits: number, totalBytes: number, estimatedRecords: number): SourcesImportPreview {
  return {
    runtime,
    summary: {
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

function diagnosticSetup(): SourcesSetupDto {
  return {
    ...emptySetup(),
    advanced: {
      adapters: [codexAdapter()],
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
        label: "Codex sessions",
        lastSyncAt: "2026-06-27T12:00:00.000Z",
        runtime: "codex",
        sourceId: "codex-sessions",
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
        label: "Codex sessions",
        path: "/home/tyler/.codex/sessions",
        runtime: "codex",
        sourceId: "codex-sessions",
        transcriptApproval: {
          approved: false,
          required: true,
          summary: "Prompts, code, command output"
        }
      },
      {
        discoveredSessions: 0,
        importable: false,
        label: "Gemini CLI history",
        path: "/home/tyler/.gemini/history",
        runtime: "gemini_cli",
        sourceId: "gemini-history",
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

function realisticScanResult(): SourceScanResult {
  return {
    adapters: [
      {
        checkedPaths: [],
        diagnostics: [],
        discoveredSessions: 7,
        label: "Codex",
        maturity: "full",
        runtime: "codex",
        sources: [
          {
            confidence: "authoritative",
            path: "/home/tyler/.codex/sessions",
            runtime: "codex",
            schemaVersion: "codex-local-jsonl",
            sourceId: "codex-sessions",
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
