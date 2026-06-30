// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SettingsStateDto } from "../../app/daemonClient";
import { OperationsPanel } from "../OperationsPanel";

describe("OperationsPanel", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = undefined;
    }
    container?.remove();
    container = undefined;
    delete window.mastheadDesktop;
  });

  test("renders local export and delete controls", () => {
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Export data");
    expect(html).toContain("Delete raw copies");
    expect(html).toContain("Delete all Masthead data");
    expect(html).toContain("Keeps normalized session metadata, summaries, and search records.");
    expect(html).toContain("Original harness files are untouched.");
    expect(html).not.toContain("Codex integration");
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
    expect(html).toContain("Source copies");
    expect(html).toContain("4");
    expect(html).not.toContain("Sessions");
    expect(html).toContain("Retention classes");
  });

  test("renders local action errors without changing action labels", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel localDataStatus={{ state: "error", message: "Export failed: unavailable" }} />
    );

    expect(html).toContain("Export failed: unavailable");
    expect(html).toContain("Export data");
    expect(html).toContain("Delete all Masthead data");
  });

  test("opens the data directory through the desktop bridge", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return undefined as T;
    };
    window.mastheadDesktop = { invoke };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<OperationsPanel settingsState={settings} />);
    });
    const openButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Open folder");

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(calls).toEqual([{ command: "open_data_directory_command", args: { path: "/tmp/masthead" } }]);
    expect(container.textContent).not.toContain("open failed");
  });

  test("renders desktop bridge errors when opening the data directory fails", async () => {
    window.mastheadDesktop = {
      invoke: async () => {
        throw new Error("open failed");
      }
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<OperationsPanel settingsState={settings} />);
    });
    const openButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Open folder");

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("open failed");
  });
});

const settings: SettingsStateDto = {
  apiVersion: 1,
  capabilities: ["settings"],
  schemaVersion: 5,
  data: {
    databaseId: "sqlite:test",
    databasePath: "/tmp/masthead/masthead.sqlite",
    dataDirectory: "/tmp/masthead",
    migrationState: "ready",
    storePath: "/tmp/masthead/events.ndjson"
  },
  deletionTargets: {
    hosts: [],
    projects: [],
    runtimes: []
  },
  enrichment: {
    currentEnrichments: 0,
    health: { complete: 0, disabled: 0, failed: 0, queued: 0, status: "complete" },
    model: "deterministic",
    provider: "Deterministic fallback",
    remoteModelEnabled: false,
    sessionCount: 0
  },
  hooks: {
    command: "node scripts/masthead-hook.js",
    configExists: true,
    configPath: "/tmp/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: false,
    missingEvents: [],
    mismatchedEvents: []
  },
  privacy: {
    mcpAccessEnabled: true,
    redactionEnabled: true,
    transcriptImportEnabled: true
  },
  product: "masthead",
  runtime: {
    host: "127.0.0.1",
    mode: "primary",
    port: 17373,
    writable: true
  },
  storage: {
    dataSummary: {
      auditRows: 0,
      enrichments: 0,
      messages: 0,
      rawEvents: 0,
      sessions: 0,
      sources: 0,
      storageClasses: {
        audit_logs: { description: "MCP query audit records.", records: 0, retention: "configurable" },
        canonical_metadata: { description: "Sessions and capsules.", records: 0, retention: "indefinite" },
        derived_indexes: { description: "Indexes.", records: 0, retention: "rebuildable" },
        large_outputs: { description: "Outputs.", records: 0, retention: "short_configurable" },
        raw_payloads: { description: "Raw payloads.", records: 0, retention: "configurable" },
        searchable_messages: { description: "Messages.", records: 0, retention: "indefinite_configurable" }
      },
      tables: { raw_events: 0, session_search: 0, sessions: 0 }
    },
    databasePath: "/tmp/masthead/masthead.sqlite",
    dataDirectory: "/tmp/masthead",
    storePath: "/tmp/masthead/events.ndjson"
  }
};
