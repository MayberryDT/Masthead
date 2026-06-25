import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../core/types.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { createSessionRepository } from "../../daemon/db/sessionRepository.ts";
import { indexCanonicalSessionSearch } from "../../daemon/db/searchRepository.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { getMcpProjectHistory, getMcpSessionExcerpt, searchMcpSessions } from "../sessionRetrieval.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("MCP session retrieval", () => {
  test("returns query-relevant excerpts with source refs and byte bounds", async () => {
    const db = await openDb();
    const sessionId = seedSession(db);

    const result = getMcpSessionExcerpt(db, { limit: 4, maxBytes: 24, query: "auth/callback", sessionId });

    expect(result.excerpts).toEqual([expect.objectContaining({ kind: "file", sourceRefs: [expect.objectContaining({ sourceRuntime: "codex" })] })]);
    expect(Buffer.byteLength(result.text.split("\n\n").at(-1) ?? "", "utf8")).toBeLessThanOrEqual(24);
    db.close();
  });

  test("search returns source provenance and project history stays structural", async () => {
    const db = await openDb();
    const sessionId = seedSession(db);

    expect(searchMcpSessions(db, { limit: 10, project: "Pip", query: "OAuth" })).toMatchObject({
      sessions: [expect.objectContaining({ sessionId, sourceRefs: [expect.objectContaining({ sourceSessionId: "session-retrieval" })] })]
    });
    expect(getMcpProjectHistory(db, "Pip", 10)).toEqual(
      expect.objectContaining({
        phases: [expect.objectContaining({ label: "Recent work", sessionIds: [sessionId] })],
        project: "Pip",
        sessions: [expect.objectContaining({ sessionId })]
      })
    );
    db.close();
  });

  test("search totals count all allowed matches before pagination", async () => {
    const db = await openDb();
    const excludedSessionId = seedSession(db, "excluded");
    seedSession(db, "allowed-a");
    seedSession(db, "allowed-b");
    db.prepare("UPDATE sessions SET excluded_from_mcp_at = ? WHERE session_id = ?").run(
      "2026-06-25T12:05:00.000Z",
      excludedSessionId
    );

    const result = searchMcpSessions(db, { limit: 1, project: "Pip", query: "OAuth" });

    expect(result.sessions).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.sessions[0].sessionId).not.toBe(excludedSessionId);
    db.close();
  });
});

async function openDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-retrieval-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: Awaited<ReturnType<typeof openDb>>, suffix = "retrieval"): string {
  const now = "2026-06-24T15:02:00.000Z";
  const repository = createSessionRepository(db, {
    hostId: "host:test",
    hostname: "masthead-test-host",
    runtimeKind: "codex"
  });
  const sessionId = repository.upsertLiveEvent(liveEvent(suffix, { message: "OAuth callback work", project: "Pip", title: `OAuth ${suffix}` }));
  if (!sessionId) throw new Error("session was not created");
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `file:${suffix}`,
    sessionId,
    "src/auth/callback.ts",
    "modified",
    now,
    "{}"
  );
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `tool:${suffix}`,
    sessionId,
    "exec_command",
    now,
    "{}"
  );
  indexCanonicalSessionSearch(db, sessionId);
  return sessionId;
}

function liveEvent(eventId: string, payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `codex:${eventId}`,
    sessionId: `session-${eventId}`,
    source: { adapter: "codex", surface: "hook", sourceEventId: eventId },
    occurredAt: "2026-06-24T15:00:00.000Z",
    receivedAt: "2026-06-24T15:00:00.000Z",
    type: "user.question",
    summary: String(payload.title ?? payload.message ?? `Event ${eventId}`),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: `codex:${eventId}`, kind: "event", observedAt: "2026-06-24T15:00:00.000Z", source: "codex.hook" }]
  };
}
