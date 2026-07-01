import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource, IngestCursor } from "../../../adapters/types.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase } from "../../db/sqlite.ts";
import { listImportWorkUnits } from "../../db/importLedgerRepository.ts";
import { buildImportManifestPlan, createManifestForJob } from "../importManifestService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import manifest service", () => {
  test("previews recent and changed transcript files without persisting rows", async () => {
    const { sources, cursors, tempDir } = await createTranscriptFixture();
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    const plan = await buildImportManifestPlan({
      cursors,
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "preview",
      importKind: "transcript",
      runtime: "codex",
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
      runtime: "codex",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sourceId: "codex-sessions",
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
    runtime: "codex" as const,
    schemaVersion: "codex-transcript-jsonl",
    sourceId: `codex:${path}`,
    sourceKind: "jsonl" as const
  }));
  const cursors = new Map<string, IngestCursor>();
  cursors.set(oldPath, {
    byteOffset: 3,
    contentFingerprint: "3:1770000000000",
    cursorId: "cursor:old",
    modifiedAt: "2026-05-01T00:00:00.000Z",
    sourceId: `codex:${oldPath}`,
    sourcePath: oldPath
  });
  cursors.set(changedPath, {
    byteOffset: 0,
    contentFingerprint: "changed-before",
    cursorId: "cursor:changed",
    modifiedAt: "2026-05-01T00:00:00.000Z",
    sourceId: `codex:${changedPath}`,
    sourcePath: changedPath
  });
  return { cursors, sources, tempDir };
}

function seedSourceAndImportJob(db: ReturnType<typeof openMastheadDatabase> extends Promise<infer T> ? T : never): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "codex-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
}
