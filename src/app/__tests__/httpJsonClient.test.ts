import { afterEach, describe, expect, test, vi } from "vitest";
import { getJson, postJson } from "../httpJsonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpJsonClient", () => {
  test("builds daemon JSON requests from a projection URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, value: 42 }), {
          headers: { "content-type": "application/json" },
          status: 200
        })
      )
    );

    await expect(
      getJson<{ ok: true; value: number }>("http://127.0.0.1:17373/projection?selectedSessionId=old", "/imports", {
        label: "imports",
        query: { adapterId: "opencode", empty: "", limit: 25, offset: 0, skipped: undefined }
      })
    ).resolves.toEqual({ ok: true, value: 42 });

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/imports?adapterId=opencode&limit=25&offset=0", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("serializes array query params as repeated keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200
        })
      )
    );

    await getJson<{ ok: true }>("http://127.0.0.1:17373/projection", "/sessions", {
      label: "logbook search",
      query: { model: ["gpt-5", "gpt-4.1"], project: [], runtime: ["opencode"] }
    });

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sessions?model=gpt-5&model=gpt-4.1&runtime=opencode", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts optional JSON bodies and labels HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(
      postJson("http://127.0.0.1:17373/projection", "/sources/connect", {
        body: { runtimes: ["opencode"] },
        label: "source connect"
      })
    ).rejects.toThrow("source connect failed: 503");

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/connect", {
      body: JSON.stringify({ runtimes: ["opencode"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
  });

  test("includes JSON error code from failed post responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "transcript_permission_required" }), {
          headers: { "content-type": "application/json" },
          status: 409
        })
      )
    );

    await expect(
      postJson("http://127.0.0.1:17373/projection", "/workbench/sessions/session%3Aabc/import-transcript", {
        label: "workbench import transcript"
      })
    ).rejects.toThrow("workbench import transcript failed: 409 transcript_permission_required");
  });

  test("prefers code over error and falls back to short error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "claim_conflict", error: "someone else holds the claim" }), {
          headers: { "content-type": "application/json" },
          status: 409
        })
      )
    );

    await expect(
      postJson("http://127.0.0.1:17373/projection", "/workbench/sessions/session%3Aabc/claim", {
        label: "workbench claim"
      })
    ).rejects.toThrow("workbench claim failed: 409 claim_conflict");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "not found" }), {
          headers: { "content-type": "application/json" },
          status: 404
        })
      )
    );

    await expect(
      getJson("http://127.0.0.1:17373/projection", "/sessions/missing", {
        label: "session detail"
      })
    ).rejects.toThrow("session detail failed: 404 not found");
  });
});
