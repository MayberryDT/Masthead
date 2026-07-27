import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  test("keeps status separate from launch config, validation, tool metadata, and recent query audit rows", async () => {
    const { daemon, databasePath, tempDir } = await createTestHarness();
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
        toolCount: 16
      }
    });
    expect(status.status.launchConfig).toBeUndefined();

    const launch = await getJson(baseUrl, "/mcp/launch-config");
    expect(launch.launchConfig.env.MASTHEAD_DB_PATH).toBe(databasePath);
    expect(launch.launchConfig.command).not.toBe("npm");
    expect(launch.validation).toMatchObject({
      commandExists: true,
      databaseMatches: true
    });

    const validation = await postJson(baseUrl, "/mcp/launch-config/validate", {
      launchConfig: { ...launch.launchConfig, args: [databasePath] }
    });
    expect(validation.validation).toMatchObject({
      commandExists: true,
      databaseMatches: true,
      entryExists: true,
      problems: [],
      ready: true,
      valid: true
    });

    const mismatch = await postJson(baseUrl, "/mcp/launch-config/validate", {
      launchConfig: { ...launch.launchConfig, args: [databasePath], env: { MASTHEAD_DB_PATH: `${databasePath}.other` } }
    });
    expect(mismatch.validation).toMatchObject({
      commandExists: true,
      databaseMatches: false,
      entryExists: true,
      ready: false
    });
    expect(mismatch.validation.problems.join(" ")).toContain("does not match active database");

    const testEntry = join(tempDir, "mcp-test-server.js");
    await writeFile(
      testEntry,
      [
        "const tools = ['get_artifact','get_corpus_stats','get_evidence_excerpt','get_evidence_transcript','get_knowledge','get_masthead_coverage','get_project_history','get_provenance','get_session','get_session_excerpt','get_session_transcript','list_knowledge','list_project_sessions','search_artifacts','search_knowledge','search_sessions'];",
        "let buffer = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => {",
        "  buffer += String(chunk);",
        "  let index = buffer.indexOf('\\n');",
        "  while (index !== -1) {",
        "    const line = buffer.slice(0, index).trim();",
        "    buffer = buffer.slice(index + 1);",
        "    index = buffer.indexOf('\\n');",
        "    if (!line) continue;",
        "    const request = JSON.parse(line);",
        "    const result = request.method === 'tools/list'",
        "      ? { tools: tools.map((name) => ({ name })) }",
        "      : { protocolVersion: '2024-11-05', serverInfo: { name: 'masthead', version: 'api-test' } };",
        "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
        "  }",
        "});"
      ].join("\n")
    );
    const connection = await postJson(baseUrl, "/mcp/test-connection", {
      launchConfig: { ...launch.launchConfig, args: [testEntry] }
    });
    expect(connection.result).toMatchObject({
      ok: true,
      status: "passed",
      serverInfo: { name: "masthead", version: "api-test" },
      toolCount: 16,
      toolNames: expect.arrayContaining(["search_knowledge", "search_sessions"]),
      validation: {
        commandExists: true,
        databaseMatches: true,
        entryExists: true,
        ready: true
      }
    });
    const tools = await getJson(baseUrl, "/mcp/tools");
    expect(tools.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "search_knowledge",
          permission: "Read only"
        }),
        expect.objectContaining({
          name: "get_knowledge",
          permission: "Read only"
        }),
        expect.objectContaining({
          name: "search_artifacts",
          permission: "Read only"
        }),
        expect.objectContaining({
          name: "get_artifact",
          permission: "Read only"
        }),
        expect.objectContaining({
          name: "search_sessions",
          permission: "Read only",
          purpose: "LEGACY: Find sessions for evidence (prefer search_knowledge)"
        }),
        expect.objectContaining({
          name: "get_evidence_transcript",
          permission: "Read only"
        }),
        expect.objectContaining({
          name: "get_session_excerpt",
          dataReturned: "Bounded transcript excerpts"
        }),
        expect.objectContaining({
          name: "get_session_transcript",
          dataReturned: "Bounded canonical transcript rows with coverage"
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
    hookTranscriptCatchupEnabled: false,
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

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}
