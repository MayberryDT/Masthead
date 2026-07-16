import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportCompletionReport } from "../ImportCompletionReport";

describe("ImportCompletionReport", () => {
  test.each([
    { status: "failed" as const, expectedText: "Failed", expectedClass: "error" },
    { status: "succeeded_with_issues" as const, expectedText: "Completed with issues", expectedClass: "warning" },
    { status: "succeeded" as const, expectedText: "Completed", expectedClass: "ready" }
  ])("renders $status with matching $expectedClass badge semantics", ({ status, expectedText, expectedClass }) => {
    const html = renderToStaticMarkup(
      <ImportCompletionReport
        report={{
          anomalies: [], cappedUnits: 0, dossierReadySessions: 0, enrichedSessions: 0, failedUnits: status === "failed" ? 1 : 0,
          generatedAt: "2026-07-15T12:00:00.000Z", importJobId: `job-${status}`, logbookSearchableSessions: 0,
          mcpVisibleSessions: 0, nextActions: [], outOfRangeSessions: 0, recordsFailed: status === "failed" ? 1 : 0,
          recordsImported: 1, recordsRecognized: 1, recordsRejected: 0, recordsSkipped: 0, runtime: "opencode",
          sessionsCreated: 1, sessionsDiscovered: 1, sessionsFinalized: 1, sessionsOnPackagePath: 1,
          sessionsRepairRequired: status === "failed" ? 1 : 0, sessionsSuppressed: 0, sessionsUpdated: 0, skippedUnits: 0, status,
          timestampBasis: { file_modified: 0, semantic: 1, source_path: 0, unknown: 0 }, transcriptsImported: 1
        }}
      />
    );

    expect(html).toContain(`class="source-state ${expectedClass}"`);
    expect(html).toContain(`>${expectedText}</span>`);
  });

  test("does not label outside-range deferrals as safety-cap deferrals", () => {
    const html = renderToStaticMarkup(
      <ImportCompletionReport
        report={{
          anomalies: [], cappedUnits: 300, dossierReadySessions: 0, enrichedSessions: 0, failedUnits: 0,
          generatedAt: "2026-07-15T12:00:00.000Z", importJobId: "job-mixed", logbookSearchableSessions: 0,
          mcpVisibleSessions: 0, nextActions: [], outOfRangeSessions: 120, recordsFailed: 0, recordsImported: 500,
          recordsRecognized: 500, recordsRejected: 0, recordsSkipped: 0, runtime: "opencode", sessionsCreated: 500,
          sessionsDiscovered: 500, sessionsFinalized: 500, sessionsOnPackagePath: 500, sessionsRepairRequired: 0,
          sessionsSuppressed: 0, sessionsUpdated: 0, skippedUnits: 420, sourceUnitsDeferred: 420,
          sourceUnitsHydrated: 500, status: "succeeded", timestampBasis: { file_modified: 0, semantic: 500, source_path: 0, unknown: 0 },
          transcriptsImported: 500
        }}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(text).toContain("300 recent units deferred by the safety cap");
    expect(text).toContain("120 units deferred for other scope reasons");
    expect(text).not.toContain("420 recent units deferred by the safety cap");
  });

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

  test("shows a sessionless repair-required unit as repairable rather than Not Added", () => {
    const onPreviewRepair = () => undefined;
    const html = renderToStaticMarkup(
      <ImportCompletionReport
        onPreviewRepair={onPreviewRepair}
        report={{
          anomalies: [], cappedUnits: 0, dossierReadySessions: 0, enrichedSessions: 0, failedUnits: 0,
          generatedAt: "2026-07-15T12:00:00.000Z", importHealth: {
            complete: 0, diagnostics: [], partial: 0,
            reasons: [{ count: 1, reason: "missing_session_identity" }], repairRequired: 1, total: 1
          }, importJobId: "job-sessionless-repair", logbookSearchableSessions: 0, mcpVisibleSessions: 0,
          nextActions: ["repair_import"], outOfRangeSessions: 0, recordsFailed: 1, recordsImported: 0,
          recordsRecognized: 0, recordsRejected: 1, recordsSkipped: 0, runtime: "opencode", sessionsCreated: 0,
          sessionsDiscovered: 0, sessionsFinalized: 0, sessionsOnPackagePath: 0, sessionsRepairRequired: 0,
          sessionsSuppressed: 0, sessionsUpdated: 0, skippedUnits: 0, status: "succeeded_with_issues",
          timestampBasis: { file_modified: 0, semantic: 0, source_path: 0, unknown: 1 }, transcriptsImported: 0
        }}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(html).toContain('class="import-completion-report needs-repair"');
    expect(text).toContain("Needs import repair");
    expect(text).toContain("1 repair unit needs import repair");
    expect(text).toContain("Preview import repair");
    expect(text).not.toContain("Not Added");
    expect(text).not.toContain("1 sessions need import repair");
  });
});
