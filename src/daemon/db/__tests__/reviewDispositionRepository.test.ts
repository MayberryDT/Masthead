import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { listReviewDispositions, upsertReviewDisposition } from "../reviewDispositionRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("review disposition repository", () => {
  test("persists review dispositions in the canonical database idempotently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-review-dispositions-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    const disposition = {
      dispositionId: "review:session:session-1:reviewed:2026-06-25T12-00-00",
      subjectId: "session-1",
      subjectType: "session" as const,
      status: "reviewed" as const,
      recordedAt: "2026-06-25T12:00:00.000Z",
      reviewer: "local",
      reason: "Marked reviewed from Masthead board."
    };

    upsertReviewDisposition(db, disposition);
    upsertReviewDisposition(db, disposition);

    expect(listReviewDispositions(db)).toEqual([disposition]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM review_dispositions").get()).toEqual({ count: 1 });
    db.close();
  });
});
