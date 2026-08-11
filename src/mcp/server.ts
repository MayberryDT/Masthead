import { parseJSONRPCMessage, STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { Transform } from "node:stream";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import { createMcpServer } from "./protocol.ts";

export function requiredMcpDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const databasePath = env.MASTHEAD_DB_PATH?.trim();
  if (!databasePath) throw new Error("MASTHEAD_DB_PATH is required to launch the Masthead MCP server.");
  return resolve(databasePath);
}

export async function startStdioMcpServer(databasePath = requiredMcpDatabasePath()): Promise<StdioServerHandle> {
  const db = await openMastheadDatabase(databasePath);
  migrateDatabase(db);
  const stdio = createMcpStdioTransport();
  const handle = serveStdio(() => createMcpServer(db), {
    transport: stdio.transport,
    onerror(error) {
      console.error(error.message);
    }
  });
  let closed = false;
  const releaseOwnedResources = () => {
    if (closed) return;
    closed = true;
    process.off("exit", releaseOwnedResources);
    stdio.closeInput();
    db.close();
  };
  process.once("exit", releaseOwnedResources);
  return {
    async close() {
      try {
        await handle.close();
      } finally {
        releaseOwnedResources();
      }
    }
  };
}

function createMcpStdioTransport(): { closeInput(): void; transport: StdioServerTransport } {
  let transport: StdioServerTransport;
  let buffer = Buffer.alloc(0);
  const input = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      let newline = buffer.indexOf(0x0a);
      while (newline !== -1) {
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        newline = buffer.indexOf(0x0a);
        if (line.length > STDIO_DEFAULT_MAX_BUFFER_SIZE) {
          callback(new Error(`MCP stdio message exceeded ${STDIO_DEFAULT_MAX_BUFFER_SIZE} bytes.`));
          return;
        }
        if (!line.toString("utf8").trim()) continue;
        try {
          parseJSONRPCMessage(JSON.parse(line.toString("utf8")));
          this.push(Buffer.concat([line, Buffer.from("\n")]));
        } catch (error) {
          const invalidJson = error instanceof SyntaxError;
          const parseError = {
            error: invalidJson
              ? { code: -32700, message: "Parse error" }
              : { code: -32600, message: "Invalid Request" },
            jsonrpc: "2.0" as const
          };
          void transport.send(parseError)
            .catch((error: unknown) => transport.onerror?.(error instanceof Error ? error : new Error(String(error))));
        }
      }
      if (buffer.length > STDIO_DEFAULT_MAX_BUFFER_SIZE) {
        callback(new Error(`MCP stdio message exceeded ${STDIO_DEFAULT_MAX_BUFFER_SIZE} bytes.`));
        return;
      }
      callback();
    }
  });
  transport = new StdioServerTransport(input, process.stdout);
  input.once("error", () => {
    process.stdin.unpipe(input);
    process.stdin.pause();
    process.stdin.destroy();
    void transport.close();
  });
  process.stdin.pipe(input);
  return {
    closeInput() {
      process.stdin.unpipe(input);
      input.destroy();
    },
    transport
  };
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
