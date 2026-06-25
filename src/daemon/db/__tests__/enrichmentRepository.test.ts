import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment repository", () => {
  test("upserts versioned session capsules by content fingerprint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO hosts (host_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?)`
    ).run("host:test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("runtime:test", "codex", "test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "session-1",
      "host:test",
      "runtime:test",
      "source-session-1",
      "unknown",
      "2026-06-24T12:00:00.000Z",
      "authoritative",
      "2026-06-24T12:00:00.000Z",
      "2026-06-24T12:00:00.000Z"
    );

    const id = upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        searchPhrases: ["Masthead"],
        technologies: ["TypeScript"],
        title: "Masthead data layer",
        topics: ["Masthead"],
        unresolved: []
      },
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-24T12:05:00.000Z",
      model: "deterministic",
      promptVersion: "session-capsule-v1",
      provider: "local",
      sessionId: "session-1",
      sourceRefs: [{ id: "event-1", kind: "event", observedAt: "2026-06-24T12:00:00.000Z", source: "codex.hook" }],
      status: "current"
    });
    const sameId = upsertSessionEnrichment(db, {
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      failureCode: "none",
      promptVersion: "session-capsule-v1",
      sessionId: "session-1",
      sourceRefs: [],
      status: "stale"
    });

    expect(sameId).toBe(id);
    expect(db.prepare("SELECT enrichment_id, status, content_fingerprint FROM session_enrichments").all()).toEqual([
      { content_fingerprint: "fingerprint-1", enrichment_id: id, status: "stale" }
    ]);
    db.close();
  });
});
