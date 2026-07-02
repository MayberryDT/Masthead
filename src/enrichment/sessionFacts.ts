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

type MessageRow = TextRow & {
  role: string;
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

  const rawMessages = db
    .prepare(
      `SELECT role, text_redacted AS text, observed_at AS observedAt
      FROM messages
      WHERE session_id = ?
        AND role IN ('user', 'assistant')
        AND trim(COALESCE(text_redacted, '')) <> ''
      ORDER BY observed_at ASC
      `
    )
    .all(sessionId) as MessageRow[];
  const messages = rawMessages.flatMap((row): MessageRow[] => {
    const text = cleanEvidenceText(row.text);
    return text ? [{ ...row, text }] : [];
  });
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
    userEvidence: messages.filter((row) => row.role === "user").map((row) => row.text),
    assistantEvidence: messages.filter((row) => row.role === "assistant").map((row) => row.text),
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

function cleanEvidenceText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let text = value;
  text = extractDelegatedInput(text);
  text = removeLeadingAgentInstructions(text);
  text = removeKnownRawBlocks(text);
  text = removeLooseRawBlocks(text);
  text = removeXmlTags(text);
  text = text.replace(/\s+/g, " ").trim();
  if (!text || isLowValueEvidenceText(text) || isRawSystemContextText(text)) return undefined;
  return text;
}

function extractDelegatedInput(value: string): string {
  return value.replace(/<codex_delegation\b[^>]*>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/gi, "$1");
}

function removeLeadingAgentInstructions(value: string): string {
  if (!/^\s*# AGENTS\.md instructions\b/i.test(value)) return value;
  const delegationStart = value.search(/<codex_delegation\b/i);
  if (delegationStart >= 0) return value.slice(delegationStart);
  const environmentEnd = value.search(/<\/environment_context>/i);
  if (environmentEnd >= 0) return value.slice(environmentEnd + "</environment_context>".length);
  return "";
}

function removeKnownRawBlocks(value: string): string {
  return ["INSTRUCTIONS", "environment_context", "project-doc", "system", "developer"].reduce((text, tag) => {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    return text.replace(pattern, " ");
  }, value);
}

function removeLooseRawBlocks(value: string): string {
  return value
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, " ")
    .replace(/<app-context>[\s\S]*?<\/app-context>/gi, " ")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, " ")
    .replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/gi, " ")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, " ")
    .replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/gi, " ");
}

function removeXmlTags(value: string): string {
  return value.replace(/<\/?[a-z][\w:-]*(?:\s+[^>]*)?>/gi, " ");
}

function isLowValueEvidenceText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "codex hook event" || normalized.startsWith("codex hook event:") || normalized === "runtime signal";
}

function isRawSystemContextText(value: string): boolean {
  return [
    "Filesystem sandboxing defines which files can be read or written.",
    "# Codex Behavioral Guidelines",
    "Knowledge cutoff:",
    "Current date:",
    "You are Codex,",
    "You are an AI assistant"
  ].some((prefix) => value.startsWith(prefix));
}
