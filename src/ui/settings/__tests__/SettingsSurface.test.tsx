import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SettingsStateDto } from "../../../app/daemonClient";
import { SettingsSurface } from "../../../app/surfaces/SettingsSurface";
import { OperationsPanel } from "../../OperationsPanel";

describe("Settings surface", () => {
  test("renders real settings rows and shared controls instead of the old card grid", () => {
    const html = renderToStaticMarkup(
      <SettingsSurface>
        <OperationsPanel
          dataSummary={settings.storage.dataSummary}
          deletionScopeKind="project"
          deletionScopeTarget="Masthead"
          settingsState={settings}
        />
      </SettingsSurface>
    );

    expect(html).toContain("Codex integration");
    expect(html).toContain("Lifecycle hooks");
    expect(html).toContain("Installed");
    expect(html).toContain("Deterministic fallback");
    expect(html).toContain("MCP access");
    expect(html).toContain("/home/tyler/.local/share/masthead/masthead.sqlite");
    expect(html).toContain("Export data");
    expect(html).not.toContain("ops-card");
    expect(html).not.toContain("ghost-pill");
    expect(html).not.toContain("<select");
  });

  test("renders a separate confirmation dialog for destructive actions", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={settings.storage.dataSummary}
        localDataStatus={{
          state: "confirm_delete",
          message: "Confirm delete all Masthead data: 31 sessions and 7,657 raw source copies."
        }}
        settingsState={settings}
      />
    );

    expect(html).toContain("Danger zone");
    expect(html).toContain("Confirm delete all Masthead data");
    expect(html).toContain("31 sessions");
    expect(html).toContain("7,657 raw source copies");
    expect(html).toContain("Cancel");
  });
});

const settings: SettingsStateDto = {
  deletionTargets: {
    hosts: [{ label: "Veelox", value: "Veelox" }],
    projects: [{ label: "Masthead", value: "Masthead" }],
    runtimes: [{ label: "codex", value: "codex" }]
  },
  enrichment: {
    currentEnrichments: 31,
    health: {
      complete: 31,
      disabled: 0,
      failed: 0,
      queued: 0,
      status: "complete"
    },
    model: "deterministic",
    provider: "Deterministic fallback",
    remoteModelEnabled: false,
    sessionCount: 31
  },
  hooks: {
    command: "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js",
    configExists: true,
    configPath: "/home/tyler/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    latestBackupPath: "/home/tyler/.codex/hooks.json.masthead-backup.json",
    lastEventAt: "2026-06-25T12:00:00.000Z",
    missingEvents: [],
    mismatchedEvents: []
  },
  privacy: {
    mcpAccessEnabled: true,
    redactionEnabled: true,
    transcriptImportEnabled: true
  },
  storage: {
    dataSummary: {
      auditRows: 2,
      enrichments: 31,
      messages: 120,
      rawEvents: 7657,
      sessions: 31,
      sources: 4,
      storageClasses: {
        audit_logs: { description: "MCP query audit records.", records: 2, retention: "configurable" },
        canonical_metadata: { description: "Sessions and capsules.", records: 31, retention: "indefinite" },
        derived_indexes: { description: "Indexes.", records: 31, retention: "rebuildable" },
        large_outputs: { description: "Outputs.", records: 0, retention: "short_configurable" },
        raw_payloads: { description: "Raw payloads.", records: 7657, retention: "configurable" },
        searchable_messages: { description: "Messages.", records: 120, retention: "indefinite_configurable" }
      },
      tables: {
        mcp_query_log: 2,
        raw_events: 7657,
        session_search: 31,
        sessions: 31
      }
    },
    databasePath: "/home/tyler/.local/share/masthead/masthead.sqlite",
    storePath: "/home/tyler/.local/share/masthead/events.ndjson"
  }
};
