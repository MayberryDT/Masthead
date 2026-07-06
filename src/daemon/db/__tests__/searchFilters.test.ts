import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { indexCanonicalSessionSearch } from "../searchRepository.ts";
import { querySessions } from "../sessionQueryRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("canonical session search filters", () => {
  test("filters Logbook by runtime, project, model, state, and file", async () => {
    const db = await openTestDatabase();
    seedFilteredSession(db, {
      file: "auth/callback.ts",
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      runtime: "opencode",
      sessionId: "session-match",
      title: "OAuth callback repair"
    });
    seedFilteredSession(db, {
      file: "billing/import.ts",
      lifecycle: "ended",
      model: "gpt-4.1",
      project: "Pip",
      runtime: "opencode",
      sessionId: "session-other",
      title: "OAuth billing repair"
    });
    indexCanonicalSessionSearch(db, "session-match");
    indexCanonicalSessionSearch(db, "session-other");

    const result = querySessions(db, {
      file: "auth/callback",
      limit: 25,
      model: "gpt-5",
      project: "pip",
      query: "OAuth",
      runtime: "opencode",
      state: "ended"
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual(expect.objectContaining({ project: "Pip", sessionId: "session-match" }));
    db.close();
  });

  test("filters Logbook by multiple runtimes, projects, and models", async () => {
    const db = await openTestDatabase();
    seedFilteredSession(db, {
      file: "auth/callback.ts",
      lifecycle: "ended",
      model: "gpt-5",
      project: "Pip",
      runtime: "opencode",
      sessionId: "session-codex",
      title: "OAuth callback repair"
    });
    seedFilteredSession(db, {
      file: "settings/panel.tsx",
      lifecycle: "ended",
      model: "claude-sonnet-4",
      project: "Masthead",
      runtime: "claude",
      sessionId: "session-claude",
      title: "Settings panel repair"
    });
    seedFilteredSession(db, {
      file: "billing/import.ts",
      lifecycle: "ended",
      model: "gemini-3.5-flash",
      project: "Billing",
      runtime: "gemini",
      sessionId: "session-gemini",
      title: "Billing repair"
    });

    const result = querySessions(db, {
      limit: 25,
      model: ["gpt-5", "claude-sonnet-4"],
      project: ["pip", "masthead"],
      runtime: ["opencode", "claude"]
    });

    expect(result.sessions.map((session) => session.sessionId).toSorted()).toEqual(["session-claude", "session-codex"]);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-search-filters-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedFilteredSession(
  db: MastheadDatabase,
  options: {
    file: string;
    lifecycle: string;
    model: string;
    project: string;
    runtime: string;
    sessionId: string;
    title: string;
  }
): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "masthead-test-host",
    now,
    now
  );
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    `runtime:${options.runtime}`,
    options.runtime,
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, objective,
      lifecycle, started_at, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.sessionId,
    "host:test",
    `runtime:${options.runtime}`,
    `source-${options.sessionId}`,
    options.project,
    options.title,
    "Repair OAuth callback handling",
    options.lifecycle,
    now,
    now,
    "authoritative",
    now,
    now
  );
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:message`,
    options.sessionId,
    "user",
    "OAuth callback work",
    `${options.sessionId}:hash`,
    now,
    "{}",
    "authoritative"
  );
  db.prepare("INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:usage`,
    options.sessionId,
    options.model,
    "openai",
    now,
    "{}"
  );
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:file`,
    options.sessionId,
    options.file,
    "modified",
    now,
    "{}"
  );
}
