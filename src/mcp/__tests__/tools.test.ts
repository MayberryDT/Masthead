import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../core/types.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { createSessionRepository } from "../../daemon/db/sessionRepository.ts";
import { indexCanonicalSessionSearch, indexSessionSearch } from "../../daemon/db/searchRepository.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { HISTORICAL_UNTRUSTED_PREFIX } from "../redaction.ts";
import {
  getMastheadCoverageTool,
  getProjectHistoryTool,
  getSessionExcerptTool,
  getSessionTool,
  listProjectSessionsTool,
  searchSessionsTool
} from "../tools.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead MCP tools", () => {
  test("searches sessions compactly and logs the read-only query", async () => {
    const db = await openDb();
    indexSessionSearch(db, {
      capsule: "Import Codex history into canonical SQLite",
      commands: "npm test",
      filePaths: "src/daemon/main.ts",
      finalResponse: "",
      firstPrompt: "Turn this into an implementation plan",
      normalizedText: "daemon logbook mcp",
      projectAliases: "Masthead",
      sessionId: "session-1",
      tags: "codex sqlite",
      title: "Masthead data layer",
      toolNames: "exec_command"
    });

    expect(searchSessionsTool(db, { limit: 5, query: "canonical" })).toMatchObject({
      sessions: [expect.objectContaining({ sessionId: "session-1", title: "Masthead data layer" })]
    });
    expect(db.prepare("SELECT tool_name, result_count, status FROM mcp_query_log").all()).toEqual([
      { result_count: 1, status: "succeeded", tool_name: "search_sessions" }
    ]);
    db.close();
  });

  test("returns bounded historical excerpts labeled as untrusted evidence", async () => {
    const db = await openDb();
    const result = getSessionExcerptTool(db, {
      maxBytes: 12,
      sessionId: "session-1",
      text: "This is a long historical response that must be bounded."
    });

    expect(result.text).toContain(HISTORICAL_UNTRUSTED_PREFIX);
    expect(Buffer.byteLength(result.text.split("\n\n").at(-1) ?? "", "utf8")).toBeLessThanOrEqual(12);
    expect(db.prepare("SELECT tool_name, bounded_bytes, status FROM mcp_query_log").all()).toEqual([
      { bounded_bytes: 12, status: "succeeded", tool_name: "get_session_excerpt" }
    ]);
    db.close();
  });

  test("serves read-only session, project, and coverage tools from canonical tables", async () => {
    const db = await openDb();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex"
    });
    const sessionId = repository.upsertLiveEvent(
      liveEvent("canonical", {
        message: "Import existing sessions",
        project: "Masthead",
        title: "MCP canonical session"
      })
    );
    expect(sessionId).toBeTruthy();
    indexCanonicalSessionSearch(db, sessionId!);

    expect(getSessionTool(db, { sessionId: sessionId!, maxBytes: 64 })).toMatchObject({
      session: expect.objectContaining({ project: "Masthead", title: "MCP canonical session" })
    });
    expect(getSessionExcerptTool(db, { sessionId: sessionId!, maxBytes: 64 }).text).toContain(HISTORICAL_UNTRUSTED_PREFIX);
    expect(listProjectSessionsTool(db, { project: "Masthead", limit: 5 }).sessions).toEqual([
      expect.objectContaining({ sessionId, title: "MCP canonical session" })
    ]);
    expect(getProjectHistoryTool(db, { project: "Masthead", limit: 5, maxBytes: 128 })).toMatchObject({
      project: "Masthead",
      sessions: [expect.objectContaining({ sessionId })]
    });
    expect(getMastheadCoverageTool(db)).toMatchObject({
      sessions: 1,
      messages: 1
    });
    expect(db.prepare("SELECT DISTINCT tool_name FROM mcp_query_log ORDER BY tool_name").all()).toEqual(
      expect.arrayContaining([
        { tool_name: "get_masthead_coverage" },
        { tool_name: "get_project_history" },
        { tool_name: "get_session" },
        { tool_name: "get_session_excerpt" },
        { tool_name: "list_project_sessions" }
      ])
    );
    db.close();
  });
});

async function openDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function liveEvent(eventId: string, payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `codex:${eventId}`,
    sessionId: `session-${eventId}`,
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: eventId
    },
    occurredAt: "2026-06-24T15:00:00.000Z",
    receivedAt: "2026-06-24T15:00:00.000Z",
    type: "user.question",
    workspace: {
      branch: "main",
      cwd: "/workspace/masthead",
      repoRoot: "/workspace/masthead",
      worktreePath: "/workspace/masthead"
    },
    summary: String(payload.title ?? payload.message ?? `Event ${eventId}`),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: `codex:${eventId}`, kind: "event", observedAt: "2026-06-24T15:00:00.000Z", source: "codex.hook" }]
  };
}
