import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readSessionEnrichment } from "../../daemon/db/enrichmentRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { createDeterministicEnrichmentProvider } from "../deterministicProvider.ts";
import { createEnrichmentCoordinator } from "../enrichmentCoordinator.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment coordinator", () => {
  test("a changed session marks old enrichment stale and queues a replacement", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const coordinator = createEnrichmentCoordinator(db, createDeterministicEnrichmentProvider());

    const first = await coordinator.enrich("session-1");
    appendMessage(db, "session-1", "assistant", "The build now passes.");

    const second = await coordinator.ensureCurrent("session-1");

    expect(first.contentFingerprint).not.toBe(second.contentFingerprint);
    expect(readSessionEnrichment(db, first.enrichmentId)?.status).toBe("stale");
    expect(second.status).toBe("current");
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-coordinator-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: MastheadDatabase): void {
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
  ).run("session-1", "host:test", "runtime:codex", "source-session-1", "Masthead", "Build Logbook", "ended", now, "authoritative", now, now);
  appendMessage(db, "session-1", "user", "Build OAuth Logbook search.");
}

function appendMessage(db: MastheadDatabase, sessionId: string, role: string, text: string): void {
  const observedAt = new Date(1_780_000_000_000 + Math.floor(Math.random() * 1000)).toISOString();
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`message:${role}:${text}`, sessionId, role, text, `${role}:${text}`, observedAt, "{}", "authoritative");
}
