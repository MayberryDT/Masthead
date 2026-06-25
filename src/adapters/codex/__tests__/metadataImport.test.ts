import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSessionRepository } from "../../../daemon/db/sessionRepository.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type { DiscoveredSource } from "../../types.ts";
import { importCodexMetadata } from "../metadataImport.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("codex metadata import", () => {
  test("yields compact metadata records without raw transcript text", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-metadata-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session_index.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({
        session_id: "session-1",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Import existing sessions",
        transcript: "raw transcript text must not be projected"
      })}\n`,
      "utf8"
    );

    const records = await collect(importCodexMetadata(source(file)));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceRecordKey: "session_index.jsonl:1",
      observedAt: "2026-06-24T12:00:00.000Z",
      normalized: {
        confidence: "inferred",
        kind: "event",
        value: {
          project: "Masthead",
          sessionId: "session-1",
          title: "Import existing sessions"
        }
      }
    });
    expect(JSON.stringify(records[0].normalized.value)).not.toContain("raw transcript text");
    expect(JSON.stringify(records[0].payload)).not.toContain("raw transcript text");
  });

  test("imports metadata records into canonical sessions idempotently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-metadata-"));
    tempDirs.push(tempDir);
    const sessionsDir = join(tempDir, "sessions");
    await mkdir(sessionsDir);
    await writeFile(
      join(sessionsDir, "2026-06-24.jsonl"),
      [
        JSON.stringify({
          id: "session-1",
          created_at: "2026-06-24T12:00:00.000Z",
          cwd: "/workspace/masthead",
          objective: "Build Logbook"
        }),
        JSON.stringify({
          id: "session-1",
          updated_at: "2026-06-24T12:05:00.000Z",
          title: "Build Logbook search"
        })
      ].join("\n"),
      "utf8"
    );
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const records = await collect(importCodexMetadata(source(sessionsDir)));

    for (const record of records) repository.upsertMetadataRecord(record);
    for (const record of records) repository.upsertMetadataRecord(record);

    expect(db.prepare("SELECT source_session_id, project_label, title FROM sessions").all()).toEqual([
      {
        project_label: "/workspace/masthead",
        source_session_id: "session-1",
        title: "Build Logbook"
      }
    ]);
    db.close();
  });
});

function source(path: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path,
    runtime: "codex",
    runtimeVersion: "local-jsonl",
    schemaVersion: "codex-local-jsonl",
    sourceId: "codex-test-source",
    sourceKind: "jsonl"
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
