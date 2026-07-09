import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { AdapterRecord } from "../../adapters/types.ts";
import { redactJsonValue, redactText } from "../../core/redaction.ts";
import type { LiveBoardProjection, NormalizedEvent } from "../../core/types.ts";
import { canonicalSessionId, runtimeIdFor } from "../../shared/sessionIdentity.ts";
import { upsertSessionSource } from "./sessionSourceRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { deriveTranscriptFileEffects } from "./transcriptEffects.ts";
import { enrollWorkbenchSession } from "./workbenchPipelineRepository.ts";

export { canonicalSessionId, runtimeIdFor } from "../../shared/sessionIdentity.ts";

export type SessionRepositoryContext = {
  hostId: string;
  hostname?: string;
  runtimeKind: string;
  runtimeVersion?: string;
};

export type AdapterIngestionContext = SessionRepositoryContext & {
  cursor?: {
    byteOffset: number;
    modifiedAt?: string;
    contentFingerprint?: string;
    sourceSessionId?: string;
    cwd?: string;
    model?: string;
  };
};

export type AdapterIngestionResult = {
  sessionId?: string;
  created?: boolean;
};

export type SessionRepository = {
  replaceBoardProjection(projection: LiveBoardProjection, updatedAt: string): void;
  upsertLiveEvent(event: NormalizedEvent): string | undefined;
  upsertMetadataRecord(record: AdapterRecord): string | undefined;
  upsertTranscriptRecord(record: AdapterRecord): string | undefined;
};

export function createSessionRepository(db: MastheadDatabase, context: SessionRepositoryContext): SessionRepository {
  const runtimeId = runtimeIdFor(context.runtimeKind, context.runtimeVersion);

  const ensureHostRuntime = (observedAt: string): void => {
    db.prepare(
      `INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(host_id) DO UPDATE SET
        hostname = excluded.hostname,
        last_seen_at = excluded.last_seen_at`
    ).run(context.hostId, context.hostname ?? null, observedAt, observedAt);
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(runtime_id) DO UPDATE SET
        runtime_version = excluded.runtime_version,
        last_seen_at = excluded.last_seen_at`
    ).run(runtimeId, context.runtimeKind, context.runtimeVersion ?? null, observedAt, observedAt);
  };

  const upsertLiveEvent = (event: NormalizedEvent): string | undefined => {
    if (!event.sessionId) return undefined;
    ensureHostRuntime(event.occurredAt);
    const sourceSessionId = event.sessionId;
    const sessionId = canonicalSessionId(context.hostId, runtimeId, sourceSessionId);
    upsertSession(event, sessionId, sourceSessionId);
    upsertTurn(event, sessionId);
    upsertMessage(event, sessionId);
    upsertToolCall(event, sessionId);
    upsertToolResult(event, sessionId);
    upsertFileEffect(event, sessionId);
    upsertRuntimeSignal(event, sessionId);
    upsertModelUsage(event, sessionId);
    afterSessionMaterialized(db, sessionId, "live_ingest");
    return sessionId;
  };

  const replaceBoardProjection = (projection: LiveBoardProjection, updatedAt: string): void => {
    ensureHostRuntime(updatedAt);
    const upsertSessionStub = db.prepare(
      `INSERT INTO sessions (
        session_id,
        host_id,
        runtime_id,
        source_session_id,
        project_label,
        title,
        lifecycle,
        outcome_label,
        started_at,
        last_activity_at,
        source_confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_id, runtime_id, source_session_id) DO UPDATE SET
        project_label = COALESCE(sessions.project_label, excluded.project_label),
        title = COALESCE(sessions.title, excluded.title),
        lifecycle = CASE
          WHEN sessions.lifecycle = 'unknown' THEN excluded.lifecycle
          ELSE sessions.lifecycle
        END,
        outcome_label = COALESCE(sessions.outcome_label, excluded.outcome_label),
        last_activity_at = MAX(sessions.last_activity_at, excluded.last_activity_at),
        updated_at = excluded.updated_at`
    );
    const upsert = db.prepare(
      `INSERT INTO board_sessions (session_id, projection_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        projection_json = excluded.projection_json,
        updated_at = excluded.updated_at`
    );
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const card of projection.cards) {
        const sourceSessionId = card.sourceSessionId ?? card.sessionId;
        const sessionId = canonicalSessionId(context.hostId, runtimeId, sourceSessionId);
        const canonicalCard = {
          ...card,
          canonicalSessionId: sessionId,
          hostId: context.hostId,
          runtime: context.runtimeKind,
          sourceSessionId
        };
        upsertSessionStub.run(
          sessionId,
          context.hostId,
          runtimeId,
          sourceSessionId,
          card.project,
          card.title,
          card.lifecycle,
          card.outcomeLabel ?? null,
          card.startedAt ?? null,
          updatedAt,
          "inferred",
          updatedAt,
          updatedAt
        );
        upsert.run(sessionId, JSON.stringify(canonicalCard), updatedAt);
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  };

  const upsertMetadataRecord = (record: AdapterRecord): string | undefined => {
    const value = metadataValue(record.normalized.value);
    if (!value.sessionId) return undefined;
    const observedAt = value.observedAt ?? record.observedAt;
    ensureHostRuntime(observedAt);
    const sessionId = canonicalSessionId(context.hostId, runtimeId, value.sessionId);
    db.prepare(
      `INSERT INTO sessions (
        session_id,
        host_id,
        runtime_id,
        source_session_id,
        project_label,
        title,
        lifecycle,
        started_at,
        last_activity_at,
        source_confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_id, runtime_id, source_session_id) DO UPDATE SET
        project_label = COALESCE(sessions.project_label, excluded.project_label),
        title = COALESCE(sessions.title, excluded.title),
        last_activity_at = MAX(sessions.last_activity_at, excluded.last_activity_at),
        updated_at = excluded.updated_at`
    ).run(
      sessionId,
      context.hostId,
      runtimeId,
      value.sessionId,
      value.project ?? null,
      value.title ?? null,
      "unknown",
      observedAt,
      observedAt,
      record.normalized.confidence,
      record.observedAt,
      record.observedAt
    );
    return sessionId;
  };

  const upsertTranscriptRecord = (record: AdapterRecord): string | undefined => {
    const value = transcriptValue(record.normalized.value, record.source.path);
    if (!value.sessionId) return undefined;
    const observedAt = value.observedAt ?? record.observedAt;
    ensureHostRuntime(observedAt);
    const sessionId = canonicalSessionId(context.hostId, runtimeId, value.sessionId);
    db.prepare(
      `INSERT INTO sessions (
        session_id,
        host_id,
        runtime_id,
        source_session_id,
        project_label,
        lifecycle,
        last_activity_at,
        source_confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_id, runtime_id, source_session_id) DO UPDATE SET
        project_label = COALESCE(sessions.project_label, excluded.project_label),
        last_activity_at = MAX(sessions.last_activity_at, excluded.last_activity_at),
        updated_at = excluded.updated_at`
    ).run(sessionId, context.hostId, runtimeId, value.sessionId, value.project ?? null, "unknown", observedAt, record.normalized.confidence, record.observedAt, record.observedAt);
    if (record.normalized.kind === "message" && value.role && value.text) {
      const textRedacted = redactText(value.text);
      db.prepare(
        `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`
      ).run(
        messageId(sessionId, record.sourceRecordKey, value.role),
        sessionId,
        value.role,
        textRedacted,
        hash(textRedacted),
        observedAt,
        transcriptSourceRefJson(record),
        record.normalized.confidence
      );
      return sessionId;
    }
    if (record.normalized.kind === "tool_call") {
      db.prepare(
        `INSERT INTO tool_calls (tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tool_call_id) DO NOTHING`
      ).run(
        toolCallIdFromRecord(sessionId, record),
        sessionId,
        value.toolName ?? "tool",
        JSON.stringify(redactJsonValue(value.arguments ?? {})),
        observedAt,
        transcriptSourceRefJson(record)
      );
      upsertTranscriptFileEffects(record, sessionId, value);
      return sessionId;
    }
    if (record.normalized.kind === "usage") {
      db.prepare(
        `INSERT INTO model_usage (
          usage_id,
          session_id,
          model,
          provider,
          input_tokens,
          output_tokens,
          total_tokens,
          cost_micros,
          observed_at,
          source_ref_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(usage_id) DO UPDATE SET
          model = COALESCE(model_usage.model, excluded.model),
          provider = COALESCE(model_usage.provider, excluded.provider),
          input_tokens = COALESCE(model_usage.input_tokens, excluded.input_tokens),
          output_tokens = COALESCE(model_usage.output_tokens, excluded.output_tokens),
          total_tokens = COALESCE(model_usage.total_tokens, excluded.total_tokens),
          cost_micros = COALESCE(model_usage.cost_micros, excluded.cost_micros)`
      ).run(
        modelUsageIdFromRecord(sessionId, record),
        sessionId,
        value.model ?? null,
        value.provider ?? null,
        value.inputTokens ?? null,
        value.outputTokens ?? null,
        value.totalTokens ?? null,
        null,
        observedAt,
        transcriptSourceRefJson(record)
      );
      return sessionId;
    }
    if (record.normalized.kind === "tool_result") {
      const outputRedacted = value.output ? redactText(value.output) : null;
      db.prepare(
        `INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tool_result_id) DO NOTHING`
      ).run(
        toolResultIdFromRecord(sessionId, record),
        toolCallIdFromRecord(sessionId, record),
        sessionId,
        value.status ?? (value.exitCode === undefined || value.exitCode === 0 ? "succeeded" : "failed"),
        outputRedacted,
        outputRedacted ? hash(outputRedacted) : null,
        value.exitCode ?? null,
        observedAt,
        transcriptSourceRefJson(record)
      );
      return sessionId;
    }
    if (record.normalized.kind === "runtime_signal") {
      db.prepare(
        `INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(signal_id) DO NOTHING`
      ).run(
        transcriptSignalIdFromRecord(sessionId, record),
        sessionId,
        value.signalKind ?? "runtime_signal",
        value.severity ?? null,
        redactText(value.message ?? value.summary ?? "Runtime signal"),
        JSON.stringify(redactJsonValue(record.normalized.value)),
        observedAt,
        transcriptSourceRefJson(record)
      );
      return sessionId;
    }
    if (record.normalized.kind === "checkpoint") {
      db.prepare(
        `INSERT INTO checkpoints (checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(checkpoint_id) DO NOTHING`
      ).run(
        transcriptCheckpointIdFromRecord(sessionId, record, value.checkpointId),
        sessionId,
        value.checkpointKind ?? "compacted",
        redactText(value.summary ?? "Checkpoint"),
        observedAt,
        transcriptSourceRefJson(record)
      );
      return sessionId;
    }
    return undefined;
  };

  const upsertSession = (event: NormalizedEvent, sessionId: string, sourceSessionId: string): void => {
    const title = stringPayload(event, ["title"]) ?? (event.type === "session.started" ? event.summary : undefined);
    const objective = stringPayload(event, ["objective"]);
    const projectLabel = stringPayload(event, ["project"]) ?? (event.type === "session.started" ? projectLabelFromWorkspace(event) : undefined);
    db.prepare(
      `INSERT INTO sessions (
        session_id,
        host_id,
        runtime_id,
        source_session_id,
        project_label,
        repo_root,
        worktree_path,
        branch,
        title,
        objective,
        lifecycle,
        outcome_label,
        started_at,
        last_activity_at,
        ended_at,
        source_confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_id, runtime_id, source_session_id) DO UPDATE SET
        project_label = COALESCE(sessions.project_label, excluded.project_label),
        repo_root = COALESCE(excluded.repo_root, sessions.repo_root),
        worktree_path = COALESCE(excluded.worktree_path, sessions.worktree_path),
        branch = COALESCE(excluded.branch, sessions.branch),
        title = COALESCE(sessions.title, excluded.title),
        objective = COALESCE(sessions.objective, excluded.objective),
        lifecycle = CASE
          WHEN excluded.lifecycle = 'ended' THEN excluded.lifecycle
          WHEN sessions.lifecycle = 'ended' THEN sessions.lifecycle
          ELSE excluded.lifecycle
        END,
        outcome_label = CASE
          WHEN sessions.lifecycle = 'ended' AND excluded.lifecycle != 'ended' THEN sessions.outcome_label
          ELSE COALESCE(excluded.outcome_label, sessions.outcome_label)
        END,
        last_activity_at = MAX(sessions.last_activity_at, excluded.last_activity_at),
        ended_at = CASE
          WHEN sessions.lifecycle = 'ended' AND excluded.lifecycle != 'ended' THEN sessions.ended_at
          ELSE COALESCE(excluded.ended_at, sessions.ended_at)
        END,
        updated_at = excluded.updated_at`
    ).run(
      sessionId,
      context.hostId,
      runtimeId,
      sourceSessionId,
      projectLabel ?? null,
      event.workspace?.repoRoot ?? null,
      event.workspace?.worktreePath ?? event.workspace?.cwd ?? null,
      event.workspace?.branch ?? null,
      title ?? null,
      objective ?? null,
      event.type === "session.completed" ? "ended" : "running",
      event.type === "session.completed" ? "completed" : null,
      event.type === "session.started" ? event.occurredAt : null,
      event.occurredAt,
      event.type === "session.completed" ? event.occurredAt : null,
      "authoritative",
      event.receivedAt,
      event.receivedAt
    );
  };

  const upsertTurn = (event: NormalizedEvent, sessionId: string): void => {
    db.prepare(
      `INSERT INTO turns (turn_id, session_id, source_turn_id, turn_index, role, started_at, ended_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, turn_index, role, source_turn_id) DO NOTHING`
    ).run(
      turnId(sessionId, event.eventId),
      sessionId,
      event.eventId,
      turnIndex(event),
      roleForEvent(event),
      event.occurredAt,
      terminalEventTypes.has(event.type) ? event.occurredAt : null,
      sourceRefJson(event)
    );
  };

  const upsertMessage = (event: NormalizedEvent, sessionId: string): void => {
    const role = messageRoleForEvent(event);
    const text = messageTextForEvent(event);
    if (!role || !text) return;
    db.prepare(
      `INSERT INTO messages (message_id, session_id, turn_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`
    ).run(messageId(sessionId, event.eventId, role), sessionId, turnId(sessionId, event.eventId), role, text, hash(text), event.occurredAt, sourceRefJson(event), "authoritative");
  };

  const upsertToolCall = (event: NormalizedEvent, sessionId: string): void => {
    if (event.type !== "command.started" && event.type !== "command.finished") return;
    db.prepare(
      `INSERT INTO tool_calls (tool_call_id, session_id, turn_id, tool_name, arguments_redacted_json, started_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tool_call_id) DO UPDATE SET
        turn_id = COALESCE(tool_calls.turn_id, excluded.turn_id),
        tool_name = CASE
          WHEN tool_calls.started_at IS NULL OR excluded.started_at < tool_calls.started_at THEN excluded.tool_name
          ELSE tool_calls.tool_name
        END,
        arguments_redacted_json = CASE
          WHEN tool_calls.arguments_redacted_json IS NULL OR tool_calls.started_at IS NULL OR excluded.started_at < tool_calls.started_at
            THEN excluded.arguments_redacted_json
          ELSE tool_calls.arguments_redacted_json
        END,
        started_at = CASE
          WHEN tool_calls.started_at IS NULL OR excluded.started_at < tool_calls.started_at THEN excluded.started_at
          ELSE tool_calls.started_at
        END,
        source_ref_json = CASE
          WHEN tool_calls.started_at IS NULL OR excluded.started_at < tool_calls.started_at THEN excluded.source_ref_json
          ELSE tool_calls.source_ref_json
        END`
    ).run(
      toolCallId(sessionId, event),
      sessionId,
      turnId(sessionId, event.eventId),
      stringPayload(event, ["category", "toolName"]) ?? "command",
      JSON.stringify({
        command: stringPayload(event, ["normalizedCommand", "command"]),
        commandId: stringPayload(event, ["commandId"])
      }),
      event.occurredAt,
      sourceRefJson(event)
    );
  };

  const upsertToolResult = (event: NormalizedEvent, sessionId: string): void => {
    if (event.type !== "command.finished") return;
    const exitCode = numberPayload(event, ["exitCode"]);
    db.prepare(
      `INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tool_result_id) DO NOTHING`
    ).run(
      toolResultId(sessionId, event),
      toolCallId(sessionId, event),
      sessionId,
      exitCode === undefined ? "unknown" : exitCode === 0 ? "succeeded" : "failed",
      null,
      null,
      exitCode ?? null,
      event.occurredAt,
      sourceRefJson(event)
    );
  };

  const upsertFileEffect = (event: NormalizedEvent, sessionId: string): void => {
    if (event.type !== "file.changed") return;
    const paths = filePathsForEvent(event);
    const insert = db.prepare(
      `INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, path, effect_kind, observed_at) DO NOTHING`
    );
    for (const path of paths) {
      insert.run(fileEffectId(sessionId, event, path), sessionId, path, stringPayload(event, ["effectKind", "status"]) ?? "modified", 0, null, null, event.occurredAt, sourceRefJson(event));
    }
  };

  const upsertTranscriptFileEffects = (record: AdapterRecord, sessionId: string, value: ReturnType<typeof transcriptValue>): void => {
    const effects = deriveTranscriptFileEffects({
      arguments: value.arguments,
      cwd: value.cwd,
      repoRoot: value.repoRoot,
      toolName: value.toolName,
      worktreePath: value.worktreePath
    });
    if (effects.length === 0) return;
    const insert = db.prepare(
      `INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, path, effect_kind, observed_at) DO NOTHING`
    );
    for (const effect of effects) {
      insert.run(
        transcriptFileEffectId(sessionId, record, effect.path, effect.effectKind),
        sessionId,
        effect.path,
        effect.effectKind,
        0,
        null,
        null,
        value.observedAt ?? record.observedAt,
        transcriptSourceRefJson(record)
      );
    }
  };

  const upsertRuntimeSignal = (event: NormalizedEvent, sessionId: string): void => {
    const signal = runtimeSignalForEvent(event);
    if (!signal) return;
    db.prepare(
      `INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signal_id) DO NOTHING`
    ).run(
      runtimeSignalId(sessionId, event, signal.kind),
      sessionId,
      signal.kind,
      signal.severity,
      signal.title,
      JSON.stringify(event.payload),
      event.occurredAt,
      sourceRefJson(event)
    );
  };

  const upsertModelUsage = (event: NormalizedEvent, sessionId: string): void => {
    const model = stringPayload(event, ["model", "modelName", "modelId"]);
    const provider = stringPayload(event, ["provider"]);
    const inputTokens = numberPayload(event, ["inputTokens", "promptTokens"]);
    const outputTokens = numberPayload(event, ["outputTokens", "completionTokens"]);
    const totalTokens = numberPayload(event, ["totalTokens"]);
    const hasTokenNumbers = inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined;
    if (!hasTokenNumbers) return;
    db.prepare(
      `INSERT INTO model_usage (
        usage_id,
        session_id,
        model,
        provider,
        input_tokens,
        output_tokens,
        total_tokens,
        cost_micros,
        observed_at,
        source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(usage_id) DO UPDATE SET
        model = COALESCE(model_usage.model, excluded.model),
        provider = COALESCE(model_usage.provider, excluded.provider),
        input_tokens = COALESCE(model_usage.input_tokens, excluded.input_tokens),
        output_tokens = COALESCE(model_usage.output_tokens, excluded.output_tokens),
        total_tokens = COALESCE(model_usage.total_tokens, excluded.total_tokens),
        cost_micros = COALESCE(model_usage.cost_micros, excluded.cost_micros)`
    ).run(
      modelUsageId(sessionId, event),
      sessionId,
      model ?? null,
      provider ?? null,
      inputTokens ?? null,
      outputTokens ?? null,
      totalTokens ?? null,
      null,
      event.occurredAt,
      sourceRefJson(event)
    );
  };

  return {
    replaceBoardProjection,
    upsertLiveEvent,
    upsertMetadataRecord,
    upsertTranscriptRecord
  };
}

export function ingestAdapterRecord(db: MastheadDatabase, record: AdapterRecord, context: AdapterIngestionContext): AdapterIngestionResult {
  const repository = createSessionRepository(db, context);
  let sessionId: string | undefined;
  const predictedSessionId = predictedCanonicalSessionId(record, context);
  const sessionExistedBefore = predictedSessionId ? sessionExists(db, predictedSessionId) : undefined;

  db.exec("BEGIN IMMEDIATE;");
  try {
    upsertAdapterSource(db, record);
    insertRawAdapterRecord(db, record);
    sessionId =
      record.normalized.kind === "event" || record.normalized.kind === "session"
        ? repository.upsertMetadataRecord(record)
        : repository.upsertTranscriptRecord(record);
    if (sessionId) {
      upsertSessionSource(db, {
        importedRecordCount: 1,
        observedAt: record.observedAt,
        sessionId,
        sourceId: record.source.sourceId
      });
    }
    if (context.cursor) upsertAdapterCursor(db, record, context.cursor);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  if (sessionId) {
    afterSessionMaterialized(db, sessionId, "session_materialize");
  }

  return { created: sessionId ? !sessionExistedBefore : undefined, sessionId };
}

/** Auto-enroll a newly materialized session onto the Workbench publish path (idempotent). */
function afterSessionMaterialized(
  db: MastheadDatabase,
  sessionId: string,
  actorId: "live_ingest" | "session_materialize"
): void {
  enrollWorkbenchSession(db, { actor: { kind: "system", id: actorId }, sessionId });
}

function predictedCanonicalSessionId(record: AdapterRecord, context: AdapterIngestionContext): string | undefined {
  const runtimeId = runtimeIdFor(context.runtimeKind, context.runtimeVersion);
  const value =
    record.normalized.kind === "event" || record.normalized.kind === "session"
      ? metadataValue(record.normalized.value)
      : transcriptValue(record.normalized.value, record.source.path);
  return value.sessionId ? canonicalSessionId(context.hostId, runtimeId, value.sessionId) : undefined;
}

function sessionExists(db: MastheadDatabase, sessionId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sessions WHERE session_id = ?").get(sessionId));
}

const terminalEventTypes = new Set<NormalizedEvent["type"]>(["command.finished", "file.changed", "session.completed", "turn.completed"]);

function turnId(sessionId: string, eventId: string): string {
  return `turn:${hash(`${sessionId}\0${eventId}`)}`;
}

function messageId(sessionId: string, eventId: string, role: string): string {
  return `message:${hash(`${sessionId}\0${eventId}\0${role}`)}`;
}

function toolCallId(sessionId: string, event: NormalizedEvent): string {
  return `tool_call:${hash(`${sessionId}\0${stringPayload(event, ["commandId"]) ?? event.eventId}`)}`;
}

function toolResultId(sessionId: string, event: NormalizedEvent): string {
  return `tool_result:${hash(`${sessionId}\0${event.eventId}`)}`;
}

function fileEffectId(sessionId: string, event: NormalizedEvent, path: string): string {
  return `file_effect:${hash(`${sessionId}\0${event.eventId}\0${path}`)}`;
}

function runtimeSignalId(sessionId: string, event: NormalizedEvent, kind: string): string {
  return `signal:${hash(`${sessionId}\0${event.eventId}\0${kind}`)}`;
}

function modelUsageId(sessionId: string, event: NormalizedEvent): string {
  return `usage:${hash(`${sessionId}\0${stringPayload(event, ["usageId", "usage_id"]) ?? event.eventId}`)}`;
}

function turnIndex(event: NormalizedEvent): number {
  return Number.parseInt(hash(event.eventId).slice(0, 12), 16);
}

function roleForEvent(event: NormalizedEvent): string {
  if (event.type === "user.question" || event.type === "user.response") return "user";
  if (event.type === "session.started") return "system";
  if (event.type === "session.completed" || event.type === "turn.completed") return "assistant";
  return "tool";
}

function messageRoleForEvent(event: NormalizedEvent): string | undefined {
  if (event.type === "user.question" || event.type === "user.response") return "user";
  if (event.type === "session.started") return "system";
  if (event.type === "session.completed" || event.type === "turn.completed") return "assistant";
  return undefined;
}

function messageTextForEvent(event: NormalizedEvent): string | undefined {
  if (event.type === "user.question" || event.type === "user.response") return stringPayload(event, ["message", "question", "summary"]) ?? event.summary;
  if (event.type === "session.started") return stringPayload(event, ["title", "objective"]) ?? event.summary;
  if (event.type === "session.completed" || event.type === "turn.completed") return stringPayload(event, ["outcome", "summary"]) ?? event.summary;
  return undefined;
}

function filePathsForEvent(event: NormalizedEvent): string[] {
  const path = stringPayload(event, ["path", "filePath"]);
  if (path) return [path];
  const paths = event.payload.paths ?? event.payload.files;
  return Array.isArray(paths) ? paths.filter((candidate): candidate is string => typeof candidate === "string") : [];
}

function runtimeSignalForEvent(event: NormalizedEvent): { kind: string; severity: string; title: string } | undefined {
  if (event.type === "approval.requested") {
    return { kind: event.type, severity: "warning", title: event.summary };
  }
  if (event.type === "user.question") {
    return { kind: event.type, severity: "info", title: event.summary };
  }
  if (event.type === "command.finished" && numberPayload(event, ["exitCode"]) !== undefined && numberPayload(event, ["exitCode"]) !== 0) {
    return { kind: "command.failed", severity: "error", title: event.summary };
  }
  return undefined;
}

function sourceRefJson(event: NormalizedEvent): string {
  return JSON.stringify({
    confidence: "authoritative",
    eventId: event.eventId,
    sourceKind: event.source.surface,
    sourceRuntime: event.source.adapter,
    sourceVersion: event.schemaVersion
  });
}

function projectLabelFromWorkspace(event: NormalizedEvent): string | undefined {
  return event.workspace?.repoRoot?.split("/").filter(Boolean).at(-1);
}

function stringPayload(event: NormalizedEvent, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function numberPayload(event: NormalizedEvent, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = event.payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function upsertAdapterSource(db: MastheadDatabase, record: AdapterRecord): void {
  const now = record.observedAt;
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id,
      adapter,
      source_kind,
      source_path,
      endpoint,
      schema_version,
      runtime_version,
      confidence,
      discovered_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_path = COALESCE(excluded.source_path, ingest_sources.source_path),
      endpoint = COALESCE(excluded.endpoint, ingest_sources.endpoint),
      schema_version = COALESCE(excluded.schema_version, ingest_sources.schema_version),
      runtime_version = COALESCE(excluded.runtime_version, ingest_sources.runtime_version),
      confidence = excluded.confidence,
      last_seen_at = excluded.last_seen_at`
  ).run(
    record.source.sourceId,
    record.source.runtime,
    record.source.sourceKind,
    record.source.path ?? null,
    record.source.endpoint ?? null,
    record.source.schemaVersion ?? null,
    record.source.runtimeVersion ?? null,
    record.source.confidence,
    now,
    now
  );
}

function insertRawAdapterRecord(db: MastheadDatabase, record: AdapterRecord): void {
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id,
      source_id,
      source_record_key,
      observed_at,
      received_at,
      source_kind,
      source_path,
      payload_hash,
      payload_json,
      adapter_diagnostics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, source_record_key) DO NOTHING`
  ).run(
    `raw:${hash(`${record.source.sourceId}\0${record.sourceRecordKey}`)}`,
    record.source.sourceId,
    record.sourceRecordKey,
    record.observedAt,
    new Date().toISOString(),
    record.source.sourceKind,
    record.source.path ?? record.normalized.sourceRef.sourcePath ?? null,
    record.payloadHash,
    JSON.stringify(record.payload),
    record.diagnostics.length > 0 ? JSON.stringify(record.diagnostics) : null
  );
}

function upsertAdapterCursor(
  db: MastheadDatabase,
  record: AdapterRecord,
  cursor: NonNullable<AdapterIngestionContext["cursor"]>
): void {
  const sourcePath = record.source.path ?? record.normalized.sourceRef.sourcePath;
  db.prepare(
    `INSERT INTO ingest_cursors (
      cursor_id,
      source_id,
      source_path,
      byte_offset,
      modified_at,
      content_fingerprint,
      source_session_id,
      cwd,
      model,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, source_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      modified_at = excluded.modified_at,
      content_fingerprint = excluded.content_fingerprint,
      source_session_id = COALESCE(excluded.source_session_id, ingest_cursors.source_session_id),
      cwd = COALESCE(excluded.cwd, ingest_cursors.cwd),
      model = COALESCE(excluded.model, ingest_cursors.model),
      updated_at = excluded.updated_at`
  ).run(
    `cursor:${hash(`${record.source.sourceId}\0${sourcePath ?? ""}`)}`,
    record.source.sourceId,
    sourcePath ?? null,
    cursor.byteOffset,
    cursor.modifiedAt ?? null,
    cursor.contentFingerprint ?? null,
    cursor.sourceSessionId ?? null,
    cursor.cwd ?? null,
    cursor.model ?? null,
    new Date().toISOString()
  );
}

function metadataValue(value: unknown): {
  observedAt?: string;
  project?: string;
  sessionId?: string;
  title?: string;
} {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    observedAt: stringValue(record.observedAt),
    project: stringValue(record.project) ?? projectLabelFromPath(stringValue(record.cwd) ?? stringValue(record.repoRoot) ?? stringValue(record.repo_root)),
    sessionId: stringValue(record.sessionId),
    title: stringValue(record.title)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function projectLabelFromPath(path: string | undefined): string | undefined {
  return path ? basename(path) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function transcriptValue(
  value: unknown,
  sourcePath: string | undefined
): {
  arguments?: unknown;
  cwd?: string;
  inputTokens?: number;
  model?: string;
  observedAt?: string;
  project?: string;
  outputTokens?: number;
  provider?: string;
  repoRoot?: string;
  role?: string;
  sessionId?: string;
  callId?: string;
  checkpointId?: string;
  checkpointKind?: string;
  exitCode?: number;
  message?: string;
  output?: string;
  severity?: string;
  signalKind?: string;
  status?: string;
  summary?: string;
  text?: string;
  toolName?: string;
  totalTokens?: number;
  worktreePath?: string;
} {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    observedAt: stringValue(record.timestamp) ?? stringValue(record.created_at) ?? stringValue(record.createdAt),
    role: stringValue(record.role),
    sessionId:
      stringValue(record.session_id) ??
      stringValue(record.sessionId) ??
      stringValue(record.conversation_id) ??
      stringValue(record.conversationId) ??
      (sourcePath?.endsWith(".jsonl") ? basename(sourcePath, ".jsonl") : undefined),
    project: stringValue(record.project) ?? projectLabelFromPath(stringValue(record.cwd) ?? stringValue(record.repoRoot) ?? stringValue(record.repo_root)),
    cwd: stringValue(record.cwd),
    repoRoot: stringValue(record.repoRoot) ?? stringValue(record.repo_root),
    worktreePath: stringValue(record.worktreePath) ?? stringValue(record.worktree_path),
    text: stringValue(record.content) ?? stringValue(record.text) ?? stringValue(record.message),
    toolName: stringValue(record.name) ?? stringValue(record.tool_name) ?? stringValue(record.toolName),
    arguments: record.arguments ?? record.args ?? record.input,
    callId: stringValue(record.callId) ?? stringValue(record.call_id),
    checkpointId: stringValue(record.checkpointId) ?? stringValue(record.checkpoint_id),
    checkpointKind: stringValue(record.checkpointKind) ?? stringValue(record.checkpoint_kind),
    exitCode: numberValue(record.exitCode) ?? numberValue(record.exit_code),
    message: stringValue(record.message) ?? stringValue(record.title),
    output: stringValue(record.output) ?? stringValue(record.content),
    severity: stringValue(record.severity) ?? stringValue(record.level),
    signalKind: stringValue(record.signalKind) ?? stringValue(record.signal_kind),
    status: stringValue(record.status),
    summary: stringValue(record.summary) ?? stringValue(record.text),
    model: stringValue(record.model) ?? stringValue(record.modelName),
    provider: stringValue(record.provider),
    inputTokens: numberValue(record.input_tokens) ?? numberValue(record.inputTokens) ?? usageNumber(record, "input_tokens"),
    outputTokens: numberValue(record.output_tokens) ?? numberValue(record.outputTokens) ?? usageNumber(record, "output_tokens"),
    totalTokens: numberValue(record.total_tokens) ?? numberValue(record.totalTokens) ?? usageNumber(record, "total_tokens")
  };
}

function usageNumber(record: Record<string, unknown>, key: string): number | undefined {
  const usage = record.usage;
  return typeof usage === "object" && usage !== null ? numberValue((usage as Record<string, unknown>)[key]) : undefined;
}

function transcriptSourceRefJson(record: AdapterRecord): string {
  return JSON.stringify([
    {
      ...record.normalized.sourceRef,
      payloadHash: record.payloadHash,
      sourceRecordKey: record.sourceRecordKey
    }
  ]);
}

function toolCallIdFromRecord(sessionId: string, record: AdapterRecord): string {
  const value = transcriptValue(record.normalized.value, record.source.path);
  return `tool_call:${hash(`${sessionId}\0${value.callId ?? record.sourceRecordKey}`)}`;
}

function toolResultIdFromRecord(sessionId: string, record: AdapterRecord): string {
  return `tool_result:${hash(`${sessionId}\0${record.sourceRecordKey}`)}`;
}

function transcriptSignalIdFromRecord(sessionId: string, record: AdapterRecord): string {
  return `signal:${hash(`${sessionId}\0${record.sourceRecordKey}`)}`;
}

function transcriptCheckpointIdFromRecord(sessionId: string, record: AdapterRecord, checkpointId: string | undefined): string {
  return `checkpoint:${hash(`${sessionId}\0${checkpointId ?? record.sourceRecordKey}`)}`;
}

function transcriptFileEffectId(sessionId: string, record: AdapterRecord, path: string, effectKind: string): string {
  return `file_effect:${hash(`${sessionId}\0${record.sourceRecordKey}\0${path}\0${effectKind}`)}`;
}

function modelUsageIdFromRecord(sessionId: string, record: AdapterRecord): string {
  return `usage:${hash(`${sessionId}\0${record.sourceRecordKey}`)}`;
}
