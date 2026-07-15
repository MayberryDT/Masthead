import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource, IngestCursor } from "../../../adapters/types.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase } from "../../db/sqlite.ts";
import { listImportWorkUnits } from "../../db/importLedgerRepository.ts";
import { buildImportManifestPlan, createManifestForJob } from "../importManifestService.ts";
import { decideImportUnitScope } from "../importScope.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import manifest service", () => {
  test("changed old source refreshes only when a prior cursor exists", () => {
    const generatedAt = "2026-07-15T00:00:00.000Z";
    const scope = { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent" as const, unitLimit: 500 };
    const oldChangedUnit = {
      modifiedAt: "2026-05-01T00:00:00.000Z",
      semanticActivityAt: "2026-05-01T00:00:00.000Z"
    };
    const oldCursor: IngestCursor = {
      byteOffset: 3,
      contentFingerprint: "old",
      cursorId: "cursor:old-changed",
      modifiedAt: "2026-04-30T00:00:00.000Z",
      sourceId: "hermes-old",
      sourcePath: "/tmp/hermes-old.jsonl"
    };

    expect(decideImportUnitScope({ unit: oldChangedUnit, cursor: undefined, generatedAt, scope })).toEqual({
      include: false,
      reason: "outside_recent_range"
    });
    expect(decideImportUnitScope({ unit: oldChangedUnit, cursor: oldCursor, generatedAt, scope })).toEqual({
      include: true,
      reason: "changed_since_cursor"
    });
  });

  test("fresh recent import excludes old files when no cursor exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-recent-fresh-"));
    tempDirs.push(tempDir);
    const oldPath = join(tempDir, "old-hermes.jsonl");
    await writeFile(oldPath, "{}\n", "utf8");
    await utimes(oldPath, new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));

    const plan = await buildImportManifestPlan({
      cursors: new Map(),
      generatedAt: "2026-07-15T00:00:00.000Z",
      importJobId: "recent-fresh",
      importKind: "transcript",
      runtime: "hermes",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sources: [{
        confidence: "authoritative",
        path: oldPath,
        runtime: "hermes",
        sourceId: "hermes-old",
        sourceKind: "jsonl"
      }]
    });

    expect(plan.summary.includedUnits).toBe(0);
    expect(plan.units[0]).toMatchObject({ status: "skipped", statusReason: "Outside selected import age." });
  });

  test("Everything schedules every discovered transcript beyond the internal 500-unit page size", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-everything-"));
    tempDirs.push(tempDir);
    const transcriptRoot = join(tempDir, "sessions");
    await mkdir(transcriptRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 1_570 }, (_, index) =>
        writeFile(join(transcriptRoot, `session-${String(index).padStart(4, "0")}.jsonl`), "{}\n", "utf8")
      )
    );

    const plan = await buildImportManifestPlan({
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "everything",
      importKind: "transcript",
      runtime: "codex",
      scope: { includeChangedSinceCursor: true, mode: "transcript_full", unitLimit: 500 },
      sources: [{
        confidence: "authoritative",
        path: transcriptRoot,
        runtime: "codex",
        sourceId: "codex-sessions",
        sourceKind: "jsonl"
      }]
    });

    expect(plan.summary).toMatchObject({ excludedUnits: 0, includedUnits: 1_570, totalUnits: 1_570 });
    expect(plan.units.every((unit) => unit.status === "queued")).toBe(true);
    expect(plan.units.some((unit) => unit.statusReason === "Outside selected first-run cap.")).toBe(false);
  });

  test("reports units deferred by the requested recent import cap", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-recent-cap-"));
    tempDirs.push(tempDir);
    const transcriptRoot = join(tempDir, "sessions");
    await mkdir(transcriptRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 800 }, (_, index) =>
        writeFile(join(transcriptRoot, `session-${String(index).padStart(4, "0")}.jsonl`), "{}\n", "utf8")
      )
    );

    const plan = await buildImportManifestPlan({
      generatedAt: "2026-07-15T00:00:00.000Z",
      importJobId: "recent-capped",
      importKind: "transcript",
      runtime: "codex",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sources: [{
        confidence: "authoritative",
        path: transcriptRoot,
        runtime: "codex",
        sourceId: "codex-sessions",
        sourceKind: "jsonl"
      }]
    });

    expect(plan.summary).toMatchObject({
      cappedUnits: 300,
      excludedUnits: 300,
      includedUnits: 500,
      totalUnits: 800
    });
  });

  test("previews recent and changed transcript files without persisting rows", async () => {
    const { sources, cursors, tempDir } = await createTranscriptFixture();
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    const plan = await buildImportManifestPlan({
      cursors,
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "preview",
      importKind: "transcript",
      runtime: "opencode",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sources
    });

    expect(plan.summary).toMatchObject({
      excludedUnits: 1,
      includedUnits: 2,
      totalUnits: 3
    });
    expect(plan.units.filter((unit) => unit.status === "queued").map((unit) => unit.sourcePath).sort()).toEqual([
      join(tempDir, "changed.jsonl"),
      join(tempDir, "recent.jsonl")
    ]);
    expect(listImportWorkUnits(db, { importJobId: "preview" })).toEqual([]);
    db.close();
  });

  test("persists manifest child units for a real import job", async () => {
    const { sources, cursors, tempDir } = await createTranscriptFixture();
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSourceAndImportJob(db);

    const manifest = await createManifestForJob(db, {
      cursors,
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "import-1",
      importKind: "transcript",
      runtime: "opencode",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sourceId: "opencode-sessions",
      sources
    });

    expect(manifest.summary).toMatchObject({
      excludedUnits: 1,
      includedUnits: 2,
      totalUnits: 3
    });
    expect(listImportWorkUnits(db, { importJobId: "import-1" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: join(tempDir, "recent.jsonl"), status: "queued" }),
        expect.objectContaining({ sourcePath: join(tempDir, "changed.jsonl"), status: "queued" }),
        expect.objectContaining({ sourcePath: join(tempDir, "old.jsonl"), status: "skipped" })
      ])
    );
    db.close();
  });

  test("deduplicates the same transcript path discovered through parent and child sources", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-dedupe-"));
    tempDirs.push(tempDir);
    const path = join(tempDir, "session.jsonl");
    await writeFile(path, "{}\n", "utf8");
    const source = {
      confidence: "authoritative" as const,
      path,
      runtime: "codex" as const,
      sourceId: "codex-session",
      sourceKind: "jsonl" as const
    };

    const plan = await buildImportManifestPlan({
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "dedupe",
      importKind: "transcript",
      runtime: "codex",
      scope: { includeChangedSinceCursor: true, mode: "transcript_full" },
      sources: [source, { ...source, sourceId: "codex-parent" }]
    });

    expect(plan.summary.totalUnits).toBe(1);
    expect(plan.units).toHaveLength(1);
  });
});

async function createTranscriptFixture(): Promise<{ cursors: Map<string, IngestCursor>; sources: DiscoveredSource[]; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-manifest-"));
  tempDirs.push(tempDir);
  await mkdir(tempDir, { recursive: true });
  const recentPath = join(tempDir, "recent.jsonl");
  const changedPath = join(tempDir, "changed.jsonl");
  const oldPath = join(tempDir, "old.jsonl");
  await writeFile(recentPath, "{}\n", "utf8");
  await writeFile(changedPath, "{}\n", "utf8");
  await writeFile(oldPath, "{}\n", "utf8");
  await utimes(recentPath, new Date("2026-06-30T00:00:00.000Z"), new Date("2026-06-30T00:00:00.000Z"));
  await utimes(changedPath, new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));
  await utimes(oldPath, new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));
  const sources = [recentPath, changedPath, oldPath].map((path) => ({
    confidence: "authoritative" as const,
    path,
    runtime: "opencode" as const,
    schemaVersion: "opencode-transcript-jsonl",
    sourceId: `opencode:${path}`,
    sourceKind: "jsonl" as const
  }));
  const cursors = new Map<string, IngestCursor>();
  cursors.set(oldPath, {
    byteOffset: 3,
    contentFingerprint: "3:1770000000000",
    cursorId: "cursor:old",
    modifiedAt: "2026-05-01T00:00:00.000Z",
    sourceId: `opencode:${oldPath}`,
    sourcePath: oldPath
  });
  cursors.set(changedPath, {
    byteOffset: 0,
    contentFingerprint: "changed-before",
    cursorId: "cursor:changed",
    modifiedAt: "2026-04-30T00:00:00.000Z",
    sourceId: `opencode:${changedPath}`,
    sourcePath: changedPath
  });
  return { cursors, sources, tempDir };
}

function seedSourceAndImportJob(db: ReturnType<typeof openMastheadDatabase> extends Promise<infer T> ? T : never): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "opencode-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
}
