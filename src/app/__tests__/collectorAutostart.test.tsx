// @vitest-environment happy-dom
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import { App } from "../App";
import { MastheadConnectionProvider } from "../connection/MastheadConnectionProvider";
import { useMastheadConnection } from "../connection/useMastheadConnection";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.mastheadDesktop;
});

describe("collector autostart", () => {
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
      vi
        .fn()
        .mockResolvedValueOnce(new Response("offline", { status: 503 }))
        .mockResolvedValueOnce(jsonResponse(currentHealth))
        .mockResolvedValue(jsonResponse(liveProjectionResponse()))
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
  if (pathname === "/adapters") return { ok: true, adapters: [] };
  if (pathname === "/sources") return { ok: true, sources: [] };
  if (pathname === "/imports") return { ok: true, imports: [], limit: 50, offset: 0, total: 0 };
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
