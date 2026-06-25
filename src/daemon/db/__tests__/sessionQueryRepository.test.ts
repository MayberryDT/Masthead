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
        runtime: "codex",
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
        runtime: "codex",
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
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-query-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
