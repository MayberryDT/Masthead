// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import type { LiveBoardProjection, SessionCardView } from "../../core/types";
import { mastheadSessionEndedNotificationsStorageKey } from "../../ui/motionPreference";
import { App } from "../App";
import { MastheadConnectionProvider } from "../connection/MastheadConnectionProvider";

const notifyTransitionMock = vi.hoisted(() => vi.fn());
vi.mock("../desktopNotify", () => ({
  notifySessionTransitionDesktop: (...args: unknown[]) => notifyTransitionMock(...args)
}));

let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  notifyTransitionMock.mockReset();
  notifyTransitionMock.mockResolvedValue({ ok: true, shown: true });
  window.localStorage.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    callback(performance.now());
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  root?.unmount();
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete window.mastheadDesktop;
});

describe("App session transition notifications", () => {
  test("baselines the first projection and notifies once when a running card later transitions", async () => {
    let projectionRequests = 0;
    stubAppFetch(() => {
      projectionRequests += 1;
      return liveProjectionResponse(projectionRequests === 1 ? firstProjection() : transitionedProjection());
    });

    renderApp();
    await waitFor(() => projectionRequests === 1);
    expect(notifyTransitionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => notifyTransitionMock.mock.calls.length === 1);

    expect(projectionRequests).toBe(2);
    expect(notifyTransitionMock).toHaveBeenCalledWith({
      sessionId: "active-1",
      transition: "idle",
      title: "Task: in progress.",
      body: "Idle"
    });
  });

  test("honors the stored disabled preference during projection polling", async () => {
    window.localStorage.setItem(mastheadSessionEndedNotificationsStorageKey, "0");
    let projectionRequests = 0;
    stubAppFetch(() => {
      projectionRequests += 1;
      return liveProjectionResponse(projectionRequests === 1 ? firstProjection() : transitionedProjection());
    });

    renderApp();
    await waitFor(() => projectionRequests === 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => projectionRequests === 2);

    expect(notifyTransitionMock).not.toHaveBeenCalled();
  });
});

function renderApp(): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
        <App />
      </MastheadConnectionProvider>
    );
  });
}

function stubAppFetch(nextProjection: () => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      const { pathname } = new URL(requestUrl);
      if (pathname === "/projection") return jsonResponse(nextProjection());
      return jsonResponse(responseForPath(pathname));
    })
  );
}

function liveProjectionResponse(projection: LiveBoardProjection) {
  return {
    ok: true,
    source: "live",
    generatedAt: "2026-07-04T00:00:00.000Z",
    projection,
    events: [],
    gitSnapshots: [],
    diagnostics: []
  };
}

function firstProjection(): LiveBoardProjection {
  return projection([
    card({ sessionId: "active-1", lifecycle: "running", title: "Active run", headline: cardHeadline("Active run") }),
    card({
      sessionId: "historical-ended",
      lifecycle: "ended",
      outcomeLabel: "completed",
      stateLabel: "Completed",
      title: "Historical run",
      headline: cardHeadline("Historical run")
    })
  ]);
}

function transitionedProjection(): LiveBoardProjection {
  return projection([
    card({ sessionId: "active-1", lifecycle: "idle", stateLabel: "Idle", title: "Active run", headline: cardHeadline("Active run") }),
    card({
      sessionId: "historical-ended",
      lifecycle: "ended",
      outcomeLabel: "completed",
      stateLabel: "Completed",
      title: "Historical run",
      headline: cardHeadline("Historical run")
    })
  ]);
}

const baseCard = {
  sessionId: "session-1",
  project: "proj",
  title: "Session",
  headline: cardHeadline("Working"),
  stateLabel: "Working",
  primaryStatus: "running_command" as const,
  lifecycle: "running" as const,
  priorityRank: 0,
  durationLabel: "1m",
  lastActivity: "2026-01-01T00:00:00Z",
  lastActivityLabel: "1m ago",
  changedFileCount: 0,
  indicators: [] as SessionCardView["indicators"],
  identityConfidence: "direct" as const,
  safeActions: ["open_source_session"] as SessionCardView["safeActions"],
  isExpanded: false
} satisfies SessionCardView;

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return { ...baseCard, ...overrides };
}

function cardHeadline(headline: string): SessionCardView["headline"] {
  return {
    headline,
    frame: {
      subject: "Task",
      disposition: "in progress",
      state: "active",
      subjectKind: "feature",
      confidence: "high",
      evidence: []
    },
    source: "offline",
    status: "ready"
  };
}

function projection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: { active: cards.length, needsAttention: 0, conflicts: 0, completed: 0, running: 1, needsAction: 0, idle: 0 },
    lanes: [
      { laneId: "running", title: "Running", count: 1, sessionIds: ["active-1"] },
      { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
      { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
      { laneId: "history", title: "History", count: 1, sessionIds: ["historical-ended"] }
    ],
    cards,
    attentionQueue: [],
    conflicts: []
  };
}

function responseForPath(pathname: string) {
  if (pathname === "/health") return currentHealth;
  if (pathname === "/sources/setup") return { ok: true, setup: emptySourcesSetup() };
  if (pathname === "/adapters") return { ok: true, adapters: [] };
  if (pathname === "/sources") return { ok: true, sources: [] };
  if (pathname === "/imports") return { ok: true, imports: [], limit: 50, offset: 0, total: 0 };
  if (pathname === "/sessions") return { sessions: [], total: 0 };
  if (pathname === "/logbook/summary") return { ok: true, summary: emptyLogbookSummary() };
  if (pathname === "/projects") return { ok: true, projects: [] };
  if (pathname === "/usage/summary") return { ok: true, usage: emptyUsageStats() };
  if (pathname === "/settings") return { ok: true, settings: settingsState() };
  if (pathname === "/mcp/status") return { ok: true, status: mcpStatus() };
  if (pathname === "/mcp/tools") return { ok: true, tools: [] };
  if (pathname === "/mcp/audit") return { ok: true, audit: [] };
  if (pathname === "/data/summary") return { ok: true, summary: dataSummary() };
  if (pathname === "/review-dispositions") return { ok: true, dispositions: [] };
  return { ok: true };
}

function emptySourcesSetup() {
  return {
    setupId: "test",
    updatedAt: "2026-07-04T00:00:00.000Z",
    status: "empty",
    connectedSources: [],
    advanced: { adapters: [], imports: [], sources: [] }
  };
}

function emptyLogbookSummary() {
  return { runtimes: [], models: [], lifecycles: [], sessions: 0, projects: 0, messages: 0, toolCalls: 0, fileEffects: 0 };
}

function emptyUsageStats() {
  return {
    window: "today",
    generatedAt: "2026-07-04T00:00:00.000Z",
    range: { to: "2026-07-04T00:00:00.000Z" },
    totals: {
      sessions: 0,
      projects: 0,
      runtimes: 0,
      models: 0,
      messages: 0,
      toolCalls: 0,
      fileEffects: 0,
      mcpQueries: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenRows: 0,
      tokenCoverageSessions: 0
    },
    byModel: [],
    byProject: [],
    byRuntime: [],
    activity: [],
    coverage: { sources: 0, importedSessions: 0, sessionsWithTokenUsage: 0, sessionsWithoutTokenUsage: 0, currentEnrichments: 0, mcpQueries: 0 }
  };
}

function settingsState() {
  return {
    apiVersion: 1,
    capabilities: ["settings"],
    schemaVersion: 1,
    product: "masthead",
    runtime: { host: "127.0.0.1", mode: "primary", port: 17373, writable: true },
    data: {
      databaseId: "db",
      databasePath: "/tmp/masthead.sqlite",
      dataDirectory: "/tmp/masthead",
      migrationState: "ready",
      storePath: "/tmp/masthead/events.ndjson"
    },
    deletionTargets: { hosts: [], projects: [], runtimes: [] },
    enrichment: {
      currentEnrichments: 0,
      health: { complete: 0, disabled: 0, failed: 0, queued: 0, status: "complete" },
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
      providers: [],
      remoteEnrichmentEnabled: false,
      secretStorage: { description: "API keys are stored locally.", kind: "local_database" }
    },
    privacy: { mcpAccessEnabled: true, redactionEnabled: true, transcriptImportEnabled: true },
    storage: { dataSummary: dataSummary(), databasePath: "/tmp/masthead.sqlite", dataDirectory: "/tmp/masthead", storePath: "/tmp/masthead/events.ndjson" }
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
    storageClasses: {},
    tables: {}
  };
}

function mcpStatus() {
  return { ready: true, databasePath: "/tmp/masthead.sqlite", mode: "stdio", readOnly: true, toolCount: 0, queryCount: 0, globalAccessEnabled: true };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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
