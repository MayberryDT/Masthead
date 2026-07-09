// @vitest-environment happy-dom
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import { App } from "../App";
import { MastheadConnectionProvider } from "../connection/MastheadConnectionProvider";
import { useMastheadConnection } from "../connection/useMastheadConnection";
import { mastheadOnboardingDismissedStorageKey } from "../onboardingPreference";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.mastheadDesktop;
});

describe("collector autostart", () => {
  test("keeps connected secondary surfaces online after desktop bridge autostart", async () => {
    const requestedUrls: string[] = [];
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17373",
        command: "masthead daemon",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17373/projection"
      };
    });

    window.mastheadDesktop = { invoke: invoke as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url);
        requestedUrls.push(requestUrl);
        const { host, pathname } = new URL(requestUrl);
        if (pathname === "/health" && host === "127.0.0.1:17372") return new Response("offline", { status: 503 });
        if (pathname === "/projection" && host === "127.0.0.1:17372") return new Response("offline", { status: 503 });
        return jsonResponse(responseForUrl(requestUrl));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17372/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    await act(async () => {
      await waitFor(() => invoke.mock.calls.length === 1);
      await flushTimers();
      await flushTimers();
    });
    await waitFor(() => requestedUrls.some((url) => urlMatches(url, "/projection", "127.0.0.1:17373")));

    await assertSurfaceDoesNotShowOfflineRecovery(container, "Logbook");
    await assertSurfaceDoesNotShowOfflineRecovery(container, "Sources");
    await assertSurfaceDoesNotShowOfflineRecovery(container, "Settings");

    root.unmount();
  });

  test("keeps first-run sources onboarding open after connector discovery", async () => {
    window.localStorage.removeItem(mastheadOnboardingDismissedStorageKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url);
        const { pathname } = new URL(requestUrl);
        if (pathname.startsWith("/sources/connectors")) return jsonResponse({ ok: true, ...detectedHarnessConnectors() });
        return jsonResponse(responseForUrl(requestUrl));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    await act(async () => {
      await waitFor(() => container.querySelector(".sources-onboarding-modal") !== null);
    });

    expect(container.textContent).toContain("Sources connect");
    expect(container.textContent).toContain("Connect live harnesses");
    expect(container.textContent).not.toContain("ADAPTERS");
    expect(container.textContent).not.toContain("Import data");

    root.unmount();
  });

  test("keeps the sources wizard open while selecting detected connectors", async () => {
    window.localStorage.removeItem(mastheadOnboardingDismissedStorageKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url);
        const { pathname } = new URL(requestUrl);
        if (pathname.startsWith("/sources/connectors")) return jsonResponse({ ok: true, ...detectedHarnessConnectors() });
        return jsonResponse(responseForUrl(requestUrl));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    await act(async () => {
      await waitFor(() => container.querySelector(".sources-onboarding-modal") !== null);
    });

    await act(async () => {
      clickButtonByText(container, "Continue");
      await flushTimers();
      await flushTimers();
    });

    await act(async () => {
      await waitFor(() => container.querySelector(".source-select-card") !== null);
    });

    expect(container.querySelector(".sources-onboarding-modal")).not.toBeNull();
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Continue");
    expect(container.textContent).not.toContain("ADAPTERS");
    expect(container.textContent).not.toContain("Import data");

    root.unmount();
  });

  test("does not report projection failure when startup load is superseded by a later successful request", async () => {
    const projectionRequests: Array<ReturnType<typeof deferred<unknown>>> = [];
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17373",
        command: "masthead daemon",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17373/projection"
      };
    });

    window.mastheadDesktop = { invoke: invoke as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request) => {
        const requestUrl = String(url);
        const { host, pathname } = new URL(requestUrl);
        if (pathname === "/health" && host === "127.0.0.1:17372") return Promise.resolve(new Response("offline", { status: 503 }));
        if (pathname === "/health" && host === "127.0.0.1:17373") return Promise.resolve(jsonResponse(currentHealth));
        if (pathname === "/projection" && host === "127.0.0.1:17373") {
          const request = deferred<unknown>();
          projectionRequests.push(request);
          return request.promise.then(jsonResponse);
        }
        if (pathname === "/projection") return Promise.resolve(new Response("offline", { status: 503 }));
        return Promise.resolve(jsonResponse(responseForUrl(requestUrl)));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17372/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    await act(async () => {
      await waitFor(() => invoke.mock.calls.length === 1);
    });
    await waitFor(() => projectionRequests.length >= 1);
    await act(async () => {
      await chooseRefreshRate(container, "5s");
      await flushTimers();
    });
    await act(async () => {
      await flushTimers();
      await flushTimers();
    });
    await waitFor(() => projectionRequests.length >= 2);

    projectionRequests[1].resolve(liveProjectionResponse());
    await act(async () => {
      await flushTimers();
    });
    projectionRequests[0].resolve(liveProjectionResponse());
    await act(async () => {
      await flushTimers();
      await flushTimers();
      clickSidebarButton(container, "Sources");
      await flushTimers();
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Live projection did not load");
    expect(container.textContent).not.toContain("Collector started, but live projection did not load.");

    root.unmount();
  });

  test("shows collector startup progress while autostart is running", async () => {
    const connectorStart = deferred<{
      ok: true;
      started: boolean;
      baseUrl: string;
      command: string;
      health: { apiVersion: number; databaseId: string; mode: string };
      message: string;
      projectionUrl: string;
    }>();
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return connectorStart.promise;
    });

    window.mastheadDesktop = { invoke: invoke as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url);
        const { pathname } = new URL(requestUrl);
        if (pathname === "/health" && !invoke.mock.calls.length) return new Response("offline", { status: 503 });
        return jsonResponse(responseForUrl(requestUrl));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    await act(async () => {
      await flushTimers();
    });
    await act(async () => {
      clickSidebarButton(container, "Sources");
      await flushTimers();
      await flushTimers();
      await flushTimers();
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Collector startup");
    expect(container.textContent).toContain("Starting local collector after app launch");
    expect(container.textContent).toContain("Desktop bridge");

    connectorStart.resolve({
      ok: true,
      started: true,
      baseUrl: "http://127.0.0.1:17373",
      command: "masthead daemon",
      health: { apiVersion: 1, databaseId: "db", mode: "primary" },
      message: "Started local Masthead collector.",
      projectionUrl: "http://127.0.0.1:17373/projection"
    });

    await act(async () => {
      await flushTimers();
    });
    root.unmount();
  });

  test("renders Masthead before starting the collector through the desktop bridge", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17373",
        command: "masthead daemon",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17373/projection"
      };
    });

    window.mastheadDesktop = { invoke: invoke as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = String(url);
        const { pathname } = new URL(requestUrl);
        if (pathname === "/health" && !invoke.mock.calls.length) return new Response("offline", { status: 503 });
        return jsonResponse(responseForUrl(requestUrl));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    expect(container.textContent).toContain("Masthead");
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      await flushTimers();
      await flushTimers();
      await flushTimers();
    });

    expect(invoke).toHaveBeenCalledTimes(1);

    root.unmount();
  });

  test("still starts once when scheduled autostart is cleaned up before frames fire", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17373",
        command: "masthead daemon",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17373/projection"
      };
    });
    const frames = createAnimationFrameQueue();

    window.mastheadDesktop = { invoke: invoke as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"] };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(frames.request);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frames.cancel);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (!invoke.mock.calls.length) return new Response("offline", { status: 503 });
        return jsonResponse(responseForUrl(String(url)));
      })
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <RefreshOnceWhenOffline />
          <App />
        </MastheadConnectionProvider>
      );
    });
    await act(async () => {
      await flushTimers();
    });
    await act(async () => {
      await flushTimers();
    });

    expect(container.textContent).toContain("Masthead");
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      frames.flush();
      frames.flush();
      await flushTimers();
    });

    expect(invoke).toHaveBeenCalledTimes(1);

    root.unmount();
  });
});

function RefreshOnceWhenOffline() {
  const connection = useMastheadConnection();
  const didRefreshRef = useRef(false);

  useEffect(() => {
    if (didRefreshRef.current) return;
    if (connection.state.state !== "offline") return;
    didRefreshRef.current = true;
    void connection.refresh();
  }, [connection]);

  return null;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await flushTimers();
  }
  expect(condition()).toBe(true);
}

function urlMatches(url: string, pathname: string, host: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === pathname && parsed.host === host;
}

function clickSidebarButton(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  expect(button).toBeDefined();
  button?.click();
}

function clickButtonByText(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  expect(button).toBeDefined();
  button?.click();
}

async function assertSurfaceDoesNotShowOfflineRecovery(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    clickSidebarButton(container, label);
    await flushTimers();
    await flushTimers();
  });

  expect(container.textContent).toContain(label);
  expect(container.textContent).not.toContain("No live connection");
  expect(container.textContent).not.toContain("No Masthead daemon is responding");
  expect(container.textContent).not.toContain("Use the Connector panel to start or check the local collector.");
}

async function chooseRefreshRate(container: HTMLElement, label: string): Promise<void> {
  const trigger = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.getAttribute("aria-label")?.startsWith("Refresh rate:")
  );
  expect(trigger).toBeDefined();
  trigger?.click();
  await flushTimers();
  const option = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  expect(option).toBeDefined();
  option?.click();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createAnimationFrameQueue() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request: (callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id: number) => {
      callbacks.delete(id);
    },
    flush: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(performance.now());
    }
  };
}

function responseForUrl(url: string) {
  const { pathname } = new URL(url);
  if (pathname === "/health") return currentHealth;
  if (pathname === "/projection") return liveProjectionResponse();
  if (pathname === "/sources/setup") return { ok: true, setup: emptySourcesSetup() };
  if (pathname.startsWith("/sources/connectors")) return { ok: true, ...emptyHarnessConnectors() };
  if (pathname === "/adapters") return { ok: true, adapters: [] };
  if (pathname === "/sources") return { ok: true, sources: [] };
  if (pathname === "/imports") return { ok: true, imports: [], limit: 50, offset: 0, total: 0 };
  if (pathname === "/sessions") return { sessions: [], total: 0 };
  if (pathname === "/logbook/summary") return { ok: true, summary: emptyLogbookSummary() };
  if (pathname === "/projects") return { ok: true, projects: [] };
  if (pathname === "/knowledge-flow/summary") return { ok: true, summary: emptyKnowledgeFlowSummary() };
  if (pathname === "/settings") return { ok: true, settings: settingsState() };
  if (pathname === "/mcp/status") return { ok: true, status: mcpStatus() };
  if (pathname === "/mcp/tools") return { ok: true, tools: [] };
  if (pathname === "/mcp/audit") return { ok: true, audit: [] };
  if (pathname === "/data/summary") return { ok: true, summary: dataSummary() };
  if (pathname === "/review-dispositions") return { ok: true, dispositions: [] };
  return { ok: true };
}

function liveProjectionResponse() {
  return {
    ok: true,
    source: "live",
    generatedAt: "2026-07-04T00:00:00.000Z",
    projection: emptyProjection(),
    events: [],
    gitSnapshots: [],
    diagnostics: []
  };
}

function emptyProjection() {
  return {
    summary: { active: 0, needsAttention: 0, conflicts: 0, completed: 0, running: 0, needsAction: 0, idle: 0 },
    lanes: [
      { laneId: "running", title: "Running", count: 0, sessionIds: [] },
      { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
      { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
      { laneId: "history", title: "History", count: 0, sessionIds: [] }
    ],
    cards: [],
    attentionQueue: [],
    conflicts: []
  };
}

function emptySourcesSetup() {
  return {
    setupId: "test",
    updatedAt: "2026-07-04T00:00:00.000Z",
    status: "empty",
    connectedSources: [],
    advanced: {
      adapters: [],
      imports: [],
      sources: []
    }
  };
}

function emptyLogbookSummary() {
  return {
    runtimes: [],
    models: [],
    lifecycles: [],
    sessions: 0,
    projects: 0,
    messages: 0,
    toolCalls: 0,
    fileEffects: 0
  };
}

function emptyHarnessConnectors() {
  return {
    generatedAt: "2026-07-04T00:00:00.000Z",
    summary: { ready: 0, needsAction: 0, notInstalled: 0, notFound: 0, error: 0 },
    connectors: []
  };
}

function detectedHarnessConnectors() {
  return {
    generatedAt: "2026-07-04T00:00:00.000Z",
    summary: { ready: 0, needsAction: 0, notInstalled: 1, notFound: 0, error: 0 },
    connectors: [
      {
        runtime: "opencode",
        label: "OpenCode",
        presence: "found",
        live: "not_installed",
        supportsActions: true
      }
    ]
  };
}

function emptyKnowledgeFlowSummary() {
  return {
    capturedSessions: 0,
    workbenchSessions: 0,
    publishedArtifacts: 0,
    automaticallyResolvedSessions: 0
  };
}

function settingsState() {
  return {
    apiVersion: 1,
    capabilities: ["settings"],
    schemaVersion: 1,
    product: "masthead",
    runtime: {
      host: "127.0.0.1",
      mode: "primary",
      port: 17373,
      writable: true
    },
    data: {
      databaseId: "db",
      databasePath: "/tmp/masthead.sqlite",
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
      health: {
        complete: 0,
        disabled: 0,
        failed: 0,
        queued: 0,
        status: "complete"
      },
      model: "deterministic",
      provider: "Deterministic fallback",
      remoteModelEnabled: false,
      sessionCount: 0
    },
    hooks: {
      command: "masthead-hook",
      configExists: false,
      configPath: "/tmp/hooks.json",
      endpoint: "http://127.0.0.1:17373/ingest",
      installed: false,
      integrations: [],
      missingEvents: [],
      mismatchedEvents: []
    },
    llm: {
      activeProvider: "openai",
      providers: [
        {
          apiKeyRequired: true,
          apiStyle: "responses",
          configured: false,
          customBaseUrl: false,
          id: "openai",
          label: "OpenAI",
          local: false,
          model: "gpt-5-nano"
        }
      ],
      remoteEnrichmentEnabled: false,
      secretStorage: {
        description: "API keys are stored locally.",
        kind: "local_database"
      }
    },
    privacy: {
      mcpAccessEnabled: true,
      redactionEnabled: true,
      transcriptImportEnabled: true
    },
    storage: {
      dataSummary: dataSummary(),
      databasePath: "/tmp/masthead.sqlite",
      dataDirectory: "/tmp/masthead",
      storePath: "/tmp/masthead/events.ndjson"
    }
  };
}

function dataSummary() {
  return {
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
    tables: {}
  };
}

function mcpStatus() {
  return {
    ready: true,
    databasePath: "/tmp/masthead.sqlite",
    mode: "stdio",
    readOnly: true,
    toolCount: 0,
    queryCount: 0,
    globalAccessEnabled: true
  };
}
