// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, ImportJob } from "../../../app/daemonClient";
import type { SourcesOnboardingScanDto, SourcesSetupDto } from "../../../shared/sourcesSetup";
import { SourcesPanel } from "../../SourcesPanel";

const noop = () => undefined;

describe("SourcesPanel import controls", () => {
  test("opens onboarding from the connected-source dashboard", async () => {
    const onScan = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel adapters={[codexAdapter()]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} onScan={onScan} sources={[]} />
      );
    });

    await act(async () => {
      buttonByText(container, "Add source").click();
    });

    await act(async () => {
      buttonByText(container, "Scan this computer").click();
    });

    expect(onScan).toHaveBeenCalledTimes(1);
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
      buttonByText(container, "Connect sources").click();
    });

    expect(container.textContent).toContain("Connect local sources");
    expect(container.textContent).toContain("Scan this computer");
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
      buttonByText(container, "Connect sources").click();
    });
    await act(async () => {
      buttonByText(container, "Scan this computer").click();
    });

    expect(onScanSetup).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Codex sessions");
    expect(container.textContent).toContain("742 sessions");
    expect(container.textContent).not.toContain("Gemini CLI history");
    await act(async () => root.unmount());
  });

  test("transcript approval is source-specific after selecting found setup sources", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await renderOpenScannedOnboarding(root, container);

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
      buttonByText(container, "Build session library").click();
    });

    expect(onRunSetup).toHaveBeenCalledWith({
      enrichmentMode: "local",
      sourceIds: ["codex-sessions"],
      transcriptApprovals: [{ approved: true, runtime: "codex", sourceId: "codex-sessions" }]
    });
    await act(async () => root.unmount());
  });

  test("advanced diagnostics still exposes adapter grid and import catalog from setup", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SourcesPanel adapters={[]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} setup={diagnosticSetup()} sources={[]} />);
    });

    await act(async () => {
      buttonByText(container, "Advanced diagnostics").click();
    });

    expect(container.textContent).toContain("Adapter inventory and import jobs");
    expect(container.textContent).toContain("harnesses in catalog");
    expect(container.textContent).toContain("ADAPTERS");
    expect(container.textContent).toContain("Codex");
    expect(container.textContent).toContain("metadata");
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
    buttonByText(container, "Connect sources").click();
  });
  await act(async () => {
    buttonByText(container, "Scan this computer").click();
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button")).filter((candidate) => candidate.textContent === text);
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.at(-1) as HTMLButtonElement;
}
