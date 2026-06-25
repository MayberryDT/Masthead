import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LogbookTable } from "../LogbookTable";

describe("LogbookTable", () => {
  test("renders canonical sessions as a semantic dense table without card grid classes", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="comfortable"
        selectedSessionId="session-1"
        sessions={[
          {
            endedAt: "2026-06-25T22:52:00.000Z",
            errorCount: 0,
            fileCount: 9,
            hostId: "host:test",
            lastActivityAt: "2026-06-25T22:42:00.000Z",
            lifecycle: "ended",
            model: "gpt-5",
            models: ["gpt-5"],
            project: "Pip",
            runtime: "codex",
            sessionId: "session-1",
            snippet: "Repair <mark>OAuth</mark> callback return path",
            sourceConfidence: "authoritative",
            sourceSessionId: "source-session-1",
            startedAt: "2026-06-25T22:12:00.000Z",
            title: "Repair OAuth callback",
            toolCount: 14
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain("SESSION / MATCH");
    expect(html).toContain("SOURCE");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("<mark>OAuth</mark>");
    expect(html).toContain("Pip");
    expect(html).toContain("Codex");
    expect(html).toContain("Authoritative");
    expect(html).toContain("host:test");
    expect(html).toContain("9");
    expect(html).toContain("14");
    expect(html).toContain("40m");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("surface-card-grid");
    expect(html).not.toContain("surface-data-card");
    expect(html).not.toContain("logbook-card");
  });
});
