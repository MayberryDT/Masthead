import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { projectLiveEvents } from "../../../core/liveProjection.ts";
import type { NormalizedEvent } from "../../../core/types.ts";
import type { AdapterRecord } from "../../../adapters/types.ts";
import { migrateDatabase } from "../schema.ts";
import { canonicalSessionId, createSessionRepository, ingestAdapterRecord, runtimeIdFor } from "../sessionRepository.ts";
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
      { model: "gpt-5.5", output_tokens: 32 }
    ]);
    db.close();
  });

  test("does not create model usage rows for model-only live hook events", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "codex-test"
    });

    repository.upsertLiveEvent(
      liveEvent("start", "session.started", {
        model: "gpt-5.5",
        project: "Masthead",
        title: "Build durable data layer"
      })
    );

    expect(db.prepare("SELECT COUNT(*) AS count FROM model_usage").get()).toEqual({ count: 0 });
    db.close();
  });

  test("keeps live ingestion idempotent when a hook event id is replayed with changed message fields", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "codex-test"
    });
    const original = liveEvent("start", "session.started", {
      title: "Original hook title"
    });
    const replayed = {
      ...original,
      occurredAt: "2026-06-24T15:09:00.000Z",
      payload: { title: "Replayed hook title" },
      receivedAt: "2026-06-24T15:09:00.000Z",
      summary: "Replayed hook title"
    };

    repository.upsertLiveEvent(original);
    repository.upsertLiveEvent(replayed);

    expect(db.prepare("SELECT role, text_redacted FROM messages").all()).toEqual([
      { role: "system", text_redacted: "Original hook title" }
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
      canonicalSessionId: sessionId,
      hostId: "host:test",
      title: "Board materialized state",
      sourceSessionId: "live-session",
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

  test("materializes scoped Board projection cards under raw source session identity", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex"
    });
    const event = liveEvent("start", "session.started", { project: "Masthead", title: "Scoped card" });
    const envelope = projectLiveEvents([event], [], { generatedAt: "2026-06-24T15:05:00.000Z" });
    const rawSourceSessionId = "raw/session";
    const projectionSessionId = "codex:raw%2Fsession";
    envelope.projection.cards = envelope.projection.cards.map((card) => ({
      ...card,
      runtime: "codex",
      sessionId: projectionSessionId,
      sourceSessionId: rawSourceSessionId
    }));
    const expectedCanonicalSessionId = canonicalSessionId("host:test", runtimeIdFor("codex", undefined), rawSourceSessionId);

    repository.replaceBoardProjection(envelope.projection, envelope.generatedAt);

    expect(db.prepare("SELECT session_id, source_session_id FROM sessions").all()).toEqual([
      {
        session_id: expectedCanonicalSessionId,
        source_session_id: rawSourceSessionId
      }
    ]);
    const boardRow = db.prepare("SELECT session_id, projection_json FROM board_sessions").get() as {
      projection_json: string;
      session_id: string;
    };
    expect(boardRow.session_id).toBe(expectedCanonicalSessionId);
    expect(JSON.parse(boardRow.projection_json)).toMatchObject({
      canonicalSessionId: expectedCanonicalSessionId,
      sessionId: projectionSessionId,
      sourceSessionId: rawSourceSessionId
    });
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

  test("derives transcript file effects from structured tool calls without storing unsafe absolute paths", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const patchRecord = transcriptRecord("tool_call", {
      arguments: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/ui/SessionCard.tsx",
          "@@",
          "-old",
          "+new",
          "*** Update File: /home/tyler/.ssh/config",
          "@@",
          "-secret",
          "+secret",
          "*** End Patch"
        ].join("\n")
      },
      callId: "call-patch",
      name: "apply_patch",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:11:00.000Z"
    });
    const fileArgRecord = transcriptRecord("tool_call", {
      arguments: {
        filePath: "/workspace/masthead/src/enrichment/enrichmentCoordinator.ts",
        cwd: "/workspace/masthead"
      },
      callId: "call-edit",
      name: "edit",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:12:00.000Z"
    });

    repository.upsertTranscriptRecord(patchRecord);
    repository.upsertTranscriptRecord(patchRecord);
    repository.upsertTranscriptRecord(fileArgRecord);

    expect(db.prepare("SELECT path, effect_kind FROM file_effects ORDER BY path").all()).toEqual([
      { effect_kind: "modified", path: "src/enrichment/enrichmentCoordinator.ts" },
      { effect_kind: "modified", path: "src/ui/SessionCard.tsx" }
    ]);
    db.close();
  });

  test("fills missing transcript usage fields when a source record is reparsed", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const sparseUsageRecord = transcriptRecord("usage", {
      session_id: "historical-session",
      timestamp: "2026-06-24T12:12:00.000Z"
    });
    const enrichedUsageRecord = transcriptRecord("usage", {
      input_tokens: 30,
      model: "gpt-5.5",
      output_tokens: 12,
      session_id: "historical-session",
      timestamp: "2026-06-24T12:12:00.000Z",
      total_tokens: 42
    });

    repository.upsertTranscriptRecord(sparseUsageRecord);
    repository.upsertTranscriptRecord(enrichedUsageRecord);

    expect(db.prepare("SELECT model, input_tokens, output_tokens, total_tokens FROM model_usage").all()).toEqual([
      { input_tokens: 30, model: "gpt-5.5", output_tokens: 12, total_tokens: 42 }
    ]);
    db.close();
  });

  test("upserts transcript tool results, runtime signals, and checkpoints", async () => {
    const db = await openMigratedDatabase();
    const repository = createSessionRepository(db, {
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });
    const toolRecord = transcriptRecord("tool_call", {
      callId: "call-1",
      name: "shell",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:11:00.000Z"
    });
    const resultRecord = transcriptRecord("tool_result", {
      callId: "call-1",
      output: "adapter tests passed",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:11:05.000Z"
    });
    const signalRecord = transcriptRecord("runtime_signal", {
      message: "Recorded the passing adapter test.",
      severity: "info",
      session_id: "historical-session",
      signalKind: "event_msg",
      timestamp: "2026-06-24T12:12:00.000Z"
    });
    const checkpointRecord = transcriptRecord("checkpoint", {
      checkpointId: "checkpoint-1",
      session_id: "historical-session",
      summary: "Earlier parser work was compacted.",
      timestamp: "2026-06-24T12:13:00.000Z"
    });

    repository.upsertTranscriptRecord(toolRecord);
    repository.upsertTranscriptRecord(resultRecord);
    repository.upsertTranscriptRecord(signalRecord);
    repository.upsertTranscriptRecord(checkpointRecord);

    expect(db.prepare("SELECT status, output_redacted FROM tool_results").all()).toEqual([
      { output_redacted: "adapter tests passed", status: "succeeded" }
    ]);
    expect(db.prepare("SELECT signal_kind, severity, title FROM runtime_signals").all()).toEqual([
      { severity: "info", signal_kind: "event_msg", title: "Recorded the passing adapter test." }
    ]);
    expect(db.prepare("SELECT checkpoint_kind, summary FROM checkpoints").all()).toEqual([
      { checkpoint_kind: "compacted", summary: "Earlier parser work was compacted." }
    ]);
    db.close();
  });

  test("ingests adapter records as raw and normalized data transactionally", async () => {
    const db = await openMigratedDatabase();
    const record = transcriptMessageRecord({
      content: "Historical context is reusable.",
      cwd: "/workspace/masthead",
      role: "user",
      session_id: "historical-session",
      timestamp: "2026-06-24T12:10:00.000Z"
    });

    const result = ingestAdapterRecord(db, record, {
      cursor: {
        byteOffset: 128,
        contentFingerprint: "128:1234",
        modifiedAt: "2026-06-24T12:11:00.000Z"
      },
      hostId: "host:test",
      hostname: "masthead-test-host",
      runtimeKind: "codex",
      runtimeVersion: "local-jsonl"
    });

    expect(result.sessionId).toBeDefined();
    expect(db.prepare("SELECT source_record_key, payload_hash FROM raw_events").all()).toEqual([
      { payload_hash: "transcript-hash", source_record_key: "/tmp/historical-session.jsonl:128" }
    ]);
    expect(db.prepare("SELECT role, text_redacted FROM messages").all()).toEqual([
      { role: "user", text_redacted: "Historical context is reusable." }
    ]);
    expect(db.prepare("SELECT project_label FROM sessions").get()).toEqual({ project_label: "masthead" });
    expect(db.prepare("SELECT byte_offset, content_fingerprint FROM ingest_cursors").all()).toEqual([
      { byte_offset: 128, content_fingerprint: "128:1234" }
    ]);
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
