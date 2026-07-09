import { getSessionTranscript } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { ProvenanceCandidateSummary, WorkbenchEvidencePacket, WorkbenchOutputKind } from "./types.ts";

const MAX_MULTI_SESSION_PROVENANCE = 12;
const MAX_TRANSCRIPT_ITEMS_PER_SESSION = 40;

type WorkbenchEvidenceSessionRow = {
  sessionId: string;
  sourceSessionId: string;
  project: string | null;
  runtime: string;
  lifecycle: string;
  startedAt: string | null;
  lastActivityAt: string;
  endedAt: string | null;
  title: string | null;
};

type TextRow = {
  text: string;
};

export function buildWorkbenchEvidencePacket(
  db: MastheadDatabase,
  options: {
    sessionId: string;
    kind: WorkbenchOutputKind;
    maxTranscriptItems?: number;
    provenanceSessionIds?: string[];
  }
): WorkbenchEvidencePacket {
  const provenanceSessionIds = normalizeProvenanceSet(options.sessionId, options.provenanceSessionIds);
  if (provenanceSessionIds.length === 1) {
    return buildSingleSessionPacket(db, {
      kind: options.kind,
      maxTranscriptItems: options.maxTranscriptItems,
      sessionId: provenanceSessionIds[0]!
    });
  }
  return buildMultiSessionPacket(db, {
    kind: options.kind,
    maxTranscriptItems: options.maxTranscriptItems ?? MAX_TRANSCRIPT_ITEMS_PER_SESSION,
    provenanceSessionIds,
    seedSessionId: options.sessionId
  });
}

export function listProvenanceCandidateSummaries(
  db: MastheadDatabase,
  options: { seedSessionId: string; limit?: number; project?: string }
): ProvenanceCandidateSummary[] {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 25), 50));
  const params: string[] = [];
  const clauses = ["sessions.deleted_at IS NULL", "sessions.session_id <> ?"];
  params.push(options.seedSessionId);
  if (options.project) {
    clauses.push("sessions.project_label = ?");
    params.push(options.project);
  }
  const rows = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.lifecycle AS lifecycle,
        sessions.started_at AS startedAt,
        sessions.last_activity_at AS lastActivityAt,
        sessions.ended_at AS endedAt,
        COALESCE(session_enrichments.title, sessions.title) AS title
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      LEFT JOIN session_enrichments ON session_enrichments.session_id = sessions.session_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY sessions.last_activity_at DESC
      LIMIT ?`
    )
    .all(...params, limit) as WorkbenchEvidenceSessionRow[];

  return rows.map((row) => ({
    errorHints: errorHintsForSession(db, row.sessionId),
    fileHints: fileHintsForSession(db, row.sessionId),
    lastActivityAt: row.lastActivityAt,
    project: row.project ?? undefined,
    runtime: row.runtime,
    sessionId: row.sessionId,
    title: row.title ?? undefined,
    topics: topicsForSession(db, row.sessionId)
  }));
}

function buildSingleSessionPacket(
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
      ref: item.itemId,
      sessionId: options.sessionId
    })),
    packetVersion: "workbench-evidence-v1",
    provenanceSessionIds: [options.sessionId],
    session: sessionSummary(detail, db),
    sourceRefs,
    timeline: transcript.items.map((item) => ({
      kind: item.kind,
      observedAt: item.observedAt,
      ref: item.itemId,
      sessionId: options.sessionId,
      summary: item.text
    })),
    tools: toolItems.map((item) => ({
      exitCode: item.exitCode,
      name: item.toolName ?? item.text,
      observedAt: item.observedAt,
      outputPreview: item.kind === "tool_result" ? item.text : undefined,
      ref: item.itemId,
      sessionId: options.sessionId,
      status: item.status
    })),
    transcript: transcriptItems.map((item) => ({
      observedAt: item.observedAt,
      ref: item.itemId,
      role: item.role,
      sessionId: options.sessionId,
      text: item.text
    })),
    verification: toolItems
      .filter((item) => item.status === "succeeded" || item.status === "failed")
      .map((item) => ({
        evidence: item.text,
        label: item.toolName ?? item.text,
        ref: item.itemId,
        sessionId: options.sessionId,
        status: item.status === "succeeded" ? "passed" : "failed"
      })),
    warnings: []
  };
}

function buildMultiSessionPacket(
  db: MastheadDatabase,
  options: {
    seedSessionId: string;
    provenanceSessionIds: string[];
    kind: WorkbenchOutputKind;
    maxTranscriptItems: number;
  }
): WorkbenchEvidencePacket {
  if (options.provenanceSessionIds.length > MAX_MULTI_SESSION_PROVENANCE) {
    throw new Error(`Provenance set exceeds max of ${MAX_MULTI_SESSION_PROVENANCE} sessions`);
  }

  const packets = options.provenanceSessionIds.map((sessionId) =>
    buildSingleSessionPacket(db, {
      kind: options.kind,
      maxTranscriptItems: options.maxTranscriptItems,
      sessionId
    })
  );
  const seed = packets.find((packet) => packet.session.sessionId === options.seedSessionId) ?? packets[0];
  if (!seed) throw new Error("Empty provenance set");

  const coverage = {
    assistantMessages: 0,
    checkpoints: 0,
    fileEffects: 0,
    hasUsableTranscript: false,
    messages: 0,
    tokenUsageRows: 0,
    toolCalls: 0,
    toolResults: 0,
    userMessages: 0
  };
  const files: WorkbenchEvidencePacket["files"] = [];
  const tools: WorkbenchEvidencePacket["tools"] = [];
  const transcript: WorkbenchEvidencePacket["transcript"] = [];
  const verification: WorkbenchEvidencePacket["verification"] = [];
  const timeline: WorkbenchEvidencePacket["timeline"] = [];
  const sourceRefs: string[] = [];
  const warnings: string[] = [];
  const sessions: WorkbenchEvidencePacket["sessions"] = [];

  for (const packet of packets) {
    coverage.assistantMessages += packet.coverage.assistantMessages;
    coverage.checkpoints += packet.coverage.checkpoints;
    coverage.fileEffects += packet.coverage.fileEffects;
    coverage.hasUsableTranscript = coverage.hasUsableTranscript || packet.coverage.hasUsableTranscript;
    coverage.messages += packet.coverage.messages;
    coverage.toolCalls += packet.coverage.toolCalls;
    coverage.toolResults += packet.coverage.toolResults;
    coverage.userMessages += packet.coverage.userMessages;
    files.push(...packet.files);
    tools.push(...packet.tools);
    transcript.push(...packet.transcript);
    verification.push(...packet.verification);
    timeline.push(...packet.timeline);
    sourceRefs.push(...packet.sourceRefs);
    warnings.push(...packet.warnings);
    sessions.push(packet.session);
  }

  return {
    coverage,
    files,
    packetVersion: "workbench-evidence-multi-v1",
    provenanceSessionIds: options.provenanceSessionIds,
    session: seed.session,
    sessions,
    sourceRefs,
    timeline,
    tools,
    transcript,
    verification,
    warnings
  };
}

function normalizeProvenanceSet(seedSessionId: string, provenanceSessionIds?: string[]): string[] {
  const raw = provenanceSessionIds?.length ? provenanceSessionIds : [seedSessionId];
  const unique = Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)));
  if (!unique.includes(seedSessionId)) unique.unshift(seedSessionId);
  return unique;
}

function sessionSummary(detail: WorkbenchEvidenceSessionRow, db: MastheadDatabase): WorkbenchEvidencePacket["session"] {
  return {
    endedAt: detail.endedAt ?? undefined,
    lastActivityAt: detail.lastActivityAt,
    lifecycle: detail.lifecycle,
    models: modelsForSession(db, detail.sessionId),
    project: detail.project ?? undefined,
    runtime: detail.runtime,
    sessionId: detail.sessionId,
    sourceSessionId: detail.sourceSessionId,
    startedAt: detail.startedAt ?? undefined
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
        sessions.ended_at AS endedAt,
        sessions.title AS title
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

function topicsForSession(db: MastheadDatabase, sessionId: string): string[] {
  const row = db
    .prepare(`SELECT topics_json AS topicsJson FROM session_enrichments WHERE session_id = ?`)
    .get(sessionId) as { topicsJson: string } | undefined;
  if (!row?.topicsJson) return [];
  try {
    const parsed = JSON.parse(row.topicsJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function errorHintsForSession(db: MastheadDatabase, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT text AS text
       FROM messages
       WHERE session_id = ?
         AND (text LIKE '%error%' OR text LIKE '%Error%' OR text LIKE '%failed%')
       ORDER BY observed_at DESC
       LIMIT 5`
    )
    .all(sessionId) as TextRow[];
  return rows.map((row) => row.text.slice(0, 120));
}

function fileHintsForSession(db: MastheadDatabase, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT path AS text
       FROM file_effects
       WHERE session_id = ?
       ORDER BY observed_at DESC
       LIMIT 8`
    )
    .all(sessionId) as TextRow[];
  return rows.map((row) => row.text);
}
