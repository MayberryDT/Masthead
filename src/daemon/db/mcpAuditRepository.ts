import { randomUUID } from "node:crypto";
import type { MastheadDatabase } from "./sqlite.ts";

export type McpQueryLogInput = {
  toolName: string;
  requestedAt: string;
  resultCount: number;
  boundedBytes?: number;
  sessionIds: string[];
  status: "succeeded" | "failed" | "denied";
  failureMessage?: string;
};

export function logMcpQuery(db: MastheadDatabase, input: McpQueryLogInput): void {
  db.prepare(
    `INSERT INTO mcp_query_log (
      mcp_query_id,
      tool_name,
      requested_at,
      result_count,
      bounded_bytes,
      session_ids_json,
      status,
      failure_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `mcp_query:${randomUUID()}`,
    input.toolName,
    input.requestedAt,
    input.resultCount,
    input.boundedBytes ?? null,
    JSON.stringify(input.sessionIds),
    input.status,
    input.failureMessage ?? null
  );
}
