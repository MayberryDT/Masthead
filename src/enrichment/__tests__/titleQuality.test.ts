import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeCodexHookPayload } from "../../core/codexAdapter.ts";
import { projectLiveEvents } from "../../core/liveProjection.ts";
import { querySessions } from "../../daemon/db/sessionQueryRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { createEnrichmentCoordinator } from "../enrichmentCoordinator.ts";
import { deterministicCapsuleFromFacts, type SessionFacts } from "../sessionCompiler.ts";
import type { SessionCapsule } from "../types.ts";

type CapsuleWithTitleSource = SessionCapsule & { titleSource?: string };

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session title quality", () => {
  test("rejects generic session titles and records the selected title source", () => {
    const capsule = deterministicCapsuleFromFacts(
      facts({
        objective: "Reject low-quality session titles",
        title: "Masthead Codex session"
      })
    ) as CapsuleWithTitleSource;

    expect(capsule.title).toBe("Reject low-quality session titles");
    expect(capsule.titleSource).toBe("objective");
    expect(capsule.searchPhrases).toContain("Reject low-quality session titles");
  });

  test("uses a real prompt before falling back to a project label", () => {
    const capsule = deterministicCapsuleFromFacts(
      facts({
        messages: ["Complete the assignment below, thoroughly:\n\n# Target\nRepair OAuth callback title quality."],
        sourceSessionId: "session-opaque-source",
        title: "session-opaque-source"
      })
    ) as CapsuleWithTitleSource;

    expect(capsule.title).toBe("Repair OAuth callback title quality");
    expect(capsule.titleSource).toBe("message");
  });

  test("coordinator persists titleSource with the canonical capsule", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      objective: "Persist title source metadata",
      sessionId: "session-title-source",
      title: "Codex session"
    });
    const coordinator = createEnrichmentCoordinator(db, {
      id: "fixture-provider",
      model: "fixture-model",
      async enrich() {
        return {
          candidateDecisions: [],
          liveSummary: "Useful live summary from provider.",
          searchPhrases: [],
          technologies: [],
          title: "Codex session",
          topics: [],
          unresolved: []
        };
      }
    });

    await coordinator.enrich("session-title-source");

    const row = db
      .prepare("SELECT content_json AS contentJson FROM session_enrichments WHERE session_id = ? AND enrichment_kind = 'session_capsule' AND status = 'current'")
      .get("session-title-source") as { contentJson: string };
    const capsule = JSON.parse(row.contentJson) as CapsuleWithTitleSource;
    expect(capsule.title).toBe("Persist title source metadata");
    expect(capsule.titleSource).toBe("objective");
    db.close();
  });

  test("Now projection prefers liveSummary when an enrichment title is generic", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "title-quality-start",
        event: "session_started",
        session_id: "title-quality-live",
        timestamp: "2026-06-25T12:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Masthead Codex session"
      },
      { receivedAt: "2026-06-25T12:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-25T12:00:01.000Z",
      sessionEnrichments: new Map([
        ["title-quality-live", { liveSummary: "Title quality work is active now.", title: "Codex session" }]
      ])
    });

    expect(envelope.projection.cards[0]?.title).toBe("Title quality work is active now.");
    expect(envelope.projection.cards[0]?.copy.headline).toBe("Title quality work is active now.");
  });

  test("Logbook list titles use liveSummary before bad stored titles", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      objective: undefined,
      sessionId: "session-logbook-title",
      title: "Codex session"
    });
    db.prepare(
      `INSERT INTO session_enrichments (
        enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
        provider, model, generated_at, content_json, source_refs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "enrichment:logbook-title",
      "session-logbook-title",
      "session_capsule",
      "current",
      "fingerprint:logbook-title",
      "session-capsule-v1",
      "fixture",
      "fixture",
      "2026-06-25T12:00:00.000Z",
      JSON.stringify({
        candidateDecisions: [],
        liveSummary: "Title quality work is ready for review.",
        searchPhrases: [],
        technologies: [],
        title: "Codex session",
        topics: [],
        unresolved: []
      }),
      "[]"
    );

    expect(querySessions(db, { limit: 10 }).sessions[0]?.title).toBe("Title quality work is ready for review.");
    db.close();
  });
});

function facts(overrides: Partial<SessionFacts>): SessionFacts {
  return {
    commands: [],
    evidence: [],
    files: [],
    messages: ["Repair session title quality."],
    project: "Masthead",
    sessionId: "session-title-quality",
    sourceSessionId: "source-title-quality",
    title: "Useful session title",
    ...overrides
  };
}

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-title-quality-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(
  db: MastheadDatabase,
  options: {
    objective: string | undefined;
    sessionId: string;
    title: string;
  }
): void {
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
      session_id, host_id, runtime_id, source_session_id, project_label, title, objective, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.sessionId,
    "host:test",
    "runtime:codex",
    options.sessionId.replace("session", "source-session"),
    "Masthead",
    options.title,
    options.objective ?? null,
    "ended",
    now,
    "authoritative",
    now,
    now
  );
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${options.sessionId}:message`, options.sessionId, "user", "Repair title quality.", `${options.sessionId}:hash`, now, "{}", "authoritative");
}
