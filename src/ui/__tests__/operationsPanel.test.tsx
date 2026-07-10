// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SettingsStateDto } from "../../app/daemonClient";
import { OperationsPanel } from "../OperationsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    document.querySelectorAll(".toolbar-select-menu-portal").forEach((node) => node.remove());
    delete window.mastheadDesktop;
    vi.unstubAllGlobals();
  });

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

  function rowNamed(label: string): HTMLElement | undefined {
    return [...(container?.querySelectorAll<HTMLElement>(".settings-row") ?? [])].find(
      (row) => row.querySelector(".settings-row-copy > span")?.textContent === label
    );
  }

  test("renders local export and delete controls", async () => {
    await renderPanel(<OperationsPanel settingsLoadState="loading" />);
    await selectCategory("Data");
    const dataHtml = container?.innerHTML ?? "";
    await selectCategory("Danger zone");
    const html = `${dataHtml}${container?.innerHTML ?? ""}`;

    expect(html).toContain("Export data");
    expect(html).toContain("Delete raw copies");
    expect(html).toContain("Delete all Masthead data");
    expect(html).not.toContain("Keeps normalized session metadata, summaries, and search records.");
    expect(html).toContain("Original harness files are never changed.");
    expect(html).not.toContain("OpenCode integration");
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

  test("renders selective deletion controls for scoped records", async () => {
    await renderPanel(
      <OperationsPanel
        deletionScopeKind="project"
        deletionScopeTarget="Pip"
        localDataStatus={{
          state: "confirm_scoped_delete",
          message: "Confirm scoped deletion for project Pip."
        }}
        settingsLoadState="loading"
      />
    );
    await selectCategory("Danger zone");
    const html = container?.innerHTML ?? "";

    expect(html).toContain("Delete scoped records");
    expect(html).toContain("Project");
    expect(html).toContain("Pip");
    expect(html).toContain("Confirm scoped deletion");
    expect(html).toContain("Confirm scoped deletion for project Pip.");
    expect(html).toContain("Cancel");
  });

  test("keeps compact danger controls gated and wired to their deletion callbacks", async () => {
    const onDeletionScopeKindChange = vi.fn();
    const onDeletionScopeTargetChange = vi.fn();
    const onRequestScopedDelete = vi.fn();
    const onRequestDeleteLocalData = vi.fn();

    await renderPanel(
      <OperationsPanel
        deletionScopeKind="project"
        deletionScopeTarget=""
        onDeletionScopeKindChange={onDeletionScopeKindChange}
        onDeletionScopeTargetChange={onDeletionScopeTargetChange}
        onRequestDeleteLocalData={onRequestDeleteLocalData}
        onRequestScopedDelete={onRequestScopedDelete}
        settingsState={settings}
      />
    );
    await selectCategory("Danger zone");

    const dangerSection = container?.querySelector<HTMLElement>(".settings-section-danger");
    expect(dangerSection?.querySelector(".settings-section-head p")?.textContent).toBe(
      "Deletes only Masthead's local canonical data. Original harness files are never changed."
    );
    expect(dangerSection?.textContent).toContain("Databasesqlite:test");
    expect(dangerSection?.textContent).not.toContain("/tmp/masthead/masthead.sqlite");
    expect(dangerSection?.textContent).not.toContain("generated indexes");
    expect(dangerSection?.textContent).not.toContain("populated from canonical session data");
    expect(dangerSection?.textContent).not.toContain("Clears Masthead-owned canonical sessions");

    const scopeTriggers = Array.from(
      container?.querySelectorAll<HTMLButtonElement>(".settings-delete-controls .filterable-select-trigger") ?? []
    );
    const scopedDelete = buttonNamed(container, "Delete selected records");
    expect(scopedDelete?.disabled).toBe(true);

    await act(async () => {
      scopeTriggers[0]?.click();
    });
    const sessionOption = [...document.body.querySelectorAll<HTMLButtonElement>('button[role="option"]')]
      .find((button) => button.textContent === "Session");
    await act(async () => {
      sessionOption?.click();
    });
    expect(onDeletionScopeKindChange).toHaveBeenCalledWith("session");

    await act(async () => {
      root?.render(
        <OperationsPanel
          deletionScopeKind="session"
          deletionScopeTarget=""
          onDeletionScopeKindChange={onDeletionScopeKindChange}
          onDeletionScopeTargetChange={onDeletionScopeTargetChange}
          onRequestDeleteLocalData={onRequestDeleteLocalData}
          onRequestScopedDelete={onRequestScopedDelete}
          settingsState={settings}
        />
      );
    });
    const targetInput = container?.querySelector<HTMLInputElement>('input[aria-label="Delete target"]');
    await act(async () => {
      if (!targetInput) throw new Error("missing session delete target input");
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(targetInput, "session-1");
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onDeletionScopeTargetChange).toHaveBeenCalledWith("session-1");

    await act(async () => {
      root?.render(
        <OperationsPanel
          deletionScopeKind="session"
          deletionScopeTarget="session-1"
          onDeletionScopeKindChange={onDeletionScopeKindChange}
          onDeletionScopeTargetChange={onDeletionScopeTargetChange}
          onRequestDeleteLocalData={onRequestDeleteLocalData}
          onRequestScopedDelete={onRequestScopedDelete}
          settingsState={settings}
        />
      );
    });
    await act(async () => {
      buttonNamed(container, "Delete selected records")?.click();
      buttonNamed(container, "Delete all Masthead data")?.click();
    });
    expect(onRequestScopedDelete).toHaveBeenCalledTimes(1);
    expect(onRequestDeleteLocalData).toHaveBeenCalledTimes(1);
  });

  test("renders data summary preview before deletion", async () => {
    await renderPanel(
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
        settingsLoadState="loading"
      />
    );
    await selectCategory("Data");
    const html = container?.innerHTML ?? "";

    expect(html).toContain("Storage");
    expect(html).toContain("Include raw copies");
    expect(html).toContain("4");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("Retention classes");
  });

  test("renders local action errors without changing action labels", async () => {
    await renderPanel(
      <OperationsPanel
        localDataStatus={{ action: "export", state: "error", message: "Export failed: unavailable" }}
        settingsLoadState="loading"
      />
    );
    await selectCategory("Data");
    const exportRow = rowNamed("Export archive");
    const dataHtml = container?.innerHTML ?? "";
    await selectCategory("Danger zone");
    const html = `${dataHtml}${container?.innerHTML ?? ""}`;

    expect(exportRow?.textContent).toContain("Export failed: unavailable");
    expect(html).toContain("Export data");
    expect(html).toContain("Delete all Masthead data");
    expect(container?.querySelector(".settings-panel > .settings-status")).toBeNull();
  });

  test("shows open-folder success beside the initiating Data row", async () => {
    const invoke = vi.fn(async () => undefined);
    window.mastheadDesktop = { invoke: invoke as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Data");

    await act(async () => {
      [...(rowNamed("Open data folder")?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent === "Open folder")
        ?.click();
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("open_data_directory_command", { path: settings.storage.dataDirectory });
    expect(rowNamed("Open data folder")?.textContent).toContain("Opened data folder.");
    expect(container?.querySelector(".settings-panel > .settings-status")).toBeNull();
  });

  test("shows raw-copy success beside the initiating Data row", async () => {
    await renderPanel(
      <OperationsPanel
        localDataStatus={{ action: "raw_copies", state: "pruned", message: "Deleted 4 raw source copies." }}
        settingsState={settings}
      />
    );
    await selectCategory("Data");

    expect(rowNamed("Include raw copies")?.textContent).toContain("Deleted 4 raw source copies.");
    expect(container?.querySelector(".settings-panel > .settings-status")).toBeNull();
  });

  test("keeps preference, export, and raw-copy callbacks wired", async () => {
    const onMotionDisabledChange = vi.fn();
    const onSessionEndedNotificationsEnabledChange = vi.fn();
    const onExportLocalData = vi.fn();
    const onRequestPruneLocalData = vi.fn();
    await renderPanel(
      <OperationsPanel
        motionDisabled={false}
        onExportLocalData={onExportLocalData}
        onMotionDisabledChange={onMotionDisabledChange}
        onRequestPruneLocalData={onRequestPruneLocalData}
        onSessionEndedNotificationsEnabledChange={onSessionEndedNotificationsEnabledChange}
        sessionEndedNotificationsEnabled
        settingsState={settings}
      />
    );

    const motion = container?.querySelector<HTMLInputElement>('input[aria-label="Enable motion"]');
    const notifications = container?.querySelector<HTMLInputElement>('input[aria-label="Session transition notifications"]');
    await act(async () => {
      motion?.click();
      notifications?.click();
    });
    expect(onMotionDisabledChange).toHaveBeenCalledWith(true);
    expect(onSessionEndedNotificationsEnabledChange).toHaveBeenCalledWith(false);

    await selectCategory("Data");
    const exportButton = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Export data");
    const pruneButton = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Delete raw copies");
    await act(async () => {
      exportButton?.click();
      pruneButton?.click();
    });
    expect(onExportLocalData).toHaveBeenCalledTimes(1);
    expect(onRequestPruneLocalData).toHaveBeenCalledTimes(1);
  });

  test("uses searchable scrolling dropdowns for populated danger-zone delete targets", async () => {
    const onTargetChange = vi.fn();
    const settingsWithTargets: SettingsStateDto = {
      ...settings,
      deletionTargets: {
        ...settings.deletionTargets,
        projects: Array.from({ length: 18 }, (_, index) => ({
          label: `Project ${String(index + 1).padStart(2, "0")}`,
          value: `project-${index + 1}`
        }))
      }
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <OperationsPanel
          deletionScopeKind="project"
          deletionScopeTarget=""
          onDeletionScopeTargetChange={onTargetChange}
          settingsState={settingsWithTargets}
        />
      );
    });
    await selectCategory("Danger zone");

    const triggers = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-delete-controls .filterable-select-trigger"));
    expect(triggers).toHaveLength(2);

    await act(async () => {
      triggers[1].click();
    });

    const menu = document.body.querySelector<HTMLElement>(".filterable-select-menu");
    const options = document.body.querySelector<HTMLElement>(".filterable-select-options");
    const search = document.body.querySelector<HTMLInputElement>(".filterable-select-search input");
    expect(menu).not.toBeNull();
    expect(menu?.style.maxHeight).not.toBe("");
    expect(Number.parseFloat(menu?.style.maxHeight ?? "0")).toBeLessThanOrEqual(window.innerHeight - 24);
    expect(options).not.toBeNull();
    expect(options?.parentElement?.style.getPropertyValue("--filterable-select-options-max-height")).not.toBe("");
    expect(search?.placeholder).toBe("Search delete targets");
    expect(document.body.textContent).toContain("Project 18");

    await act(async () => {
      if (!search) throw new Error("missing delete target search input");
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(search, "not-a-project");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("No matching delete targets");
    expect(document.body.textContent).not.toContain("Use “not-a-project”");
  });

  test("keeps empty project delete targets as a searchable dropdown", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<OperationsPanel deletionScopeKind="project" deletionScopeTarget="" settingsState={settings} />);
    });
    await selectCategory("Danger zone");

    const triggers = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-delete-controls .filterable-select-trigger"));
    expect(triggers).toHaveLength(2);
    expect(container.querySelector('input[placeholder="project label"]')).toBeNull();

    await act(async () => {
      triggers[1].click();
    });

    expect(document.body.querySelector<HTMLInputElement>(".filterable-select-search input")?.placeholder).toBe("Search delete targets");
    expect(document.body.textContent).toContain("No matching delete targets");
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
    await selectCategory("Data");
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
    await selectCategory("Data");
    const openButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Open folder");

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("open failed");
  });
});

function buttonNamed(container: HTMLElement | undefined, label: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === label
  );
}

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
    configPath: "/tmp/.opencode/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: false,
    integrations: [
      {
        actionSurface: "settings",
        captureMode: "live_hook",
        description: "Live local hook events are managed from this Settings card.",
        label: "OpenCode",
        runtime: "opencode",
        status: "not_installed",
        supportsActions: true
      }
    ],
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
