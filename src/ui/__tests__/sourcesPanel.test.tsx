import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SourcesPanel } from "../SourcesPanel";

describe("SourcesPanel", () => {
  test("renders detected paths and import progress without raw transcript text", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        adapters={[
          {
            runtime: "codex",
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
        onImportCodexMetadata={() => undefined}
        onRefresh={() => undefined}
      />
    );

    expect(html).toContain("Codex");
    expect(html).toContain("/home/tyler/.codex/sessions");
    expect(html).toContain("742");
    expect(html).toContain("IMPORT JOBS");
    expect(html).toContain("running");
    expect(html).toContain("Metadata import ready");
    expect(html).not.toContain("surface-card-grid");
    expect(html).not.toContain("source-card");
    expect(html).not.toContain("transcript");
  });
});
