import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../core/types.ts";
import { setSourcePolicy } from "../../daemon/db/sourcePolicyRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { createSessionRepository } from "../../daemon/db/sessionRepository.ts";
import { indexCanonicalSessionSearch } from "../../daemon/db/searchRepository.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { sessionMcpAllowed } from "../policy.ts";
import { searchSessionsTool } from "../tools.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("MCP policy", () => {
  test("excluded sessions never appear in search", async () => {
    const db = await openDb();
    const sessionId = seedSession(db, "excluded");
    db.prepare("UPDATE sessions SET excluded_from_mcp_at = ? WHERE session_id = ?").run("2026-06-25T12:05:00.000Z", sessionId);
    indexCanonicalSessionSearch(db, sessionId);

    expect(sessionMcpAllowed(db, sessionId)).toBe(false);
    expect(searchSessionsTool(db, { limit: 5, query: "OAuth" }).sessions).toEqual([]);
    db.close();
  });

  test("disabled source policy excludes sessions linked to that source", async () => {
    const db = await openDb();
    const sessionId = seedSession(db, "source-policy");
    const now = "2026-06-25T12:00:00.000Z";
    db.prepare(
      `INSERT INTO ingest_sources (source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("source:codex", "codex", "transcript", "/tmp/rollout.jsonl", "authoritative", now, now);
    db.prepare(
      `INSERT INTO session_aliases (alias_id, session_id, alias_kind, alias_value, source_id, confidence)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run("alias:source-policy", sessionId, "source", "source-policy", "source:codex", "authoritative");
    setSourcePolicy(db, {
      decidedAt: now,
      enabled: false,
      policyKind: "mcp_access",
      sourceId: "source:codex"
    });

    expect(sessionMcpAllowed(db, sessionId)).toBe(false);
    db.close();
  });
});

async function openDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-policy-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: Awaited<ReturnType<typeof openDb>>, suffix: string): string {
  const repository = createSessionRepository(db, {
    hostId: "host:test",
    hostname: "masthead-test-host",
    runtimeKind: "codex"
  });
  const sessionId = repository.upsertLiveEvent(liveEvent(suffix, { message: "OAuth callback work", project: "Pip", title: `OAuth ${suffix}` }));
  if (!sessionId) throw new Error("session was not created");
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
