import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeLiveStateReport } from "../../../core/liveState.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { latestLiveStateForSourceSession, latestLiveStateReports, upsertLiveStateReport } from "../liveStateRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("live state repository", () => {
  test("inserts first report and returns latest by source session", async () => {
    const db = await openTestDatabase();
    const report = reportAt("2026-07-07T12:00:00.000Z", { seq: 1, state: "working" });

    expect(upsertTestLiveStateReport(db, report)).toMatchObject({ status: "accepted" });
    expect(latestLiveStateForSourceSession(db, { runtime: "codex", sourceSessionId: "source-1" })).toMatchObject({
      reportId: report.reportId,
      state: "working"
    });
  });

  test("rejects lower or equal seq reports for the same key", async () => {
    const db = await openTestDatabase();
    const first = reportAt("2026-07-07T12:00:00.000Z", { seq: 2, state: "working" });
    const stale = reportAt("2026-07-07T12:00:01.000Z", { seq: 2, state: "idle" });

    expect(upsertTestLiveStateReport(db, first)).toMatchObject({ status: "accepted" });
    expect(upsertTestLiveStateReport(db, stale)).toMatchObject({ status: "ignored_stale", previous: expect.objectContaining({ reportId: first.reportId }) });
    expect(latestLiveStateForSourceSession(db, { runtime: "codex", sourceSessionId: "source-1" })?.state).toBe("working");
  });

  test("accepts higher seq and newer observedAt without seq", async () => {
    const db = await openTestDatabase();
    expect(upsertTestLiveStateReport(db, reportAt("2026-07-07T12:00:00.000Z", { seq: 1, state: "working" }))).toMatchObject({ status: "accepted" });
    expect(upsertTestLiveStateReport(db, reportAt("2026-07-07T12:00:01.000Z", { seq: 2, state: "idle" }))).toMatchObject({ status: "accepted" });
    expect(upsertTestLiveStateReport(db, reportAt("2026-07-07T12:00:02.000Z", { seq: undefined, state: "blocked" }))).toMatchObject({
      status: "accepted"
    });
    expect(latestLiveStateForSourceSession(db, { runtime: "codex", sourceSessionId: "source-1" })?.state).toBe("blocked");
  });

  test("filters fresh reports only", async () => {
    const db = await openTestDatabase();
    upsertLiveStateReport(db, reportAt("2026-07-07T12:00:00.000Z", { ttlMs: 1, state: "working" }));

    expect(
      latestLiveStateReports(db, {
        freshOnly: true,
        now: new Date("2026-07-07T12:00:01.000Z")
      })
    ).toEqual([]);
  });

  test("filters by session before applying the result limit", async () => {
    const db = await openTestDatabase();
    for (let index = 0; index < 8; index += 1) {
      upsertTestLiveStateReport(
        db,
        normalizeLiveStateReport({
          runtime: "codex",
          source: `source-${index}`,
          sourceSessionId: `unrelated-${index}`,
          state: "working",
          observedAt: `2026-07-07T12:00:0${index}.000Z`
        })
      );
    }
    const target = reportAt("2026-07-07T11:59:00.000Z", { sourceSessionId: "target-session", source: "target" });
    upsertTestLiveStateReport(db, target);

    expect(latestLiveStateReports(db, { sourceSessionIds: new Set(["target-session"]), limit: 1 })).toEqual([
      expect.objectContaining({ reportId: target.reportId })
    ]);
  });

  test("queries canonical-only reports", async () => {
    const db = await openTestDatabase();
    const report = reportAt("2026-07-07T12:00:00.000Z", {
      canonicalSessionId: "canonical-session",
      sourceSessionId: undefined,
      source: "canonical-source"
    });
    upsertTestLiveStateReport(db, report);

    expect(latestLiveStateReports(db, { canonicalSessionIds: new Set(["canonical-session"]) })).toEqual([
      expect.objectContaining({ reportId: report.reportId })
    ]);
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-state-db-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function reportAt(
  observedAt: string,
  overrides: Partial<Parameters<typeof normalizeLiveStateReport>[0]> = {}
): ReturnType<typeof normalizeLiveStateReport> {
  return normalizeLiveStateReport({
    runtime: "codex",
    source: "masthead:codex-hook",
    sourceSessionId: "source-1",
    state: "working",
    observedAt,
    ...overrides
  });
}

function upsertTestLiveStateReport(db: MastheadDatabase, report: ReturnType<typeof normalizeLiveStateReport>): ReturnType<typeof upsertLiveStateReport> {
  return upsertLiveStateReport(db, report, { now: new Date(report.observedAt) });
}
