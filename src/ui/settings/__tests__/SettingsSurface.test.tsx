import { readFileSync } from "node:fs";
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

    expect(html).toContain("settings-layout");
    expect(html).toContain("settings-section-wide");
    expect(html).toContain("settings-section-danger");
    expect(html).toContain("Enrichment model");
    expect(html).toContain("API key");
    expect(html).toContain("fast, lightweight model");
    expect(html).toContain("Transcript import");
    expect(html).toContain("Redaction");
    expect(html).toContain("Codex hooks");
    expect(html).toContain("Repair hooks");
    expect(html).toContain("Capture mode");
    expect(html).toContain("MCP access");
    expect(html).toContain("MCP server");
    expect(html).toContain("Refresh MCP");
    expect(html).toContain("Codex TOML");
    expect(html).toContain("MCP JSON");
    expect(html).toContain("stdio");
    expect(html).toContain("Test MCP launch");
    expect(html).toContain("/home/tyler/.local/share/masthead/masthead.sqlite");
    expect(html).toContain("Export data");
    expect(html).toContain("Advanced runtime");
    expect(html).toContain("Retention classes");
    expect(html).not.toContain("Codex integration");
    expect(html).not.toContain("Lifecycle hooks");
    expect(html).not.toContain("Current enrichments");
    expect(html).not.toContain("Health");
    expect(html).not.toContain("Copy Codex config");
    expect(html).not.toContain("Other MCP clients");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("Can agents read Masthead?");
    expect(html).not.toContain("Agent Access");
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
    expect(html).toContain("sqlite:test");
    expect(html).toContain("API 1 / schema 5");
    expect(html).toContain("31 sessions");
    expect(html).toContain("7,657 raw source copies");
    expect(html).toContain("Cancel");
  });

  test("keeps Priority Bay fluid and gives square toggles breathing room", () => {
    const css = readFileSync("src/styles/settings.css", "utf8");

    expect(css).toMatch(/\.settings-layout-priority-bay\s*\{[\s\S]*max-width: none;/);
    expect(css).toMatch(/\.settings-toggle > span\s*\{[\s\S]*width: 42px;[\s\S]*height: 24px;/);
    expect(css).toMatch(/\.settings-toggle\.checked > span::after\s*\{[\s\S]*transform: translateX\(20px\);/);
  });

  test("uses shared card entrance motion for settings sections", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");

    expect(css).toMatch(/\.usage-summary-strip \.usage-metric,[\s\S]*\.settings-section,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: usage-card-enter 400ms cubic-bezier\(0\.17, 0\.78, 0\.13, 1\) both;[\s\S]*transform-origin: 50% 100%;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.observability-console \.session-card,[\s\S]*\.masthead-shell \.session-card,[\s\S]*animation: session-card-created 300ms cubic-bezier\(0\.17, 0\.78, 0\.13, 1\) both;[\s\S]*transform-origin: 50% 100%;/);
    expect(css).toMatch(/@keyframes usage-card-enter\s*\{[\s\S]*transform: translateY\(9px\) scale\(0\.968\);[\s\S]*transform: translateY\(-1px\) scale\(1\.004\);[\s\S]*transform: translateY\(1px\) scale\(0\.999\);[\s\S]*transform: translateY\(0\) scale\(1\);/);
    expect(css).toMatch(/@keyframes session-card-created\s*\{[\s\S]*transform: translateY\(9px\) scale\(0\.968\);[\s\S]*transform: translateY\(-1px\) scale\(1\.004\);[\s\S]*transform: translateY\(1px\) scale\(0\.999\);[\s\S]*transform: translateY\(0\) scale\(1\);/);
    expect(css).not.toContain("filter: blur(4px);");
    expect(css).not.toContain("filter: blur(5px);");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.settings-section,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: none/);
  });
});

const settings: SettingsStateDto = {
  apiVersion: 1,
  capabilities: ["settings"],
  schemaVersion: 5,
  data: {
    databaseId: "sqlite:test",
    databasePath: "/home/tyler/.local/share/masthead/masthead.sqlite",
    dataDirectory: "/home/tyler/.local/share/masthead",
    migrationState: "ready",
    storePath: "/home/tyler/.local/share/masthead/events.ndjson"
  },
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
  product: "masthead",
  runtime: {
    host: "127.0.0.1",
    mode: "primary",
    port: 17373,
    writable: true
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
    dataDirectory: "/home/tyler/.local/share/masthead",
    storePath: "/home/tyler/.local/share/masthead/events.ndjson"
  }
};
