import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import { handleMcpLine } from "./protocol.ts";

export function requiredMcpDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const databasePath = env.MASTHEAD_DB_PATH?.trim();
  if (!databasePath) throw new Error("MASTHEAD_DB_PATH is required to launch the Masthead MCP server.");
  return resolve(databasePath);
}

export async function startStdioMcpServer(databasePath = requiredMcpDatabasePath()): Promise<void> {
  const db = await openMastheadDatabase(databasePath);
  migrateDatabase(db);
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const output = handleMcpLine(db, line);
      if (output) process.stdout.write(`${output}\n`);
    }
  });
  process.once("exit", () => db.close());
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isMainModule()) {
  startStdioMcpServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
