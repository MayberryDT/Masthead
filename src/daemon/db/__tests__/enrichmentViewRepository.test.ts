import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { currentSessionEnrichmentView, liveProjectionEnrichments } from "../enrichmentViewRepository.ts";
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
    seedCapsule(db, "session-c", "Reworked the card headline path to summarize the latest assistant output.", {
      generatedAt: "2026-06-24T12:05:00.000Z",
      id: "current-v3",
      promptVersion: "session-capsule-v4"
    });

    const enrichments = liveProjectionEnrichments(db, new Set(["source-c"]));

    expect(enrichments.get("source-c")).toMatchObject({
      liveSummary: "Reworked the card headline path to summarize the latest assistant output.",
      title: "Reworked the card headline path to summarize the latest assistant output."
    });
    db.close();
  });

  test("does not treat older current prompt versions as usable current enrichment", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-view-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-old", "source-old");
    seedCapsule(db, "session-old", "Validated App for Codex hook event.", {
      generatedAt: "2026-06-24T12:10:00.000Z",
      id: "old-v3",
      promptVersion: "session-capsule-v3"
    });

    const enrichments = liveProjectionEnrichments(db, new Set(["source-old"]));

    expect(enrichments.has("source-old")).toBe(false);
    db.close();
  });

  test("persists durable title and summary in the current session capsule", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-view-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-durable", "source-durable");
    db.prepare(
      `INSERT INTO session_enrichments (
        enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
        provider, model, generated_at, content_json, source_refs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "enrichment:durable",
      "session-durable",
      "session_capsule",
      "current",
      "fingerprint:durable",
      "session-capsule-v4",
      "openai",
      "test-model",
      "2026-06-24T12:05:00.000Z",
      JSON.stringify({
        candidateDecisions: [],
        liveSummary: "Live summary remains separate from durable title.",
        searchPhrases: [],
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], openQuestions: [] },
          decisions: [],
          evidenceRefs: [],
          keyWork: ["Added durable title fields."],
          verification: {
            commands: [],
            evidenceRefs: [],
            failures: [],
            status: "unknown",
            summary: "No verification was captured."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefs: [],
          state: "completed",
          text: "Added durable title and summary fields to the persisted session capsule."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefs: [],
          text: "Durable capsule field persistence"
        },
        technologies: [],
        title: "Durable capsule field persistence",
        topics: [],
        unresolved: []
      }),
      "[]"
    );

    const view = liveProjectionEnrichments(db, new Set(["source-durable"])).get("source-durable");

    expect(view?.sessionTitle?.text).toBe("Durable capsule field persistence");
    expect(view?.sessionSummary?.text).toContain("persisted session capsule");
    db.close();
  });

  test("lets summary search projection refresh Logbook fields without replacing the full dossier", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-view-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-summary", "source-summary");
    seedCapsule(db, "session-summary", "Older full capsule title", {
      generatedAt: "2026-06-24T12:00:00.000Z",
      id: "older-full"
    });
    seedSearchProjection(db, "session-summary");

    const view = currentSessionEnrichmentView(db, "session-summary");

    expect(view).toMatchObject({
      objective: "Refresh summaries locally",
      outcome: "Summary fields updated",
      searchSummary: "Summary projection search text",
      sessionSummary: { text: "Summary projection row should drive Logbook summary." },
      sessionTitle: { text: "Fresh summary projection title" },
      technologies: ["TypeScript"],
      title: "Fresh summary projection title",
      titleSource: "deterministic",
      topics: ["logbook"]
    });
    expect(view?.sessionDossier?.keyWork).toEqual(["Kept older full dossier."]);
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
    options.promptVersion ?? "session-capsule-v4",
    "local",
    "deterministic",
    options.generatedAt ?? "2026-06-24T12:05:00.000Z",
    JSON.stringify({
      candidateDecisions: [],
      liveSummary: title,
      searchPhrases: [title],
      sessionDossier: { keyWork: ["Kept older full dossier."] },
      technologies: [],
      title,
      topics: [],
      unresolved: []
    }),
    "[]"
  );
}

function seedSearchProjection(db: MastheadDatabase, sessionId: string): void {
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      provider, model, generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "enrichment:summary-projection",
    sessionId,
    "search_projection",
    "current",
    "fingerprint:summary-projection",
    "session-capsule-v4",
    "deterministic",
    "local-rules",
    "2026-06-24T12:10:00.000Z",
    JSON.stringify({
      objective: "Refresh summaries locally",
      outcome: "Summary fields updated",
      searchSummary: "Summary projection search text",
      searchText: "Fresh summary projection title Summary projection row should drive Logbook summary.",
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [],
        state: "completed",
        text: "Summary projection row should drive Logbook summary."
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
        text: "Fresh summary projection title"
      },
      technologies: ["TypeScript"],
      title: "Fresh summary projection title",
      titleSource: "deterministic",
      topics: ["logbook"]
    }),
    "[]"
  );
}
