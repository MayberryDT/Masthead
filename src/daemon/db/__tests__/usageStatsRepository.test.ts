import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionTokenTotals, getSessionUsageSummaries, getUsageStats, usageRangeForWindow } from "../usageStatsRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];
const now = new Date("2026-06-26T15:00:00.000Z");
const todayStart = localDayStart(now).toISOString();

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("usage stats repository", () => {
  test("creates stable usage windows", () => {
    expect(usageRangeForWindow("today", now)).toEqual({
      bucket: "hour",
      from: todayStart,
      to: "2026-06-26T15:00:00.000Z"
    });
    expect(usageRangeForWindow("24h", now)).toEqual({
      bucket: "hour",
      from: "2026-06-25T15:00:00.000Z",
      to: "2026-06-26T15:00:00.000Z"
    });
    expect(usageRangeForWindow("all", now)).toEqual({
      bucket: "day",
      to: "2026-06-26T15:00:00.000Z"
    });
  });

  test("summarizes today's canonical usage while excluding deleted sessions", async () => {
    const db = await openTestDatabase();
    seedUsageFixture(db);

    const stats = getUsageStats(db, "today", now);

    expect(stats.window).toBe("today");
    expect(stats.generatedAt).toBe("2026-06-26T15:00:00.000Z");
    expect(stats.range).toEqual({
      from: todayStart,
      to: "2026-06-26T15:00:00.000Z"
    });
    expect(stats.totals).toMatchObject({
      fileEffects: 3,
      inputTokens: 100,
      mcpQueries: 2,
      messages: 3,
      models: 1,
      outputTokens: 50,
      projects: 2,
      runtimes: 2,
      sessions: 2,
      tokenCoverageSessions: 1,
      tokenRows: 1,
      toolCalls: 3,
      totalTokens: 150
    });
    expect(stats.totals.tokensPerMinute).toBeCloseTo(150 / minutesBetween(todayStart, now.toISOString()));
    expect(stats.byModel).toEqual([
      {
        inputTokens: 100,
        model: "gpt-5",
        outputTokens: 50,
        provider: "openai",
        sessions: 1,
        totalTokens: 150
      }
    ]);
    expect(stats.byProject).toEqual([
      {
        fileEffects: 2,
        messages: 2,
        project: "Masthead",
        sessions: 1,
        toolCalls: 1,
        totalTokens: 150
      },
      {
        fileEffects: 1,
        messages: 1,
        project: "Pip",
        sessions: 1,
        toolCalls: 2,
        totalTokens: 0
      }
    ]);
    expect(stats.byRuntime).toEqual([
      {
        fileEffects: 2,
        messages: 2,
        runtime: "opencode",
        sessions: 1,
        toolCalls: 1,
        totalTokens: 150
      },
      {
        fileEffects: 1,
        messages: 1,
        runtime: "cursor",
        sessions: 1,
        toolCalls: 2,
        totalTokens: 0
      }
    ]);
    expect(stats.activity).toEqual(
      expect.arrayContaining([
        {
          bucketStart: "2026-06-26T10:00:00.000Z",
          fileEffects: 1,
          messages: 1,
          sessions: 1,
          toolCalls: 2,
          totalTokens: 0
        },
        {
          bucketStart: "2026-06-26T14:00:00.000Z",
          fileEffects: 2,
          messages: 2,
          sessions: 1,
          toolCalls: 1,
          totalTokens: 150
        }
      ])
    );
    expect(stats.coverage).toEqual({
      currentEnrichments: 3,
      importedSessions: 3,
      mcpQueries: 3,
      sessionsWithTokenUsage: 2,
      sessionsWithoutTokenUsage: 1,
      sources: 2
    });
    db.close();
  });

  test("supports rolling and all-time windows from canonical timestamps", async () => {
    const db = await openTestDatabase();
    seedUsageFixture(db);

    const rolling = getUsageStats(db, "24h", now);
    expect(rolling.range.from).toBe("2026-06-25T15:00:00.000Z");
    expect(rolling.totals).toMatchObject({
      sessions: 3,
      tokenRows: 2,
      totalTokens: 210
    });
    expect(rolling.totals.tokensPerMinute).toBeCloseTo(210 / 1440);
    expect(rolling.activity[0]?.bucketStart).toBe("2026-06-25T16:00:00.000Z");

    const all = getUsageStats(db, "all", now);
    expect(all.range).toEqual({ to: "2026-06-26T15:00:00.000Z" });
    expect(all.totals).toMatchObject({
      sessions: 3,
      tokenRows: 2,
      totalTokens: 210
    });
    expect(all.totals.tokensPerMinute).toBeUndefined();
    expect(all.activity).toEqual(
      expect.arrayContaining([
        {
          bucketStart: "2026-06-25T00:00:00.000Z",
          fileEffects: 1,
          messages: 1,
          sessions: 1,
          toolCalls: 1,
          totalTokens: 60
        },
        {
          bucketStart: "2026-06-26T00:00:00.000Z",
          fileEffects: 3,
          messages: 3,
          sessions: 2,
          toolCalls: 3,
          totalTokens: 150
        }
      ])
    );
    db.close();
  });

  test("returns session token totals keyed by source session id", async () => {
    const db = await openTestDatabase();
    db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
      "host:test",
      "masthead-test-host",
      "2026-06-25T12:00:00.000Z",
      now.toISOString()
    );
    insertRuntime(db, "runtime-opencode", "opencode");
    insertSession(db, {
      project: "Masthead",
      runtimeId: "runtime-opencode",
      sessionId: "canonical-session",
      sourceSessionId: "source-session",
      timestamp: "2026-06-26T14:05:00.000Z"
    });
    insertSession(db, {
      deletedAt: "2026-06-26T14:20:00.000Z",
      project: "Masthead",
      runtimeId: "runtime-opencode",
      sessionId: "deleted-session",
      sourceSessionId: "deleted-source",
      timestamp: "2026-06-26T14:10:00.000Z"
    });
    insertUsage(db, "usage-a", "canonical-session", "gpt-5", "openai", 100, 50, 150, "2026-06-26T14:08:00.000Z");
    insertUsage(db, "usage-b", "canonical-session", "gpt-5", "openai", 20, 10, null, "2026-06-26T14:09:00.000Z");
    insertUsage(db, "usage-missing", "canonical-session", "gpt-5", "openai", null, null, null, "2026-06-26T14:10:00.000Z");
    insertUsage(db, "usage-deleted", "deleted-session", "gpt-5", "openai", 900, 90, 990, "2026-06-26T14:11:00.000Z");

    expect([...getSessionTokenTotals(db, ["source-session", "deleted-source", "missing-session"])]).toEqual([["source-session", 180]]);
    db.close();
  });

  test("returns runtime-scoped session usage summaries from model_usage", async () => {
    const db = await openTestDatabase();
    db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
      "host:test",
      "masthead-test-host",
      "2026-06-25T12:00:00.000Z",
      now.toISOString()
    );
    insertRuntime(db, "runtime-opencode", "opencode");
    insertRuntime(db, "runtime-omp", "omp");
    insertSession(db, {
      project: "Masthead",
      runtimeId: "runtime-opencode",
      sessionId: "canonical-opencode-session",
      sourceSessionId: "shared-source-session",
      timestamp: "2026-06-26T14:05:00.000Z"
    });
    insertSession(db, {
      project: "Masthead",
      runtimeId: "runtime-omp",
      sessionId: "canonical-omp-session",
      sourceSessionId: "shared-source-session",
      timestamp: "2026-06-26T14:06:00.000Z"
    });
    insertUsage(db, "usage-opencode-total", "canonical-opencode-session", "stale-model", "stale-provider", 100, 50, 150, "2026-06-26T14:07:00.000Z");
    insertUsage(db, "usage-opencode-delta", "canonical-opencode-session", "stale-model", "stale-provider", 20, 10, null, "2026-06-26T14:08:00.000Z");
    insertUsage(db, "usage-opencode-latest", "canonical-opencode-session", "gpt-5.5", "openai-compatible", null, null, null, "2026-06-26T14:09:00.000Z");
    insertUsage(db, "usage-omp", "canonical-omp-session", "qwen3-coder", "ollama", 11, 22, null, "2026-06-26T14:10:00.000Z");

    expect([...getSessionUsageSummaries(db, ["canonical-opencode-session", "canonical-omp-session"])]).toEqual([
      [
        "canonical-opencode-session",
        {
          model: "gpt-5.5",
          observedAt: "2026-06-26T14:09:00.000Z",
          provider: "openai-compatible",
          totalTokens: 180
        }
      ],
      [
        "canonical-omp-session",
        {
          model: "qwen3-coder",
          observedAt: "2026-06-26T14:10:00.000Z",
          provider: "ollama",
          totalTokens: 33
        }
      ]
    ]);
    db.close();
  });

  test("plans session token totals without scanning all model usage", async () => {
    const db = await openTestDatabase();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT COALESCE(sessions.source_session_id, sessions.session_id) AS sessionId,
          COALESCE(SUM(COALESCE(model_usage.total_tokens, COALESCE(model_usage.input_tokens, 0) + COALESCE(model_usage.output_tokens, 0))), 0) AS totalTokens
        FROM sessions
        JOIN model_usage ON model_usage.session_id = sessions.session_id
        WHERE sessions.deleted_at IS NULL
          AND (sessions.source_session_id IN (?) OR sessions.session_id IN (?))
          AND (model_usage.total_tokens IS NOT NULL OR model_usage.input_tokens IS NOT NULL OR model_usage.output_tokens IS NOT NULL)
        GROUP BY COALESCE(sessions.source_session_id, sessions.session_id)`
      )
      .all("source-session", "canonical-session") as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail);

    expect(details).toEqual(expect.arrayContaining([expect.stringContaining("model_usage_session_idx")]));
    expect(details).not.toEqual(expect.arrayContaining([expect.stringContaining("SCAN model_usage")]));
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-usage-stats-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedUsageFixture(db: MastheadDatabase): void {
  const createdAt = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "masthead-test-host",
    createdAt,
    now.toISOString()
  );
  insertRuntime(db, "runtime:opencode", "opencode");
  insertRuntime(db, "runtime:cursor", "cursor");
  insertSource(db, "source:opencode", "opencode", null);
  insertSource(db, "source:cursor", "cursor", null);
  insertSource(db, "source:excluded", "opencode", "2026-06-26T12:00:00.000Z");

  insertSession(db, {
    project: "Masthead",
    runtimeId: "runtime:opencode",
    sessionId: "session-today-a",
    timestamp: "2026-06-26T14:00:00.000Z"
  });
  insertSession(db, {
    project: "Pip",
    runtimeId: "runtime:cursor",
    sessionId: "session-today-b",
    timestamp: "2026-06-26T10:00:00.000Z"
  });
  insertSession(db, {
    project: "Masthead",
    runtimeId: "runtime:opencode",
    sessionId: "session-yesterday",
    timestamp: "2026-06-25T16:30:00.000Z"
  });
  insertSession(db, {
    deletedAt: "2026-06-26T14:30:00.000Z",
    project: "Deleted",
    runtimeId: "runtime:cursor",
    sessionId: "session-deleted",
    timestamp: "2026-06-26T14:20:00.000Z"
  });

  insertRepeatedRows(db, "messages", "message_id", "observed_at", "session-today-a", "2026-06-26T14:05:00.000Z", 2);
  insertRepeatedRows(db, "tool_calls", "tool_call_id", "started_at", "session-today-a", "2026-06-26T14:06:00.000Z", 1);
  insertRepeatedRows(db, "file_effects", "file_effect_id", "observed_at", "session-today-a", "2026-06-26T14:07:00.000Z", 2);
  insertRepeatedRows(db, "messages", "message_id", "observed_at", "session-today-b", "2026-06-26T10:05:00.000Z", 1);
  insertRepeatedRows(db, "tool_calls", "tool_call_id", "started_at", "session-today-b", "2026-06-26T10:06:00.000Z", 2);
  insertRepeatedRows(db, "file_effects", "file_effect_id", "observed_at", "session-today-b", "2026-06-26T10:07:00.000Z", 1);
  insertRepeatedRows(db, "messages", "message_id", "observed_at", "session-yesterday", "2026-06-25T16:35:00.000Z", 1);
  insertRepeatedRows(db, "tool_calls", "tool_call_id", "started_at", "session-yesterday", "2026-06-25T16:36:00.000Z", 1);
  insertRepeatedRows(db, "file_effects", "file_effect_id", "observed_at", "session-yesterday", "2026-06-25T16:37:00.000Z", 1);
  insertRepeatedRows(db, "messages", "message_id", "observed_at", "session-deleted", "2026-06-26T14:25:00.000Z", 1);
  insertRepeatedRows(db, "tool_calls", "tool_call_id", "started_at", "session-deleted", "2026-06-26T14:26:00.000Z", 1);
  insertRepeatedRows(db, "file_effects", "file_effect_id", "observed_at", "session-deleted", "2026-06-26T14:27:00.000Z", 1);

  insertUsage(db, "usage-a", "session-today-a", "gpt-5", "openai", 100, 50, 150, "2026-06-26T14:08:00.000Z");
  insertUsage(db, "usage-b", "session-today-b", null, "openai", null, null, null, "2026-06-26T10:08:00.000Z");
  insertUsage(db, "usage-model-only", "session-today-b", "gpt-5-model-only", "openai", null, null, null, "2026-06-26T10:09:00.000Z");
  insertUsage(db, "usage-c", "session-yesterday", "gpt-4.1", "openai", 40, 20, 60, "2026-06-25T16:38:00.000Z");
  insertUsage(db, "usage-deleted", "session-deleted", "gpt-deleted", "openai", 900, 90, 990, "2026-06-26T14:28:00.000Z");

  insertEnrichment(db, "enrichment-a", "session-today-a", "current");
  insertEnrichment(db, "enrichment-b", "session-today-b", "current");
  insertEnrichment(db, "enrichment-c", "session-yesterday", "current");
  insertEnrichment(db, "enrichment-deleted", "session-deleted", "current");
  insertEnrichment(db, "enrichment-stale", "session-today-a", "stale");

  insertMcpQuery(db, "mcp-a", "2026-06-26T14:09:00.000Z");
  insertMcpQuery(db, "mcp-b", "2026-06-26T10:09:00.000Z");
  insertMcpQuery(db, "mcp-c", "2026-06-25T16:39:00.000Z");
}

function insertRuntime(db: MastheadDatabase, runtimeId: string, runtimeKind: string): void {
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    runtimeId,
    runtimeKind,
    "1.0.0",
    "2026-06-25T12:00:00.000Z",
    now.toISOString()
  );
}

function insertSource(db: MastheadDatabase, sourceId: string, adapter: string, excludedAt: string | null): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, schema_version, runtime_version,
      confidence, discovered_at, last_seen_at, excluded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, adapter, "transcript", `/tmp/${sourceId}`, "1", "1.0.0", "authoritative", "2026-06-25T12:00:00.000Z", now.toISOString(), excludedAt);
}

function insertSession(
  db: MastheadDatabase,
  options: {
    deletedAt?: string;
    project: string;
    runtimeId: string;
    sessionId: string;
    sourceSessionId?: string;
    timestamp: string;
  }
): void {
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.sessionId,
    "host:test",
    options.runtimeId,
    options.sourceSessionId ?? options.sessionId,
    options.project,
    "/workspace/masthead",
    "/workspace/masthead",
    "main",
    options.sessionId,
    "Measure canonical usage",
    "ended",
    "completed",
    options.timestamp,
    options.timestamp,
    options.timestamp,
    "authoritative",
    options.timestamp,
    options.timestamp,
    options.deletedAt ?? null
  );
}

function insertRepeatedRows(
  db: MastheadDatabase,
  table: "messages" | "tool_calls" | "file_effects",
  idColumn: "message_id" | "tool_call_id" | "file_effect_id",
  timestampColumn: "observed_at" | "started_at",
  sessionId: string,
  timestamp: string,
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    const id = `${sessionId}:${table}:${index}`;
    if (table === "messages") {
      db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        sessionId,
        "user",
        "Do the work.",
        `${id}:hash`,
        timestamp,
        "{}",
        "authoritative"
      );
    } else if (table === "tool_calls") {
      db.prepare(`INSERT INTO tool_calls (${idColumn}, session_id, tool_name, ${timestampColumn}, source_ref_json) VALUES (?, ?, ?, ?, ?)`).run(
        id,
        sessionId,
        "exec_command",
        timestamp,
        "{}"
      );
    } else {
      db.prepare(`INSERT INTO file_effects (${idColumn}, session_id, path, effect_kind, ${timestampColumn}, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id,
        sessionId,
        `src/${index}.ts`,
        "modified",
        timestamp,
        "{}"
      );
    }
  }
}

function insertUsage(
  db: MastheadDatabase,
  usageId: string,
  sessionId: string,
  model: string | null,
  provider: string,
  inputTokens: number | null,
  outputTokens: number | null,
  totalTokens: number | null,
  observedAt: string
): void {
  db.prepare(
    `INSERT INTO model_usage (
      usage_id, session_id, model, provider, input_tokens, output_tokens, total_tokens, observed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(usageId, sessionId, model, provider, inputTokens, outputTokens, totalTokens, observedAt, "{}");
}

function insertEnrichment(db: MastheadDatabase, enrichmentId: string, sessionId: string, status: "current" | "stale"): void {
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      provider, generated_at, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(enrichmentId, sessionId, "session_capsule", status, `${enrichmentId}:fingerprint`, "usage-test", "deterministic", now.toISOString(), "[]");
}

function insertMcpQuery(db: MastheadDatabase, mcpQueryId: string, requestedAt: string): void {
  db.prepare(
    `INSERT INTO mcp_query_log (
      mcp_query_id, tool_name, requested_at, result_count, session_ids_json, status
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(mcpQueryId, "session_search", requestedAt, 1, "[]", "succeeded");
}

function localDayStart(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start;
}

function minutesBetween(from: string, to: string): number {
  return Math.max(1, (Date.parse(to) - Date.parse(from)) / 60_000);
}
