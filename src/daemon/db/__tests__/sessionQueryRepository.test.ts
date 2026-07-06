import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { indexCanonicalSessionSearch } from "../searchRepository.ts";
import {
  getSessionDetail,
  getSessionExcerpts,
  listProjects,
  querySessions
} from "../sessionQueryRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session query repository", () => {
  test("returns rich canonical list items, detail, excerpts, and projects", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      sessionId: "session-1",
      title: "OAuth callback repair"
    });
    indexCanonicalSessionSearch(db, "session-1");

    const result = querySessions(db, { limit: 25, query: "OAuth" });

    expect(result.sessions).toEqual([
      expect.objectContaining({
        fileCount: 1,
        hostId: "host:test",
        lifecycle: "ended",
        models: ["gpt-5"],
        project: "Pip",
        runtime: "opencode",
        sessionId: "session-1",
        sourceConfidence: "authoritative",
        sourceSessionId: "source-session-1",
        title: "OAuth callback repair",
        toolCount: 1,
        topics: ["authentication"]
      })
    ]);

    expect(getSessionDetail(db, "session-1")).toEqual(
      expect.objectContaining({
        branch: "main",
        fileCount: 1,
        models: ["gpt-5"],
        project: "Pip",
        runtime: "opencode",
        sessionId: "session-1",
        sourceProvenance: expect.objectContaining({ sourceSessionId: "source-session-1" }),
        toolCount: 1
      })
    );
    expect(getSessionExcerpts(db, "session-1", { limit: 8, query: "authentication" })).toEqual([
      expect.objectContaining({ kind: "message", text: expect.stringContaining("authentication") })
    ]);
    expect(listProjects(db)).toEqual([{ project: "Pip", sessionCount: 1 }]);
    db.close();
  });

  test("applies explicit server-side sort modes before pagination", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Zeta",
      sessionId: "session-1",
      title: "Single file repair"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Alpha",
      sessionId: "session-2",
      title: "Wide refactor"
    });
    db.prepare("UPDATE sessions SET last_activity_at = ? WHERE session_id = ?").run("2026-06-25T12:05:00.000Z", "session-1");
    db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
      "session-2:file-extra",
      "session-2",
      "src/extra.ts",
      "modified",
      "2026-06-25T12:01:00.000Z",
      "{}"
    );

    expect(querySessions(db, { limit: 1, sort: "files_desc" }).sessions[0]?.sessionId).toBe("session-2");
    expect(querySessions(db, { limit: 1, sort: "project" }).sessions[0]?.project).toBe("Alpha");
    db.close();
  });

  test("returns the first SQL-backed page without losing the full canonical total", async () => {
    const db = await openTestDatabase();
    for (let index = 1; index <= 4; index += 1) {
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: `session-${index}`,
        title: `Session ${index}`
      });
      db.prepare("UPDATE sessions SET last_activity_at = ? WHERE session_id = ?").run(`2026-06-25T12:0${index}:00.000Z`, `session-${index}`);
    }

    const firstPage = querySessions(db, { limit: 2, offset: 0, sort: "recent" });

    expect(firstPage.total).toBe(4);
    expect(firstPage.nextCursor).toBe("2");
    expect(sessionIds(firstPage)).toEqual(["session-4", "session-3"]);
    db.close();
  });

  test("does not fall back to weak source titles in logbook rows", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "",
      sessionId: "session-weak-source",
      title: "session narrative"
    });
    db.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session-weak-source");
    db.prepare(
      `UPDATE sessions
      SET source_session_id = ?,
        project_label = NULL,
        objective = NULL,
        last_activity_at = ?,
        updated_at = ?
      WHERE session_id = ?`
    ).run("session narrative", "2026-07-01T10:38:00.000Z", "2026-07-01T10:38:00.000Z", "session-weak-source");

    expect(querySessions(db, { limit: 25 }).sessions[0]).toEqual(
      expect.objectContaining({
        sourceSessionId: "session narrative",
        title: "OpenCode session · 2026-07-01 10:38"
      })
    );
    db.close();
  });

  test("searches seeded canonical SQLite rows and reduces with filters", async () => {
    const db = await openTestDatabase();
    seedQueryableSession(db, {
      file: "auth/callback.ts",
      lastActivityAt: "2026-06-25T12:00:00.000Z",
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      runtime: "opencode",
      sessionId: "session-match",
      title: "OAuth callback repair"
    });
    seedQueryableSession(db, {
      file: "auth/runtime.ts",
      lastActivityAt: "2026-06-25T12:10:00.000Z",
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      runtime: "cursor",
      sessionId: "session-runtime",
      title: "OAuth runtime repair"
    });
    seedQueryableSession(db, {
      file: "src/logbook.ts",
      lastActivityAt: "2026-06-20T09:00:00.000Z",
      lifecycle: "running",
      model: "gpt-4.1",
      project: "Masthead",
      runtime: "opencode",
      sessionId: "session-older",
      title: "OAuth logbook repair"
    });

    expect(sessionIds(querySessions(db, { limit: 25, query: "OAuth", sort: "oldest" }))).toEqual([
      "session-older",
      "session-match",
      "session-runtime"
    ]);
    expect(sessionIds(querySessions(db, { limit: 25, query: "OAuth", runtime: "opencode", sort: "oldest" }))).toEqual([
      "session-older",
      "session-match"
    ]);
    expect(sessionIds(querySessions(db, { limit: 25, query: "OAuth", project: "pip", sort: "oldest" }))).toEqual([
      "session-match",
      "session-runtime"
    ]);
    expect(sessionIds(querySessions(db, { limit: 25, model: "gpt-5", query: "OAuth", sort: "oldest" }))).toEqual([
      "session-match",
      "session-runtime"
    ]);
    expect(sessionIds(querySessions(db, { lifecycle: "ended", limit: 25, query: "OAuth", sort: "oldest" }))).toEqual([
      "session-match",
      "session-runtime"
    ]);
    expect(sessionIds(querySessions(db, { limit: 25, query: "OAuth", sort: "oldest", state: "ended" }))).toEqual([
      "session-match",
      "session-runtime"
    ]);
    expect(
      sessionIds(
        querySessions(db, {
          dateFrom: "2026-06-25T00:00:00.000Z",
          dateTo: "2026-06-25T12:05:00.000Z",
          limit: 25,
          query: "OAuth",
          sort: "oldest"
        })
      )
    ).toEqual(["session-match"]);
    expect(
      sessionIds(
        querySessions(db, {
          dateFrom: "2026-06-25",
          dateTo: "2026-06-25",
          limit: 25,
          query: "OAuth",
          sort: "oldest"
        })
      )
    ).toEqual(["session-match", "session-runtime"]);
    expect(sessionIds(querySessions(db, { file: "auth/callback", limit: 25, query: "OAuth" }))).toEqual([
      "session-match"
    ]);
    expect(
      sessionIds(
        querySessions(db, {
          dateFrom: "2026-06-25T00:00:00.000Z",
          dateTo: "2026-06-25T12:05:00.000Z",
          file: "auth/callback",
          lifecycle: "ended",
          limit: 25,
          model: "gpt-5",
          project: "pip",
          query: "OAuth",
          runtime: "opencode"
        })
      )
    ).toEqual(["session-match"]);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-query-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

type QueryableSessionOptions = {
  file: string;
  lastActivityAt: string;
  lifecycle: string;
  model: string;
  project: string;
  runtime: string;
  sessionId: string;
  title: string;
};

function seedQueryableSession(db: MastheadDatabase, options: QueryableSessionOptions): void {
  const now = "2026-06-25T12:00:00.000Z";
  seedSession(db, options);
  db.prepare(
    `INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run(`runtime:${options.runtime}`, options.runtime, "1.0.0", now, now);
  db.prepare(
    `UPDATE sessions
    SET runtime_id = ?,
      project_label = ?,
      lifecycle = ?,
      last_activity_at = ?,
      updated_at = ?
    WHERE session_id = ?`
  ).run(
    `runtime:${options.runtime}`,
    options.project,
    options.lifecycle,
    options.lastActivityAt,
    options.lastActivityAt,
    options.sessionId
  );
  db.prepare("UPDATE model_usage SET model = ?, observed_at = ? WHERE session_id = ?").run(
    options.model,
    options.lastActivityAt,
    options.sessionId
  );
  db.prepare("UPDATE file_effects SET path = ?, observed_at = ? WHERE session_id = ?").run(
    options.file,
    options.lastActivityAt,
    options.sessionId
  );
  indexCanonicalSessionSearch(db, options.sessionId);
}

function sessionIds(result: ReturnType<typeof querySessions>): string[] {
  return result.sessions.map((session) => session.sessionId);
}
