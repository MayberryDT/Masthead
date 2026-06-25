import { afterEach, describe, expect, test, vi } from "vitest";
import { LOCAL_CONNECTOR_COMMAND, startLiveConnector } from "../connectorClient";

describe("connector client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses the native command when an invoke bridge is provided", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const result = await startLiveConnector(async (command, args) => {
      calls.push({ command, args });
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17374",
        command: "node scripts/masthead-ingest-server.js",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17374/projection"
      };
    });

    expect(calls).toEqual([{ command: "start_live_connector_command", args: undefined }]);
    expect(result).toMatchObject({
      ok: true,
      started: true,
      message: "Started local Masthead collector.",
      baseUrl: "http://127.0.0.1:17374",
      projectionUrl: "http://127.0.0.1:17374/projection"
    });
  });

  test("returns a local command fallback outside the native shell", async () => {
    const result = await startLiveConnector();

    expect(result).toMatchObject({
      ok: false,
      supported: false,
      command: LOCAL_CONNECTOR_COMMAND
    });
    expect(result.message).toContain("Run npm run dev");
  });

  test("uses the local dev server endpoint when the browser shell is available", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(
        JSON.stringify({
          ok: true,
          started: true,
          baseUrl: "http://127.0.0.1:17374",
          command: "node scripts/masthead-ingest-server.js",
          health: { apiVersion: 1, databaseId: "db", mode: "primary" },
          message: "Started local Masthead collector.",
          projectionUrl: "http://127.0.0.1:17374/projection"
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" }
        }
      );
    });

    const result = await startLiveConnector();

    expect(calls).toEqual([{ url: "/__masthead/connector/start", method: "POST" }]);
    expect(result).toMatchObject({
      ok: true,
      started: true,
      message: "Started local Masthead collector.",
      baseUrl: "http://127.0.0.1:17374",
      projectionUrl: "http://127.0.0.1:17374/projection"
    });
  });
});
