import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource } from "../../../adapters/types.ts";
import { listImportJobs, type ImportJobKind } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { sourcePolicyExplicitlyEnabled } from "../../db/sourcePolicyRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { connectSelectedSources } from "../sourceConnectService.ts";
import type { AdapterScanResult, SourceScanResult } from "../sourceScanService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source connect service", () => {
  test("queues one parent metadata job per selected runtime and skips selected runtimes without sources", async () => {
    const { db } = await openSourceConnectTestDatabase("masthead-source-connect-");
    const scan = scanResult([
      adapterResult("opencode", [source("opencode", "opencode-session-a"), source("opencode", "opencode-session-b")]),
      adapterResult("cursor", [source("cursor", "cursor-state")]),
      adapterResult("hermes", [])
    ]);
    seedSources(db, scan.adapters.flatMap((adapter) => adapter.sources));
    const requestedJobs: Array<{ kind: ImportJobKind; runtime: string }> = [];

    const result = connectSelectedSources(
      db,
      scan,
      {
        importMetadata: true,
        queueEnrichment: false,
        runtimes: ["opencode", "hermes"]
      },
      async (kind, runtime) => {
        requestedJobs.push({ kind, runtime });
        return { discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 };
      }
    );

    expect(result.jobs.map((job) => [job.importKind, job.sourceId])).toEqual([
      ["metadata", "opencode-session-a"]
    ]);
    expect(result.skipped).toEqual([{ runtime: "hermes", reason: "No recognized local history was detected for this coding harness." }]);
    expect(listImportJobs(db).map((job) => [job.importKind, job.sourceId, job.status])).toEqual(
      expect.arrayContaining([["metadata", "opencode-session-a", "queued"]])
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(requestedJobs).toEqual([{ kind: "metadata", runtime: "opencode" }]);
    db.close();
  });

  test("explicit Everything history setup queues one full transcript job with source-scoped approval", async () => {
    const { db } = await openSourceConnectTestDatabase("masthead-source-connect-transcripts-");
    const scan = scanResult([adapterResult("opencode", [source("opencode", "opencode-session-a")])]);
    seedSources(db, scan.adapters.flatMap((adapter) => adapter.sources));

    const result = connectSelectedSources(
      db,
      scan,
      {
        importMetadata: true,
        importScope: { includeChangedSinceCursor: true, mode: "transcript_full" },
        queueEnrichment: true,
        runtimes: ["opencode"]
      },
      async () => ({ discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 })
    );

    expect(result.jobs.map((job) => job.importKind)).toEqual(["transcript"]);
    expect(sourcePolicyExplicitlyEnabled(db, "transcript_import", "opencode-session-a")).toBe(true);
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
