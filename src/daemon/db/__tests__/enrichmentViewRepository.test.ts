import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { liveProjectionEnrichments } from "../enrichmentViewRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import type { MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment view repository", () => {
  test("scopes live projection enrichment lookup to requested source session ids", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-view-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");
    seedSession(db, "session-b", "source-b");
    seedCapsule(db, "session-a", "Source A summary");
    seedCapsule(db, "session-b", "Source B summary");

    const enrichments = liveProjectionEnrichments(db, new Set(["source-a"]));

    expect([...enrichments.keys()]).toEqual(["source-a"]);
    expect(enrichments.get("source-a")).toMatchObject({
      liveSummary: "Source A summary",
      sourceSessionId: "source-a",
      title: "Source A summary"
    });
    expect(enrichments.has("source-b")).toBe(false);
    db.close();
  });

  test("prefers current session capsule prompt version over newer stale rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-view-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-c", "source-c");
    seedCapsule(db, "session-c", "Masthead work is focused on mcp.", {
      generatedAt: "2026-06-24T12:10:00.000Z",
      id: "stale-v2",
      promptVersion: "session-capsule-v2"
    });
    seedCapsule(db, "session-c", "Reworked the card copy path to summarize the latest assistant output.", {
      generatedAt: "2026-06-24T12:05:00.000Z",
      id: "current-v3",
      promptVersion: "session-capsule-v3"
    });

    const enrichments = liveProjectionEnrichments(db, new Set(["source-c"]));

    expect(enrichments.get("source-c")).toMatchObject({
      liveSummary: "Reworked the card copy path to summarize the latest assistant output.",
      title: "Reworked the card copy path to summarize the latest assistant output."
    });
    db.close();
  });
});

function seedSession(db: MastheadDatabase, sessionId: string, sourceSessionId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO hosts (host_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?)`
  ).run("host:test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
  db.prepare(
    `INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run("runtime:test", "codex", "test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    "host:test",
    "runtime:test",
    sourceSessionId,
    "running",
    "2026-06-24T12:00:00.000Z",
    "authoritative",
    "2026-06-24T12:00:00.000Z",
    "2026-06-24T12:00:00.000Z"
  );
}

function seedCapsule(
  db: MastheadDatabase,
  sessionId: string,
  title: string,
  options: { generatedAt?: string; id?: string; promptVersion?: string } = {}
): void {
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      provider, model, generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `enrichment:${options.id ?? sessionId}`,
    sessionId,
    "session_capsule",
    "current",
    `fingerprint:${options.id ?? sessionId}`,
    options.promptVersion ?? "session-capsule-v1",
    "local",
    "deterministic",
    options.generatedAt ?? "2026-06-24T12:05:00.000Z",
    JSON.stringify({
      candidateDecisions: [],
      liveSummary: title,
      searchPhrases: [title],
      technologies: [],
      title,
      topics: [],
      unresolved: []
    }),
    "[]"
  );
}
