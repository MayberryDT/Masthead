import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import {
  authoringEvidenceRevision,
  getAuthoringEvidenceManifest,
  getAuthoringEvidencePage
} from "../evidenceCatalog.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("authoring evidence catalog", () => {
  test("pages every redacted item and can retrieve the final outcome first", async () => {
    const db = await testDb();
    seedLongSession(db, "session:long", 500);

    const manifest = getAuthoringEvidenceManifest(db, ["session:long"]);
    expect(manifest.sessions[0]).toMatchObject({
      coverage: {
        assistantMessages: 250,
        messages: 500,
        userMessages: 250
      },
      firstObservedAt: "2026-07-10T12:00:00.000Z",
      kindCounts: [{ count: 500, kind: "message" }],
      lastObservedAt: "2026-07-10T12:08:19.000Z",
      sessionId: "session:long",
      totalItems: 500,
      warnings: []
    });
    expect(manifest.evidenceRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = getAuthoringEvidencePage(db, {
        cursor,
        limit: 75,
        order: "asc",
        sessionId: "session:long"
      });
      page.items.forEach((item) => seen.add(item.itemId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(500);

    const latest = getAuthoringEvidencePage(db, {
      limit: 25,
      order: "desc",
      query: "final outcome",
      sessionId: "session:long"
    });
    expect(latest.items[0]?.text).toContain("final outcome");

    const maximumPage = getAuthoringEvidencePage(db, {
      limit: 500,
      sessionId: "session:long"
    });
    expect(maximumPage.items).toHaveLength(250);
    db.close();
  });

  test("summarizes every canonical evidence kind for a normalized session set", async () => {
    const db = await testDb();
    seedMixedSession(db, "session:mixed");
    seedOneMessageSession(db, "session:other");

    const manifest = getAuthoringEvidenceManifest(db, ["session:mixed", "session:mixed"]);

    expect(manifest.sessions).toEqual([
      {
        coverage: {
          assistantMessages: 1,
          checkpoints: 1,
          fileEffects: 1,
          messages: 2,
          runtimeSignals: 1,
          toolCalls: 1,
          toolResults: 1,
          userMessages: 1
        },
        firstObservedAt: "2026-07-10T13:00:00.000Z",
        kindCounts: [
          { count: 2, kind: "message" },
          { count: 1, kind: "tool_call" },
          { count: 1, kind: "tool_result" },
          { count: 1, kind: "file_effect" },
          { count: 1, kind: "checkpoint" },
          { count: 1, kind: "runtime_signal" }
        ],
        lastObservedAt: "2026-07-10T13:06:00.000Z",
        sessionId: "session:mixed",
        totalItems: 7,
        warnings: []
      }
    ]);
    expect(authoringEvidenceRevision(db, ["session:other", "session:mixed", "session:other"])).toBe(
      authoringEvidenceRevision(db, ["session:mixed", "session:other"])
    );
    db.close();
  });

  test("changes revision for canonical identity, ordering, redacted content, status, and exit code changes", async () => {
    const db = await testDb();
    seedToolResultSession(db, "session:revision");

    const initial = authoringEvidenceRevision(db, ["session:revision"]);
    db.prepare("UPDATE tool_results SET output_redacted = ? WHERE session_id = ?").run(
      `${"x".repeat(850)}tail-b`,
      "session:revision"
    );
    const contentChanged = authoringEvidenceRevision(db, ["session:revision"]);
    expect(contentChanged).not.toBe(initial);

    db.prepare("UPDATE tool_results SET completed_at = ? WHERE session_id = ?").run(
      "2026-07-10T14:02:00.000Z",
      "session:revision"
    );
    const orderingChanged = authoringEvidenceRevision(db, ["session:revision"]);
    expect(orderingChanged).not.toBe(contentChanged);

    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("failed", "session:revision");
    const statusChanged = authoringEvidenceRevision(db, ["session:revision"]);
    expect(statusChanged).not.toBe(orderingChanged);

    db.prepare("UPDATE tool_results SET exit_code = ? WHERE session_id = ?").run(1, "session:revision");
    const exitCodeChanged = authoringEvidenceRevision(db, ["session:revision"]);
    expect(exitCodeChanged).not.toBe(statusChanged);

    db.prepare("UPDATE tool_results SET tool_result_id = ? WHERE session_id = ?").run(
      "session:revision:result-renamed",
      "session:revision"
    );
    expect(authoringEvidenceRevision(db, ["session:revision"])).not.toBe(exitCodeChanged);
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-authoring-evidence-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedLongSession(db: MastheadDatabase, sessionId: string, itemCount: number): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Long authoring session"
  });
  clearCanonicalRows(db, sessionId);
  const insert = db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 0; index < itemCount; index += 1) {
    const padded = String(index).padStart(4, "0");
    const text =
      index === 490
        ? "The final outcome shipped after successful verification."
        : `Canonical redacted evidence item ${padded}.`;
    insert.run(
      `${sessionId}:message-${padded}`,
      sessionId,
      index % 2 === 0 ? "user" : "assistant",
      text,
      `${sessionId}:hash-${padded}`,
      new Date(Date.UTC(2026, 6, 10, 12, 0, index)).toISOString(),
      JSON.stringify({ index }),
      "authoritative"
    );
  }
}

function seedMixedSession(db: MastheadDatabase, sessionId: string): void {
  seedOneMessageSession(db, sessionId);
  insertMessage(db, sessionId, "assistant", "assistant", "Implementation complete.", "2026-07-10T13:01:00.000Z");
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${sessionId}:tool`,
    sessionId,
    "shell",
    "2026-07-10T13:02:00.000Z",
    "{}"
  );
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:result`,
    `${sessionId}:tool`,
    sessionId,
    "succeeded",
    "Tests passed.",
    `${sessionId}:result-hash`,
    0,
    "2026-07-10T13:03:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${sessionId}:file`,
    sessionId,
    "src/example.ts",
    "modified",
    "2026-07-10T13:04:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO checkpoints (checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${sessionId}:checkpoint`,
    sessionId,
    "verification",
    "Focused tests passed.",
    "2026-07-10T13:05:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${sessionId}:signal`,
    sessionId,
    "completed",
    "info",
    "Run completed",
    "{}",
    "2026-07-10T13:06:00.000Z",
    "{}"
  );
}

function seedOneMessageSession(db: MastheadDatabase, sessionId: string): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: `Evidence ${sessionId}`
  });
  clearCanonicalRows(db, sessionId);
  insertMessage(db, sessionId, "user", "user", "Implement the evidence catalog.", "2026-07-10T13:00:00.000Z");
}

function seedToolResultSession(db: MastheadDatabase, sessionId: string): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Evidence revision"
  });
  clearCanonicalRows(db, sessionId);
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${sessionId}:tool`,
    sessionId,
    "shell",
    "2026-07-10T14:00:00.000Z",
    "{}"
  );
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:result`,
    `${sessionId}:tool`,
    sessionId,
    "succeeded",
    `${"x".repeat(850)}tail-a`,
    `${sessionId}:result-hash`,
    0,
    "2026-07-10T14:01:00.000Z",
    "{}"
  );
}

function insertMessage(
  db: MastheadDatabase,
  sessionId: string,
  id: string,
  role: "assistant" | "user",
  text: string,
  observedAt: string
): void {
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:${id}`, sessionId, role, text, `${sessionId}:${id}:hash`, observedAt, "{}", "authoritative");
}

function clearCanonicalRows(db: MastheadDatabase, sessionId: string): void {
  db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}
