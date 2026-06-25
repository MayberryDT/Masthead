import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { handleMcpLine, toolDefinitions } from "../protocol.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("MCP protocol", () => {
  test("malformed JSON returns parse error and server continues", async () => {
    const db = await openDb();
    expect(JSON.parse(handleMcpLine(db, "{not-json") ?? "{}")).toMatchObject({
      error: { code: -32700 },
      id: null,
      jsonrpc: "2.0"
    });
    expect(JSON.parse(handleMcpLine(db, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })) ?? "{}")).toMatchObject({
      id: 1,
      result: { serverInfo: { name: "masthead" } }
    });
    db.close();
  });

  test("tool schemas require identifiers and reject additional properties", () => {
    expect(toolDefinitions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputSchema: expect.objectContaining({ additionalProperties: false, required: ["sessionId"] }),
          name: "get_session"
        }),
        expect.objectContaining({
          inputSchema: expect.objectContaining({ additionalProperties: false, required: ["query"] }),
          name: "search_sessions"
        })
      ])
    );
  });
});

async function openDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-protocol-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
