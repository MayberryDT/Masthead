import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "../searchRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment search", () => {
  test("indexes current persisted session capsules", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-search-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";
    db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
    db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
      "runtime:codex",
      "codex",
      now,
      now
    );
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
        last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session-1", "host:test", "runtime:codex", "source-session-1", "Pip", "Callback work", "ended", now, "authoritative", now, now);
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        commandsSummary: "tools-list test",
        filesChangedSummary: "Agent Access Panel, mcp Status Service",
        objective: "Fix OAuth callback handling",
        searchSummary: "Masthead session for MCP launch config validation. Verification: tools-list test passed.",
        searchPhrases: ["OAuth callback", "authentication return path"],
        technologies: ["TypeScript"],
        title: "OAuth callback repair",
        topics: ["authentication"],
        unresolved: []
      },
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      generatedAt: now,
      promptVersion: "session-capsule-v1",
      provider: "deterministic",
      sessionId: "session-1",
      sourceRefs: [],
      status: "current"
    });

    indexCanonicalSessionSearch(db, "session-1");

    expect(searchSessions(db, { query: "authentication", limit: 10 }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session-1" })
    ]);
    expect(searchSessions(db, { query: "tools-list", limit: 10 }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session-1" })
    ]);
    db.close();
  });
});
