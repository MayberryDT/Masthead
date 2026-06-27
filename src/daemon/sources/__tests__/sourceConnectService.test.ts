import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource } from "../../../adapters/types.ts";
import { listImportJobs, type ImportJobKind } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { connectSelectedSources } from "../sourceConnectService.ts";
import type { AdapterScanResult, SourceScanResult } from "../sourceScanService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source connect service", () => {
  test("queues metadata jobs for selected recognized sources and skips selected runtimes without sources", async () => {
    const { db } = await openSourceConnectTestDatabase("masthead-source-connect-");
    const scan = scanResult([
      adapterResult("codex", [source("codex", "codex-session-index"), source("codex", "codex-history")]),
      adapterResult("cursor", [source("cursor", "cursor-state")]),
      adapterResult("hermes", [])
    ]);
    seedSources(db, scan.adapters.flatMap((adapter) => adapter.sources));
    const requestedJobs: Array<{ kind: ImportJobKind; sourceId: string }> = [];

    const result = connectSelectedSources(
      db,
      scan,
      {
        importMetadata: true,
        importTranscripts: false,
        queueEnrichment: false,
        runtimes: ["codex", "hermes"]
      },
      async (kind, sourceId) => {
        requestedJobs.push({ kind, sourceId });
        return { discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 };
      }
    );

    expect(result.jobs.map((job) => [job.importKind, job.sourceId])).toEqual([
      ["metadata", "codex-session-index"],
      ["metadata", "codex-history"]
    ]);
    expect(result.skipped).toEqual([{ runtime: "hermes", reason: "No recognized local source files were detected." }]);
    expect(listImportJobs(db).map((job) => [job.importKind, job.sourceId, job.status])).toEqual(
      expect.arrayContaining([
        ["metadata", "codex-session-index", "queued"],
        ["metadata", "codex-history", "queued"]
      ])
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(requestedJobs).toEqual([
      { kind: "metadata", sourceId: "codex-session-index" },
      { kind: "metadata", sourceId: "codex-history" }
    ]);
    db.close();
  });
});

async function openSourceConnectTestDatabase(prefix: string): Promise<{ db: MastheadDatabase }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return { db };
}

function scanResult(adapters: AdapterScanResult[]): SourceScanResult {
  return {
    adapters,
    generatedAt: "2026-06-27T10:00:00.000Z",
    scanId: "scan:test"
  };
}

function adapterResult(runtime: AdapterScanResult["runtime"], sources: DiscoveredSource[]): AdapterScanResult {
  return {
    checkedPaths: [],
    diagnostics: [],
    discoveredSessions: sources.length,
    label: runtime,
    maturity: "metadata",
    runtime,
    sources,
    state: sources.length > 0 ? "connected" : "not_detected"
  };
}

function source(runtime: DiscoveredSource["runtime"], sourceId: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path: `/tmp/${sourceId}`,
    runtime,
    sourceId,
    sourceKind: "jsonl"
  };
}

function seedSources(db: MastheadDatabase, sources: DiscoveredSource[]): void {
  const now = "2026-06-27T10:00:00.000Z";
  const insert = db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const source of sources) {
    insert.run(source.sourceId, source.runtime, source.sourceKind, source.path ?? null, source.confidence, now, now);
  }
}
