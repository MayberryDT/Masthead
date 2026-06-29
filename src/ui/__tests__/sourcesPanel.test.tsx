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
            runtime: "codex",
            name: "Codex",
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
                path: "/home/tyler/.codex/sessions",
                queuedCount: 622,
                runtime: "codex",
                sessionCount: 742,
                sourceId: "codex-sessions",
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
            sourceId: "codex-sessions",
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
    expect(html).toContain("Set up more sources");
    expect(html).toContain("Live capture");
    expect(html).toContain("History");
    expect(html).toContain("Transcripts");
    expect(html).toContain("Enrichment");
    expect(html).toContain("Last activity");
    expect(html).toContain("Needs enrichment");
    expect(html).toContain("Codex");
    expect(html).toContain("120");
    expect(html).not.toContain("Advanced diagnostics");
    expect(html).toContain("Metadata import ready");
    expect(html).not.toContain("/home/tyler/.codex/sessions");
    expect(html).not.toContain("hello from transcript");
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
    expect(html).toContain("Set up more sources");
    expect(html).toContain("Codex sessions");
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
    expect(html).toContain("Codex sessions");
    expect(html).not.toContain("Masthead");
    expect(html).not.toContain("masthead-git-observer");
  });

  test("groups repeated Antigravity source locations into one source family", () => {
    const setup = connectedSetup();
    setup.connectedSources = Array.from({ length: 12 }, (_, index) => ({
      discoveredSessions: 2,
      importedSessions: 2,
      label: "Antigravity",
      lastSyncAt: `2026-06-27T${String(10 + (index % 3)).padStart(2, "0")}:00:00.000Z`,
      path: `/home/tyler/.config/Antigravity/User/workspaceStorage/workspace-${index + 1}/state.vscdb`,
      queuedRecords: index === 0 ? 3 : 0,
      runtime: "antigravity",
      sourceId: `antigravity-${index + 1}`,
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
    expect(html).toContain("Antigravity");
    expect(html).toContain("12 locations");
    expect(html).toContain("24 sessions");
    expect(html).not.toContain("Showing 12 of 12 connected source records");
    expect(html).not.toContain("workspace-12");
  });

  test("shows import jobs by default instead of behind advanced diagnostics", () => {
    const setup = connectedSetup();
    setup.advanced.imports = [
      {
        discoveredCount: 12,
        failureCount: 0,
        importJobId: "job-antigravity",
        importedCount: 4,
        importKind: "metadata",
        queuedCount: 8,
        sourceId: "antigravity-workspace",
        status: "running",
        updatedAt: "2026-06-27T12:00:00.000Z"
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

    expect(html).toContain("Import jobs");
    expect(html).toContain("antigravity-workspace");
    expect(html).toContain("metadata");
    expect(html).not.toContain("Advanced diagnostics");
  });

  test("keeps setup empty state focused on onboarding instead of unconnected harnesses", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[
          {
            runtime: "gemini_cli",
            name: "Gemini CLI",
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
    expect(html).not.toContain("Gemini CLI");
    expect(html).not.toContain("Harnesses Masthead knows how to check");
  });

  test("summarizes large connected source inventories by source family", () => {
    const setup = connectedSetup();
    setup.connectedSources = Array.from({ length: 20 }, (_, index) => ({
      discoveredSessions: 1,
      importedSessions: 1,
      label: `Source ${index + 1}`,
      runtime: "codex",
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
        label: "Codex sessions",
        lastSyncAt: "2026-06-27T12:00:00.000Z",
        needsAttention: ["transcript_import", "enrichment"],
        queuedRecords: 14,
        runtime: "codex",
        sourceId: "codex-sessions",
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
