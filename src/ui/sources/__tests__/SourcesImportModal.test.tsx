import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SourcesImportModal } from "../SourcesImportModal";

describe("SourcesImportModal", () => {
  test("renders harness-first choices and import age preview", () => {
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[
          {
            discoveredSessions: 7,
            importedSessions: 0,
            name: "Codex",
            policies: { enrichment: false, mcpAccess: true, metadataImport: true, transcriptImport: false },
            runtime: "codex",
            sourceLocationCount: 2,
            sourceLocations: [],
            state: "connected"
          }
        ]}
        onClose={() => undefined}
        onPreviewImport={() => Promise.resolve([])}
        onRunSetup={() => undefined}
        open
        previews={[
          {
            runtime: "codex",
            summary: {
              excludedUnits: 1,
              generatedAt: "2026-07-01T00:00:00.000Z",
              importJobId: "preview:codex",
              importKind: "transcript",
              includedUnits: 2,
              manifestId: "",
              runtime: "codex",
              scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
              totalBytes: 120,
              totalUnits: 3
            }
          }
        ]}
      />
    );

    expect(html).toContain("Import session history");
    expect(html).toContain("Coding harness");
    expect(html).toContain("Codex");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("2 files");
    expect(html).not.toContain(".codex/sessions");
  });
});
