// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AdapterStatus, SettingsStateDto } from "../../../app/daemonClient";
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
  test("renders connected OpenCode as a compact source card", () => {
    const html = renderAdapter({
      runtime: "opencode",
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
          path: "/home/tyler/.opencode/sessions",
          queuedCount: 622,
          runtime: "opencode",
          sessionCount: 742,
          sourceId: "opencode-sessions",
          sourceKind: "jsonl"
        }
      ]
    });

    expect(html).toContain("adapter-card adapter-card-connected");
    expect(html).toContain("OpenCode");
    expect(html).toContain("Connected");
    expect(html).toContain("Discovered");
    expect(html).toContain("742");
    expect(html).toContain("Locations");
    expect(html).toContain("Details");
    expect(html).not.toContain("Import metadata");
    expect(html).not.toContain("/home/tyler/.opencode/sessions");
  });

  test("opens details from click and keyboard callbacks", async () => {
    const onOpenDetails = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AdapterRow
          adapter={opencodeAdapter({ transcriptImport: true })}
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

    expect(onOpenDetails).toHaveBeenCalledWith("opencode");
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
      runtime: "pi",
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

    expect(html).toContain("Pi");
    expect(html).toContain("Adapter planned");
    expect(html).toMatch(/<input[^>]*disabled[^>]*aria-label="Select Pi"/);
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

  test("renders live connector status in harness detail header", () => {
    const html = renderToStaticMarkup(
      <SourceAdapterDetailModal
        adapter={opencodeAdapter({ transcriptImport: true })}
        busy={false}
        hooks={opencodeHookSettings()}
        onClose={noop}
        onExcludePath={noop}
        onRuntimeHookAction={noop}
      />
    );

    expect(html).toContain("source-detail-head-badges");
    expect(html).toContain("Live: Installed");
    expect(html).toContain("Test live connectors");
  });

  test("invokes OpenCode metadata, transcript, approval, and sync callbacks", async () => {
    const onImportMetadata = vi.fn();
    const onImportTranscripts = vi.fn();
    const onEnableTranscriptImport = vi.fn();
    const onSyncAdapter = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourceAdapterDetailModal
          adapter={opencodeAdapter({ transcriptImport: true })}
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

    expect(onImportMetadata).toHaveBeenCalledWith("opencode");
    expect(onImportTranscripts).toHaveBeenCalledWith("opencode");
    expect(onSyncAdapter).toHaveBeenCalledWith("opencode");

    await act(async () => {
      root.render(
        <SourceAdapterDetailModal
          adapter={opencodeAdapter({ transcriptImport: false })}
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

    expect(onEnableTranscriptImport).toHaveBeenCalledWith("opencode");

    await act(async () => root.unmount());
  });

  test("invokes runtime hook and import-history callbacks for non-OpenCode adapters", async () => {
    const onRuntimeHookAction = vi.fn();
    const onOpenImportJobs = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourceAdapterDetailModal
          adapter={{
            checkedPaths: ["/home/tyler/.claude/projects"],
            discoveredSessions: 9,
            importedSessions: 3,
            policies: {
              metadataImport: true,
              transcriptImport: false,
              enrichment: false,
              mcpAccess: false
            },
            runtime: "claude_code",
            sourceLocations: [],
            state: "connected"
          } as AdapterStatus}
          busy={false}
          hooks={{
            ...opencodeHookSettings(),
            integrations: [
              {
                actionSurface: "sources",
                captureMode: "live_hook",
                configPath: "/home/tyler/.claude/hooks.json",
                description: "Claude Code live hooks",
                endpoint: "http://127.0.0.1:17373/ingest?runtime=claude_code",
                label: "Claude Code",
                runtime: "claude_code",
                status: "installed",
                supportsActions: true
              }
            ]
          }}
          onClose={noop}
          onExcludePath={noop}
          onOpenImportJobs={onOpenImportJobs}
          onRuntimeHookAction={onRuntimeHookAction}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Test live connectors").click();
      buttonByText(container, "Open import jobs").click();
    });

    expect(onRuntimeHookAction).toHaveBeenCalledWith("claude_code", "test");
    expect(onOpenImportJobs).toHaveBeenCalledWith("claude_code");
    await act(async () => root.unmount());
  });
});

function opencodeAdapter({ transcriptImport }: { transcriptImport: boolean }): AdapterStatus {
  return {
    runtime: "opencode",
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
        path: "/home/tyler/.opencode/sessions",
        queuedCount: 622,
        runtime: "opencode",
        sessionCount: 742,
        sourceId: "opencode-sessions",
        sourceKind: "jsonl"
      }
    ]
  };
}

function opencodeHookSettings(): SettingsStateDto["hooks"] {
  return {
    command: "masthead hook",
    configExists: true,
    configPath: "/home/tyler/.opencode/config.toml",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    integrations: [
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: "OpenCode live hooks",
        label: "OpenCode",
        runtime: "opencode",
        status: "installed",
        supportsActions: true
      }
    ],
    lastEventAt: "2026-07-04T12:00:00.000Z",
    lastTest: {
      message: "ok",
      status: "passed",
      testedAt: "2026-07-04T12:01:00.000Z"
    },
    missingEvents: [],
    mismatchedEvents: []
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}
