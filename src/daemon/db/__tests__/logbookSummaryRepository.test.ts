import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getLogbookSummary } from "../logbookSummaryRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("logbook summary repository", () => {
  test("summarizes canonical session aggregates for the Logbook surface", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      sessionId: "session-1",
      title: "OAuth callback repair"
    });
    seedSession(db, {
      lifecycle: "running",
      model: "gpt-5.5",
      project: "Masthead",
      sessionId: "session-2",
      title: "Logbook database rebuild"
    });

    expect(getLogbookSummary(db)).toMatchObject({
      fileEffects: 2,
      messages: 2,
      projects: 2,
      sessions: 2,
      toolCalls: 2,
      lifecycles: [
        { lifecycle: "ended", count: 1 },
        { lifecycle: "running", count: 1 }
      ],
      models: [
        { model: "gpt-5", count: 1 },
        { model: "gpt-5.5", count: 1 }
      ],
      runtimes: [{ runtime: "opencode", count: 2 }]
    });
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-logbook-summary-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
