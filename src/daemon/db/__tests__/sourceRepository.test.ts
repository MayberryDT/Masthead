import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AdapterRecord } from "../../../adapters/types.ts";
import { addSourceExclusion, approveTranscriptImport, sourceIsExcluded, sourceRecordIsExcluded, transcriptImportApproved } from "../sourceRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source exclusions", () => {
  test("blocks transcript ingestion for excluded project paths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-exclusion-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    addSourceExclusion(db, {
      createdAt: "2026-06-24T12:00:00.000Z",
      exclusionKind: "path",
      pattern: "/home/tyler/private-client",
      reason: "Excluded before full transcript ingestion."
    });

    expect(sourceIsExcluded(db, "/home/tyler/private-client/session.jsonl")).toBe(true);
    expect(sourceIsExcluded(db, "/home/tyler/Documents/Masthead/session.jsonl")).toBe(false);
    db.close();
  });

  test("blocks transcript records for excluded project metadata under neutral paths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-exclusion-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    addSourceExclusion(db, {
      createdAt: "2026-06-24T12:00:00.000Z",
      exclusionKind: "project",
      pattern: "PrivateClient",
      reason: "Excluded project transcripts."
    });

    expect(sourceIsExcluded(db, { project: "PrivateClient", sourcePath: "/tmp/codex/sessions/thread.jsonl" })).toBe(true);
    expect(sourceIsExcluded(db, { project: "PrivateClient Archive", sourcePath: "/tmp/codex/sessions/thread.jsonl" })).toBe(false);
    expect(
      sourceRecordIsExcluded(
        db,
        adapterRecord({
          cwd: "/workspace/PrivateClient",
          sessionId: "private-session"
        })
      )
    ).toBe(true);
    expect(
      sourceRecordIsExcluded(
        db,
        adapterRecord({
          cwd: "/workspace/PublicClient",
          sessionId: "public-session"
        })
      )
    ).toBe(false);
    db.close();
  });

  test("requires a persisted approval before full transcript ingestion", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-exclusion-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    expect(transcriptImportApproved(db)).toBe(false);
    approveTranscriptImport(db, {
      approvedAt: "2026-06-24T12:00:00.000Z",
      reason: "Source exclusions reviewed."
    });

    expect(transcriptImportApproved(db)).toBe(true);
    db.close();
  });
});

function adapterRecord(value: Record<string, unknown>): AdapterRecord {
  const sourcePath = "/tmp/codex/sessions/thread.jsonl";
  return {
    diagnostics: [],
    normalized: {
      confidence: "authoritative",
      kind: "session",
      sourceRef: {
        sourceKind: "jsonl",
        sourcePath
      },
      value
    },
    observedAt: "2026-06-24T12:00:00.000Z",
    payload: value,
    payloadHash: "hash",
    source: {
      confidence: "authoritative",
      path: sourcePath,
      runtime: "codex",
      sourceId: "codex-sessions:thread.jsonl",
      sourceKind: "jsonl"
    },
    sourceRecordKey: `${sourcePath}:1`
  };
}
