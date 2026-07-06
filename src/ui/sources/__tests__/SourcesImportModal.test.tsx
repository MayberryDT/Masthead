// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SourcesImportPreview } from "../../../app/daemonClient";
import { SourcesImportModal } from "../SourcesImportModal";

describe("SourcesImportModal", () => {
  test("renders harness-first choices and import age preview", () => {
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[
          {
            discoveredSessions: 7,
            importedSessions: 0,
            name: "OpenCode",
            policies: { enrichment: false, mcpAccess: true, metadataImport: true, transcriptImport: false },
            runtime: "opencode",
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
            runtime: "opencode",
            summary: {
              excludedUnits: 1,
              generatedAt: "2026-07-01T00:00:00.000Z",
              importJobId: "preview:opencode",
              importKind: "transcript",
              includedUnits: 2,
              manifestId: "",
              runtime: "opencode",
              scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
              estimatedRecords: 7,
              totalBytes: 120,
              totalUnits: 3
            }
          }
        ]}
      />
    );

    expect(html).toContain("Import history");
    expect(html).toContain("Harnesses");
    expect(html).toContain("OpenCode");
    expect(html).toContain("Recent");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Full archive");
    expect(html).toContain("All detected history");
    expect(html).toContain("Sessions to import");
    expect(html).toContain("<dd>7</dd>");
    expect(html).not.toContain("Coding harness");
    expect(html).not.toContain("OpenCode local hook");
    expect(html).not.toContain("Preview");
    expect(html).not.toContain("Includes changed transcripts");
    expect(html).not.toContain("Every file remains visible");
    expect(html).not.toContain(".opencode/sessions");
  });

  test("uses preview runtimes as selectable harnesses when adapter rows are unavailable", () => {
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[]}
        onClose={() => undefined}
        onPreviewImport={() => Promise.resolve([])}
        onRunSetup={() => undefined}
        open
        previews={[
          previewForRuntime("opencode", 500, 912, 5_614_987_264, 742),
          previewForRuntime("cursor", 2, 0, 1_153_433, 28)
        ]}
      />
    );

    expect(html).toContain("2 harnesses");
    expect(html).toContain("2 selected");
    expect(html).toContain("OpenCode");
    expect(html).toContain("Cursor");
    expect(html).toContain("Sessions to import");
    expect(html).toContain("<dd>742</dd>");
    expect(html).toContain("<dd>28</dd>");
    expect(html).not.toContain("Files");
    expect(html).not.toContain("Skipped");
    expect(html).not.toContain("No importable harnesses found.");
  });

  test("shows loading sessions while the initial estimate is pending", async () => {
    let resolvePreview: (value: SourcesImportPreview[]) => void = () => undefined;
    const onPreviewImport = vi.fn(
      () =>
        new Promise<SourcesImportPreview[]>((resolve) => {
          resolvePreview = resolve;
        })
    );
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SourcesImportModal
          adapters={[
            {
              discoveredSessions: 0,
              importedSessions: 0,
              name: "OpenCode",
              policies: { enrichment: false, mcpAccess: true, metadataImport: true, transcriptImport: true },
              runtime: "opencode",
              sourceLocationCount: 2,
              sourceLocations: [],
              state: "connected"
            }
          ]}
          onClose={() => undefined}
          onPreviewImport={onPreviewImport}
          onRunSetup={() => undefined}
          open
        />
      );
    });

    expect(onPreviewImport).toHaveBeenCalledWith(expect.objectContaining({ runtimes: ["opencode"] }));
    expect(container.textContent).toContain("Loading sessions");
    expect(container.textContent).not.toContain("Estimate unavailable");

    await act(async () => {
      resolvePreview([previewForRuntime("opencode", 3, 0, 120, 12)]);
    });

    expect(container.textContent).toContain("12");
    await act(async () => root.unmount());
  });

  test("does not offer unsupported runtime previews for import", () => {
    const unsupportedRuntime = "legacy_harness" as SourcesImportPreview["summary"]["runtime"];
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[
          {
            discoveredSessions: 38,
            importedSessions: 0,
            name: "Legacy Harness",
            policies: { enrichment: false, mcpAccess: true, metadataImport: true, transcriptImport: true },
            runtime: unsupportedRuntime,
            sourceLocationCount: 1,
            sourceLocations: [],
            state: "connected"
          }
        ]}
        onClose={() => undefined}
        onPreviewImport={() => Promise.resolve([previewForRuntime(unsupportedRuntime, 38, 0, 120, 38)])}
        onRunSetup={() => undefined}
        open
      />
    );

    expect(html).not.toContain("Legacy Harness");
    expect(html).not.toContain("38</dd>");
    expect(html).toContain("No importable harnesses found.");
  });

  test("uses a no-sessions result when a completed preview has no estimate", () => {
    const preview = previewForRuntime("opencode", 0, 0, 0, undefined);
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[]}
        onClose={() => undefined}
        onPreviewImport={() => Promise.resolve([])}
        onRunSetup={() => undefined}
        open
        previews={[preview]}
      />
    );

    expect(html).toContain("OpenCode");
    expect(html).toContain("No sessions found");
    expect(html).not.toContain("Estimate unavailable");
  });
});

function previewForRuntime(
  runtime: SourcesImportPreview["summary"]["runtime"],
  includedUnits: number,
  excludedUnits: number,
  totalBytes: number,
  estimatedRecords: number | undefined
): SourcesImportPreview {
  const summary: SourcesImportPreview["summary"] = {
    excludedUnits,
    generatedAt: "2026-07-01T00:00:00.000Z",
    importJobId: `preview:${runtime}`,
    importKind: "transcript" as const,
    includedUnits,
    manifestId: "",
    runtime,
    scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent" as const, unitLimit: 500 },
    totalBytes,
    totalUnits: includedUnits + excludedUnits
  };
  if (estimatedRecords !== undefined) summary.estimatedRecords = estimatedRecords;
  return {
    runtime,
    summary
  };
}
