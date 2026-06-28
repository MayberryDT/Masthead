import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { SourcesOnboardingScanDto, SourcesSetupDto } from "../../../shared/sourcesSetup.ts";
import { getLatestSourceScanRun, getLatestSourceSetupState, saveSourceScanRun, saveSourceSetupState } from "../sourceSetupRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source setup repository", () => {
  test("stores and returns the newest source scan run", async () => {
    const db = await openTestDatabase();
    const first = scan("scan:first", "2026-06-27T10:00:00.000Z", "completed");
    const second = scan("scan:second", "2026-06-27T10:05:00.000Z", "failed");

    saveSourceScanRun(db, first);
    saveSourceScanRun(db, second);

    expect(getLatestSourceScanRun(db)).toEqual(second);
    db.close();
  });

  test("stores and returns the newest setup state", async () => {
    const db = await openTestDatabase();
    const emptyState = setup("setup:first", "2026-06-27T10:00:00.000Z", "empty");
    const readyState = setup("setup:second", "2026-06-27T10:05:00.000Z", "ready");

    saveSourceSetupState(db, emptyState);
    saveSourceSetupState(db, readyState);

    expect(getLatestSourceSetupState(db)).toEqual(readyState);
    db.close();
  });
});

async function openTestDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-setup-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function scan(scanId: string, generatedAt: string, status: SourcesOnboardingScanDto["status"]): SourcesOnboardingScanDto {
  return {
    adapters: [],
    foundSources: [],
    generatedAt,
    scanId,
    status,
    summary: {
      detectedHarnesses: 0,
      foundSources: 0,
      scannedHarnesses: 0
    }
  };
}

function setup(setupId: string, updatedAt: string, status: SourcesSetupDto["status"]): SourcesSetupDto {
  return {
    advanced: {
      adapters: [],
      imports: [],
      sources: []
    },
    connectedSources: [],
    setupId,
    status,
    updatedAt
  };
}
