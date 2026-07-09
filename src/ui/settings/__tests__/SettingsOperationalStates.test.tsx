// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../../fixtures/protocol/current-health.json";
import type { SettingsStateDto } from "../../../app/daemonClient";
import type { MastheadHealthDto } from "../../../shared/protocol";
import { OperationsPanel } from "../../OperationsPanel";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
});

describe("Settings operational states", () => {
  async function renderPanel(panel: ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(panel);
    });
  }

  async function selectCategory(label: string) {
    const button = [...(container?.querySelectorAll<HTMLButtonElement>(".settings-category-nav button") ?? [])]
      .find((candidate) => candidate.textContent === label);
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
  }

  test("keeps read-only state out of the Settings chrome while disabling destructive actions", async () => {
    await renderPanel(
      <OperationsPanel
        deletionScopeKind="project"
        deletionScopeTarget="Masthead"
        readOnly
        settingsState={settings}
      />
    );
    await selectCategory("Data");
    const dataHtml = container?.innerHTML ?? "";
    await selectCategory("Danger zone");
    const html = `${dataHtml}${container?.innerHTML ?? ""}`;

    expect(html).not.toContain("Read-only connection");
    expect(html).not.toContain("hook writes");
    expect(html).not.toContain("Codex integration");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete raw copies<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete selected records<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete all Masthead data<\/button>/);
    expect(html.match(/<button[^>]*>Export data<\/button>/)?.[0]).not.toContain("disabled");
  });

  test("does not render connection recovery chrome inside Settings", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        connection={{
          state: "ready",
          baseUrl: "http://127.0.0.1:17374",
          health: currentHealth as MastheadHealthDto,
          writable: true
        }}
        onReconnect={() => undefined}
        onStartConnector={() => undefined}
        settingsState={settings}
      />
    );

    expect(html).not.toContain("Connection ready");
    expect(html).not.toContain("Masthead daemon is ready");
    expect(html).not.toContain("Reconnect");
  });

  test("shows a recoverable failure state when runtime settings cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("settings offline"))));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<OperationsPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Settings unavailable");
    expect(container.textContent).toContain("settings offline");
    expect(container.textContent).toContain("Retry settings");
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
    hosts: [{ label: "Veelox", value: "Veelox" }],
    projects: [{ label: "Masthead", value: "Masthead" }],
    runtimes: [{ label: "codex", value: "codex" }]
  },
  enrichment: {
    currentEnrichments: 2,
    health: { complete: 2, disabled: 0, failed: 0, queued: 0, status: "complete" },
    model: "deterministic",
    provider: "Deterministic fallback",
    remoteModelEnabled: false,
    sessionCount: 2
  },
  hooks: {
    command: "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js",
    configExists: true,
    configPath: "/tmp/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: false,
    integrations: [
      {
        actionSurface: "settings",
        captureMode: "live_hook",
        description: "Live local hook events are managed from this Settings card.",
        label: "Codex",
        runtime: "codex",
        status: "needs_repair",
        supportsActions: true
      }
    ],
    missingEvents: ["SessionStart"],
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
      enrichments: 2,
      messages: 8,
      rawEvents: 10,
      sessions: 2,
      sources: 1,
      storageClasses: {
        audit_logs: { description: "MCP query audit records.", records: 0, retention: "configurable" },
        canonical_metadata: { description: "Sessions and capsules.", records: 2, retention: "indefinite" },
        derived_indexes: { description: "Indexes.", records: 2, retention: "rebuildable" },
        large_outputs: { description: "Outputs.", records: 0, retention: "short_configurable" },
        raw_payloads: { description: "Raw payloads.", records: 10, retention: "configurable" },
        searchable_messages: { description: "Messages.", records: 8, retention: "indefinite_configurable" }
      },
      tables: { raw_events: 10, session_search: 2, sessions: 2 }
    },
    databasePath: "/tmp/masthead/masthead.sqlite",
    dataDirectory: "/tmp/masthead",
    storePath: "/tmp/masthead/events.ndjson"
  }
};
