import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "../searchRepository.ts";
import { getSessionDetail, querySessions } from "../sessionQueryRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enriched session query", () => {
  test("prefers the current session capsule and exposes enrichment status", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      sessionId: "session-1",
      title: "OpenCode session"
    });
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        objective: "Repair the OAuth callback return path",
        outcome: "Authentication callback fixed",
        searchPhrases: ["OAuth callback", "authentication return path"],
        technologies: ["TypeScript"],
        title: "OAuth callback repair",
        topics: ["authentication", "callback"],
        unresolved: [{ evidence: [], support: "derived", text: "Follow up on redirect coverage" }]
      },
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-25T12:00:00.000Z",
      promptVersion: "session-capsule-v4",
      provider: "deterministic",
      sessionId: "session-1",
      sourceRefs: [],
      status: "current"
    });
    upsertSessionEnrichment(db, {
      content: { searchText: "OAuth callback authentication return path" },
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "search_projection",
      generatedAt: "2026-06-25T12:00:00.000Z",
      promptVersion: "session-capsule-v4",
      provider: "deterministic",
      sessionId: "session-1",
      sourceRefs: [],
      status: "current"
    });

    indexCanonicalSessionSearch(db, "session-1");

    expect(querySessions(db, { limit: 25 }).sessions[0]).toMatchObject({
      enrichmentStatus: "current",
      objective: "Repair the OAuth callback return path",
      outcome: "Authentication callback fixed",
      title: "OAuth callback repair",
      topics: expect.arrayContaining(["authentication", "callback"]),
      unresolved: ["Follow up on redirect coverage"]
    });
    expect(getSessionDetail(db, "session-1")).toMatchObject({
      enrichmentStatus: "current",
      title: "OAuth callback repair",
      unresolved: ["Follow up on redirect coverage"]
    });
    expect(searchSessions(db, { limit: 10, query: "return path" }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session-1", title: "OAuth callback repair" })
    ]);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-enriched-query-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
