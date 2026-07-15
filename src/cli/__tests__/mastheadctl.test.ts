import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWorkbenchDatabasePath } from "../dbPath.ts";
import { runMastheadCli } from "../mastheadctl.ts";

describe("resolveWorkbenchDatabasePath for explicit wipe maintenance", () => {
  test("prefers --db over environment paths", () => {
    expect(
      resolveWorkbenchDatabasePath({
        args: ["wipe-published", "--db", "/tmp/explicit.sqlite"],
        env: {
          MASTHEAD_DATA_DIR: "/tmp/data",
          MASTHEAD_DB_PATH: "/tmp/env.sqlite"
        }
      })
    ).toBe("/tmp/explicit.sqlite");
  });

  test("prefers MASTHEAD_DB_PATH over MASTHEAD_DATA_DIR", () => {
    expect(
      resolveWorkbenchDatabasePath({
        args: [],
        env: {
          MASTHEAD_DATA_DIR: "/tmp/data",
          MASTHEAD_DB_PATH: "/tmp/env.sqlite"
        }
      })
    ).toBe("/tmp/env.sqlite");
  });

  test("derives database path from MASTHEAD_DATA_DIR", () => {
    expect(
      resolveWorkbenchDatabasePath({
        args: [],
        env: { MASTHEAD_DATA_DIR: "/tmp/data" }
      })
    ).toBe("/tmp/data/masthead.sqlite");
  });
});

describe("mastheadctl import repair", () => {
  test("defaults to a read-only preview and sends repeated selected job ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, preview: { planHash: "a".repeat(64) } }), {
      headers: { "content-type": "application/json" }, status: 200
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runMastheadCli(["import", "repair", "--job", "job:grok", "--job", "job:hermes", "--json"], {
      env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:17373" }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, preview: { planHash: "a".repeat(64) } });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:17373/imports/repair/preview", expect.objectContaining({
      body: JSON.stringify({ importJobIds: ["job:grok", "job:hermes"] }), method: "POST"
    }));
  });

  test("requires an exact sha256 hash for explicit apply", async () => {
    const missing = await runMastheadCli(["import", "repair", "apply", "--job", "job:grok", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ error: { code: "missing_argument" } });

    const invalid = await runMastheadCli([
      "import", "repair", "apply", "--job", "job:grok", "--plan-hash", "wrong", "--json"
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stderr)).toMatchObject({ error: { code: "invalid_argument" } });
  });
});

afterEach(() => vi.unstubAllGlobals());
