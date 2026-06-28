// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, ImportJob } from "../../../app/daemonClient";
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
    sourceLocations: []
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

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button")).filter((candidate) => candidate.textContent === text);
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.at(-1) as HTMLButtonElement;
}
