// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
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
          motionDisabled={false}
          onMotionDisabledChange={() => undefined}
          settingsState={settings}
        />
      </SettingsSurface>
    );

    expect(html).toContain("settings-layout");
    expect(html).toContain("settings-section-wide");
    expect(html).toContain("settings-section-danger");
    expect(html).not.toContain("Remote enrichment");
    expect(html).not.toContain("Provider connection");
    expect(html).not.toContain("Use remote LLM enrichment");
    expect(html).not.toContain("OpenAI");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Paste API key");
    expect(html).not.toContain("Fast model name");
    expect(html).not.toContain("type=\"password\"");
    expect(html).not.toContain("Save provider");
    expect(html).not.toContain("sk-test-settings-secret");
    expect(html).not.toContain("Data boundaries");
    expect(html).not.toContain("Transcript import");
    expect(html).not.toContain("Redaction");
    expect(html).not.toContain("Codex hooks");
    expect(html).not.toContain("Install/repair hooks");
    expect(html).not.toContain("Test hooks");
    expect(html).not.toContain("Uninstall hooks");
    expect(html).not.toContain("Supported harnesses");
    expect(html).toContain("Onboarding");
    expect(html).toContain("Run onboarding again");
    expect(html).toContain("Setup wizard");
    expect(html).toContain("MCP access");
    expect(html).toContain("MCP server");
    expect(html).toContain("Refresh MCP");
    expect(html).toContain("MCP TOML");
    expect(html).toContain("MCP JSON");
    expect(html).toContain("stdio");
    expect(html).toContain("Test MCP launch");
    expect(html).toContain("/home/tyler/.local/share/masthead/masthead.sqlite");
    expect(html).toContain("Export data");
    expect(html).toContain("Preferences");
    expect(html).toContain("Motion");
    expect(html).toContain("Enable motion");
    expect(html).toContain("settings-toggle checked");
    expect(html).toContain("Motion on");
    expect(html).toContain("checked=\"\"");
    expect(html).not.toContain("Advanced runtime");
    expect(html).not.toContain("Retention classes");
    expect(html).not.toContain("Raw event rows");
    expect(html).not.toContain("<span>MCP audit rows</span>");
    expect(html).not.toContain("Codex integration");
    expect(html).not.toContain("Lifecycle hooks");
    expect(html).not.toContain("Current enrichments");
    expect(html).not.toContain("Health");
    expect(html).not.toContain("Copy Codex config");
    expect(html).not.toContain("Other MCP clients");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("Can agents read Masthead?");
    expect(html).not.toContain("Agent Access");
    expect(html).toContain("settings-toggle");
    expect(html).not.toContain("ops-card");
    expect(html).not.toContain("ghost-pill");
    expect(html).not.toContain("<select");
  });

  test("renders disabled motion as the off state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <OperationsPanel motionDisabled onMotionDisabledChange={() => undefined} settingsState={settings} />
      );
    });

    const motionInput = host.querySelector<HTMLInputElement>('input[aria-label="Enable motion"]');
    expect(motionInput?.checked).toBe(false);
    const motionLabel = motionInput?.closest("label.settings-toggle");
    expect(motionLabel?.className).not.toContain("checked");
    expect(motionLabel?.textContent).toContain("Motion off");

    await act(async () => {
      root.unmount();
    });
    host.remove();
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
    expect(html).toContain("Type sqlite:test to confirm");
    expect(html).toContain("Deletes Masthead");
  });

  test("delete-all confirmation requires typing the active database id", () => {
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

    expect(html).toContain('placeholder="sqlite:test"');
    expect(html).toContain("Delete all Masthead data");
    expect(html).toContain("disabled=\"\"");
  });

  test("scoped deletion confirmation requires typing the selected target", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={settings.storage.dataSummary}
        deletionScopeKind="project"
        deletionScopeTarget="Masthead"
        localDataStatus={{
          state: "confirm_scoped_delete",
          message: "Confirm scoped deletion for project Masthead: 31 sessions."
        }}
        settingsState={settings}
      />
    );

    expect(html).toContain("Type Masthead to confirm");
    expect(html).toContain("Delete selected records");
    expect(html).toContain("disabled=\"\"");
  });

  test("keeps Priority Bay fluid with real toggle styling", () => {
    const css = readFileSync("src/styles/settings.css", "utf8");

    expect(css).toMatch(/\.settings-layout-priority-bay\s*\{[\s\S]*max-width: none;/);
    expect(css).toMatch(/\.settings-toggle > span\s*\{[\s\S]*width: 42px;[\s\S]*height: 24px;/);
    expect(css).toMatch(/\.settings-toggle\.checked > span::after\s*\{[\s\S]*transform: translateX\(20px\);/);
  });

  test("uses shared card entrance motion for settings sections", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");

    expect(css).toMatch(/\.summary-strip \.summary-metric,[\s\S]*\.settings-section,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: surface-card-enter 400ms cubic-bezier\(0\.17, 0\.78, 0\.13, 1\) both;[\s\S]*transform-origin: 50% 100%;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.observability-console \.session-card\.is-new-card,[\s\S]*\.masthead-shell \.session-card\.is-new-card\s*\{[\s\S]*animation: session-card-created 760ms var\(--layout-ease\) both;[\s\S]*animation-delay: calc\(var\(--new-card-index\) \* 70ms\);[\s\S]*transform-origin: 50% 100%;/);
    expect(css).toMatch(/@keyframes surface-card-enter\s*\{[\s\S]*transform: translateY\(9px\) scale\(0\.968\);[\s\S]*transform: translateY\(-1px\) scale\(1\.004\);[\s\S]*transform: translateY\(1px\) scale\(0\.999\);[\s\S]*transform: translateY\(0\) scale\(1\);/);
    expect(css).toMatch(/@keyframes session-card-created\s*\{[\s\S]*opacity: 0\.92;[\s\S]*transform: translateY\(18px\) scale\(0\.992\);[\s\S]*transform: translateY\(3px\) scale\(0\.998\);[\s\S]*transform: translateY\(0\) scale\(1\);/);
    expect(css).not.toContain("filter: blur(4px);");
    expect(css).not.toContain("filter: blur(5px);");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.settings-section,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: none/);
    expect(css).toMatch(/\.masthead-shell\[data-motion-mode="off"\],[\s\S]*\.masthead-shell\[data-motion-mode="off"\] \*::after\s*\{[\s\S]*animation: none !important;[\s\S]*transition-duration: 1ms !important;/);
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
    integrations: [
      {
        actionSurface: "settings",
        captureMode: "live_hook",
        description: "Live local hook events are managed from this Settings card.",
        label: "Codex",
        runtime: "codex",
        status: "installed",
        supportsActions: true
      },
      {
        actionSurface: "sources",
        captureMode: "transcript_import",
        description: "Imported from local Claude Code transcript history through Sources.",
        label: "Claude Code",
        runtime: "claude_code",
        status: "managed_in_sources",
        supportsActions: false
      },
      {
        actionSurface: "sources",
        captureMode: "transcript_import",
        description: "Imported from local OpenCode transcript history through Sources.",
        label: "OpenCode",
        runtime: "opencode",
        status: "managed_in_sources",
        supportsActions: false
      }
    ],
    latestBackupPath: "/home/tyler/.codex/hooks.json.masthead-backup.json",
    lastEventAt: "2026-06-25T12:00:00.000Z",
    missingEvents: [],
    mismatchedEvents: []
  },
  llm: {
    activeProvider: "openai",
    providers: [
      {
        apiKeyRequired: true,
        apiStyle: "responses",
        baseUrl: "https://api.openai.com/v1",
        configured: false,
        customBaseUrl: false,
        id: "openai",
        label: "OpenAI",
        local: false,
        model: "gpt-5-nano-2025-08-07"
      },
      {
        apiKeyRequired: true,
        apiStyle: "chat_completions",
        configured: false,
        customBaseUrl: true,
        id: "openai_compatible",
        label: "OpenAI-compatible",
        local: false,
        model: ""
      },
      {
        apiKeyRequired: true,
        apiStyle: "anthropic_messages",
        configured: false,
        customBaseUrl: false,
        id: "anthropic",
        label: "Anthropic",
        local: false,
        model: "claude-sonnet-4-6"
      },
      {
        apiKeyRequired: true,
        apiStyle: "gemini_generate_content",
        configured: false,
        customBaseUrl: false,
        id: "gemini",
        label: "Gemini",
        local: false,
        model: "gemini-3.5-flash"
      }
    ],
    remoteEnrichmentEnabled: false,
    secretStorage: {
      description: "API keys are stored only in the local Masthead settings database and are never returned by the settings API.",
      kind: "local_database"
    }
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
