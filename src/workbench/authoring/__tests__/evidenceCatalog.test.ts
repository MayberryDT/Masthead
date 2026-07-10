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

  test("returns decisive redacted tool output beyond the transcript preview boundary", async () => {
    const db = await testDb();
    seedToolResultSession(db, "session:complete-page");

    const page = getAuthoringEvidencePage(db, {
      query: "tail-a",
      sessionId: "session:complete-page"
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.text).toContain("tail-a");
    expect(page.items[0]?.text.length).toBeGreaterThan(800);
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

  test("changes revision when an exposed canonical evidence label changes", async () => {
    const db = await testDb();
    seedMixedSession(db, "session:label-revision");

    const initial = authoringEvidenceRevision(db, ["session:label-revision"]);
    db.prepare("UPDATE checkpoints SET checkpoint_kind = ? WHERE session_id = ?").run(
      "final_verification",
      "session:label-revision"
    );

    expect(authoringEvidenceRevision(db, ["session:label-revision"])).not.toBe(initial);
    db.close();
  });

  test("changes revision when exposed canonical source provenance changes", async () => {
    const db = await testDb();
    seedMixedSession(db, "session:source-revision");

    const initial = authoringEvidenceRevision(db, ["session:source-revision"]);
    db.prepare("UPDATE checkpoints SET source_ref_json = ? WHERE session_id = ?").run(
      JSON.stringify({ source: "updated-checkpoint" }),
      "session:source-revision"
    );

    expect(authoringEvidenceRevision(db, ["session:source-revision"])).not.toBe(initial);
    db.close();
  });

  test("exposes every redacted canonical content field and revises for each field change", async () => {
    const db = await testDb();
    seedMixedSession(db, "session:complete-canonical-fields");

    const page = getAuthoringEvidencePage(db, { sessionId: "session:complete-canonical-fields" });
    expect(page.total).toBe(7);
    expect(page.items.find((item) => item.kind === "tool_call")).toMatchObject({
      argumentsRedacted: { command: "npm run focused-test" },
      label: "shell",
      text: expect.stringContaining("npm run focused-test")
    });
    expect(page.items.find((item) => item.kind === "runtime_signal")).toMatchObject({
      details: { phase: "finish", receipt: "stored" },
      label: "completed",
      text: expect.stringContaining("receipt")
    });
    expect(page.items.find((item) => item.kind === "file_effect")).toMatchObject({
      additions: 20,
      deletions: 4,
      label: "modified",
      staged: true,
      text: expect.stringMatching(/staged.*20 additions.*4 deletions/)
    });

    const revisions = [authoringEvidenceRevision(db, ["session:complete-canonical-fields"])];
    db.prepare("UPDATE tool_calls SET arguments_redacted_json = ? WHERE session_id = ?").run(
      JSON.stringify({ command: "npm run changed-test" }),
      "session:complete-canonical-fields"
    );
    revisions.push(authoringEvidenceRevision(db, ["session:complete-canonical-fields"]));
    db.prepare("UPDATE runtime_signals SET details_json = ? WHERE session_id = ?").run(
      JSON.stringify({ phase: "finish", receipt: "changed" }),
      "session:complete-canonical-fields"
    );
    revisions.push(authoringEvidenceRevision(db, ["session:complete-canonical-fields"]));
    db.prepare("UPDATE file_effects SET staged = 0 WHERE session_id = ?").run("session:complete-canonical-fields");
    revisions.push(authoringEvidenceRevision(db, ["session:complete-canonical-fields"]));
    db.prepare("UPDATE file_effects SET additions = 21 WHERE session_id = ?").run("session:complete-canonical-fields");
    revisions.push(authoringEvidenceRevision(db, ["session:complete-canonical-fields"]));
    db.prepare("UPDATE file_effects SET deletions = 5 WHERE session_id = ?").run("session:complete-canonical-fields");
    revisions.push(authoringEvidenceRevision(db, ["session:complete-canonical-fields"]));

    expect(new Set(revisions).size).toBe(revisions.length);
    expect(
      getAuthoringEvidencePage(db, {
        query: "changed-test",
        sessionId: "session:complete-canonical-fields"
      }).items.map((item) => item.kind)
    ).toEqual(["tool_call"]);
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
  db.prepare(
    "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    `${sessionId}:tool`,
    sessionId,
    "shell",
    JSON.stringify({ command: "npm run focused-test" }),
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
  db.prepare(
    "INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    `${sessionId}:file`,
    sessionId,
    "src/example.ts",
    "modified",
    1,
    20,
    4,
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
    JSON.stringify({ phase: "finish", receipt: "stored" }),
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
