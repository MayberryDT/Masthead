import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { ensureWorkbenchSessionState, markWorkbenchNotAdded, markWorkbenchSessionEnrichmentSatisfied } from "../../daemon/db/workbenchPipelineRepository.ts";
import { parseWorkbenchScope, queueWorkbenchSessions } from "../queueRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("parseWorkbenchScope", () => {
  test("parses supported scopes", () => {
    expect(parseWorkbenchScope("missing")).toEqual({ kind: "missing" });
    expect(parseWorkbenchScope("session:session-1")).toEqual({ kind: "session", sessionId: "session-1" });
    expect(parseWorkbenchScope("project:Masthead")).toEqual({ kind: "project", project: "Masthead" });
    expect(parseWorkbenchScope("runtime:opencode")).toEqual({ kind: "runtime", runtime: "opencode" });
  });

  test("rejects unknown scopes", () => {
    expect(() => parseWorkbenchScope("team:alpha")).toThrow("invalid_scope");
  });
});

describe("queueWorkbenchSessions", () => {
  test("returns publish-path sessions with pipeline readiness fields", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Add CLI" });
    ensureWorkbenchSessionState(db, "session:abc");

    expect(queueWorkbenchSessions(db, { kind: "session_enrichment", limit: 10, scope: "missing" })).toEqual([
      expect.objectContaining({
        nextAction: "check_transcript",
        project: "Masthead",
        sessionEnrichmentStatus: "missing",
        sessionId: "session:abc",
        status: "missing"
      })
    ]);
  });

  test("excludes Not Added sessions from default queue", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Add CLI" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:not-added", title: "Not Added" });
    ensureWorkbenchSessionState(db, "session:abc");
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "test" },
      reason: "metadata_only",
      sessionId: "session:not-added"
    });

    expect(queueWorkbenchSessions(db, { kind: "session_enrichment", limit: 10, scope: "missing" }).map((session) => session.sessionId)).toEqual([
      "session:abc"
    ]);
  });

  test("returns a single session for session scope", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Add CLI" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Other", sessionId: "session:def", title: "Other session" });
    ensureWorkbenchSessionState(db, "session:abc");
    ensureWorkbenchSessionState(db, "session:def");

    expect(queueWorkbenchSessions(db, { kind: "session_enrichment", limit: 10, scope: "session:session:def" })).toEqual([
      expect.objectContaining({ project: "Other", sessionId: "session:def" })
    ]);
  });

  test("applies scope before limit for next-style lookups", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:newer", title: "Newer session" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Other", sessionId: "session:older", title: "Older scoped session" });
    ensureWorkbenchSessionState(db, "session:newer");
    ensureWorkbenchSessionState(db, "session:older");
    db.prepare("UPDATE sessions SET last_activity_at = ? WHERE session_id = ?").run("2026-07-08T12:00:00.000Z", "session:newer");
    db.prepare("UPDATE sessions SET last_activity_at = ? WHERE session_id = ?").run("2026-07-07T12:00:00.000Z", "session:older");

    expect(queueWorkbenchSessions(db, { kind: "session_enrichment", limit: 1, scope: "session:session:older" })).toEqual([
      expect.objectContaining({ project: "Other", sessionId: "session:older" })
    ]);
  });

  test("returns satisfied readiness as current for matching kind", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Add CLI" });
    ensureWorkbenchSessionState(db, "session:abc");
    markWorkbenchSessionEnrichmentSatisfied(db, {
      actor: { kind: "agent", id: "codex" },
      sessionId: "session:abc",
    });

    expect(queueWorkbenchSessions(db, { kind: "session_enrichment", limit: 10, scope: "session:session:abc" })).toEqual([
      expect.objectContaining({ sessionId: "session:abc", status: "current" })
    ]);
  });

  test("treats published optional artifacts as current and applied artifacts as unfinished", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:optional-state",
      title: "Optional artifact state"
    });
    ensureWorkbenchSessionState(db, "session:optional-state");
    db.prepare("UPDATE workbench_session_state SET runbook_status = 'published' WHERE session_id = ?").run(
      "session:optional-state"
    );

    expect(
      queueWorkbenchSessions(db, {
        kind: "runbook",
        limit: 10,
        scope: "session:session:optional-state"
      })
    ).toEqual([expect.objectContaining({ sessionId: "session:optional-state", status: "current" })]);

    db.prepare("UPDATE workbench_session_state SET runbook_status = 'applied' WHERE session_id = ?").run(
      "session:optional-state"
    );
    expect(
      queueWorkbenchSessions(db, {
        kind: "runbook",
        limit: 10,
        scope: "session:session:optional-state"
      })
    ).toEqual([expect.objectContaining({ sessionId: "session:optional-state", status: "missing" })]);
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-queue-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
