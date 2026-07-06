import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SourcesSetupDto } from "../../shared/sourcesSetup";
import { SourcesPanel } from "../SourcesPanel";

describe("SourcesPanel", () => {
  test("renders connected source health without raw transcript text", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[
          {
            runtime: "opencode",
            name: "OpenCode",
            state: "connected",
            discoveredSessions: 742,
            importedSessions: 120,
            lastSyncAt: "2026-06-24T12:00:00.000Z",
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
            ],
            policies: {
              metadataImport: true,
              transcriptImport: false,
              enrichment: false,
              mcpAccess: true
            }
          }
        ]}
        imports={[
          {
            discoveredCount: 742,
            failureCount: 0,
            importJobId: "job-1",
            importedCount: 120,
            importKind: "metadata",
            queuedCount: 622,
            sourceId: "opencode-sessions",
            status: "running",
            updatedAt: "2026-06-24T12:00:00.000Z"
          }
        ]}
        sources={[]}
        busy={false}
        status="Metadata import ready"
        onExcludePath={() => undefined}
        onImportMetadata={() => undefined}
        onRefresh={() => undefined}
        onSyncAdapter={() => undefined}
      />
    );

    expect(html).toContain('class="sources-action-bar sources-toolbar observability-toolbar metal-toolbar"');
    expect(html).not.toContain("Source health");
    expect(html).toContain("Import data");
    expect(html).toContain("Refresh detection");
    expect(html).not.toContain("Repair missing data");
    expect(html).toContain("Live capture");
    expect(html).toContain("History");
    expect(html).toContain("Transcripts");
    expect(html).toContain("Enrichment");
    expect(html).toContain("Last activity");
    expect(html).toContain("Needs enrichment");
    expect(html).toContain("OpenCode");
    expect(html).toContain("120");
    expect(html).not.toContain("Advanced diagnostics");
    expect(html).not.toContain("Metadata import ready");
    expect(html).toContain("sources-toolbar-facts");
    expect(html).toContain("Last refresh");
    expect(html).toContain("Active import");
    expect(html).not.toContain("Open Logbook");
    expect(html).not.toContain("/home/tyler/.opencode/sessions");
    expect(html).not.toContain("hello from transcript");
  });

  test("does not wire a redundant Logbook action into the source toolbar", () => {
    const dashboard = readFileSync("src/ui/sources/SourcesConnectedDashboard.tsx", "utf8");
    const panel = readFileSync("src/ui/SourcesPanel.tsx", "utf8");
    const app = readFileSync("src/app/App.tsx", "utf8");

    expect(dashboard).not.toContain("Open Logbook");
    expect(dashboard).not.toContain("onOpenLogbook");
    expect(panel).not.toContain("onOpenLogbook");
    expect(app).not.toContain("onOpenLogbook");
  });

  test("renders connected setup coverage when setup is available", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={connectedSetup()}
        sources={[]}
      />
    );

    expect(html).not.toContain("Source health");
    expect(html).toContain("Import data");
    expect(html).toContain("Refresh detection");
    expect(html).toContain("OpenCode sessions");
    expect(html).toContain("742 sessions");
    expect(html).toContain("<dt>Enriched</dt>");
    expect(html).toContain("<dd>320</dd>");
    expect(html).not.toContain("320 enriched");
    expect(html).toContain("Live capture");
    expect(html).toContain("History");
    expect(html).toContain("Transcripts");
    expect(html).toContain("Enrichment");
    expect(html).toContain("Last activity");
    expect(html).toContain("Needs transcript import");
    expect(html).toContain("Needs enrichment");
    expect(html).toContain("Queued");
    expect(html).toContain("14");
    expect(html).toContain("sources-summary-strip");
    expect(html).toContain("usage-metric");
    expect(html).not.toContain("sources-action-summary");
    expect(html).not.toContain("Inventory");
    expect(html).not.toContain("source families indexed");
  });

  test("hides Masthead internal provenance from source inventory", () => {
    const setup = connectedSetup();
    setup.connectedSources = [
      ...setup.connectedSources,
      {
        discoveredSessions: 8,
        importedSessions: 8,
        label: "Masthead",
        runtime: "masthead",
        sourceId: "masthead-git-observer",
        state: "connected"
      }
    ];

    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={setup}
        sources={[]}
      />
    );

    expect(html.match(/connected-source-row/g)).toHaveLength(1);
    expect(html).toContain("OpenCode sessions");
    expect(html).not.toContain("masthead-git-observer");
  });

  test("groups repeated Hermes source locations into one source family", () => {
    const setup = connectedSetup();
    setup.connectedSources = Array.from({ length: 12 }, (_, index) => ({
      discoveredSessions: 2,
      importedSessions: 2,
      label: "Hermes",
      lastSyncAt: `2026-06-27T${String(10 + (index % 3)).padStart(2, "0")}:00:00.000Z`,
      path: `/home/tyler/.hermes/workspace-${index + 1}/state.db`,
      queuedRecords: index === 0 ? 3 : 0,
      runtime: "hermes",
      sourceId: `hermes-${index + 1}`,
      state: "connected",
      transcriptImportEnabled: true
    }));
    setup.coverage = {
      enriched: 0,
      failures: 0,
      queued: 3,
      sessions: 24,
      transcripts: 0
    };

    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={setup}
        sources={[]}
      />
    );

    expect(html.match(/connected-source-row/g)).toHaveLength(1);
    expect(html).toContain("Hermes");
    expect(html).toContain("12 locations");
    expect(html).toContain("24 sessions");
    expect(html).not.toContain("Showing 12 of 12 connected source records");
    expect(html).not.toContain("workspace-12");
  });

  test("shows import jobs by default instead of behind advanced diagnostics", () => {
    const setup = connectedSetup();
    const imports = [
      {
        discoveredCount: 12,
        failureCount: 0,
        importJobId: "job-hermes",
        importedCount: 4,
        importKind: "metadata" as const,
        queuedCount: 8,
        sourceId: "hermes-workspace",
        status: "running" as const,
        updatedAt: "2026-06-27T12:00:00.000Z"
      }
    ];

    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        imports={imports}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={setup}
        sources={[]}
      />
    );

    expect(html).toContain("Import jobs");
    expect(html).toContain("Hermes");
    expect(html).not.toContain("hermes-workspace");
    expect(html).toContain("metadata");
    expect(html).not.toContain("Advanced diagnostics");
  });

  test("keeps setup empty state focused on onboarding instead of unconnected harnesses", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[
          {
            runtime: "pi",
            name: "Pi",
            state: "not_detected",
            discoveredSessions: 0,
            importedSessions: 0,
            policies: {
              enrichment: false,
              mcpAccess: false,
              metadataImport: false,
              transcriptImport: false
            },
            sourceLocations: []
          }
        ]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={emptySetup()}
        sources={[]}
      />
    );

    expect(html).toContain("No sources set up");
    expect(html).toContain("Set up sources");
    expect(html).toContain("Capture new sessions now, or optionally import past sessions from local harness history.");
    expect(html).not.toContain("Advanced diagnostics");
    expect(html).not.toContain("Connect sources");
    expect(html).not.toContain("Pi");
    expect(html).not.toContain("Harnesses Masthead knows how to check");
  });

  test("summarizes large connected source inventories by source family", () => {
    const setup = connectedSetup();
    setup.connectedSources = Array.from({ length: 20 }, (_, index) => ({
      discoveredSessions: 1,
      importedSessions: 1,
      label: `Source ${index + 1}`,
      runtime: "opencode",
      sourceId: `source-${index + 1}`,
      state: "connected",
      transcriptSessions: 1
    }));

    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={setup}
        sources={[]}
      />
    );

    expect(html.match(/connected-source-row/g)).toHaveLength(1);
    expect(html).toContain("20 locations");
    expect(html).toContain("20 sessions");
    expect(html).not.toContain("Source 12");
    expect(html).not.toContain("Source 13");
  });

  test("uses folded metal box chips for source cards and import queue statuses", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");

    expect(css).toMatch(/\.source-state\s*\{[\s\S]*border-radius: 1px;[\s\S]*clip-path: var\(--folded-control-clip/);
    expect(css).toMatch(/\.sources-management \.status-badge\s*\{[\s\S]*border-radius: 1px;[\s\S]*clip-path: var\(--folded-control-clip/);
  });

  test("keeps first-run onboarding stages in one responsive row on narrow screens", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");
    const narrowRule = css.match(/@media \(max-width: 980px\) \{[\s\S]*?\.sources-onboarding-step-list\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const compactRule = css.match(/@media \(max-width: 620px\) \{[\s\S]*?\.sources-onboarding-step-item small\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(css).toMatch(/@media \(max-width: 980px\) \{[\s\S]*\.sources-onboarding-modal \.sources-onboarding-command-layout\s*\{[\s\S]*grid-template-columns: 1fr;[\s\S]*overflow: auto;/);
    expect(narrowRule).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(narrowRule).toContain("gap: clamp(4px, 1.4vw, 10px);");
    expect(compactRule).toContain("display: none;");
  });

  test("styles first-run onboarding header as an aligned toolbar band", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");
    const headerRule = css.match(/\.session-detail-modal\.sources-onboarding-modal-full \.session-detail-header\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const actionRule = css.match(/\.sources-onboarding-modal-full \.session-detail-header \.surface-actions\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(headerRule).toContain("display: grid;");
    expect(headerRule).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(headerRule).toContain("min-height: 72px;");
    expect(headerRule).toContain("padding: 14px clamp(18px, 3vw, 32px);");
    expect(headerRule).toContain("border-bottom: 1px solid rgba(194, 221, 241, 0.13);");
    expect(actionRule).toContain("align-items: center;");
    expect(actionRule).toContain("justify-self: end;");
  });

  test("keeps onboarding source paths clipped and shared action rows spaced", () => {
    const sourcesCss = readFileSync("src/styles/sources.css", "utf8");
    const primitivesCss = readFileSync("src/styles/primitives.css", "utf8");
    const pathRule = sourcesCss.match(/\.source-select-card \.source-card-path\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const actionRule = primitivesCss.match(/\.surface-actions\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(pathRule).toContain("max-width: 100%;");
    expect(pathRule).toContain("overflow: hidden;");
    expect(pathRule).toContain("text-overflow: ellipsis;");
    expect(pathRule).toContain("white-space: nowrap;");
    expect(actionRule).toContain("display: flex;");
    expect(actionRule).toContain("gap: 8px;");
    expect(actionRule).toContain("flex-wrap: wrap;");
  });

  test("keeps source actions inline with toolbar facts on the right", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");
    const toolbarRule = css.match(/\.sources-action-bar\.sources-toolbar\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const toolbarGroupRule = css.match(/\.sources-action-bar\.sources-toolbar \.sources-action-group\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const toolbarFactsRule = css.match(/\.sources-toolbar-facts\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const toolbarFactCardRule = css.match(/\.sources-toolbar-facts div\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(toolbarRule).toContain("width: 100%;");
    expect(toolbarRule).toContain("justify-content: space-between;");
    expect(toolbarRule).toContain("align-items: center;");
    expect(toolbarGroupRule).toContain("justify-content: flex-start;");
    expect(toolbarFactsRule).toContain("margin-left: auto;");
    expect(toolbarFactCardRule).not.toContain("inset 2px 0 0");
  });

  test("keeps import modal cards compact without left accent stripes", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");
    const importModalRule = css.match(/\.session-detail-modal\.sources-import-modal\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const harnessCardRule = css.match(/\.harness-import-card\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const footerRule = css.match(/\.sources-import-footer\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(importModalRule).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
    expect(harnessCardRule).toContain("border-left: 0;");
    expect(harnessCardRule).toContain("min-height: 104px;");
    expect(harnessCardRule).toContain("animation: none;");
    expect(harnessCardRule).toContain("transform: none;");
    expect(footerRule).toContain("padding: 12px 16px;");
  });

  test("uses dossier modal motion for the import history modal", () => {
    const css = readFileSync("src/styles/sources.css", "utf8");
    const openingRule = css.match(/\.session-detail-modal\.sources-import-modal\.t-modal\.is-opening\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const openRule = css.match(/\.session-detail-modal\.sources-import-modal\.t-modal\.is-open\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const settledRule = css.match(/\.session-detail-modal\.sources-import-modal\.t-modal\.is-open\.is-settled\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";
    const closingRule = css.match(/\.session-detail-modal\.sources-import-modal\.t-modal\.is-closing\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

    expect(openingRule).toContain("transform: translateY(9px) scale(var(--modal-scale));");
    expect(openRule).toContain("transform: none;");
    expect(openRule).toContain("animation: usage-card-enter var(--modal-open-dur) cubic-bezier(0.17, 0.78, 0.13, 1);");
    expect(openRule).not.toContain("both");
    expect(settledRule).toContain("transform: none;");
    expect(settledRule).toContain("animation: none;");
    expect(closingRule).toContain("animation: session-dossier-card-exit var(--modal-close-dur) cubic-bezier(0.17, 0.78, 0.13, 1) both;");
  });

  test("uses shared card entrance motion for source inventory cards", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");

    expect(css).toMatch(/\.usage-summary-strip \.usage-metric,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: usage-card-enter 400ms cubic-bezier\(0\.17, 0\.78, 0\.13, 1\) both;[\s\S]*transform-origin: 50% 100%;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: none/);
  });
});

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

function connectedSetup(): SourcesSetupDto {
  return {
    advanced: {
      adapters: [],
      imports: [],
      sources: []
    },
    connectedSources: [
      {
        discoveredSessions: 742,
        enrichedSessions: 320,
        failureCount: 0,
        importedSessions: 742,
        enrichmentEnabled: false,
        label: "OpenCode sessions",
        lastSyncAt: "2026-06-27T12:00:00.000Z",
        needsAttention: ["transcript_import", "enrichment"],
        queuedRecords: 14,
        runtime: "opencode",
        sourceId: "opencode-sessions",
        state: "connected",
        transcriptImportEnabled: false,
        transcriptSessions: 510
      }
    ],
    coverage: {
      enriched: 320,
      failures: 0,
      queued: 14,
      sessions: 742,
      transcripts: 510
    },
    setupId: "setup-ready",
    status: "ready",
    updatedAt: "2026-06-27T12:00:00.000Z"
  };
}
