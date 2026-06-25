import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  getMastheadCoverageTool,
  getProjectHistoryTool,
  getSessionExcerptTool,
  getSessionTool,
  listProjectSessionsTool,
  searchSessionsTool
} from "./tools.ts";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export function handleMcpLine(db: MastheadDatabase, line: string): string | undefined {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  try {
    if (request.method) {
      const response = handleJsonRpc(db, request);
      return response ? JSON.stringify(response) : undefined;
    }
    const result = callTool(db, request.tool ?? "", request.arguments ?? {});
    return JSON.stringify({ id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method) return JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32602, message } });
    return JSON.stringify({ id: request.id, error: message });
  }
}

function handleJsonRpc(db: MastheadDatabase, request: JsonRpcRequest) {
  if (request.method === "notifications/initialized") return undefined;
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "masthead", version: "0.1.0" }
      }
    };
  }
  if (request.method === "tools/list") {
    return { jsonrpc: "2.0", id: request.id, result: { tools: toolDefinitions() } };
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const result = callTool(db, requiredString(params.name, "name"), objectArg(params.arguments));
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

function callTool(db: MastheadDatabase, tool: string, args: Record<string, unknown>): unknown {
  if (tool === "search_sessions") {
    return searchSessionsTool(db, {
      dateFrom: optionalString(args.dateFrom),
      dateTo: optionalString(args.dateTo),
      host: optionalString(args.host),
      limit: numberArg(args.limit),
      model: optionalString(args.model),
      project: optionalString(args.project),
      query: requiredString(args.query, "query"),
      runtime: optionalString(args.runtime),
      state: optionalString(args.state)
    });
  }
  if (tool === "get_session") {
    return getSessionTool(db, { maxBytes: numberArg(args.maxBytes), sessionId: requiredString(args.sessionId, "sessionId") });
  }
  if (tool === "get_session_excerpt") {
    return getSessionExcerptTool(db, {
      limit: numberArg(args.limit),
      maxBytes: numberArg(args.maxBytes),
      query: optionalString(args.query),
      sessionId: requiredString(args.sessionId, "sessionId")
    });
  }
  if (tool === "list_project_sessions") {
    return listProjectSessionsTool(db, { limit: numberArg(args.limit), project: requiredString(args.project, "project") });
  }
  if (tool === "get_project_history") {
    return getProjectHistoryTool(db, { limit: numberArg(args.limit), project: requiredString(args.project, "project") });
  }
  if (tool === "get_masthead_coverage") return getMastheadCoverageTool(db);
  throw new Error(`Unknown tool: ${tool}`);
}

export function toolDefinitions() {
  return [
    {
      name: "search_sessions",
      description: "Search Masthead session capsules and indexed metadata.",
      inputSchema: objectSchema(
        {
          dateFrom: { type: "string" },
          dateTo: { type: "string" },
          host: { type: "string" },
          limit: { type: "number" },
          model: { type: "string" },
          project: { type: "string" },
          query: { type: "string", minLength: 1 },
          runtime: { type: "string" },
          state: { type: "string" }
        },
        ["query"]
      )
    },
    {
      name: "get_session",
      description: "Get one normalized Masthead session with bounded historical evidence.",
      inputSchema: objectSchema({ maxBytes: { type: "number" }, sessionId: { type: "string", minLength: 1 } }, ["sessionId"])
    },
    {
      name: "get_session_excerpt",
      description: "Get a bounded query-relevant historical transcript excerpt labeled as untrusted evidence.",
      inputSchema: objectSchema(
        { limit: { type: "number" }, maxBytes: { type: "number" }, query: { type: "string" }, sessionId: { type: "string", minLength: 1 } },
        ["sessionId"]
      )
    },
    {
      name: "list_project_sessions",
      description: "List recent sessions for a project label.",
      inputSchema: objectSchema({ limit: { type: "number" }, project: { type: "string", minLength: 1 } }, ["project"])
    },
    {
      name: "get_project_history",
      description: "Get structured project history from normalized session metadata.",
      inputSchema: objectSchema({ limit: { type: "number" }, project: { type: "string", minLength: 1 } }, ["project"])
    },
    {
      name: "get_masthead_coverage",
      description: "Report local Masthead coverage counts by canonical table.",
      inputSchema: objectSchema({})
    }
  ];
}

function objectSchema(properties: Record<string, { type: string; minLength?: number }>, required: string[] = []) {
  return { additionalProperties: false, properties, required, type: "object" };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function objectArg(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
