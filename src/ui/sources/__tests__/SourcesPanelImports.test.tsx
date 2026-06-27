// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, ImportJob } from "../../../app/daemonClient";
import { SourcesPanel } from "../../SourcesPanel";

const noop = () => undefined;

describe("SourcesPanel import controls", () => {
  test("wires Codex action buttons through the panel", async () => {
    const onRefresh = vi.fn();
    const onImportMetadata = vi.fn();
    const onEnableTranscriptImport = vi.fn();
    const onSyncAdapter = vi.fn();
    const onScan = vi.fn();
    const onConnectSelected = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[codexAdapter({ transcriptImport: false })]}
          busy={false}
          imports={[]}
          onConnectSelected={onConnectSelected}
          onEnableTranscriptImport={onEnableTranscriptImport}
          onExcludePath={noop}
          onImportMetadata={onImportMetadata}
          onRefresh={onRefresh}
          onScan={onScan}
          onSyncAdapter={onSyncAdapter}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Discover sources").click();
      buttonByText(container, "Scan this computer").click();
      buttonByText(container, "Connect selected").click();
      buttonByText(container, "Import metadata").click();
      buttonByText(container, "Enable transcript import").click();
      buttonByText(container, "Sync").click();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onConnectSelected).toHaveBeenCalledWith(["codex"]);
    expect(onImportMetadata).toHaveBeenCalledWith("codex");
    expect(onEnableTranscriptImport).toHaveBeenCalledWith("codex");
    expect(onSyncAdapter).toHaveBeenCalledWith("codex");

    await act(async () => root.unmount());
  });

  test("wires transcript import once transcript policy is enabled", async () => {
    const onImportTranscripts = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[codexAdapter({ transcriptImport: true })]}
          busy={false}
          imports={[]}
          onExcludePath={noop}
          onImportTranscripts={onImportTranscripts}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Import transcripts").click();
    });

    expect(onImportTranscripts).toHaveBeenCalledWith("codex");

    await act(async () => root.unmount());
  });

  test("polls while imports are queued or running and stops after completion", async () => {
    vi.useFakeTimers();
    const onPollImports = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[codexAdapter({ transcriptImport: true })]}
          busy={false}
          imports={[importJob({ status: "running" })]}
          onExcludePath={noop}
          onPollImports={onPollImports}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onPollImports).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <SourcesPanel
          adapters={[codexAdapter({ transcriptImport: true })]}
          busy={false}
          imports={[importJob({ status: "succeeded" })]}
          onExcludePath={noop}
          onPollImports={onPollImports}
          onRefresh={noop}
          sources={[]}
        />
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(onPollImports).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    vi.useRealTimers();
  });
});

function codexAdapter({ transcriptImport }: { transcriptImport: boolean }): AdapterStatus {
  return {
    runtime: "codex",
    state: "connected",
    discoveredSessions: 742,
    importedSessions: 120,
    policies: {
      metadataImport: true,
      transcriptImport,
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
