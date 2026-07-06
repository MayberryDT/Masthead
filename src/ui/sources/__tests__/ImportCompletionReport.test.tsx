import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportCompletionReport } from "../ImportCompletionReport";

describe("ImportCompletionReport", () => {
  test("shows what Masthead gained from an import", () => {
    const html = renderToStaticMarkup(
      <ImportCompletionReport
        report={{
          dossierReadySessions: 4,
          enrichedSessions: 0,
          failedUnits: 1,
          generatedAt: "2026-07-01T00:00:00.000Z",
          importJobId: "job-1",
          logbookSearchableSessions: 6,
          mcpVisibleSessions: 6,
          nextActions: ["retry_failed_units", "open_logbook"],
          recordsFailed: 1,
          recordsImported: 12,
          recordsSkipped: 2,
          runtime: "opencode",
          sessionsCreated: 2,
          sessionsDiscovered: 6,
          sessionsUpdated: 4,
          skippedUnits: 2,
          status: "succeeded_with_issues",
          transcriptsImported: 12
        }}
      />
    );

    expect(html).toContain("Import report");
    expect(html).toContain("2");
    expect(html).toContain("retry failed units");
  });
});
