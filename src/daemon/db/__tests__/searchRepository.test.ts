import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../../core/types.ts";
import { createSessionRepository } from "../sessionRepository.ts";
import { indexCanonicalSessionSearch, indexSessionSearch, searchSessions } from "../searchRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { publishSessionToLogbook, seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("logbook FTS search", () => {
  test("finds sessions by generated capsule terms and exact raw terms", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-1",
      title: "Masthead data layer"
    });
    publishSessionToLogbook(db, "session-1");

    indexSessionSearch(db, {
      capsule: "Import OpenCode history into canonical SQLite",
      commands: "npm test",
      filePaths: "src/daemon/main.ts",
      finalResponse: "Plan saved",
      firstPrompt: "Turn this into an implementation plan",
      normalizedText: "daemon logbook mcp",
      projectAliases: "Masthead",
      sessionId: "session-1",
      tags: "opencode sqlite",
      title: "Masthead data layer",
      toolNames: "exec_command"
    });

    expect(searchSessions(db, { limit: 10, query: "canonical SQLite" }).sessions[0]).toMatchObject({
      sessionId: "session-1",
      title: "Masthead data layer"
    });
    db.close();
  });

  test("lists recent canonical sessions for blank queries without using invalid FTS syntax", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "opencode"
    });
    const sessionId = repository.upsertLiveEvent(liveEvent("blank", { project: "Masthead", title: "Blank query session" }));
    publishSessionToLogbook(db, sessionId!);

    expect(searchSessions(db, { limit: 10, query: "" })).toMatchObject({
      sessions: [expect.objectContaining({ title: "Blank query session" })],
      total: 1
    });
    db.close();
  });

  test("indexes canonical live sessions for FTS lookup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "opencode"
    });
    const sessionId = repository.upsertLiveEvent(
      liveEvent("canonical", {
        model: "gpt-5.5",
        project: "Masthead",
        title: "Durable Board history",
        normalizedCommand: "npm test"
      })
    );
    expect(sessionId).toBeTruthy();
    publishSessionToLogbook(db, sessionId!);
    indexCanonicalSessionSearch(db, sessionId!);

    expect(searchSessions(db, { limit: 10, query: "Durable Board" }).sessions[0]).toMatchObject({
      sessionId,
      title: "Durable Board history"
    });
    expect(searchSessions(db, { limit: 10, query: "Masthead:" }).sessions[0]).toMatchObject({
      sessionId,
      title: "Durable Board history"
    });
    db.close();
  });
});

function liveEvent(eventId: string, payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `opencode:${eventId}`,
    sessionId: `session-${eventId}`,
    source: {
      adapter: "opencode",
      surface: "hook",
      sourceEventId: eventId
    },
    occurredAt: "2026-06-24T15:00:00.000Z",
    receivedAt: "2026-06-24T15:00:00.000Z",
    type: "session.started",
    workspace: {
      branch: "main",
      cwd: "/workspace/masthead",
      repoRoot: "/workspace/masthead",
      worktreePath: "/workspace/masthead"
    },
    summary: String(payload.title ?? `Event ${eventId}`),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: `opencode:${eventId}`, kind: "event", observedAt: "2026-06-24T15:00:00.000Z", source: "opencode.plugin" }]
  };
}
