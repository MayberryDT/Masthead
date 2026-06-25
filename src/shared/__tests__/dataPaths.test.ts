import { describe, expect, test } from "vitest";
import { resolveMastheadDataPaths } from "../dataPaths.ts";

describe("Masthead data paths", () => {
  test("derives all runtime paths from MASTHEAD_DATA_DIR", () => {
    expect(resolveMastheadDataPaths({ env: { MASTHEAD_DATA_DIR: "/tmp/masthead" } })).toEqual({
      dataDirectory: "/tmp/masthead",
      databasePath: "/tmp/masthead/masthead.sqlite",
      legacyJournalPath: "/tmp/masthead/legacy/events.ndjson",
      runtimeDirectory: "/tmp/masthead/runtime",
      exportsDirectory: "/tmp/masthead/exports",
      logsDirectory: "/tmp/masthead/logs"
    });
  });

  test("defaults development Linux data outside the checkout", () => {
    expect(resolveMastheadDataPaths({ env: {}, homeDir: "/home/tyler", platform: "linux" }).dataDirectory).toBe(
      "/home/tyler/.local/share/masthead-dev"
    );
  });

  test("defaults development macOS data to Application Support", () => {
    expect(resolveMastheadDataPaths({ env: {}, homeDir: "/Users/tyler", platform: "darwin" }).dataDirectory).toBe(
      "/Users/tyler/Library/Application Support/Masthead Dev"
    );
  });

  test("honors explicit database and store overrides for tests", () => {
    const paths = resolveMastheadDataPaths({
      env: {
        MASTHEAD_DATA_DIR: "/tmp/masthead",
        MASTHEAD_DB_PATH: "/tmp/test.sqlite",
        MASTHEAD_STORE_PATH: "/tmp/test.ndjson"
      }
    });

    expect(paths.databasePath).toBe("/tmp/test.sqlite");
    expect(paths.legacyJournalPath).toBe("/tmp/test.ndjson");
    expect(paths.dataDirectory).toBe("/tmp/masthead");
  });
});
