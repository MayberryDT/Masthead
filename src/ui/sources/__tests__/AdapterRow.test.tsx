// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus } from "../../../app/daemonClient";
import { AdapterRow } from "../AdapterRow";
import { SourceAdapterDetailModal } from "../SourceAdapterDetailModal";

const noop = () => undefined;

function renderAdapter(adapter: AdapterStatus) {
  return renderToStaticMarkup(
    <AdapterRow
      adapter={adapter}
      busy={false}
      checked
      onOpenDetails={noop}
      onToggleSelected={noop}
    />
  );
}

describe("AdapterRow", () => {
  test("renders connected Codex as a compact source card", () => {
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

    expect(html).toContain("adapter-card adapter-card-connected");
    expect(html).toContain("Codex");
    expect(html).toContain("Connected");
    expect(html).toContain("Discovered");
    expect(html).toContain("742");
    expect(html).toContain("Locations");
    expect(html).toContain("Details");
    expect(html).not.toContain("Import metadata");
    expect(html).not.toContain("/home/tyler/.codex/sessions");
  });

  test("opens details from click and keyboard callbacks", async () => {
    const onOpenDetails = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AdapterRow
          adapter={codexAdapter({ transcriptImport: true })}
          busy={false}
          onOpenDetails={onOpenDetails}
          onToggleSelected={noop}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLElement>(".adapter-card")?.click();
      container.querySelector<HTMLElement>(".adapter-card")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onOpenDetails).toHaveBeenCalledWith("codex");
    expect(onOpenDetails).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });

  test("renders Claude Code not-detected card without inline diagnostics", () => {
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
    expect(html).toContain("Details");
    expect(html).not.toContain("No supported store detected");
    expect(html).not.toContain("/home/tyler/.claude/projects");
  });

  test("renders planned adapters as selectable-disabled cards", () => {
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
    expect(html).toMatch(/<input[^>]*disabled[^>]*aria-label="Select Gemini CLI"/);
  });
});

describe("SourceAdapterDetailModal", () => {
  test("renders source actions, policy, diagnostics, and path details", () => {
    const html = renderToStaticMarkup(
      <SourceAdapterDetailModal
        adapter={{
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
          checkedPaths: ["/home/tyler/.claude/projects"]
        } as unknown as AdapterStatus}
        busy={false}
        onClose={noop}
        onExcludePath={noop}
      />
    );

    expect(html).toContain("source-detail-modal");
    expect(html).toContain("source-detail-scroll-frame");
    expect(html).toContain("Live capture");
    expect(html).toContain("Loading");
    expect(html).toContain("Not wired yet");
    expect(html).toContain("No supported store detected");
    expect(html).toContain("Checked paths");
    expect(html).toContain("/home/tyler/.claude/projects");
  });

  test("invokes Codex metadata, transcript, approval, and sync callbacks", async () => {
    const onImportMetadata = vi.fn();
    const onImportTranscripts = vi.fn();
    const onEnableTranscriptImport = vi.fn();
    const onSyncAdapter = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourceAdapterDetailModal
          adapter={codexAdapter({ transcriptImport: true })}
          busy={false}
          onClose={noop}
          onEnableTranscriptImport={onEnableTranscriptImport}
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
      buttonByText(container, "Sync").click();
    });

    expect(onImportMetadata).toHaveBeenCalledWith("codex");
    expect(onImportTranscripts).toHaveBeenCalledWith("codex");
    expect(onSyncAdapter).toHaveBeenCalledWith("codex");

    await act(async () => {
      root.render(
        <SourceAdapterDetailModal
          adapter={codexAdapter({ transcriptImport: false })}
          busy={false}
          onClose={noop}
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
    sourceLocations: [
      {
        confidence: "authoritative",
        failures: 0,
        importedCount: 120,
        path: "/home/tyler/.codex/sessions",
        queuedCount: 622,
        runtime: "codex",
        sessionCount: 742,
        sourceId: "codex-sessions",
        sourceKind: "jsonl"
      }
    ]
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}
