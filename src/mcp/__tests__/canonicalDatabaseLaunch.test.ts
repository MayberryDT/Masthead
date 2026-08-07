import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { testMcpConnection, validateMcpLaunchConfig, type McpLaunchConfigDto } from "../../daemon/mcpStatusService.ts";
import { requiredMcpDatabasePath } from "../server.ts";

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

  test("test connection starts the configured MCP command with the active database env", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-test-"));
    tempDirs.push(tempDir);
    const activeDatabase = join(tempDir, "active.sqlite");
    const entry = join(tempDir, "mcp-server.js");
    await writeFile(activeDatabase, "");
    await writeFile(
      entry,
      [
        "if (!process.env.MASTHEAD_DB_PATH) { console.error('missing database'); process.exit(1); }",
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
        "    const result = request.method === 'tools/list'",
        "      ? { tools: tools.map((name) => ({ name })) }",
        "      : { protocolVersion: '2024-11-05', serverInfo: { name: 'masthead', version: 'test' } };",
        "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
        "  }",
        "});"
      ].join("\n")
    );

    await expect(
      testMcpConnection(
        {
          args: [entry],
          command: process.execPath,
          env: { MASTHEAD_DB_PATH: activeDatabase }
        },
        activeDatabase,
        1_000
      )
    ).resolves.toMatchObject({
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
  });
});
