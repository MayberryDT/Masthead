// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../../fixtures/protocol/current-health.json";
import type { SettingsStateDto } from "../../../app/daemonClient";
import type { MastheadHealthDto } from "../../../shared/protocol";
import { OperationsPanel } from "../../OperationsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(container?.querySelector(".settings-spine-sections")?.textContent).toContain(label);
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

  test("keeps delete-all confirmation outside the pane and requires the active database id", async () => {
    const onConfirmDeleteLocalData = vi.fn();
    await renderPanel(
      <OperationsPanel
        localDataStatus={{ action: "delete_all", state: "confirm_delete", message: "Confirm deletion." }}
        onConfirmDeleteLocalData={onConfirmDeleteLocalData}
        settingsState={settings}
      />
    );

    const dialog = container?.querySelector<HTMLElement>('[role="dialog"]');
    const pane = container?.querySelector<HTMLElement>(".settings-spine-card");
    const confirmation = dialog?.querySelector<HTMLInputElement>('input[placeholder="sqlite:test"]');
    const confirmButton = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Delete all Masthead data");

    expect(dialog).not.toBeNull();
    expect(pane?.contains(dialog ?? null)).toBe(false);
    expect(confirmButton?.disabled).toBe(true);

    await act(async () => {
      if (!confirmation) throw new Error("missing database confirmation input");
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(confirmation, "wrong-id");
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirmButton?.disabled).toBe(true);

    await act(async () => {
      if (!confirmation) throw new Error("missing database confirmation input");
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(confirmation, "sqlite:test");
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.click();
    });
    expect(onConfirmDeleteLocalData).toHaveBeenCalledTimes(1);
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

  test("copies the selected MCP client format and resets copy feedback when the format changes", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => mcpResponse(input)));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Copy configuration")?.disabled === false);

    await act(async () => {
      buttonNamed("Copy configuration")?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(`{
  "mcpServers": {
    "masthead": {
      "command": "/usr/bin/node",
      "args": [
        "/app/dist/mcp/server.js"
      ],
      "env": {
        "MASTHEAD_DB_PATH": "/tmp/masthead.sqlite"
      }
    }
  }
}`);
    expect(buttonNamed("Copied")).toBeDefined();

    await act(async () => {
      buttonNamed("MCP TOML")?.click();
    });
    expect(buttonNamed("Copy configuration")).toBeDefined();
    await act(async () => {
      buttonNamed("Copy configuration")?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(`[mcp_servers.masthead]
command = "/usr/bin/node"
args = ["/app/dist/mcp/server.js"]
env = {"MASTHEAD_DB_PATH":"/tmp/masthead.sqlite"}`);

    await act(async () => {
      buttonNamed("stdio")?.click();
    });
    await act(async () => {
      buttonNamed("Copy configuration")?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(
      '/usr/bin/node "/app/dist/mcp/server.js"  {\n  "env": {\n    "MASTHEAD_DB_PATH": "/tmp/masthead.sqlite"\n  }\n}'
    );
  });

  test("ignores deferred clipboard results after the selected format changes", async () => {
    let resolveCopy: (() => void) | undefined;
    let rejectCopy: ((reason?: unknown) => void) | undefined;
    const writeText = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveCopy = resolve;
        })
      )
      .mockImplementationOnce(
        () => new Promise<void>((_resolve, reject) => {
          rejectCopy = reject;
        })
      );
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => mcpResponse(input)));
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Copy configuration")?.disabled === false);

    await act(async () => {
      buttonNamed("Copy configuration")?.click();
    });
    await act(async () => {
      buttonNamed("MCP TOML")?.click();
      resolveCopy?.();
      await Promise.resolve();
    });
    expect(buttonNamed("Copy configuration")).toBeDefined();
    expect(buttonNamed("Copied")).toBeUndefined();

    await act(async () => {
      buttonNamed("Copy configuration")?.click();
    });
    await act(async () => {
      buttonNamed("stdio")?.click();
      rejectCopy?.(new Error("clipboard denied"));
      await Promise.resolve();
    });
    expect(buttonNamed("Copy configuration")).toBeDefined();
    expect(buttonNamed("Copy failed")).toBeUndefined();
    expect(container?.textContent).not.toContain("Could not copy configuration.");
  });

  test("shows concise loading and load failure states beside the MCP server row", async () => {
    let rejectStatus: ((reason?: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/mcp/status") {
          return new Promise<Response>((_resolve, reject) => {
            rejectStatus = reject;
          });
        }
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");

    expect(rowNamed("MCP server")?.textContent).toContain("Loading");
    expect(buttonNamed("Copy configuration")?.disabled).toBe(true);
    expect(container?.querySelector("pre")).toBeNull();

    await act(async () => {
      rejectStatus?.(new Error("MCP status unavailable"));
      await Promise.resolve();
    });
    await waitFor(() => container?.textContent?.includes("MCP status unavailable") === true);
    expect(rowNamed("MCP server")?.textContent).toContain("Unavailable");
    expect(container?.textContent).not.toContain("Checking the local MCP launch configuration");
  });

  test("keeps read-only Agent access checks and configuration copy available", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => mcpResponse(input)));
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: { writeText: vi.fn(() => Promise.resolve()) }
    });
    await renderPanel(<OperationsPanel readOnly settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Copy configuration")?.disabled === false);

    expect(rowNamed("MCP server")?.textContent).toContain("Ready");
    expect(rowNamed("Access")?.textContent).toContain("Enabled");
    expect(buttonNamed("Test connection")?.disabled).toBe(false);
    expect(buttonNamed("Copy configuration")?.disabled).toBe(false);
  });

  test("shows connection-test progress and one concise inline failure", async () => {
    let resolveTest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        if (requestPath(input) === "/mcp/test-connection") {
          return new Promise<Response>((resolve) => {
            resolveTest = resolve;
          });
        }
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Test connection") !== undefined);

    await act(async () => {
      buttonNamed("Test connection")?.click();
    });
    expect(buttonNamed("Testing…")?.disabled).toBe(true);
    expect(rowNamed("MCP server")?.querySelector(".settings-inline-feedback")?.textContent).toBe("Testing connection…");

    await act(async () => {
      resolveTest?.(jsonResponse({ ok: true, test: { status: "failed", message: "MCP process did not answer." } }));
      await Promise.resolve();
    });
    await waitFor(() => container?.textContent?.includes("MCP process did not answer.") === true);
    expect(buttonNamed("Test connection")?.disabled).toBe(false);
    expect(rowNamed("MCP server")?.textContent).toContain("MCP process did not answer.");
    expect(container?.querySelectorAll(".settings-inline-feedback.error")).toHaveLength(1);
  });

  test("shows compact connection-test success beside the MCP server row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        if (requestPath(input) === "/mcp/test-connection") {
          return jsonResponse({ ok: true, test: { status: "passed", message: "Connection passed." } });
        }
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Test connection") !== undefined);

    await act(async () => {
      buttonNamed("Test connection")?.click();
      await Promise.resolve();
    });
    await waitFor(() => rowNamed("MCP server")?.textContent?.includes("Connection passed.") === true);

    expect(rowNamed("MCP server")?.querySelector(".settings-inline-feedback.success")).not.toBeNull();
    expect(rowNamed("MCP server")?.querySelector(".settings-inline-feedback.success")?.getAttribute("aria-live")).toBe("polite");
    expect(container?.querySelector("#settings-agent-access")?.closest(".settings-section")?.querySelectorAll(".settings-row")).toHaveLength(3);
  });

  test("replaces a stale MCP load error with the latest connection-test failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/mcp/status") return Promise.reject(new Error("Initial MCP load failed."));
        if (pathname === "/mcp/test-connection") {
          return jsonResponse({
            ok: true,
            test: { status: "failed", message: "Latest connection test failed." }
          });
        }
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => container?.textContent?.includes("Initial MCP load failed.") === true);

    await act(async () => {
      buttonNamed("Test connection")?.click();
      await Promise.resolve();
    });
    await waitFor(() => buttonNamed("Test connection")?.disabled === false);

    expect(container?.textContent).toContain("Latest connection test failed.");
    expect(container?.textContent).not.toContain("Initial MCP load failed.");
  });

  test("keeps a newer connection-test failure after an older pending load rejects", async () => {
    let rejectInitialLoad: ((reason?: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/mcp/status") {
          return new Promise<Response>((_resolve, reject) => {
            rejectInitialLoad = reject;
          });
        }
        if (pathname === "/mcp/test-connection") {
          return jsonResponse({
            ok: true,
            test: { status: "failed", message: "Newest connection test failed." }
          });
        }
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    expect(rowNamed("MCP server")?.textContent).toContain("Loading");

    await act(async () => {
      buttonNamed("Test connection")?.click();
      await Promise.resolve();
    });
    await waitFor(() => container?.textContent?.includes("Newest connection test failed.") === true);

    await act(async () => {
      rejectInitialLoad?.(new Error("Older MCP load failed."));
      await Promise.resolve();
    });
    await waitFor(() => rowNamed("MCP server")?.textContent?.includes("Unavailable") === true);

    expect(container?.textContent).toContain("Newest connection test failed.");
    expect(container?.textContent).not.toContain("Older MCP load failed.");
  });

  test("keeps a successful test's reload authoritative over an older initial load", async () => {
    let resolveInitialLoad: ((response: Response) => void) | undefined;
    let statusRequests = 0;
    let validationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/mcp/status") {
          statusRequests += 1;
          if (statusRequests === 1) {
            return new Promise<Response>((resolve) => {
              resolveInitialLoad = resolve;
            });
          }
          return Promise.reject(new Error("Current MCP reload failed."));
        }
        if (pathname === "/mcp/test-connection") {
          return jsonResponse({ ok: true, test: { status: "passed", message: "Connection passed." } });
        }
        if (pathname === "/mcp/launch-config/validate") validationRequests += 1;
        return mcpResponse(input);
      })
    );
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");

    await act(async () => {
      buttonNamed("Test connection")?.click();
      await Promise.resolve();
    });
    await waitFor(() => container?.textContent?.includes("Current MCP reload failed.") === true);

    await act(async () => {
      resolveInitialLoad?.(mcpResponse("http://127.0.0.1/mcp/status"));
      await Promise.resolve();
    });
    await waitFor(() => validationRequests === 1);

    expect(container?.textContent).toContain("Current MCP reload failed.");
    expect(rowNamed("MCP server")?.textContent).toContain("Unavailable");
  });

  test("reports clipboard failure inline without exposing configuration text", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => mcpResponse(input)));
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error("clipboard denied"))) }
    });
    await renderPanel(<OperationsPanel settingsState={settings} />);
    await selectCategory("Agent access");
    await waitFor(() => buttonNamed("Copy configuration")?.disabled === false);

    await act(async () => {
      buttonNamed("Copy configuration")?.click();
      await Promise.resolve();
    });
    expect(buttonNamed("Copy failed")).toBeDefined();
    expect(container?.textContent).toContain("Could not copy configuration.");
    expect(container?.querySelector("pre")).toBeNull();
  });

  function buttonNamed(label: string): HTMLButtonElement | undefined {
    return [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === label
    );
  }

  function rowNamed(label: string): HTMLElement | undefined {
    return [...(container?.querySelectorAll<HTMLElement>(".settings-row") ?? [])].find(
      (row) => row.querySelector(".settings-row-copy > span")?.textContent === label
    );
  }
});

function mcpResponse(input: string | URL | Request): Response {
  const pathname = requestPath(input);
  if (pathname === "/mcp/status") {
    return jsonResponse({
      ok: true,
      status: {
        ready: true,
        databasePath: "/tmp/masthead.sqlite",
        mode: "stdio",
        readOnly: true,
        toolCount: 8,
        queryCount: 0,
        globalAccessEnabled: true
      }
    });
  }
  if (pathname === "/mcp/launch-config") {
    return jsonResponse({
      ok: true,
      launchConfig: {
        command: "/usr/bin/node",
        args: ["/app/dist/mcp/server.js"],
        env: { MASTHEAD_DB_PATH: "/tmp/masthead.sqlite" }
      }
    });
  }
  if (pathname === "/mcp/launch-config/validate") {
    return jsonResponse({
      ok: true,
      validation: { valid: true, commandExists: true, entryExists: true, databaseMatches: true, problems: [] }
    });
  }
  return jsonResponse({ ok: true });
}

function requestPath(input: string | URL | Request): string {
  return new URL(input instanceof Request ? input.url : input.toString()).pathname;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  expect(condition()).toBe(true);
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
