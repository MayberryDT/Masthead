import { execFile } from "node:child_process";
import { access, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("packaged MCP runtime", () => {
  test("relocated Electron Agent Access resolves client and server runtime packages", async () => {
    await execFileAsync(process.execPath, ["scripts/prepare-electron-resources.js"], { cwd: process.cwd() });
    const generatedRoot = resolve(".electron-resources/daemon");
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-packaged-mcp-"));
    tempDirs.push(tempDir);
    const runtimeRoot = join(tempDir, "daemon");
    await cp(join(generatedRoot, "dist"), join(runtimeRoot, "dist"), { recursive: true });
    await access(join(generatedRoot, "node_modules", "@modelcontextprotocol", "client", "package.json"));
    await access(join(generatedRoot, "node_modules", "@modelcontextprotocol", "server", "package.json"));
    await cp(join(generatedRoot, "node_modules"), join(runtimeRoot, "node_modules"), { recursive: true });

    const databasePath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    db.close();

    const probePath = join(runtimeRoot, "agent-access-probe.mjs");
    await writeFile(probePath, packagedAgentAccessProbe(), "utf8");
    const statusEntry = join(runtimeRoot, "dist", "src", "daemon", "mcpStatusService.js");
    const serverEntry = join(runtimeRoot, "dist", "src", "mcp", "server.js");
    const { stdout } = await execFileAsync(
      join(generatedRoot, process.platform === "win32" ? "node.exe" : "node"),
      [probePath, statusEntry, serverEntry, databasePath],
      {
        cwd: runtimeRoot,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" }
      }
    );
    const evidence = JSON.parse(stdout.trim()) as {
      clientModuleUrl: string;
      serverModuleUrl: string;
      result: { ok: boolean; protocolVersion?: string; toolNames?: string[] };
    };
    const relocatedNodeModulesUrl = pathToFileURL(join(runtimeRoot, "node_modules")).href;

    expect(evidence.clientModuleUrl).toContain(relocatedNodeModulesUrl);
    expect(evidence.serverModuleUrl).toContain(relocatedNodeModulesUrl);
    expect(evidence.result).toMatchObject({
      ok: true,
      protocolVersion: "2026-07-28",
      toolNames: expect.arrayContaining(["search_knowledge"])
    });
  }, 30_000);
});

function packagedAgentAccessProbe(): string {
  return [
    'import { pathToFileURL } from "node:url";',
    "const [statusEntry, serverEntry, databasePath] = process.argv.slice(2);",
    'process.env.MASTHEAD_MCP_COMMAND = process.execPath;',
    'process.env.MASTHEAD_MCP_ENTRY = serverEntry;',
    'const clientModuleUrl = import.meta.resolve("@modelcontextprotocol/client");',
    'const serverModuleUrl = import.meta.resolve("@modelcontextprotocol/server");',
    'const { testMcpConnection } = await import(pathToFileURL(statusEntry).href);',
    'const result = await testMcpConnection(databasePath, undefined, 5_000);',
    'process.stdout.write(`${JSON.stringify({ clientModuleUrl, serverModuleUrl, result })}\\n`);',
    'if (!result.ok) process.exitCode = 1;'
  ].join("\n");
}
