import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SourcesPanel } from "../SourcesPanel";

describe("SourcesPanel", () => {
  test("renders detected paths and import progress without raw transcript text", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        sources={[
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
        ]}
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
    expect(html).toContain("Metadata import ready");
    expect(html).not.toContain("transcript");
  });
});
