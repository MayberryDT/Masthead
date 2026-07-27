import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  getArtifactTool,
  getCorpusStatsTool,
  getEvidenceExcerptTool,
  getEvidenceTranscriptTool,
  getKnowledgeTool,
  getMastheadCoverageTool,
  getProjectHistoryTool,
  getProvenanceTool,
  getSessionExcerptTool,
  getSessionTranscriptTool,
  getSessionTool,
  listKnowledgeTool,
  listProjectSessionsTool,
  searchArtifactsTool,
  searchKnowledgeTool,
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
  // --- Artifact-first v2 (primary) ---
  if (tool === "search_knowledge") {
    return searchKnowledgeTool(db, {
      dateFrom: optionalString(args.dateFrom),
      dateTo: optionalString(args.dateTo),
      kind: artifactKindArg(args.kind),
      limit: numberArg(args.limit),
      offset: numberArg(args.offset),
      project: optionalString(args.project),
      query: optionalString(args.query)
    });
  }
  if (tool === "list_knowledge") {
    return listKnowledgeTool(db, {
      dateFrom: optionalString(args.dateFrom),
      dateTo: optionalString(args.dateTo),
      kind: artifactKindArg(args.kind),
      limit: numberArg(args.limit),
      offset: numberArg(args.offset),
      project: optionalString(args.project)
    });
  }
  if (tool === "get_knowledge") {
    return getKnowledgeTool(db, { artifactId: requiredString(args.artifactId, "artifactId") });
  }
  if (tool === "get_provenance") {
    return getProvenanceTool(db, { artifactId: requiredString(args.artifactId, "artifactId") });
  }
  if (tool === "get_evidence_excerpt") {
    return getEvidenceExcerptTool(db, {
      artifactId: optionalString(args.artifactId),
      limit: numberArg(args.limit),
      maxBytes: maxBytesArg(args.maxBytes),
      query: optionalString(args.query),
      sessionId: requiredString(args.sessionId, "sessionId")
    });
  }
  if (tool === "get_evidence_transcript") {
    return getEvidenceTranscriptTool(db, {
      artifactId: optionalString(args.artifactId),
      limit: numberArg(args.limit),
      maxBytes: maxBytesArg(args.maxBytes),
      role: transcriptRoleArg(args.role),
      sessionId: requiredString(args.sessionId, "sessionId")
    });
  }
  if (tool === "get_corpus_stats") return getCorpusStatsTool(db);

  // --- v1 aliases (compat) ---
  if (tool === "search_artifacts") {
    return searchArtifactsTool(db, {
      kind: artifactKindArg(args.kind),
      limit: numberArg(args.limit),
      offset: numberArg(args.offset),
      project: optionalString(args.project),
      query: optionalString(args.query)
    });
  }
  if (tool === "get_artifact") {
    return getArtifactTool(db, { artifactId: requiredString(args.artifactId, "artifactId") });
  }
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
    return getSessionTool(db, { maxBytes: maxBytesArg(args.maxBytes), sessionId: requiredString(args.sessionId, "sessionId") });
  }
  if (tool === "get_session_excerpt") {
    return getSessionExcerptTool(db, {
      limit: numberArg(args.limit),
      maxBytes: maxBytesArg(args.maxBytes),
      query: optionalString(args.query),
      sessionId: requiredString(args.sessionId, "sessionId")
    });
  }
  if (tool === "get_session_transcript") {
    return getSessionTranscriptTool(db, {
      limit: numberArg(args.limit),
      maxBytes: maxBytesArg(args.maxBytes),
      role: transcriptRoleArg(args.role),
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
      name: "search_knowledge",
      description:
        "PRIMARY: Search published Logbook knowledge (session dossiers, runbooks, ADRs, incident timelines). Prefer this for reuse questions.",
      inputSchema: objectSchema(
        {
          kind: { type: "string", enum: ["session_dossier", "runbook", "adr", "incident_timeline"] },
          limit: { type: "number" },
          offset: { type: "number" },
          project: { type: "string" },
          query: { type: "string" },
          dateFrom: { type: "string" },
          dateTo: { type: "string" }
        },
        []
      )
    },
    {
      name: "list_knowledge",
      description: "PRIMARY: Browse published knowledge without a text query (kind/project/date filters + pagination).",
      inputSchema: objectSchema(
        {
          kind: { type: "string", enum: ["session_dossier", "runbook", "adr", "incident_timeline"] },
          limit: { type: "number" },
          offset: { type: "number" },
          project: { type: "string" },
          dateFrom: { type: "string" },
          dateTo: { type: "string" }
        },
        []
      )
    },
    {
      name: "get_knowledge",
      description:
        "PRIMARY: Get one published artifact with stable artifactId, body, provenance sessions, and evidence refs.",
      inputSchema: objectSchema({ artifactId: { type: "string", minLength: 1 } }, ["artifactId"])
    },
    {
      name: "get_provenance",
      description: "PRIMARY: List provenance sessions for a published artifact (and join rationale when multi-session).",
      inputSchema: objectSchema({ artifactId: { type: "string", minLength: 1 } }, ["artifactId"])
    },
    {
      name: "get_evidence_excerpt",
      description:
        "EVIDENCE: Bounded historical excerpt for a session. Pass artifactId to require the session is in that artifact's provenance.",
      inputSchema: objectSchema(
        {
          artifactId: { type: "string" },
          limit: { type: "number" },
          maxBytes: { type: "number", minimum: 1, maximum: 16000 },
          query: { type: "string" },
          sessionId: { type: "string", minLength: 1 }
        },
        ["sessionId"]
      )
    },
    {
      name: "get_evidence_transcript",
      description:
        "EVIDENCE: Bounded transcript rows (role filter). Pass artifactId to require provenance membership.",
      inputSchema: objectSchema(
        {
          artifactId: { type: "string" },
          limit: { type: "number" },
          maxBytes: { type: "number", minimum: 1, maximum: 16000 },
          role: { type: "string" },
          sessionId: { type: "string", minLength: 1 }
        },
        ["sessionId"]
      )
    },
    {
      name: "get_corpus_stats",
      description: "PRIMARY: Published artifact counts by kind/project plus optional session coverage stats.",
      inputSchema: objectSchema({})
    },
    // v1 aliases
    {
      name: "search_artifacts",
      description: "Alias of search_knowledge (published Logbook artifacts). Prefer search_knowledge.",
      inputSchema: objectSchema(
        {
          kind: { type: "string", enum: ["session_dossier", "runbook", "adr", "incident_timeline"] },
          limit: { type: "number" },
          offset: { type: "number" },
          project: { type: "string" },
          query: { type: "string" }
        },
        []
      )
    },
    {
      name: "get_artifact",
      description: "Alias of get_knowledge. Prefer get_knowledge.",
      inputSchema: objectSchema({ artifactId: { type: "string", minLength: 1 } }, ["artifactId"])
    },
    {
      name: "search_sessions",
      description:
        "LEGACY evidence: Search sessions (can be slow on broad queries). Prefer search_knowledge for reuse.",
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
      description: "LEGACY evidence: Bounded session bag. Prefer get_knowledge + get_evidence_*.",
      inputSchema: objectSchema({ maxBytes: { type: "number", minimum: 1, maximum: 16000 }, sessionId: { type: "string", minLength: 1 } }, ["sessionId"])
    },
    {
      name: "get_session_excerpt",
      description: "LEGACY alias of get_evidence_excerpt.",
      inputSchema: objectSchema(
        { limit: { type: "number" }, maxBytes: { type: "number", minimum: 1, maximum: 16000 }, query: { type: "string" }, sessionId: { type: "string", minLength: 1 } },
        ["sessionId"]
      )
    },
    {
      name: "get_session_transcript",
      description: "LEGACY alias of get_evidence_transcript.",
      inputSchema: objectSchema(
        { limit: { type: "number" }, maxBytes: { type: "number", minimum: 1, maximum: 16000 }, role: { type: "string" }, sessionId: { type: "string", minLength: 1 } },
        ["sessionId"]
      )
    },
    {
      name: "list_project_sessions",
      description: "LEGACY: List sessions by project. Prefer list_knowledge/search_knowledge with project.",
      inputSchema: objectSchema({ limit: { type: "number" }, project: { type: "string", minLength: 1 } }, ["project"])
    },
    {
      name: "get_project_history",
      description: "LEGACY: Project session history. Prefer search_knowledge with project.",
      inputSchema: objectSchema({ limit: { type: "number" }, project: { type: "string", minLength: 1 } }, ["project"])
    },
    {
      name: "get_masthead_coverage",
      description: "LEGACY session table coverage. Prefer get_corpus_stats for published knowledge counts.",
      inputSchema: objectSchema({})
    }
  ];
}

function objectSchema(
  properties: Record<string, { type: string; minLength?: number; minimum?: number; maximum?: number; enum?: string[] }>,
  required: string[] = []
) {
  return { additionalProperties: false, properties, required, type: "object" };
}

function artifactKindArg(value: unknown): "session_dossier" | "runbook" | "adr" | "incident_timeline" | undefined {
  if (value === "session_dossier" || value === "runbook" || value === "adr" || value === "incident_timeline") return value;
  return undefined;
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

function maxBytesArg(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
  return Math.max(1, Math.min(value, 16_000));
}

function transcriptRoleArg(value: unknown): "user" | "assistant" | "tool" | "all" | undefined {
  return value === "user" || value === "assistant" || value === "tool" || value === "all" ? value : undefined;
}
