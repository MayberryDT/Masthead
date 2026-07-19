import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ConnectorActionRequired, HarnessConnectorsSnapshotDto } from "../../../shared/harnessConnectors";
import { SourcesPanel } from "../../SourcesPanel";
import { HarnessConnectorDetail } from "../HarnessConnectorDetail";
import { HarnessConnectorList } from "../HarnessConnectorList";
import { HarnessConnectorRow } from "../HarnessConnectorRow";

const noop = () => undefined;

describe("HarnessConnectorList", () => {
  test("keeps the detail status warning when an endpoint test passes before activation", () => {
    const html = renderToStaticMarkup(
      <HarnessConnectorDetail
        connector={{
          runtime: "codex",
          label: "Codex",
          presence: "found",
          live: "needs_action",
          actionRequired: "trust_hooks",
          actionMessage: "Trust hooks in Codex (/hooks) after install.",
          lastTest: {
            status: "passed",
            testedAt: "2026-07-08T12:00:00.000Z",
            message: "Connector command verified."
          },
          supportsActions: true
        }}
        actionStatus="Test passed — Connector command verified."
      />
    );

    expect(html).toContain("Endpoint test passed — trust hooks still required");
    expect(html).toContain("Trust hooks in Codex (/hooks) after install.");
    expect(html).toContain("sources-connection-detail-status-warn");
    expect(html).not.toContain("sources-connection-detail-status-pass");
  });

  test("shows a passed endpoint test as activation-pending when live capture still needs action", () => {
    const html = renderToStaticMarkup(
      <HarnessConnectorRow
        connector={{
          runtime: "codex",
          label: "Codex",
          presence: "found",
          live: "needs_action",
          actionRequired: "trust_hooks",
          actionMessage: "Trust hooks in Codex (/hooks) after install.",
          lastTest: {
            status: "passed",
            testedAt: "2026-07-08T12:00:00.000Z",
            message: "Connector command verified."
          },
          supportsActions: true
        }}
        actionStatus="Test passed — Connector command verified."
        onTest={noop}
      />
    );

    expect(html).toContain("Endpoint test passed — trust hooks still required");
    expect(html).toContain("Needs action");
    expect(html).toContain("sources-connection-open-hint has-status is-warn");
    expect(html).not.toContain("sources-connection-open-hint has-status is-pass");
  });

  test.each([
    ["enable_plugin" as ConnectorActionRequired, "Endpoint test passed — plugin enablement still required"],
    ["repair" as ConnectorActionRequired, "Endpoint test passed — connector repair still required"]
  ])("uses the same action-specific passed-test warning for %s in row and detail", (actionRequired, expected) => {
    const connector = {
      runtime: "codex" as const,
      label: "Codex",
      presence: "found" as const,
      live: "needs_action" as const,
      actionRequired,
      actionMessage: actionRequired === "repair" ? "Live connector files need repair." : "Enable the plugin in host config.",
      lastTest: {
        status: "passed" as const,
        testedAt: "2026-07-08T12:00:00.000Z",
        message: "Connector command verified."
      },
      supportsActions: true
    };
    const row = renderToStaticMarkup(<HarnessConnectorRow connector={connector} actionStatus="Test passed" onTest={noop} />);
    const detail = renderToStaticMarkup(<HarnessConnectorDetail connector={connector} actionStatus="Test passed" />);

    expect(row).toContain(expected);
    expect(detail).toContain(expected);
    expect(row).toContain("is-warn");
    expect(detail).toContain("sources-connection-detail-status-warn");
  });

  test("does not infer a passed test from unrelated ready wording", () => {
    const connector = {
      runtime: "codex" as const,
      label: "Codex",
      presence: "found" as const,
      live: "needs_action" as const,
      actionRequired: "repair" as const,
      actionMessage: "Live connector files need repair.",
      supportsActions: true
    };

    const row = renderToStaticMarkup(
      <HarnessConnectorRow connector={connector} actionStatus="Connector is not ready." onTest={noop} />
    );

    expect(row).toContain("Connector is not ready.");
    expect(row).not.toContain("Endpoint test passed");
    expect(row).not.toContain("is-pass");
  });

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
    expect(listHtml).toContain("Ready after Masthead observes a live Codex event");
    expect(listHtml).not.toContain("Confirm trusted");
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
