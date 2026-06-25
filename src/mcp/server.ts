import { daemonConfigFromEnv } from "../daemon/config.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  getMastheadCoverageTool,
  getProjectHistoryTool,
  getSessionExcerptTool,
  getSessionTool,
  listProjectSessionsTool,
  searchSessionsTool
} from "./tools.ts";

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
    handleLine(line);
  }
});

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  tool?: string;
  arguments?: Record<string, unknown>;
};

function handleLine(line: string): void {
  const request = JSON.parse(line) as JsonRpcRequest;
  try {
    if (request.method) {
      const response = handleJsonRpc(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    const result = callTool(request.tool ?? "", request.arguments ?? {});
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32000, message } })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ id: request.id, error: message })}\n`);
  }
}

function handleJsonRpc(request: JsonRpcRequest) {
  if (request.method === "notifications/initialized") return undefined;
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "masthead",
          version: "0.1.0"
        }
      }
    };
  }
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: toolDefinitions()
      }
    };
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const result = callTool(stringArg(params.name), objectArg(params.arguments));
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false
      }
    };
  }
  throw new Error(`Unknown MCP method: ${request.method}`);
}

function callTool(tool: string, args: Record<string, unknown>): unknown {
  if (tool === "search_sessions") {
    return searchSessionsTool(db, { limit: numberArg(args.limit), query: stringArg(args.query) });
  }
  if (tool === "get_session") {
    return getSessionTool(db, { maxBytes: numberArg(args.maxBytes), sessionId: stringArg(args.sessionId) });
  }
  if (tool === "get_session_excerpt") {
    return getSessionExcerptTool(db, {
      maxBytes: numberArg(args.maxBytes),
      sessionId: stringArg(args.sessionId),
      text: stringArg(args.text)
    });
  }
  if (tool === "list_project_sessions") {
    return listProjectSessionsTool(db, { limit: numberArg(args.limit), project: stringArg(args.project) });
  }
  if (tool === "get_project_history") {
    return getProjectHistoryTool(db, {
      limit: numberArg(args.limit),
      maxBytes: numberArg(args.maxBytes),
      project: stringArg(args.project)
    });
  }
  if (tool === "get_masthead_coverage") {
    return getMastheadCoverageTool(db);
  }
  throw new Error(`Unknown tool: ${tool}`);
}

function toolDefinitions() {
  return [
    {
      name: "search_sessions",
      description: "Search Masthead session capsules and indexed metadata.",
      inputSchema: objectSchema({
        limit: { type: "number" },
        query: { type: "string" }
      })
    },
    {
      name: "get_session",
      description: "Get one normalized Masthead session with bounded historical evidence.",
      inputSchema: objectSchema({
        maxBytes: { type: "number" },
        sessionId: { type: "string" }
      })
    },
    {
      name: "get_session_excerpt",
      description: "Get a bounded historical transcript excerpt labeled as untrusted evidence.",
      inputSchema: objectSchema({
        maxBytes: { type: "number" },
        sessionId: { type: "string" }
      })
    },
    {
      name: "list_project_sessions",
      description: "List recent sessions for a project label.",
      inputSchema: objectSchema({
        limit: { type: "number" },
        project: { type: "string" }
      })
    },
    {
      name: "get_project_history",
      description: "Get bounded project history from normalized session metadata.",
      inputSchema: objectSchema({
        limit: { type: "number" },
        maxBytes: { type: "number" },
        project: { type: "string" }
      })
    },
    {
      name: "get_masthead_coverage",
      description: "Report local Masthead coverage counts by canonical table.",
      inputSchema: objectSchema({})
    }
  ];
}

function objectSchema(properties: Record<string, { type: string }>) {
  return {
    type: "object",
    properties,
    additionalProperties: false
  };
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function objectArg(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
