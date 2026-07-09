import { getSessionTranscript } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { WorkbenchEvidencePacket, WorkbenchOutputKind } from "./types.ts";

type WorkbenchEvidenceSessionRow = {
  sessionId: string;
  sourceSessionId: string;
  project: string | null;
  runtime: string;
  lifecycle: string;
  startedAt: string | null;
  lastActivityAt: string;
  endedAt: string | null;
};

type TextRow = {
  text: string;
};

export function buildWorkbenchEvidencePacket(
  db: MastheadDatabase,
  options: { sessionId: string; kind: WorkbenchOutputKind; maxTranscriptItems?: number }
): WorkbenchEvidencePacket {
  const detail = getWorkbenchEvidenceSession(db, options.sessionId);
  if (!detail) throw new Error(`Session not found: ${options.sessionId}`);
  const transcript = getSessionTranscript(db, { sessionId: options.sessionId, limit: options.maxTranscriptItems ?? 80 });
  const transcriptItems = transcript.items.filter((item) => item.kind === "message");
  const fileItems = transcript.items.filter((item) => item.kind === "file_effect");
  const toolItems = transcript.items.filter((item) => item.kind === "tool_call" || item.kind === "tool_result");
  const sourceRefs = [
    ...transcriptItems.map((item) => item.itemId),
    ...fileItems.map((item) => item.itemId),
    ...toolItems.map((item) => item.itemId)
  ];

  return {
    coverage: {
      assistantMessages: transcript.coverage.assistantMessages,
      checkpoints: transcript.coverage.checkpoints,
      fileEffects: transcript.coverage.fileEffects,
      hasUsableTranscript: transcript.coverage.hasUsableTranscript,
      messages: transcript.coverage.messages,
      tokenUsageRows: 0,
      toolCalls: transcript.coverage.toolCalls,
      toolResults: transcript.coverage.toolResults,
      userMessages: transcript.coverage.userMessages
    },
    files: fileItems.map((item) => ({
      displayPath: item.text,
      effectKind: item.label,
      path: item.text,
      ref: item.itemId
    })),
    packetVersion: "workbench-evidence-v1",
    session: {
      endedAt: detail.endedAt ?? undefined,
      lastActivityAt: detail.lastActivityAt,
      lifecycle: detail.lifecycle,
      models: modelsForSession(db, options.sessionId),
      project: detail.project ?? undefined,
      runtime: detail.runtime,
      sessionId: detail.sessionId,
      sourceSessionId: detail.sourceSessionId,
      startedAt: detail.startedAt ?? undefined
    },
    sourceRefs,
    timeline: transcript.items.map((item) => ({
      kind: item.kind,
      observedAt: item.observedAt,
      ref: item.itemId,
      summary: item.text
    })),
    tools: toolItems.map((item) => ({
      exitCode: item.exitCode,
      name: item.toolName ?? item.text,
      observedAt: item.observedAt,
      outputPreview: item.kind === "tool_result" ? item.text : undefined,
      ref: item.itemId,
      status: item.status
    })),
    transcript: transcriptItems.map((item) => ({
      observedAt: item.observedAt,
      ref: item.itemId,
      role: item.role,
      text: item.text
    })),
    verification: toolItems
      .filter((item) => item.status === "succeeded" || item.status === "failed")
      .map((item) => ({
        evidence: item.text,
        label: item.toolName ?? item.text,
        ref: item.itemId,
        status: item.status === "succeeded" ? "passed" : "failed"
      })),
    warnings: []
  };
}

function getWorkbenchEvidenceSession(db: MastheadDatabase, sessionId: string): WorkbenchEvidenceSessionRow | undefined {
  return db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.lifecycle AS lifecycle,
        sessions.started_at AS startedAt,
        sessions.last_activity_at AS lastActivityAt,
        sessions.ended_at AS endedAt
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(sessionId) as WorkbenchEvidenceSessionRow | undefined;
}

function modelsForSession(db: MastheadDatabase, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT model AS text
      FROM model_usage
      WHERE session_id = ?
        AND model IS NOT NULL
        AND trim(model) <> ''
      ORDER BY model`
    )
    .all(sessionId) as TextRow[];
  return rows.map((row) => row.text);
}
