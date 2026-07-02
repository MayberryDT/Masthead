import type { LiveSessionTranscriptFacts } from "../../core/replay.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type TranscriptFactRow = {
  sourceSessionId: string | null;
  role: string | null;
  text: string | null;
  observedAt: string | null;
};

type LiveProjectionTranscriptFactsOptions = {
  maxMessagesPerSession?: number;
};

export function liveProjectionTranscriptFacts(
  db: MastheadDatabase,
  sourceSessionIds?: Iterable<string>,
  options: LiveProjectionTranscriptFactsOptions = {}
): Map<string, LiveSessionTranscriptFacts> {
  const scopedSourceSessionIds = sourceSessionIds ? [...new Set([...sourceSessionIds].filter(Boolean))] : undefined;
  if (scopedSourceSessionIds && scopedSourceSessionIds.length === 0) return new Map();

  const sourceSessionFilter = scopedSourceSessionIds ? `AND sessions.source_session_id IN (${scopedSourceSessionIds.map(() => "?").join(", ")})` : "";
  const rows = db
    .prepare(
      `SELECT
        sessions.source_session_id AS sourceSessionId,
        messages.role AS role,
        messages.text_redacted AS text,
        messages.observed_at AS observedAt
      FROM messages
      JOIN sessions ON sessions.session_id = messages.session_id
      WHERE messages.role IN ('user', 'assistant')
        AND trim(COALESCE(messages.text_redacted, '')) <> ''
        ${sourceSessionFilter}
      ORDER BY sessions.source_session_id ASC, COALESCE(messages.observed_at, '') DESC, messages.message_id DESC`
    )
    .all(...(scopedSourceSessionIds ?? [])) as TranscriptFactRow[];

  const maxMessagesPerSession = Math.max(1, Math.min(options.maxMessagesPerSession ?? 24, 48));
  const factsBySourceSession = new Map<string, LiveSessionTranscriptFacts>();
  for (const row of rows) {
    const sourceSessionId = row.sourceSessionId?.trim();
    const role = normalizeRole(row.role);
    const text = row.text?.replace(/\s+/g, " ").trim();
    if (!sourceSessionId || !role || !text || isLowValueLiveTranscriptText(text, role)) continue;

    const facts = factsBySourceSession.get(sourceSessionId) ?? { recentMessages: [] };
    if (facts.recentMessages.length >= maxMessagesPerSession) {
      factsBySourceSession.set(sourceSessionId, facts);
      continue;
    }

    facts.recentMessages.push({
      observedAt: row.observedAt ?? "",
      role,
      text
    });
    factsBySourceSession.set(sourceSessionId, facts);
  }
  return factsBySourceSession;
}

function normalizeRole(role: string | null): "user" | "assistant" | undefined {
  if (role === "user" || role === "assistant") return role;
  return undefined;
}

function isLowValueLiveTranscriptText(value: string, role: "user" | "assistant"): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (/^(codex hook event|runtime signal|unknown|shell)$/i.test(normalized)) return true;
  if (role !== "assistant") return false;
  return false;
}
