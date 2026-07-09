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
    expect(html).toContain("Search published artifacts");
    expect(html).not.toContain("Session library");
    expect(html).not.toContain("Search and inspect durable agent-session history.");
    expect(html).toContain("TITLE / HIGHLIGHT");
    expect(html).toContain("KIND");
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
              runtime: "opencode",
              sessionId: "session-1",
              snippet: 'Import <script>alert("x")</script> OpenCode history into <mark>SQLite</mark>',
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
    expect(html).toContain("OpenCode history into");
    expect(html).toContain("<mark>SQLite</mark>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("logbook-summary-strip");
    expect(html).not.toContain(">Sessions</dt>");
    expect(html).not.toContain(">Messages</dt>");
    expect(html).not.toContain(">Tool calls</dt>");
    expect(html).not.toContain("stat-strip");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).not.toContain("Showing 1 of 1");
  });

  test("surfaces Kind / Project / Date / Query facets and omits Sort", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        filters={{
          dateFrom: "2026-06-01",
          kind: "runbook",
          project: "Masthead"
        }}
        loadState={{ state: "ready", sessions: [], total: 1 }}
        loading={false}
        query="incident"
        sort="oldest"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain('aria-label="Active Logbook filters"');
    expect(html).toContain("Query: incident");
    expect(html).toContain("Remove Query filter");
    expect(html).toContain("Kind: Runbook");
    expect(html).toContain("Remove Kind filter");
    expect(html).toContain("Project: Masthead");
    expect(html).toContain("Remove Project filter");
    expect(html).toContain("From: 2026-06-01");
    expect(html).toContain("Remove From filter");
    expect(html).not.toContain("Sort:");
    expect(html).not.toContain("Remove Sort filter");
    expect(html).not.toContain("Runtime filter");
    expect(html).not.toContain("Model filter");
    expect(html).not.toContain("Enrich summaries");
  });

  test("does not render session-era summary strip metrics", () => {
    const html = renderToStaticMarkup(
      <HistoryPanel
        loadState={{ state: "ready", sessions: [], total: 0 }}
        loading={false}
        query=""
        onQueryChange={() => {}}
      />
    );

    expect(html).not.toContain("logbook-summary-strip");
    expect(html).not.toContain(">Sessions</dt>");
    expect(html).not.toContain(">Messages</dt>");
    expect(html).not.toContain(">Tool calls</dt>");
    expect(html).not.toContain("<dt>Date range</dt>");
    expect(html).not.toContain("May 2026 - Jun 2026");
    expect(html).toContain("No published artifacts yet.");
    expect(html).toContain("Compile and publish from Workbench.");
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
            runtime: "opencode",
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
            runtime: "opencode",
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
            runtime: "opencode",
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

    expect(html).toContain('aria-label="Loading published artifacts"');
    expect(html).toContain("Loading published artifacts");
    expect(html).toContain("<table");
    expect(html).toContain("TITLE / HIGHLIGHT");
    expect(html).toContain("KIND");
    expect(html).toContain("PROJECT");
    expect(html).toContain("PROVENANCE");
    expect(html).not.toContain("logbook-summary-strip");
    expect(html).not.toContain(">Sessions</dt>");
    expect(html).not.toContain(">Messages</dt>");
    expect(html).not.toContain(">Tool calls</dt>");
    expect(html).not.toContain("Date range");
    expect(html).not.toContain("Records</dt>");
    expect(html).not.toContain('class="usage-metric ');
    expect(html).toContain("logbook-loading-inspector");
    expect(html).toContain("logbook-footer observability-toolbar metal-toolbar logbook-skeleton-footer");
    expect(html).toContain("logbook-page-button toolbar-icon-button");
    expect(html).toContain("logbook-skeleton-table-frame");
    expect((html.match(/logbook-skeleton-row/g) ?? []).length).toBe(24);
    expect(html).not.toContain("No sessions");
    expect(html).not.toContain("Logbook could not read");
  });

  test("renders no-match queries with an empty state instead of summary metrics", () => {
    const html = renderToStaticMarkup(<HistoryPanel records={records()} query="project:Missing" onQueryChange={() => {}} />);

    expect(html).toContain("Logbook");
    expect(html).not.toContain("Session library");
    expect(html).not.toContain("logbook-summary-strip");
    expect(html).not.toContain(">Sessions</dt>");
    expect(html).not.toContain("<dd>0</dd>");
    expect(html).not.toContain("Showing 0 of 0; searching 0 local records");
    expect(html).not.toContain("History case");
  });

  test("renders artifact-first empty and filter-miss copy", () => {
    const empty = renderToStaticMarkup(
      <HistoryPanel loadState={{ state: "ready", sessions: [], total: 0 }} loading={false} query="" onQueryChange={() => {}} />
    );
    expect(empty).toContain("No published artifacts yet.");
    expect(empty).toContain("Compile and publish from Workbench.");
    expect(empty).not.toContain("No sessions imported yet.");

    const filtered = renderToStaticMarkup(
      <HistoryPanel
        filters={{ project: "Missing" }}
        loadState={{ state: "ready", sessions: [], total: 0 }}
        loading={false}
        query="incident"
        onFilterChange={() => undefined}
        onQueryChange={() => {}}
      />
    );
    expect(filtered).toContain("No artifacts match these filters.");
    expect(filtered).not.toContain("No sessions match these filters.");
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
        source: { adapter: "opencode", surface: "fixture", sourceEventId: "event-1" },
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


