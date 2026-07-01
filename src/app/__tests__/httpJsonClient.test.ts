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
        query: { adapterId: "codex", empty: "", limit: 25, offset: 0, skipped: undefined }
      })
    ).resolves.toEqual({ ok: true, value: 42 });

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/imports?adapterId=codex&limit=25&offset=0", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts optional JSON bodies and labels HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(
      postJson("http://127.0.0.1:17373/projection", "/sources/connect", {
        body: { runtimes: ["codex"] },
        label: "source connect"
      })
    ).rejects.toThrow("source connect failed: 503");

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/connect", {
      body: JSON.stringify({ runtimes: ["codex"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
  });
});
