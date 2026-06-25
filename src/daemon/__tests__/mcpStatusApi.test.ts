import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { logMcpQuery } from "../db/mcpAuditRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("MCP status API", () => {
  test("returns real launch config, tool metadata, and recent query audit rows", async () => {
    const { daemon, databasePath } = await createTestHarness();
    seedMcpAuditRow(daemon.database);
    const baseUrl = await listen(daemon);

    const status = await getJson(baseUrl, "/mcp/status");
    expect(status).toMatchObject({
      ok: true,
      status: {
        databasePath,
        globalAccessEnabled: true,
        mode: "stdio",
        queryCount: 1,
        readOnly: true,
        ready: true,
        toolCount: 6
      }
    });
    expect(status.status.launchConfig.env.MASTHEAD_DB_PATH).toBe(databasePath);
    expect(status.status.launchConfig.command).not.toBe("npm");

    const tools = await getJson(baseUrl, "/mcp/tools");
    expect(tools.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "search_sessions",
          permission: "Read only",
          purpose: "Find session records"
        }),
        expect.objectContaining({
          name: "get_session_excerpt",
          dataReturned: "Bounded transcript excerpts"
        })
      ])
    );

    const audit = await getJson(baseUrl, "/mcp/audit?limit=1");
    expect(audit.audit).toEqual([
      expect.objectContaining({
        boundedBytes: 8000,
        resultCount: 1,
        sessionIds: ["session:mcp"],
        status: "succeeded",
        toolName: "get_session_excerpt"
      })
    ]);
  });
});

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-api-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
}

function seedMcpAuditRow(db: MastheadDatabase): void {
  seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:mcp", title: "MCP query" });
  logMcpQuery(db, {
    boundedBytes: 8000,
    requestedAt: "2026-06-25T12:00:00.000Z",
    resultCount: 1,
    sessionIds: ["session:mcp"],
    status: "succeeded",
    toolName: "get_session_excerpt"
  });
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}
