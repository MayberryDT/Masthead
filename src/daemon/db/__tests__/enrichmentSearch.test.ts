import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "../searchRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { publishSessionToLogbook } from "./sessionTestHelpers.ts";

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
      "runtime:opencode",
      "opencode",
      now,
      now
    );
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
        last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session-1", "host:test", "runtime:opencode", "source-session-1", "Pip", "Callback work", "ended", now, "authoritative", now, now);
    publishSessionToLogbook(db, "session-1");
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        commandsSummary: "tools-list test",
        filesChangedSummary: "Agent Access Panel, mcp Status Service",
        objective: "Fix OAuth callback handling",
        searchSummary: "Masthead session for MCP launch config validation. Verification: tools-list test passed.",
        searchPhrases: ["OAuth callback", "authentication return path"],
        sessionDossier: {
          blockers: [],
          continuation: {
            constraints: [],
            nextStep: "Keep durable title search indexed.",
            openQuestions: []
          },
          decisions: [],
          evidenceRefs: [],
          keyWork: ["Indexed durable title fields."],
          outcome: "Durable title and summary are searchable.",
          purpose: "Refresh durable search projection.",
          verification: {
            commands: [],
            evidenceRefs: [],
            failures: [],
            status: "unknown",
            summary: "Search indexing was exercised."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefs: [],
          state: "completed",
          text: "Added durable title and summary fields to Logbook search indexing."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefs: [],
          text: "Durable search projection"
        },
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
    expect(searchSessions(db, { query: "durable", limit: 10 }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session-1" })
    ]);
    db.close();
  });
});
