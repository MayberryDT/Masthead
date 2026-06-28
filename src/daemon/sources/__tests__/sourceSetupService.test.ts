import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { RuntimeKind } from "../../../adapters/types.ts";
import { createImportJob, updateImportJob } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { approveTranscriptImport } from "../../db/sourceRepository.ts";
import { setSourcePolicy } from "../../db/sourcePolicyRepository.ts";
import { saveSourceScanRun } from "../../db/sourceSetupRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import type { SourceScanResult } from "../sourceScanService.ts";
import { buildSourcesSetupState, scanResultToOnboardingScan } from "../sourceSetupService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source setup service", () => {
  test("reports empty before connected sources or scans exist", async () => {
    const db = await openTestDatabase();

    const setup = buildSourcesSetupState(db, { now: "2026-06-27T10:00:00.000Z" });

    expect(setup).toMatchObject({
      connectedSources: [],
      status: "empty"
    });
    expect(setup.scan).toBeUndefined();
    db.close();
  });

  test("reports detected when the latest scan found sources but none are connected", async () => {
    const db = await openTestDatabase();
    saveSourceScanRun(db, {
      adapters: [
        {
          diagnostics: [],
          foundSources: [
            {
              confidence: "authoritative",
              path: "/tmp/codex/history.jsonl",
              runtime: "codex",
              sourceId: "codex-history",
              sourceKind: "jsonl"
            }
          ],
          runtime: "codex",
          state: "connected",
          summary: {
            foundSources: 1,
            sessions: 8
          }
        }
      ],
      foundSources: [
        {
          confidence: "authoritative",
          path: "/tmp/codex/history.jsonl",
          runtime: "codex",
          sourceId: "codex-history",
          sourceKind: "jsonl"
        }
      ],
      generatedAt: "2026-06-27T10:00:00.000Z",
      scanId: "scan:detected",
      status: "completed",
      summary: {
        detectedHarnesses: 1,
        foundSources: 1,
        scannedHarnesses: 1
      }
    });

    const setup = buildSourcesSetupState(db, { now: "2026-06-27T10:01:00.000Z" });

    expect(setup.status).toBe("detected");
    expect(setup.scan?.foundSources).toHaveLength(1);
    db.close();
  });

  test("reports importing when connected sources have active jobs", async () => {
    const db = await openTestDatabase();
    seedSource(db, "codex-history", "codex");
    const job = createImportJob(db, {
      importKind: "metadata",
      sourceId: "codex-history",
      updatedAt: "2026-06-27T10:00:00.000Z"
    });
    updateImportJob(db, job.importJobId, {
      status: "running",
      updatedAt: "2026-06-27T10:00:30.000Z"
    });

    const setup = buildSourcesSetupState(db, { now: "2026-06-27T10:01:00.000Z" });

    expect(setup.status).toBe("importing");
    expect(setup.connectedSources[0]).toMatchObject({ sourceId: "codex-history", status: "importing" });
    db.close();
  });

  test("reports needs_attention when connected sources still need transcript or enrichment setup", async () => {
    const db = await openTestDatabase();
    seedSource(db, "codex-history", "codex");
    const job = createImportJob(db, {
      importKind: "metadata",
      sourceId: "codex-history",
      updatedAt: "2026-06-27T10:00:00.000Z"
    });
    updateImportJob(db, job.importJobId, {
      importedCount: 4,
      processedCount: 4,
      status: "succeeded",
      updatedAt: "2026-06-27T10:00:30.000Z"
    });

    const setup = buildSourcesSetupState(db, { now: "2026-06-27T10:01:00.000Z" });

    expect(setup.status).toBe("needs_attention");
    expect(setup.connectedSources[0]).toMatchObject({
      needsAttention: ["transcript_import", "enrichment"],
      status: "needs_attention"
    });
    db.close();
  });

  test("reports ready when connected sources have no active jobs, failures, or missing setup", async () => {
    const db = await openTestDatabase();
    seedSource(db, "codex-history", "codex");
    approveTranscriptImport(db, {
      approvedAt: "2026-06-27T10:00:00.000Z",
      reason: "Approved in setup."
    });
    setSourcePolicy(db, {
      decidedAt: "2026-06-27T10:00:00.000Z",
      enabled: true,
      policyKind: "enrichment",
      reason: "Enabled in setup.",
      sourceId: "codex-history"
    });

    const setup = buildSourcesSetupState(db, { now: "2026-06-27T10:01:00.000Z" });

    expect(setup.status).toBe("ready");
    expect(setup.connectedSources[0]).toMatchObject({ sourceId: "codex-history", status: "ready" });
    db.close();
  });

  test("marks discovered import-adapter sources importable for setup onboarding", () => {
    const scan = scanResultToOnboardingScan(realisticScanResult());

    expect(scan.foundSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importable: true,
          runtime: "codex",
          sourceId: "codex-sessions",
          state: "importable",
          transcriptApproval: expect.objectContaining({
            approved: false,
            required: true
          })
        }),
        expect.objectContaining({
          importable: false,
          runtime: "omp",
          sourceId: "omp:detector:local",
          state: "detected",
          transcriptApproval: expect.objectContaining({
            approved: false,
            required: false
          })
        })
      ])
    );
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-setup-service-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSource(db: MastheadDatabase, sourceId: string, runtime: RuntimeKind): void {
  const now = "2026-06-27T10:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, runtime, "jsonl", `/tmp/${sourceId}.jsonl`, "authoritative", now, now);
}

function realisticScanResult(): SourceScanResult {
  return {
    adapters: [
      {
        checkedPaths: [],
        diagnostics: [],
        discoveredSessions: 7,
        label: "Codex",
        maturity: "full",
        runtime: "codex",
        sources: [
          {
            confidence: "authoritative",
            path: "/home/tyler/.codex/sessions",
            runtime: "codex",
            schemaVersion: "codex-local-jsonl",
            sourceId: "codex-sessions",
            sourceKind: "jsonl"
          }
        ],
        state: "connected"
      },
      {
        checkedPaths: [],
        diagnostics: [],
        discoveredSessions: 1,
        label: "Oh My Pi",
        maturity: "detector",
        runtime: "omp",
        sources: [
          {
            confidence: "heuristic",
            path: "/home/tyler/.local/share/omp",
            runtime: "omp",
            schemaVersion: "omp-detector-only",
            sourceId: "omp:detector:local",
            sourceKind: "inference"
          }
        ],
        state: "connected"
      }
    ],
    generatedAt: "2026-06-27T12:00:00.000Z",
    scanId: "scan-realistic"
  };
}
