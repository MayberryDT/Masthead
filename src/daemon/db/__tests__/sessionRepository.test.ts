import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { projectLiveEvents } from "../../../core/liveProjection.ts";
import type { NormalizedEvent } from "../../../core/types.ts";
import type { AdapterRecord } from "../../../adapters/types.ts";
import { migrateDatabase } from "../schema.ts";
import { createSessionRepository } from "../sessionRepository.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session repository", () => {
  test("upserts live events into the canonical session graph idempotently", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "codex-test"
    });
    const events = [
      liveEvent("start", "session.started", {
        model: "gpt-5.5",
        objective: "Import Codex history",
        project: "Masthead",
        title: "Build durable data layer"
      }),
      liveEvent("question", "user.question", { message: "Should I import archived sessions too?" }),
      liveEvent("command-start", "command.started", {
        category: "test",
        commandId: "cmd-test",
        normalizedCommand: "npm test"
      }),
      liveEvent("command-finish", "command.finished", {
        category: "test",
        commandId: "cmd-test",
        exitCode: 1,
        model: "gpt-5.5",
        outputTokens: 32
      }),
      liveEvent("file", "file.changed", { path: "src/daemon/db/sessionRepository.ts" })
    ];

    for (const event of events) repository.upsertLiveEvent(event);
    for (const event of events) repository.upsertLiveEvent(event);

    const sessions = db.prepare("SELECT session_id, source_session_id, title, objective, project_label FROM sessions").all();
    expect(sessions).toEqual([
      expect.objectContaining({
        objective: "Import Codex history",
        project_label: "Masthead",
        source_session_id: "live-session",
        title: "Build durable data layer"
      })
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM turns").get()).toEqual({ count: 5 });
    expect(db.prepare("SELECT role, text_redacted FROM messages ORDER BY observed_at").all()).toEqual([
      { role: "system", text_redacted: "Build durable data layer" },
      { role: "user", text_redacted: "Should I import archived sessions too?" }
    ]);
    expect(db.prepare("SELECT tool_name FROM tool_calls").all()).toEqual([{ tool_name: "test" }]);
    expect(db.prepare("SELECT status, exit_code FROM tool_results").all()).toEqual([{ status: "failed", exit_code: 1 }]);
    expect(db.prepare("SELECT path, effect_kind FROM file_effects").all()).toEqual([
      { effect_kind: "modified", path: "src/daemon/db/sessionRepository.ts" }
    ]);
    expect(db.prepare("SELECT signal_kind, severity FROM runtime_signals ORDER BY observed_at").all()).toEqual(
      expect.arrayContaining([
        { severity: "info", signal_kind: "user.question" },
        { severity: "error", signal_kind: "command.failed" }
      ])
    );
    expect(db.prepare("SELECT model, output_tokens FROM model_usage").all()).toEqual([
      { model: "gpt-5.5", output_tokens: null },
      { model: "gpt-5.5", output_tokens: 32 }
    ]);
    db.close();
  });

  test("materializes Board projection state for canonical sessions", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex"
    });
    const event = liveEvent("start", "session.started", { project: "Masthead", title: "Board materialized state" });
    const sessionId = repository.upsertLiveEvent(event);
    const envelope = projectLiveEvents([event], [], { generatedAt: "2026-06-24T15:05:00.000Z" });

    repository.replaceBoardProjection(envelope.projection, envelope.generatedAt);

    const boardRows = db.prepare("SELECT session_id, projection_json, updated_at FROM board_sessions").all() as Array<{
      projection_json: string;
      session_id: string;
      updated_at: string;
    }>;
    expect(boardRows).toHaveLength(1);
    expect(boardRows[0].session_id).toBe(sessionId);
    expect(boardRows[0].updated_at).toBe("2026-06-24T15:05:00.000Z");
    expect(JSON.parse(boardRows[0].projection_json)).toMatchObject({
      title: "Board materialized state",
      sessionId: "live-session"
    });
    db.close();
  });

  test("materializes Board projection state before full canonical replay", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex"
    });
    const event = liveEvent("start", "session.started", { project: "Masthead", title: "Legacy journal card" });
    const envelope = projectLiveEvents([event], [], { generatedAt: "2026-06-24T15:05:00.000Z" });

    repository.replaceBoardProjection(envelope.projection, envelope.generatedAt);

    expect(db.prepare("SELECT source_session_id, project_label, title, source_confidence FROM sessions").all()).toEqual([
      {
        project_label: "Masthead",
        source_confidence: "inferred",
        source_session_id: "live-session",
        title: "Legacy journal card"
      }
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM board_sessions").get()).toEqual({ count: 1 });
    db.close();
  });

  test("upserts transcript message records into canonical messages idempotently", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const record = transcriptMessageRecord({
      content: "Use Bearer live-secret-token when testing.",
      role: "assistant",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:10:00.000Z"
    });

    repository.upsertTranscriptRecord(record);
    repository.upsertTranscriptRecord(record);

    expect(db.prepare("SELECT source_session_id FROM sessions").all()).toEqual([{ source_session_id: "historical-session" }]);
    expect(db.prepare("SELECT role, text_redacted, observed_at FROM messages").all()).toEqual([
      {
        observed_at: "2026-06-24T12:10:00.000Z",
        role: "assistant",
        text_redacted: "Use Bearer [SECRET:bearer_token] when testing."
      }
    ]);
    db.close();
  });

  test("upserts transcript tool and usage records before cursor advancement", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const toolRecord = transcriptRecord("tool_call", {
      name: "bash",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:11:00.000Z",
      tool_call_id: "call-1"
    });
    const usageRecord = transcriptRecord("usage", {
      model: "gpt-5.5",
      output_tokens: 12,
      session_id: "historical-session",
      timestamp: "2026-06-24T12:12:00.000Z"
    });

    repository.upsertTranscriptRecord(toolRecord);
    repository.upsertTranscriptRecord(toolRecord);
    repository.upsertTranscriptRecord(usageRecord);
    repository.upsertTranscriptRecord(usageRecord);

    expect(db.prepare("SELECT tool_name FROM tool_calls").all()).toEqual([{ tool_name: "bash" }]);
    expect(db.prepare("SELECT model, output_tokens FROM model_usage").all()).toEqual([{ model: "gpt-5.5", output_tokens: 12 }]);
    db.close();
  });
});

async function openMigratedDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-repo-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function liveEvent(eventId: string, type: NormalizedEvent["type"], payload: Record<string, unknown> = {}): NormalizedEvent {
  const occurredAt = `2026-06-24T15:0${eventOrdinal(eventId)}:00.000Z`;
  return {
    schemaVersion: 1,
    eventId: `codex:${eventId}`,
    sessionId: "live-session",
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: eventId
    },
    occurredAt,
    receivedAt: occurredAt,
    type,
    workspace: {
      branch: "main",
      cwd: "/workspace/masthead",
      repoRoot: "/workspace/masthead",
      worktreePath: "/workspace/masthead"
    },
    summary: String(payload.title ?? payload.message ?? payload.normalizedCommand ?? `Event ${eventId}`),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: `codex:${eventId}`, kind: "event", observedAt: occurredAt, source: "codex.hook" }]
  };
}

function eventOrdinal(eventId: string): number {
  return ["start", "question", "command-start", "command-finish", "file"].indexOf(eventId);
}

function transcriptMessageRecord(value: Record<string, unknown>): AdapterRecord {
  return transcriptRecord("message", value);
}

function transcriptRecord(kind: AdapterRecord["normalized"]["kind"], value: Record<string, unknown>): AdapterRecord {
  return {
    diagnostics: [],
    normalized: {
      confidence: "inferred",
      kind,
      sourceRef: {
        schemaVersion: "codex-transcript-jsonl",
        sourceKind: "jsonl",
        sourcePath: "/tmp/historical-session.jsonl"
      },
      value
    },
    observedAt: String(value.timestamp),
    payload: value,
    payloadHash: "transcript-hash",
    source: {
      confidence: "authoritative",
      path: "/tmp/historical-session.jsonl",
      runtime: "codex",
      runtimeVersion: "local-jsonl",
      schemaVersion: "codex-transcript-jsonl",
      sourceId: "codex-transcript",
      sourceKind: "jsonl"
    },
    sourceRecordKey: "/tmp/historical-session.jsonl:128"
  };
}
