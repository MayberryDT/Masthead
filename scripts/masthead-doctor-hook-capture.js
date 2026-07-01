const CODEX_HOOK_SOURCE_ID = "codex-hook-local";

export function findHookTranscriptStuckSessions(db, options = {}) {
  const candidateLimit = positiveInteger(options.candidateLimit, 10);
  const stuckLimit = positiveInteger(options.stuckLimit, 10);
  const candidates = selectDistinctHookTranscriptCandidates(db, candidateLimit);
  const selectSession = db.prepare(
    `SELECT sessions.session_id AS sessionId,
      sessions.source_session_id AS sourceSessionId,
      sessions.title,
      sessions.last_activity_at AS lastActivityAt
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    WHERE runtimes.runtime_kind = 'codex'
      AND sessions.deleted_at IS NULL
      AND sessions.source_session_id = ?
    ORDER BY sessions.last_activity_at DESC
    LIMIT 1`
  );
  const selectMessages = db.prepare(
    `SELECT
      COUNT(*) AS messages,
      SUM(
        CASE
          WHEN lower(trim(text_redacted)) NOT IN ('codex hook event', 'runtime signal', 'tool call', 'shell', 'unknown')
            AND lower(trim(text_redacted)) NOT LIKE 'codex hook event:%'
          THEN 1
          ELSE 0
        END
      ) AS usefulMessages
    FROM messages
    WHERE session_id = ?`
  );
  const selectUsage = db.prepare(
    `SELECT COUNT(*) AS usageRows, COALESCE(SUM(COALESCE(total_tokens, 0)), 0) AS totalTokens
    FROM model_usage
    WHERE session_id = ?`
  );

  const stuckSessions = [];
  for (const candidate of candidates) {
    const sourceSessionId = stringValue(candidate.sourceSessionId);
    const transcriptPath = stringValue(candidate.transcriptPath);
    if (!sourceSessionId || !transcriptPath) continue;

    const session = selectSession.get(sourceSessionId);
    if (!isRecord(session)) continue;
    const messages = selectMessages.get(session.sessionId);
    const usage = selectUsage.get(session.sessionId);
    const usefulMessages = numberValue(messages?.usefulMessages) ?? 0;
    const usageRows = numberValue(usage?.usageRows) ?? 0;
    if (usefulMessages > 0 || usageRows > 0) continue;

    stuckSessions.push({
      hookObservedAt: candidate.observedAt,
      lastActivityAt: session.lastActivityAt,
      messages: numberValue(messages?.messages) ?? 0,
      sessionId: session.sessionId,
      sourceSessionId,
      title: session.title,
      totalTokens: numberValue(usage?.totalTokens) ?? 0,
      transcriptPath,
      usageRows
    });
    if (stuckSessions.length >= stuckLimit) break;
  }

  return {
    checkedCandidates: candidates.length,
    stuckSessions
  };
}

export function selectDistinctHookTranscriptCandidates(db, limit = 10) {
  return db
    .prepare(
      `WITH candidates AS (
        SELECT
          raw_event_id AS rawEventId,
          observed_at AS observedAt,
          COALESCE(
            json_extract(payload_json, '$.value.sessionId'),
            json_extract(payload_json, '$.value.sourceSessionId'),
            json_extract(payload_json, '$.sessionId'),
            json_extract(payload_json, '$.sourceSessionId')
          ) AS sourceSessionId,
          COALESCE(
            json_extract(payload_json, '$.value.payload.transcriptPath'),
            json_extract(payload_json, '$.value.payload.transcript_path'),
            json_extract(payload_json, '$.payload.transcriptPath'),
            json_extract(payload_json, '$.payload.transcript_path')
          ) AS transcriptPath
        FROM raw_events
        WHERE source_id = ?
          AND source_kind = 'hook'
          AND json_valid(payload_json)
          AND (payload_json LIKE '%"transcriptPath"%' OR payload_json LIKE '%"transcript_path"%')
      ),
      ranked AS (
        SELECT
          rawEventId,
          observedAt,
          sourceSessionId,
          transcriptPath,
          ROW_NUMBER() OVER (
            PARTITION BY sourceSessionId, transcriptPath
            ORDER BY observedAt DESC, rawEventId DESC
          ) AS rowRank
        FROM candidates
        WHERE sourceSessionId IS NOT NULL
          AND transcriptPath IS NOT NULL
      )
      SELECT observedAt, sourceSessionId, transcriptPath
      FROM ranked
      WHERE rowRank = 1
      ORDER BY observedAt DESC, rawEventId DESC
      LIMIT ?`
    )
    .all(CODEX_HOOK_SOURCE_ID, positiveInteger(limit, 10));
}

function positiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
