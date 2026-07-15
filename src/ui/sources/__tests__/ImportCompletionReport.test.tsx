import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportCompletionReport } from "../ImportCompletionReport";

describe("ImportCompletionReport", () => {
  test("shows what Masthead gained from an import", () => {
    const html = renderToStaticMarkup(
      <ImportCompletionReport
        report={{
          anomalies: [],
          cappedUnits: 0,
          dossierReadySessions: 4,
          enrichedSessions: 0,
          failedUnits: 1,
          generatedAt: "2026-07-01T00:00:00.000Z",
          importJobId: "job-1",
          logbookSearchableSessions: 6,
          mcpVisibleSessions: 6,
          nextActions: ["retry_failed_units", "open_logbook"],
          outOfRangeSessions: 0,
          recordsFailed: 1,
          recordsImported: 12,
          recordsRecognized: 12,
          recordsRejected: 1,
          recordsSkipped: 2,
          runtime: "opencode",
          sessionsCreated: 2,
          sessionsDiscovered: 6,
          sessionsFinalized: 6,
          sessionsOnPackagePath: 6,
          sessionsRepairRequired: 0,
          sessionsSuppressed: 0,
          sessionsUpdated: 4,
          skippedUnits: 2,
          status: "succeeded_with_issues",
          timestampBasis: { file_modified: 0, semantic: 1, source_path: 0, unknown: 0 },
          transcriptsImported: 12
        }}
      />
    );

    expect(html).toContain("Import report");
    expect(html).toContain("2");
    expect(html).toContain("retry failed units");
  });
});
