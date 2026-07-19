import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SidebarImportActivity } from "../SidebarImportActivity";

describe("SidebarImportActivity", () => {
  test("keeps a compact per-harness import-health receipt visible when repair is required", () => {
    const html = renderToStaticMarkup(
      <SidebarImportActivity
        imports={[
          {
            completionReport: {
              anomalies: [],
              cappedUnits: 300,
              dossierReadySessions: 0,
              enrichedSessions: 0,
              failedUnits: 0,
              generatedAt: "2026-07-15T12:00:00.000Z",
              importJobId: "import-opencode",
              logbookSearchableSessions: 0,
              mcpVisibleSessions: 0,
              nextActions: ["repair_import"],
              outOfRangeSessions: 0,
              recordsFailed: 121,
              recordsImported: 500,
              recordsRecognized: 500,
              recordsRejected: 121,
              recordsSkipped: 0,
              runtime: "opencode",
              sessionsCreated: 500,
              sessionsDiscovered: 512,
              sessionsFinalized: 500,
              sessionsOnPackagePath: 102,
              sessionsRepairRequired: 12,
              sessionsSuppressed: 386,
              sessionsUpdated: 0,
              skippedUnits: 0,
              status: "succeeded_with_issues",
              timestampBasis: { file_modified: 20, semantic: 480, source_path: 0, unknown: 0 },
              transcriptsImported: 500
            },
            discoveredCount: 800,
            failureCount: 0,
            importJobId: "import-opencode",
            importKind: "transcript",
            importedCount: 500,
            queuedCount: 0,
            sourceId: "opencode:history",
            status: "succeeded_with_issues",
            updatedAt: "2026-07-15T12:00:00.000Z"
          }
        ]}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(html).toContain('class="sidebar-import-activity is-health"');
    expect(text).toContain("OpenCode");
    expect(text).toContain("500 recognized · 121 rejected");
    expect(text).toContain("500 canonical · 102 package · 12 repair");
    expect(text).toContain("386 noise · 300 capped");
  });
});
