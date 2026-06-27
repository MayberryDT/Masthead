import type { EvidenceRef } from "../core/types.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { SessionFacts } from "./sessionCompiler.ts";
import { buildSessionNarrativeFacts } from "./sessionNarrativeFacts.ts";

type SessionRow = {
  session_id: string;
  title: string | null;
  objective: string | null;
  project_label: string | null;
  source_session_id: string;
};

type TextRow = {
  text: string;
  observedAt: string;
};

export function buildSessionFacts(db: MastheadDatabase, sessionId: string): SessionFacts {
  const session = db
    .prepare(
      `SELECT session_id, title, objective, project_label, source_session_id
      FROM sessions
      WHERE session_id = ? AND deleted_at IS NULL`
    )
    .get(sessionId) as SessionRow | undefined;
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const messages = db
    .prepare(
      `SELECT text_redacted AS text, observed_at AS observedAt
      FROM messages
      WHERE session_id = ?
      ORDER BY observed_at ASC
      LIMIT 24`
    )
    .all(sessionId) as TextRow[];
  const commands = db
    .prepare("SELECT DISTINCT tool_name AS text, COALESCE(started_at, '') AS observedAt FROM tool_calls WHERE session_id = ? ORDER BY tool_name")
    .all(sessionId) as TextRow[];
  const files = db
    .prepare("SELECT DISTINCT path AS text, observed_at AS observedAt FROM file_effects WHERE session_id = ? ORDER BY path")
    .all(sessionId) as TextRow[];
  const checkpoints = db
    .prepare("SELECT summary AS text, observed_at AS observedAt FROM checkpoints WHERE session_id = ? ORDER BY observed_at DESC LIMIT 6")
    .all(sessionId) as TextRow[];

  return {
    commands: commands.map((row) => row.text),
    evidence: evidenceRefs(sessionId, [...messages, ...commands, ...files, ...checkpoints]),
    files: files.map((row) => row.text),
    messages: [...messages, ...checkpoints].map((row) => row.text),
    narrative: buildSessionNarrativeFacts(db, sessionId),
    objective: session.objective ?? undefined,
    project: session.project_label ?? session.source_session_id,
    sessionId,
    sourceSessionId: session.source_session_id,
    title: session.title ?? ""
  };
}

function evidenceRefs(sessionId: string, rows: TextRow[]): EvidenceRef[] {
  return rows.slice(0, 24).map((row, index) => ({
    id: `${sessionId}:fact:${index}`,
    kind: "event",
    observedAt: row.observedAt || new Date(0).toISOString(),
    source: "masthead.canonical"
  }));
}
