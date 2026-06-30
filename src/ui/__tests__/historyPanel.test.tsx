import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreRecord } from "../../core/store";
import { filtersFromQuery, HistoryPanel } from "../HistoryPanel";

describe("HistoryPanel", () => {
  test("parses explicit PRD history search filters", () => {
    expect(
      filtersFromQuery(
        "project:App session:session-1 file:src/app.ts command:\"npm test\" status:failed branch:agent/demo alert:conflict conflict:shared_resource outcome:needs_review disposition:reviewed"
      )
    ).toEqual({
      project: "App",
      sessionId: "session-1",
      filePath: "src/app.ts",
      command: "npm test",
      status: "failed",
      branch: "agent/demo",
      alertType: "conflict",
      conflictType: "shared_resource",
      outcome: "needs_review",
      disposition: "reviewed"
    });
  });

  test("renders searchable local history without raw session metadata or unsafe actions", () => {
    const html = renderToStaticMarkup(<HistoryPanel records={records()} query="project:App" onQueryChange={() => {}} />);

    expect(html).toContain("Logbook");
    expect(html).toContain("Search all session history");
    expect(html).not.toContain("Session library");
    expect(html).not.toContain("Search and inspect durable agent-session history.");
    expect(html).toContain("SESSION / MATCH");
    expect(html).toContain("Session needs review");
    expect(html).not.toContain("Showing 1 of 1; searching");
    expect(html).not.toContain("searching 1 local records");
    expect(html).not.toContain("surface-card-grid");
    expect(html).not.toContain("logbook-card");
    expect(html).not.toContain("History case");
    expect(html).not.toContain("src/app.ts");
    expect(html).not.toContain("agent/demo");
    expect(html).not.toContain("stale_verification");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
  });

  test("renders database-backed Logbook sessions", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: [
            {
              project: "Masthead",
              runtime: "codex",
              sessionId: "session-1",
              snippet: 'Import <script>alert("x")</script> Codex history into <mark>SQLite</mark>',
              state: "unknown",
              title: "Masthead data layer"
            }
          ],
          total: 1
        }}
        loading={false}
        query="sqlite"
        onQueryChange={() => {}}
      />
    );

    expect(html).toContain("Masthead data layer");
    expect(html).toContain("Codex history into");
    expect(html).toContain("<mark>SQLite</mark>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("logbook-summary-strip");
    expect(html).toContain("usage-metric sessions");
    expect(html).not.toContain("stat-strip");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).not.toContain("Showing 1 of 1");
  });

  test("renders more than six database-backed sessions and exposes detail actions", () => {
    const opened: string[] = [];
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: Array.from({ length: 8 }, (_, index) => ({
            fileCount: index,
            hostId: "host:test",
            lifecycle: "ended",
            models: ["gpt-5"],
            project: "Masthead",
            runtime: "codex",
            sessionId: `session-${index + 1}`,
            sourceConfidence: "authoritative",
            sourceSessionId: `source-session-${index + 1}`,
            title: `Session ${index + 1}`,
            toolCount: index + 1,
            topics: ["session-memory"]
          })),
          total: 8
        }}
        loading={false}
        query=""
        onQueryChange={() => {}}
        onSessionSelect={(sessionId) => opened.push(sessionId)}
      />
    );

    expect(opened).toEqual([]);
    expect(html).toContain("Session 1");
    expect(html).toContain("Session 8");
    expect(html).toContain("<table");
    expect(html).not.toContain("Showing 8 of 8");
  });

  test("renders page controls for canonical Logbook pages instead of load more", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: Array.from({ length: 100 }, (_, index) => ({
            project: "Masthead",
            runtime: "codex",
            sessionId: `session-${index + 1}`,
            title: `Session ${index + 1}`
          })),
          total: 250
        }}
        loading={false}
        pageIndex={1}
        pageSize={100}
        query=""
        onPageChange={() => undefined}
        onQueryChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="First page"');
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
    expect(html).toContain('aria-label="Last page"');
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain("logbook-footer observability-toolbar metal-toolbar has-pagination");
    expect(html).toContain("logbook-page-button toolbar-icon-button");
    expect(html).not.toContain("Showing 101-200 of 250");
    expect(html).not.toContain("searching 250 canonical sessions");
    expect(html).not.toContain("Load more");
  });

  test("renders a table-shaped skeleton while refreshing a canonical page", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: Array.from({ length: 100 }, (_, index) => ({
            project: "Masthead",
            runtime: "codex",
            sessionId: `session-${index + 1}`,
            title: `Session ${index + 1}`
          })),
          total: 250
        }}
        loading
        pageIndex={1}
        pageSize={100}
        query=""
        onPageChange={() => undefined}
        onQueryChange={() => {}}
      />
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading next Logbook page"');
    expect(html).toContain("Page 2 of 3");
    expect(html).not.toContain("Loading Logbook page");
    expect(html).toContain("<table");
    expect(html).toContain("logbook-page-loading");
    expect(html).not.toContain("Session 1");
  });

  test("renders first-run canonical loading as a Logbook table and inspector skeleton", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{ state: "loading" }}
        query=""
        onQueryChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Loading Logbook session records"');
    expect(html).toContain("Loading session records");
    expect(html).toContain("<table");
    expect(html).toContain("SESSION / MATCH");
    expect(html).toContain("PROJECT");
    expect(html).toContain("logbook-loading-inspector");
    expect(html).toContain("logbook-skeleton-footer");
    expect(html).toContain("logbook-skeleton-table-frame");
    expect((html.match(/logbook-skeleton-row/g) ?? []).length).toBe(24);
    expect(html).not.toContain("No sessions");
    expect(html).not.toContain("Logbook could not read");
  });

  test("renders no-match queries with an explicit zero result count", () => {
    const html = renderToStaticMarkup(<HistoryPanel records={records()} query="project:Missing" onQueryChange={() => {}} />);

    expect(html).toContain("Logbook");
    expect(html).not.toContain("Session library");
    expect(html).toContain("<dd>0</dd>");
    expect(html).not.toContain("Showing 0 of 0; searching 0 local records");
    expect(html).not.toContain("History case");
  });

  test("does not fall back to local history when the canonical Logbook request fails", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        records={records()}
        loadState={{ state: "error", message: "logbook search failed: 405" }}
        query="project:App"
        onQueryChange={() => {}}
      />
    );

    expect(html).toContain("Logbook could not read the Masthead session database.");
    expect(html).toContain("logbook search failed: 405");
    expect(html).not.toContain("Session needs review");
  });
});

function records(): StoreRecord[] {
  return [
    {
      recordId: "record:event:event-1",
      recordType: "event",
      observedAt: "2026-06-23T07:00:00.000Z",
      value: {
        schemaVersion: 1,
        eventId: "event-1",
        sessionId: "session-1",
        source: { adapter: "codex", surface: "fixture", sourceEventId: "event-1" },
        occurredAt: "2026-06-23T07:00:00.000Z",
        receivedAt: "2026-06-23T07:00:00.000Z",
        type: "session.started",
        workspace: {
          repoRoot: "/workspace/app",
          worktreePath: "/workspace/app",
          gitCommonDir: "/workspace/app/.git",
          branch: "agent/demo"
        },
        summary: "Started",
        payload: { project: "App", title: "History case" },
        sensitivity: "metadata",
        payloadHash: "hash-event-1",
        evidence: [{ id: "event-1", kind: "event", observedAt: "2026-06-23T07:00:00.000Z", source: "fixture" }]
      }
    },
    {
      recordId: "record:git_snapshot:snapshot-1",
      recordType: "git_snapshot",
      observedAt: "2026-06-23T07:01:00.000Z",
      value: {
        snapshotId: "snapshot-1",
        sessionId: "session-1",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/demo",
        changedPaths: [{ path: "src/app.ts", status: "modified", staged: false, sensitivity: "metadata" }],
        observedAt: "2026-06-23T07:01:00.000Z"
      }
    },
    {
      recordId: "record:attention_item:attention-1",
      recordType: "attention_item",
      observedAt: "2026-06-23T07:02:00.000Z",
      value: {
        itemId: "attention-1",
        sessionId: "session-1",
        project: "App",
        type: "stale_verification",
        severity: "P2",
        title: "Verification is stale",
        createdAt: "2026-06-23T07:02:00.000Z",
        affectedPaths: ["src/app.ts"],
        affectedCommandIds: ["cmd-test"],
        evidence: [{ id: "event-1", kind: "event", observedAt: "2026-06-23T07:00:00.000Z", source: "fixture" }],
        support: "deterministic",
        suggestedNextAction: "Re-run verification."
      }
    }
  ];
}
