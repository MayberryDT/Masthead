import { describe, expect, test } from "vitest";
import { resolveWorkbenchDatabasePath } from "../dbPath.ts";

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
