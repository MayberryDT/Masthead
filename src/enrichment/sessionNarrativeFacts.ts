import { basename, extname } from "node:path/posix";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import { classifyWorkSubject, normalizeTopic, topicFromEvidence } from "./workSubject.ts";

export type NarrativeFileFact = {
  path: string;
  basename: string;
  directory: string;
  extension?: string;
  operation?: string;
};

export type NarrativeCommandFact = {
  name: string;
  category?: string;
  status?: string;
  exitCode?: number;
  outputPreview?: string;
  startedAt?: string;
  completedAt?: string;
};

export type SessionNarrativeCoverageFacts = {
  hasUsableTranscript: boolean;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  fileEffects: number;
  tokenUsageRows: number;
  level: "complete" | "partial" | "hook_only" | "metadata_only";
};

export type SessionNarrativeFacts = {
  sessionId: string;
  sourceSessionId?: string;
  project?: string;
  runtime?: string;
  model?: string;
  branch?: string;
  repoRoot?: string;
  worktreePath?: string;
  storedTitle?: string;
  objective?: string;
  firstUserPrompt?: string;
  lastUserPrompt?: string;
  finalAssistantMessage?: string;
  latestFeedbackSummary?: string;
  checkpointSummaries: string[];
  files: NarrativeFileFact[];
  fileDirectories: string[];
  fileBasenames: string[];
  commands: NarrativeCommandFact[];
  coverage: SessionNarrativeCoverageFacts;
  testsPassed: boolean;
  testsFailed: boolean;
  buildPassed: boolean;
  buildFailed: boolean;
  deployMentioned: boolean;
  eventSummaries: string[];
  topics: string[];
  technologies: string[];
};

type NarrativeSessionRow = {
  sessionId: string;
  sourceSessionId: string;
  project: string | null;
  runtime: string;
  model: string | null;
  branch: string | null;
  repoRoot: string | null;
  worktreePath: string | null;
  storedTitle: string | null;
  objective: string | null;
};

type TextRow = { text: string };
type FileRow = { path: string; operation: string | null };
type CommandRow = {
  name: string;
  category: string | null;
  status: string | null;
  exitCode: number | null;
  outputPreview: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export function buildSessionNarrativeFacts(db: MastheadDatabase, sessionId: string): SessionNarrativeFacts {
  const session = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        (SELECT model FROM model_usage WHERE model_usage.session_id = sessions.session_id AND model IS NOT NULL ORDER BY observed_at DESC LIMIT 1) AS model,
        sessions.branch AS branch,
        sessions.repo_root AS repoRoot,
        sessions.worktree_path AS worktreePath,
        sessions.title AS storedTitle,
        sessions.objective AS objective
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id = ? AND sessions.deleted_at IS NULL`
    )
    .get(sessionId) as NarrativeSessionRow | undefined;
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const firstUserPrompt = oneText(db, "SELECT text_redacted AS text FROM messages WHERE session_id = ? AND role = 'user' ORDER BY observed_at ASC LIMIT 1", sessionId);
  const lastUserPrompt = oneText(db, "SELECT text_redacted AS text FROM messages WHERE session_id = ? AND role = 'user' ORDER BY observed_at DESC LIMIT 1", sessionId);
  const finalAssistantMessage = oneText(
    db,
    "SELECT text_redacted AS text FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY observed_at DESC LIMIT 1",
    sessionId
  );
  const checkpointSummaries = allText(
    db,
    "SELECT summary AS text FROM checkpoints WHERE session_id = ? ORDER BY observed_at DESC LIMIT 6",
    sessionId
  );
  const eventSummaries = allText(
    db,
    "SELECT title AS text FROM runtime_signals WHERE session_id = ? ORDER BY observed_at DESC LIMIT 10",
    sessionId
  ).filter((summary) => !isLowValueRuntimeSignal(summary));
  const latestFeedbackSummary = eventSummaries.find((summary) => /feedback|completion|done|review/i.test(summary));

  const files = (
    db
      .prepare("SELECT DISTINCT path, effect_kind AS operation FROM file_effects WHERE session_id = ? ORDER BY path LIMIT 50")
      .all(sessionId) as FileRow[]
  ).map((row) => fileFactFromPath(row.path, row.operation ?? undefined));
  const commands = db
    .prepare(
      `SELECT DISTINCT
        tool_calls.tool_name AS name,
        NULL AS category,
        COALESCE(tool_results.status, '') AS status,
        tool_results.exit_code AS exitCode,
        tool_results.output_redacted AS outputPreview,
        tool_calls.started_at AS startedAt,
        tool_results.completed_at AS completedAt
      FROM tool_calls
      LEFT JOIN tool_results ON tool_results.tool_call_id = tool_calls.tool_call_id
      WHERE tool_calls.session_id = ?
      ORDER BY tool_calls.tool_name
      LIMIT 50`
    )
    .all(sessionId) as CommandRow[];

  const commandText = commands.map((command) => `${command.name} ${command.status ?? ""}`).join(" ");
  const summaryText = [session.objective, firstUserPrompt, finalAssistantMessage, latestFeedbackSummary, ...checkpointSummaries, ...eventSummaries].join(" ");
  const coverage = buildCoverageFacts(db, sessionId);
  const topics = unique([
    ...[summaryText, ...files.map((file) => `${file.directory} ${file.basename}`)].map(topicFromEvidence).filter(isString),
    ...topDirectories(files).map(normalizeTopic)
  ]);

  return {
    branch: session.branch ?? undefined,
    buildFailed: /\b(build|compile)\b/i.test(commandText) && /\b(failed|failure|error)\b/i.test(commandText),
    buildPassed: /\b(build|compile)\b/i.test(commandText) && /\b(succeeded|success|passed|ok)\b/i.test(commandText),
    checkpointSummaries,
    commands: commands.map((command) => ({
      category: command.category ?? commandCategory(command.name),
      ...(command.completedAt ? { completedAt: command.completedAt } : {}),
      ...(command.exitCode !== null ? { exitCode: command.exitCode } : {}),
      name: command.name,
      ...(command.outputPreview ? { outputPreview: safeOutputPreview(command.outputPreview) } : {}),
      ...(command.startedAt ? { startedAt: command.startedAt } : {}),
      status: command.status || undefined
    })),
    coverage,
    deployMentioned: /\bdeploy|deployed|deployment|netlify|vercel\b/i.test(`${summaryText} ${commandText}`),
    eventSummaries,
    fileBasenames: unique(files.map((file) => file.basename)),
    fileDirectories: topDirectories(files),
    files,
    finalAssistantMessage,
    firstUserPrompt,
    lastUserPrompt,
    latestFeedbackSummary,
    model: session.model ?? undefined,
    objective: session.objective ?? undefined,
    project: session.project ?? undefined,
    repoRoot: session.repoRoot ?? undefined,
    runtime: session.runtime,
    sessionId,
    sourceSessionId: session.sourceSessionId,
    storedTitle: session.storedTitle ?? undefined,
    technologies: unique(files.map((file) => technologyFromExtension(file.extension)).filter(isString)),
    testsFailed: /\b(test|spec|smoke|verify|verification)\b/i.test(commandText) && /\b(failed|failure|error)\b/i.test(commandText),
    testsPassed: /\b(test|spec|smoke|verify|verification)\b/i.test(commandText) && /\b(succeeded|success|passed|ok)\b/i.test(commandText),
    topics,
    worktreePath: session.worktreePath ?? undefined
  };
}

export function isLowValueRuntimeSignal(value: string): boolean {
  return /^(codex hook event|runtime signal|unknown|shell|approval\.requested|P\d)$/i.test(value.trim());
}

export function fileFactFromPath(path: string, operation?: string): NarrativeFileFact {
  const safePath = sanitizePath(path);
  const extension = extname(safePath).replace(/^\./, "") || undefined;
  return {
    basename: safeBasename(safePath),
    directory: safeDirectory(safePath),
    ...(extension ? { extension } : {}),
    ...(operation ? { operation } : {}),
    path: safePath
  };
}

export function safeBasename(path: string): string {
  const name = basename(sanitizePath(path)).replace(/\.[a-z0-9]+$/i, "");
  return readablePhrase(name.replace(/[0-9a-f]{12,}/gi, "")) || "file";
}

export function safeDirectory(path: string): string {
  const parts = sanitizePath(path).split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).filter((part) => !isPrivateSegment(part)).slice(-2).join("/");
}

export function topDirectories(files: NarrativeFileFact[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!file.directory) continue;
    counts.set(file.directory, (counts.get(file.directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([directory]) => directory);
}

export function technologyFromExtension(extension: string | undefined): string | undefined {
  if (!extension) return undefined;
  const normalized = extension.toLowerCase();
  if (normalized === "ts" || normalized === "tsx") return "TypeScript";
  if (normalized === "rs") return "Rust";
  if (normalized === "sql") return "SQLite";
  if (normalized === "css") return "CSS";
  if (normalized === "md" || normalized === "mdx") return "Markdown";
  if (normalized === "json") return "JSON";
  if (normalized === "yml" || normalized === "yaml") return "YAML";
  return undefined;
}

export function narrativeWorkArea(facts: Pick<SessionNarrativeFacts, "objective" | "firstUserPrompt" | "finalAssistantMessage" | "fileBasenames" | "fileDirectories" | "branch" | "project">) {
  return classifyWorkSubject({
    branch: facts.branch,
    fileBasenames: facts.fileBasenames,
    fileDirectories: facts.fileDirectories,
    project: facts.project,
    texts: [facts.objective, facts.firstUserPrompt, facts.finalAssistantMessage].filter(isString)
  });
}

function oneText(db: MastheadDatabase, sql: string, sessionId: string): string | undefined {
  return (db.prepare(sql).get(sessionId) as TextRow | undefined)?.text || undefined;
}

function allText(db: MastheadDatabase, sql: string, sessionId: string): string[] {
  return (db.prepare(sql).all(sessionId) as TextRow[]).map((row) => row.text).filter(Boolean);
}

function sanitizePath(path: string): string {
  const trimmed = path.replace(/\\/g, "/").replace(/\s+/g, " ").trim();
  const parts = trimmed.split("/").filter(Boolean);
  const relativeStart = Math.max(parts.findIndex((part) => ["src", "docs", "tests", "fixtures", "scripts", ".github"].includes(part)), 0);
  return parts.slice(relativeStart).filter((part) => !isPrivateSegment(part)).join("/");
}

function isPrivateSegment(value: string): boolean {
  return /^(home|users?|tyler|root|tmp|var|private)$/i.test(value) || /^[0-9a-f]{12,}$/i.test(value);
}

function commandCategory(name: string): string | undefined {
  if (/test|vitest|smoke|verify|check/i.test(name)) return "test";
  if (/build|tsc|cargo/i.test(name)) return "build";
  if (/deploy|netlify|vercel/i.test(name)) return "deploy";
  return undefined;
}

function buildCoverageFacts(db: MastheadDatabase, sessionId: string): SessionNarrativeCoverageFacts {
  const transcript = getTranscriptCoverage(db, sessionId);
  const tokenUsageRows = countRows(db, "model_usage", sessionId);
  const level = coverageLevel({
    fileEffects: transcript.fileEffects,
    hasUsableTranscript: transcript.hasUsableTranscript,
    runtimeSignals: transcript.runtimeSignals,
    toolCalls: transcript.toolCalls
  });
  return {
    assistantMessages: transcript.assistantMessages,
    fileEffects: transcript.fileEffects,
    hasUsableTranscript: transcript.hasUsableTranscript,
    level,
    messageCount: transcript.messages,
    tokenUsageRows,
    toolCalls: transcript.toolCalls,
    userMessages: transcript.userMessages
  };
}

function coverageLevel(input: {
  hasUsableTranscript: boolean;
  fileEffects: number;
  toolCalls: number;
  runtimeSignals: number;
}): SessionNarrativeCoverageFacts["level"] {
  if (input.hasUsableTranscript && input.fileEffects > 0 && input.toolCalls > 0) return "complete";
  if (input.hasUsableTranscript || input.fileEffects > 0 || input.toolCalls > 0) return "partial";
  if (input.runtimeSignals > 0) return "hook_only";
  return "metadata_only";
}

function countRows(db: MastheadDatabase, table: string, sessionId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`).get(sessionId) as { count: number }).count;
}

function safeOutputPreview(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function readablePhrase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
