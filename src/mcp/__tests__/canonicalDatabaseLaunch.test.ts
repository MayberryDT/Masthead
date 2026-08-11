import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { testMcpConnection, validateMcpLaunchConfig, type McpLaunchConfigDto } from "../../daemon/mcpStatusService.ts";
import { requiredMcpDatabasePath, startStdioMcpServer } from "../server.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("canonical database MCP launch", () => {
  test("MCP server requires an explicit MASTHEAD_DB_PATH", () => {
    expect(() => requiredMcpDatabasePath({} as NodeJS.ProcessEnv)).toThrow("MASTHEAD_DB_PATH is required");
    expect(requiredMcpDatabasePath({ MASTHEAD_DB_PATH: "./active.sqlite" } as NodeJS.ProcessEnv)).toBe(resolve("active.sqlite"));
  });

  test("closing the returned server handle releases its process lifecycle", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-handle-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const exitListenersBefore = process.listenerCount("exit");

    const handle = await startStdioMcpServer(databasePath);
    expect(process.listenerCount("exit")).toBe(exitListenersBefore + 1);

    await handle.close();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
  });

  test("launch validation rejects missing entries and non-active databases", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-launch-"));
    tempDirs.push(tempDir);
    const activeDatabase = join(tempDir, "active.sqlite");
    await writeFile(activeDatabase, "");

    const missing: McpLaunchConfigDto = {
      args: [join(tempDir, "missing-server.js")],
      command: process.execPath,
      env: { MASTHEAD_DB_PATH: join(tempDir, "other.sqlite") }
    };

    await expect(validateMcpLaunchConfig(missing, activeDatabase)).resolves.toMatchObject({
      commandExists: true,
      databaseMatches: false,
      entryExists: false,
      ready: false
    });
  });

  test("test connection restricts both probe and session child environments", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-test-"));
    tempDirs.push(tempDir);
    const activeDatabase = join(tempDir, "active.sqlite");
    const entry = join(tempDir, "mcp-server.js");
    const requestLog = join(tempDir, "requests.ndjson");
    await writeFile(activeDatabase, "");
    await writeFile(
      entry,
      [
        "const forbiddenEnvKeys = ['HOME','LOGNAME','SHELL','TERM','USER','APPDATA','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','PROCESSOR_ARCHITECTURE','SYSTEMDRIVE','TEMP','USERNAME','USERPROFILE','PROGRAMFILES'];",
        "const observedEnv = { databasePath: process.env.MASTHEAD_DB_PATH, forbidden: forbiddenEnvKeys.filter((key) => Object.hasOwn(process.env, key)), launchValue: process.env.MASTHEAD_ENV_TEST, nodePath: process.env.NODE_PATH, path: process.env.PATH, pathExt: process.env.PATHEXT, systemRoot: process.env.SYSTEMROOT };",
        "if (!process.env.MASTHEAD_DB_PATH) { console.error('missing database'); process.exit(1); }",
        "if (process.env.EVIL) { console.error('attacker env leaked'); process.exit(1); }",
        "import { appendFileSync } from 'node:fs';",
        "const tools = ['search_knowledge','list_knowledge','get_knowledge','get_provenance','get_evidence_excerpt','get_evidence_transcript','get_corpus_stats','search_artifacts','get_artifact','search_sessions','get_session','get_session_excerpt','get_session_transcript','list_project_sessions','get_project_history','get_masthead_coverage'];",
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
        `    appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify({ env: observedEnv, method: request.method, pid: process.pid }) + '\\n');`,
        "    if (request.method === 'server/discover') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');",
        "      continue;",
        "    }",
        "    const result = request.method === 'tools/list'",
        "      ? { tools: tools.map((name) => ({ inputSchema: { type: 'object' }, name })) }",
        "      : { capabilities: { tools: {} }, protocolVersion: '2024-11-05', serverInfo: { name: 'masthead', version: 'test' } };",
        "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
        "  }",
        "});"
      ].join("\n")
    );

    await expect(testMcpConnection(activeDatabase, undefined, 1_000, {
      launchConfig: {
        args: [entry],
        command: process.execPath,
        env: { MASTHEAD_DB_PATH: activeDatabase, MASTHEAD_ENV_TEST: "launch-value" }
      }
    })).resolves.toMatchObject({
      ok: true,
      serverInfo: { name: "masthead", version: "test" },
      toolCount: 16,
      toolNames: expect.arrayContaining(["search_knowledge", "search_sessions"]),
      validation: {
        commandExists: true,
        databaseMatches: true,
        entryExists: true,
        ready: true
      }
    });
    const attempts = (await readFile(requestLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
      env: {
        databasePath?: string;
        forbidden: string[];
        launchValue?: string;
        nodePath?: string;
        path?: string;
        pathExt?: string;
        systemRoot?: string;
      };
      method: string;
      pid: number;
    });
    const discovery = attempts.find((attempt) => attempt.method === "server/discover");
    const initialize = attempts.find((attempt) => attempt.method === "initialize");
    expect(discovery).toBeDefined();
    expect(initialize).toBeDefined();
    expect(discovery?.pid).not.toBe(initialize?.pid);
    for (const attempt of [discovery, initialize]) {
      expect(attempt?.env).toMatchObject({
        databasePath: activeDatabase,
        forbidden: [],
        launchValue: "launch-value",
        path: process.env.PATH
      });
      if (process.env.NODE_PATH) expect(attempt?.env.nodePath).toBe(process.env.NODE_PATH);
      if (process.env.PATHEXT) expect(attempt?.env.pathExt).toBe(process.env.PATHEXT);
      if (process.env.SYSTEMROOT) expect(attempt?.env.systemRoot).toBe(process.env.SYSTEMROOT);
    }
  });

  test("test connection applies one timeout across probe and legacy fallback", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-deadline-"));
    tempDirs.push(tempDir);
    const activeDatabase = join(tempDir, "active.sqlite");
    const entry = join(tempDir, "slow-mcp-server.js");
    await writeFile(activeDatabase, "");
    await writeFile(
      entry,
      [
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
        "    if (request.method === 'server/discover') continue;",
        "    const result = request.method === 'tools/list'",
        "      ? { tools: [] }",
        "      : { capabilities: { tools: {} }, protocolVersion: '2024-11-05', serverInfo: { name: 'masthead', version: 'slow-test' } };",
        "    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n'), 150);",
        "  }",
        "});"
      ].join("\n")
    );

    const startedAt = Date.now();
    const result = await testMcpConnection(activeDatabase, undefined, 100, {
      launchConfig: { args: [entry], command: process.execPath, env: { MASTHEAD_DB_PATH: activeDatabase } }
    });

    expect(result.ok).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  test("Agent Access negotiates modern MCP against the real launch entry", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-modern-test-"));
    tempDirs.push(tempDir);
    const activeDatabase = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(activeDatabase);
    migrateDatabase(db);
    db.close();

    await expect(testMcpConnection(activeDatabase, undefined, 5_000, {
      launchConfig: {
        args: [resolve("dist/daemon/src/mcp/server.js")],
        command: process.execPath,
        env: { MASTHEAD_DB_PATH: activeDatabase }
      }
    })).resolves.toMatchObject({
      ok: true,
      protocolVersion: "2026-07-28",
      serverInfo: { name: "masthead" },
      status: "passed",
      toolCount: 16
    });
  });
});
