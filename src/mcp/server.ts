import { daemonConfigFromEnv } from "../daemon/config.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import { handleMcpLine } from "./protocol.ts";

const config = daemonConfigFromEnv();
const db = await openMastheadDatabase(config.databasePath);
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
