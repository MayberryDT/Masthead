import type { MastheadDatabase } from "./sqlite.ts";

export type McpAuditStatus = "succeeded" | "failed" | "denied";

export type McpAuditRowDto = {
  mcpQueryId: string;
  toolName: string;
  requestedAt: string;
  resultCount: number;
  boundedBytes?: number;
  sessionIds: string[];
  status: McpAuditStatus;
  failureMessage?: string;
};

export type McpQuerySummaryDto = {
  queryCount: number;
  lastQueryAt?: string;
};

export type McpExclusionDto = {
  exclusionKind: "source" | "project" | "path";
  pattern: string;
  reason: string;
  createdAt: string;
};

export type McpSourcePolicyDto = {
  sourceId: string;
  runtime: string;
  path?: string;
  enabled: boolean;
  policySource: "source" | "global" | "default";
};

type McpAuditRow = {
  mcpQueryId: string;
  toolName: string;
  requestedAt: string;
  resultCount: number;
  boundedBytes: number | null;
  sessionIdsJson: string;
  status: McpAuditStatus;
  failureMessage: string | null;
};

type SourcePolicyRow = {
  sourceId: string;
  runtime: string;
  path: string | null;
};

export function listMcpAuditRows(db: MastheadDatabase, limit = 50): McpAuditRowDto[] {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT
        mcp_query_id AS mcpQueryId,
        tool_name AS toolName,
        requested_at AS requestedAt,
        result_count AS resultCount,
        bounded_bytes AS boundedBytes,
        session_ids_json AS sessionIdsJson,
        status,
        failure_message AS failureMessage
      FROM mcp_query_log
      ORDER BY requested_at DESC
      LIMIT ?`
    )
    .all(boundedLimit) as McpAuditRow[];

  return rows.map((row) => ({
    boundedBytes: row.boundedBytes ?? undefined,
    failureMessage: row.failureMessage ?? undefined,
    mcpQueryId: row.mcpQueryId,
    requestedAt: row.requestedAt,
    resultCount: row.resultCount,
    sessionIds: parseSessionIds(row.sessionIdsJson),
    status: row.status,
    toolName: row.toolName
  }));
}

export function getMcpQuerySummary(db: MastheadDatabase): McpQuerySummaryDto {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS queryCount, MAX(requested_at) AS lastQueryAt
      FROM mcp_query_log`
    )
    .get() as { queryCount: number; lastQueryAt: string | null };
  return {
    lastQueryAt: row.lastQueryAt ?? undefined,
    queryCount: row.queryCount
  };
}

export function globalMcpAccessEnabled(db: MastheadDatabase): boolean {
  const row = db
    .prepare(
      `SELECT enabled
      FROM source_policies
      WHERE policy_kind = 'mcp_access'
        AND source_id IS NULL
      ORDER BY decided_at DESC
      LIMIT 1`
    )
    .get() as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

export function listMcpExclusions(db: MastheadDatabase): McpExclusionDto[] {
  return db
    .prepare(
      `SELECT
        exclusion_kind AS exclusionKind,
        pattern,
        reason,
        created_at AS createdAt
      FROM source_exclusions
      WHERE disabled_at IS NULL
      ORDER BY exclusion_kind, pattern`
    )
    .all() as McpExclusionDto[];
}

export function listMcpSourcePolicies(db: MastheadDatabase): McpSourcePolicyDto[] {
  const globalEnabled = globalMcpAccessEnabled(db);
  const rows = db
    .prepare(
      `SELECT
        source_id AS sourceId,
        adapter AS runtime,
        source_path AS path
      FROM ingest_sources
      ORDER BY adapter, source_id`
    )
    .all() as SourcePolicyRow[];

  return rows.map((row) => {
    const sourcePolicy = latestSourceMcpPolicy(db, row.sourceId);
    return {
      enabled: sourcePolicy?.enabled ?? globalEnabled,
      path: row.path ?? undefined,
      policySource: sourcePolicy ? "source" : globalEnabled === true ? "default" : "global",
      runtime: row.runtime,
      sourceId: row.sourceId
    };
  });
}

function latestSourceMcpPolicy(db: MastheadDatabase, sourceId: string): { enabled: boolean } | undefined {
  const row = db
    .prepare(
      `SELECT enabled
      FROM source_policies
      WHERE policy_kind = 'mcp_access'
        AND source_id = ?
      ORDER BY decided_at DESC
      LIMIT 1`
    )
    .get(sourceId) as { enabled: number } | undefined;
  return row ? { enabled: row.enabled === 1 } : undefined;
}

function parseSessionIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
