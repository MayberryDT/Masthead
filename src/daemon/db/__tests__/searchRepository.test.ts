import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../../core/types.ts";
import { createSessionRepository } from "../sessionRepository.ts";
import {
  indexCanonicalSessionSearch,
  indexSessionSearch,
  removeSessionSearchDocument,
  searchSessions
} from "../searchRepository.ts";
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

  test("replaces a session search document at its stable FTS rowid", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-stable-rowid",
      title: "Search replacement"
    });
    publishSessionToLogbook(db, "session-stable-rowid");

    indexSessionSearch(db, searchDocument("obsolete-porcupine"));
    const first = db
      .prepare(
        `SELECT session_search_rowids.search_rowid AS mappedRowid, session_search.rowid AS indexedRowid
         FROM session_search_rowids
         JOIN session_search ON session_search.rowid = session_search_rowids.search_rowid
         WHERE session_search_rowids.session_id = ?`
      )
      .get("session-stable-rowid") as { indexedRowid: number; mappedRowid: number };

    indexSessionSearch(db, searchDocument("current-narwhal"));
    const second = db
      .prepare(
        `SELECT session_search_rowids.search_rowid AS mappedRowid, session_search.rowid AS indexedRowid
         FROM session_search_rowids
         JOIN session_search ON session_search.rowid = session_search_rowids.search_rowid
         WHERE session_search_rowids.session_id = ?`
      )
      .get("session-stable-rowid") as { indexedRowid: number; mappedRowid: number };

    expect(second).toEqual(first);
    expect(searchSessions(db, { limit: 10, query: "obsolete-porcupine" })).toMatchObject({ sessions: [], total: 0 });
    expect(searchSessions(db, { limit: 10, query: "current-narwhal" }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session-stable-rowid" })
    ]);
    db.close();
  });

  test("removes both the FTS document and its stable rowid mapping", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-stable-rowid",
      title: "Search removal"
    });
    indexSessionSearch(db, searchDocument("remove-me"));

    removeSessionSearchDocument(db, "session-stable-rowid");

    expect(db.prepare("SELECT COUNT(*) AS count FROM session_search").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_search_rowids").get()).toEqual({ count: 0 });
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

function searchDocument(normalizedText: string) {
  return {
    capsule: "",
    commands: "",
    filePaths: "",
    finalResponse: "",
    firstPrompt: "",
    normalizedText,
    projectAliases: "Masthead",
    sessionId: "session-stable-rowid",
    tags: "",
    title: "Search replacement",
    toolNames: ""
  };
}

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
