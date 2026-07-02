import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { BoardHeadlineFrame } from "../../../core/boardHeadlineFrame.ts";
import { currentBoardHeadlineFrames, upsertBoardHeadlineFrame } from "../boardHeadlineFrameRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("board headline frame repository", () => {
  test("stores and loads the latest valid frame by source session id", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-1",
      title: "Board headline storage"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-2",
      title: "Board headline refresh"
    });

    upsertBoardHeadlineFrame(db, {
      frame: frame({
        disposition: "Stores an earlier generated headline frame",
        subject: "Headline persistence"
      }),
      generatedAt: "2026-07-01T12:00:00.000Z",
      model: "gpt-5-mini",
      provider: "openai",
      sessionId: "session-1",
      sourceSessionId: "source-session-1"
    });
    upsertBoardHeadlineFrame(db, {
      frame: frame({
        disposition: "Uses the newest durable frame for rendering",
        subject: "Board headline cache"
      }),
      generatedAt: "2026-07-01T12:05:00.000Z",
      model: "gpt-5",
      provider: "openai",
      sessionId: "session-2",
      sourceSessionId: "source-session-1"
    });

    const views = currentBoardHeadlineFrames(db, [
      { sessionId: "session-2", sourceSessionId: "source-session-1" },
      { sessionId: "session-2", sourceSessionId: "source-session-1" },
      { sessionId: "", sourceSessionId: "" },
      { sessionId: "missing-session", sourceSessionId: "missing-session" }
    ]);

    expect(views.get("source-session-1")).toEqual({
      frame: frame({
        disposition: "Uses the newest durable frame for rendering",
        subject: "Board headline cache"
      }),
      generatedAt: "2026-07-01T12:05:00.000Z",
      headline: "Board headline cache: uses the newest durable frame for rendering.",
      model: "gpt-5",
      provider: "openai",
      source: "llm",
      status: "ready"
    });
    expect(views.has("missing-session")).toBe(false);
    db.close();
  });

  test("does not hydrate a frame from another canonical session with the same source id", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-local",
      title: "Local Board headline"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-other-host",
      title: "Other host Board headline"
    });

    upsertBoardHeadlineFrame(db, {
      frame: frame({
        disposition: "belongs to a different host runtime",
        subject: "Other host headline"
      }),
      generatedAt: "2026-07-01T12:05:00.000Z",
      model: "gpt-5",
      provider: "openai",
      sessionId: "session-other-host",
      sourceSessionId: "duplicate-source-session"
    });

    const views = currentBoardHeadlineFrames(db, [{ sessionId: "session-local", sourceSessionId: "duplicate-source-session" }]);

    expect(views.has("duplicate-source-session")).toBe(false);
    db.close();
  });

  test("does not hydrate a frame when the requested source id does not match the canonical session row", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-1",
      title: "Canonical Board headline"
    });

    upsertBoardHeadlineFrame(db, {
      frame: frame({
        disposition: "belongs to the old source session id",
        subject: "Old source headline"
      }),
      generatedAt: "2026-07-01T12:05:00.000Z",
      model: "gpt-5",
      provider: "openai",
      sessionId: "session-1",
      sourceSessionId: "old-source-session"
    });

    const views = currentBoardHeadlineFrames(db, [{ sessionId: "session-1", sourceSessionId: "current-source-session" }]);

    expect(views.has("old-source-session")).toBe(false);
    expect(views.has("current-source-session")).toBe(false);
    db.close();
  });

  test("throws when upserting an invalid frame", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-1",
      title: "Board headline validation"
    });

    expect(() =>
      upsertBoardHeadlineFrame(db, {
        frame: frame({
          disposition: "Uses a subject that validation rejects",
          subject: " "
        }),
        generatedAt: "2026-07-01T12:00:00.000Z",
        model: "gpt-5",
        provider: "openai",
        sessionId: "session-1",
        sourceSessionId: "source-session-1"
      })
    ).toThrow("Invalid Board headline frame: weak_subject");
    db.close();
  });

  test("skips corrupt stored frames", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-1",
      title: "Board headline corruption"
    });
    db.prepare(
      `INSERT INTO board_headline_frames (
        frame_id, session_id, source_session_id, provider, model, generated_at, frame_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "board-headline:session-1",
      "session-1",
      "source-session-1",
      "openai",
      "gpt-5",
      "2026-07-01T12:00:00.000Z",
      "{",
      "2026-07-01T12:00:00.000Z",
      "2026-07-01T12:00:00.000Z"
    );

    expect(currentBoardHeadlineFrames(db, [{ sessionId: "session-1", sourceSessionId: "source-session-1" }])).toEqual(new Map());
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-board-headline-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function frame(overrides: Pick<BoardHeadlineFrame, "disposition" | "subject">): BoardHeadlineFrame {
  return {
    confidence: "high",
    disposition: overrides.disposition,
    evidence: ["Board headline frame repository test"],
    state: "active",
    subject: overrides.subject,
    subjectKind: "feature"
  };
}
