import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OperationsPanel } from "../OperationsPanel";

describe("OperationsPanel", () => {
  test("renders local export and delete controls", () => {
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Export data");
    expect(html).toContain("Delete raw copies");
    expect(html).toContain("Delete all Masthead data");
    expect(html).toContain("Keeps normalized session metadata, summaries, and search records.");
    expect(html).toContain("Original harness files are untouched.");
    expect(html).toContain("Codex integration");
    expect(html).not.toContain("ops-card");
    expect(html).not.toContain("ghost-pill");
    expect(html).not.toContain("Manual 30-day prune");
    expect(html).not.toContain("latest 500 records");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
  });

  test("renders explicit delete confirmation state", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        localDataStatus={{
          state: "confirm_delete",
          message: "Confirm delete all Masthead data. Original harness files remain untouched."
        }}
      />
    );

    expect(html).toContain("Confirm delete all Masthead data");
    expect(html).toContain("Cancel");
    expect(html).toContain("Confirm delete all Masthead data. Original harness files remain untouched.");
  });

  test("renders explicit retention confirmation state", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        localDataStatus={{
          state: "confirm_prune",
          message: "Confirm deletion of 4 raw source copies. Normalized session metadata, summaries, and search records stay available."
        }}
      />
    );

    expect(html).toContain("Confirm raw source copy deletion");
    expect(html).toContain("Delete raw copies");
    expect(html).toContain("Confirm deletion of 4 raw source copies.");
  });

  test("renders selective deletion controls for scoped records", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        deletionScopeKind="project"
        deletionScopeTarget="Pip"
        localDataStatus={{
          state: "confirm_scoped_delete",
          message: "Confirm scoped deletion for project Pip."
        }}
      />
    );

    expect(html).toContain("Delete scoped records");
    expect(html).toContain("Project");
    expect(html).toContain("Pip");
    expect(html).toContain("Confirm scoped deletion");
    expect(html).toContain("Confirm scoped deletion for project Pip.");
    expect(html).toContain("Cancel");
  });

  test("renders data summary preview before deletion", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={{
          auditRows: 2,
          enrichments: 1,
          messages: 3,
          rawEvents: 4,
          sessions: 5,
          sources: 1,
          storageClasses: {
            audit_logs: { description: "MCP query audit records.", records: 2, retention: "configurable" },
            canonical_metadata: { description: "Sessions and capsules.", records: 6, retention: "indefinite" },
            derived_indexes: { description: "Indexes.", records: 7, retention: "rebuildable" },
            large_outputs: { description: "Outputs.", records: 0, retention: "short_configurable" },
            raw_payloads: { description: "Raw payloads.", records: 4, retention: "configurable" },
            searchable_messages: { description: "Messages.", records: 3, retention: "indefinite_configurable" }
          },
          tables: {
            mcp_query_log: 2,
            raw_events: 4,
            session_search: 7,
            sessions: 5
          }
        }}
      />
    );

    expect(html).toContain("Storage");
    expect(html).toContain("Sessions");
    expect(html).toContain("Raw source copies");
    expect(html).toContain("5");
    expect(html).toContain("4");
  });

  test("renders local action errors without changing action labels", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel localDataStatus={{ state: "error", message: "Export failed: unavailable" }} />
    );

    expect(html).toContain("Export failed: unavailable");
    expect(html).toContain("Export data");
    expect(html).toContain("Delete all Masthead data");
  });
});
