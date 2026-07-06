import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportProgressPanel } from "../ImportProgressPanel";

describe("ImportProgressPanel", () => {
  test("shows heartbeat, work units, and grouped failures", () => {
    const html = renderToStaticMarkup(
      <ImportProgressPanel
        failureGroups={[
          {
            code: "malformed_json",
            count: 3,
            failureGroupId: "fg-1",
            failureKind: "malformed",
            firstSeenAt: "2026-07-01T00:00:00.000Z",
            importJobId: "job-1",
            lastSeenAt: "2026-07-01T00:01:00.000Z",
            message: "Malformed JSON.",
            retryable: false,
            runtime: "codex",
            samplePaths: ["/tmp/bad.jsonl"]
          }
        ]}
        job={{
          completedWorkUnits: 4,
          discoveredCount: 10,
          failedWorkUnits: 1,
          failureCount: 3,
          heartbeatAt: "2026-07-01T00:01:00.000Z",
          importJobId: "job-1",
          importedCount: 6,
          importKind: "transcript",
          processedCount: 9,
          queuedCount: 0,
          skippedWorkUnits: 2,
          sourceId: "codex-sessions",
          stage: "transcript",
          status: "running",
          totalWorkUnits: 7,
          updatedAt: "2026-07-01T00:01:00.000Z"
        }}
        units={[
          {
            failedRecords: 0,
            importedRecords: 6,
            importJobId: "job-1",
            manifestId: "manifest-1",
            processedRecords: 6,
            runtime: "codex",
            confidence: "authoritative",
            skippedRecords: 0,
            sourceId: "codex-sessions",
            sourceKind: "jsonl",
            sourcePath: "/tmp/session.jsonl",
            status: "succeeded",
            unitKind: "transcript_file",
            workUnitId: "unit-1"
          }
        ]}
      />
    );

    expect(html).toContain("transcript");
    expect(html).toContain("4 / 7");
    expect(html).toContain("Malformed JSON.");
    expect(html).toContain("session.jsonl");
  });


  test("uses indeterminate progress when an active import only knows processed-so-far records", () => {
    const html = renderToStaticMarkup(
      <ImportProgressPanel
        job={{
          discoveredCount: 4,
          failureCount: 0,
          heartbeatAt: "2026-07-01T00:01:00.000Z",
          importJobId: "job-indeterminate",
          importKind: "metadata",
          importedCount: 4,
          processedCount: 4,
          queuedCount: 0,
          sourceId: "claude-code-sessions",
          stage: "metadata",
          startedAt: "2026-07-01T00:00:00.000Z",
          status: "running",
          updatedAt: "2026-07-01T00:01:00.000Z"
        }}
        nowMs={new Date("2026-07-01T00:01:00.000Z").getTime()}
      />
    );

    expect(html).toContain("is-indeterminate");
    expect(html).toContain("Discovering…");
    expect(html).toContain("4 / ?");
    expect(html).toContain("Elapsed");
    expect(html).toContain("1 min");
    expect(html).not.toContain("aria-valuenow");
  });
  test("shows determinate record progress with elapsed time and stale heartbeat warning", () => {
    const html = renderToStaticMarkup(
      <ImportProgressPanel
        job={{
          discoveredCount: 10,
          failureCount: 0,
          heartbeatAt: "2026-07-01T00:00:00.000Z",
          importJobId: "job-2",
          importKind: "metadata",
          importedCount: 0,
          processedCount: 5,
          queuedCount: 0,
          sourceId: "codex-sessions",
          startedAt: "2026-07-01T00:00:00.000Z",
          status: "running",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }}
        nowMs={new Date("2026-07-01T00:02:00.000Z").getTime()}
      />
    );

    expect(html).toContain("import-progress-bar");
    expect(html).toContain("aria-valuenow=\"5\"");
    expect(html).toContain("aria-valuemin=\"0\"");
    expect(html).toContain("aria-valuemax=\"10\"");
    expect(html).toContain("50%");
    expect(html).toContain("Elapsed");
    expect(html).toContain("2 min");
    expect(html).toContain("is-stale");
    expect(html).toContain("No import heartbeat");
    expect(html).toContain("stalled");
  });
});
