import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { HarnessConnectorsSnapshotDto } from "../../../shared/harnessConnectors";
import { SourcesPanel } from "../../SourcesPanel";
import { HarnessConnectorList } from "../HarnessConnectorList";

const noop = () => undefined;

describe("HarnessConnectorList", () => {
  test("renders Connections cards and Refresh without Discover chrome", () => {
    const snapshot = sampleSnapshot();
    const listHtml = renderToStaticMarkup(
      <HarnessConnectorList
        snapshot={snapshot}
        selectedRuntime="codex"
        onSelect={noop}
        onEnable={noop}
        onTest={noop}
        onConfirm={noop}
      />
    );

    expect(listHtml).toContain("Claude Code");
    expect(listHtml).toContain("Codex");
    expect(listHtml).toContain("Needs action");
    expect(listHtml).toContain("Details");
    expect(listHtml).not.toContain("Import jobs");
    expect(listHtml).not.toContain("Live harness inventory");

    const panelHtml = renderToStaticMarkup(
      <SourcesPanel
        sources={[]}
        busy={false}
        connectorsSnapshot={snapshot}
        selectedConnectorRuntime="codex"
        onSelectConnectorRuntime={noop}
        onDiscoverConnectors={noop}
        onEnableConnector={noop}
        onEnableAllDetectedConnectors={noop}
        onTestConnector={noop}
        onUninstallConnector={noop}
        onConfirmConnectorActivation={noop}
        onExcludePath={noop}
        onRefresh={noop}
      />
    );

    expect(panelHtml).toContain("Refresh");
    expect(panelHtml).toContain("Connections");
    expect(panelHtml).toContain("Detail");
    expect(panelHtml).toContain("Claude Code");
    expect(panelHtml).toContain("Needs action");
    expect(panelHtml).toContain("Codex");
    expect(panelHtml).toContain("Enable all found");
    expect(panelHtml).toContain("observability-toolbar");
    expect(panelHtml).not.toContain("Discover local harnesses");
    expect(panelHtml).not.toContain("First-run setup");
    expect(panelHtml).not.toContain("Import jobs");
    expect(panelHtml).not.toContain("Import data");
  });
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
        supportsActions: true
      },
      {
        runtime: "claude_code",
        label: "Claude Code",
        presence: "found",
        live: "not_installed",
        supportsActions: true
      }
    ]
  };
}
