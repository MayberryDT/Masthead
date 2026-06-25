// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus } from "../../../app/daemonClient";
import { AdapterRow } from "../AdapterRow";

const noop = () => undefined;

function renderAdapter(adapter: AdapterStatus) {
  return renderToStaticMarkup(
    <AdapterRow
      adapter={adapter}
      busy={false}
      onEnableTranscriptImport={noop}
      onExcludePath={noop}
      onImportMetadata={noop}
      onImportTranscripts={noop}
      onSyncAdapter={noop}
    />
  );
}

describe("AdapterRow", () => {
  test("renders connected Codex import actions", () => {
    const html = renderAdapter({
      runtime: "codex",
      state: "connected",
      discoveredSessions: 742,
      importedSessions: 120,
      lastSyncAt: "2026-06-24T12:00:00.000Z",
      policies: {
        metadataImport: true,
        transcriptImport: false,
        enrichment: false,
        mcpAccess: true
      },
      sourceLocations: [
        {
          confidence: "authoritative",
          failures: 0,
          importedCount: 120,
          lastSync: "2026-06-24T12:00:00.000Z",
          path: "/home/tyler/.codex/sessions",
          queuedCount: 622,
          runtime: "codex",
          sessionCount: 742,
          sourceId: "codex-sessions",
          sourceKind: "jsonl"
        }
      ]
    });

    expect(html).toContain("Codex");
    expect(html).toContain("Connected");
    expect(html).toContain("Import metadata");
    expect(html).toContain("Enable transcript import");
    expect(html).toContain("Import transcripts");
    expect(html).toContain("Sync all");
    expect(html).toContain("/home/tyler/.codex/sessions");
  });

  test("invokes Codex metadata, transcript, and sync callbacks", async () => {
    const onImportMetadata = vi.fn();
    const onImportTranscripts = vi.fn();
    const onSyncAdapter = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AdapterRow
          adapter={codexAdapter({ transcriptImport: true })}
          busy={false}
          onExcludePath={noop}
          onImportMetadata={onImportMetadata}
          onImportTranscripts={onImportTranscripts}
          onSyncAdapter={onSyncAdapter}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Import metadata").click();
      buttonByText(container, "Import transcripts").click();
      buttonByText(container, "Sync all").click();
    });

    expect(onImportMetadata).toHaveBeenCalledWith("codex");
    expect(onImportTranscripts).toHaveBeenCalledWith("codex");
    expect(onSyncAdapter).toHaveBeenCalledWith("codex");

    await act(async () => root.unmount());
  });

  test("invokes Codex transcript approval callback", async () => {
    const onEnableTranscriptImport = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AdapterRow
          adapter={codexAdapter({ transcriptImport: false })}
          busy={false}
          onEnableTranscriptImport={onEnableTranscriptImport}
          onExcludePath={noop}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Enable transcript import").click();
    });

    expect(onEnableTranscriptImport).toHaveBeenCalledWith("codex");

    await act(async () => root.unmount());
  });

  test("renders Claude Code not-detected diagnostics and checked paths", () => {
    const html = renderAdapter({
      runtime: "claude_code",
      state: "not_detected",
      discoveredSessions: 0,
      importedSessions: 0,
      policies: {
        metadataImport: false,
        transcriptImport: false,
        enrichment: false,
        mcpAccess: false
      },
      sourceLocations: [],
      checkedPaths: ["/home/tyler/.claude/projects", "/home/tyler/Library/Application Support/Claude"]
    } as unknown as AdapterStatus);

    expect(html).toContain("Claude Code");
    expect(html).toContain("Not detected");
    expect(html).toContain("No supported store detected");
    expect(html).toContain("Checked paths");
    expect(html).toContain("/home/tyler/.claude/projects");
    expect(html).toContain("Choose location");
  });

  test("renders planned adapters as disabled future rows", () => {
    const html = renderAdapter({
      runtime: "gemini_cli",
      state: "planned",
      implementationState: "planned",
      discoveredCount: 0,
      discoveredSessions: 0,
      importedCount: 0,
      importedSessions: 0,
      policies: {
        metadataImport: false,
        transcriptImport: false,
        enrichment: false,
        mcpAccess: false
      },
      sourceLocations: []
    } as unknown as AdapterStatus);

    expect(html).toContain("Gemini CLI");
    expect(html).toContain("Adapter planned");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Coming later<\/button>/);
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

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}
