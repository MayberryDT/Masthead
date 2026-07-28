import { createHash } from "node:crypto";
import { hasSemanticRedactedText } from "../../core/redaction.ts";
import type {
  SessionTranscriptItem,
  SessionTranscriptKind,
  SessionTranscriptOrder,
  SessionTranscriptRole
} from "../../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringEvidenceManifest,
  WorkbenchAuthoringEvidencePage
} from "../../shared/workbenchAuthoring.ts";
import {
  getCompleteSessionTranscriptPage,
  iterateSessionTranscriptItems,
  type SessionTranscriptRowIdCutoffs,
  type SessionTranscriptKindFilter
} from "../../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";

const transcriptKinds: SessionTranscriptKind[] = [
  "message",
  "tool_call",
  "tool_result",
  "file_effect",
  "checkpoint",
  "runtime_signal"
];

export type AuthoringEvidenceRevisionInput = {
  sessionId: string;
  sessionDigest: `sha256:${string}`;
};

export type AuthoringEvidenceSessionSnapshot = {
  evidence: WorkbenchAuthoringEvidenceManifest["sessions"][number];
  revisionInput: AuthoringEvidenceRevisionInput;
  usableCanonicalEvidence: boolean;
};

export type CapturedAuthoringEvidenceSession = AuthoringEvidenceSessionSnapshot & {
  items: SessionTranscriptItem[];
};

export type AuthoringEvidenceSnapshot = {
  manifest: WorkbenchAuthoringEvidenceManifest;
  sessions: AuthoringEvidenceSessionSnapshot[];
};

export function getAuthoringEvidenceManifest(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchAuthoringEvidenceManifest {
  return collectAuthoringEvidenceSnapshot(db, normalizedSessionIds(sessionIds)).manifest;
}

export function getAuthoringEvidenceSnapshot(
  db: MastheadDatabase,
  sessionIds: string[]
): AuthoringEvidenceSnapshot {
  return collectAuthoringEvidenceSnapshot(db, strictSessionIds(sessionIds));
}

export function captureAuthoringEvidenceSession(
  db: MastheadDatabase,
  sessionId: string,
  rowIdCutoffs?: SessionTranscriptRowIdCutoffs
): CapturedAuthoringEvidenceSession {
  const items = [...iterateSessionTranscriptItems(db, { order: "asc", rowIdCutoffs, sessionId })];
  return { ...authoringEvidenceSessionSnapshot(sessionId, items), items };
}

export function hasUsableAuthoringEvidence(db: MastheadDatabase, sessionId: string): boolean {
  for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
    if (isUsableAuthoringEvidenceItem(item)) return true;
  }
  return false;
}

export function hasUsableAuthoringEvidenceItems(items: SessionTranscriptItem[]): boolean {
  return items.some(isUsableAuthoringEvidenceItem);
}

/**
 * Minimal shape for scaffold catalog ranking. Accepts canonical transcript items
 * and V5 catalog rows without requiring every SessionTranscriptItem field.
 */
export type ScaffoldEvidenceCatalogItemLike = {
  itemId?: string;
  id?: string;
  kind: SessionTranscriptKind | string;
  role?: SessionTranscriptRole | string | null;
  text?: string | null;
  narrativeText?: string | null;
  lowValue?: boolean | null;
  observedAt?: string | null;
};

/**
 * Rank evidence for scaffold presentation: substantive user/assistant messages
 * first; demote instruction dumps and approval/JSON noise. Never drops items so
 * inspect coverage membership stays complete when the same set is ranked.
 */
export function rankScaffoldEvidenceCatalogItems<T extends ScaffoldEvidenceCatalogItemLike>(
  items: readonly T[]
): T[] {
  return items
    .map((item, index) => ({ index, item, score: scaffoldEvidenceCatalogScore(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}

export function isDemotedScaffoldEvidenceItem(item: ScaffoldEvidenceCatalogItemLike): boolean {
  if (item.lowValue === true) return true;
  const text = scaffoldEvidenceText(item);
  if (!text) return false;
  if (isAgentsOrSkillInstructionDump(text)) return true;
  if (isDeveloperSandboxPolicyText(text)) return true;
  if (isApprovalAssessmentWrapperText(text)) return true;
  if (isPureJsonAssistantAllowText(text, item.role, item.kind)) return true;
  return false;
}

export function guidedAuthoringEvidenceRevisionFromInputs(
  inputs: AuthoringEvidenceRevisionInput[]
): string {
  if (inputs.length === 0) throw new Error("Guided authoring evidence revision inputs must not be empty.");
  const normalized = strictRevisionInputs(inputs);
  const hash = createHash("sha256");
  for (const { sessionDigest, sessionId } of normalized) {
    hash.update(`${JSON.stringify({ sessionId, sessionDigest })}\n`);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function guidedAuthoringEvidenceRevision(
  db: MastheadDatabase,
  sessionIds: string[]
): string {
  return guidedAuthoringEvidenceRevisionFromInputs(guidedAuthoringEvidenceRevisionInputs(db, sessionIds));
}

/**
 * The guided workflow needs a durable change token, not a second full replay of
 * every selected transcript. Canonical transcript-table mutations advance this
 * per-session revision in SQLite, so composing it here detects the same class
 * of evidence changes while keeping large Workbench selections bounded.
 */
export function guidedAuthoringEvidenceRevisionInputs(
  db: MastheadDatabase,
  sessionIds: string[]
): AuthoringEvidenceRevisionInput[] {
  const normalized = strictSessionIds(sessionIds);
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT sessions.session_id AS sessionId,
            COALESCE(revisions.source_revision, 0) AS sourceRevision,
            runtimes.runtime_kind AS runtimeKind
     FROM sessions
     JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
     LEFT JOIN workbench_artifact_candidate_source_revisions revisions
       ON revisions.session_id = sessions.session_id
     WHERE sessions.session_id IN (${placeholders})`
  ).all(...normalized) as Array<{ sessionId: string; sourceRevision: number; runtimeKind: string }>;
  const revisionBySessionId = new Map(rows.map((row) => [row.sessionId, row]));
  return normalized.map((sessionId) => {
    const revision = revisionBySessionId.get(sessionId);
    const hash = createHash("sha256");
    hash.update(JSON.stringify({
      runtimeKind: revision?.runtimeKind ?? "",
      sessionId,
      sourceRevision: revision?.sourceRevision ?? 0
    }));
    return { sessionDigest: `sha256:${hash.digest("hex")}`, sessionId };
  });
}

export function getAuthoringEvidencePage(
  db: MastheadDatabase,
  query: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    query?: string;
    order?: SessionTranscriptOrder;
  }
): WorkbenchAuthoringEvidencePage {
  const result = getCompleteSessionTranscriptPage(db, {
    cursor: query.cursor,
    kind: query.kind,
    limit: Math.max(1, Math.min(query.limit ?? 100, 250)),
    order: query.order,
    q: query.query,
    sessionId: query.sessionId
  });
  return {
    evidenceRevision: authoringEvidenceRevision(db, [query.sessionId]),
    items: result.items,
    nextCursor: result.nextCursor,
    sessionId: query.sessionId,
    total: result.total
  };
}

export function getAuthoringValidationEvidenceByRef(
  db: MastheadDatabase,
  sessionIds: string[]
): Map<string, WorkbenchValidationEvidence> {
  const evidence = new Map<string, WorkbenchValidationEvidence>();
  for (const sessionId of sessionIds) {
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      evidence.set(item.itemId, {
        exitCode: item.exitCode,
        kind: item.kind,
        label: item.label,
        lowValue: item.lowValue ?? false,
        observedAt: item.observedAt,
        role: item.role,
        sessionId,
        status: item.status,
        text: item.kind === "file_effect"
          ? `${item.label} ${item.text}`
          : item.kind === "message"
            ? (item.narrativeText ?? item.text)
            : item.text,
        toolName: item.toolName
      });
    }
  }
  return evidence;
}

export function authoringEvidenceRevision(db: MastheadDatabase, sessionIds: string[]): string {
  return collectAuthoringEvidenceSnapshot(db, normalizedSessionIds(sessionIds)).manifest.evidenceRevision;
}

function collectAuthoringEvidenceSnapshot(
  db: MastheadDatabase,
  sessionIds: string[]
): AuthoringEvidenceSnapshot {
  const legacyHash = createHash("sha256");
  const sessions: AuthoringEvidenceSessionSnapshot[] = [];
  for (const sessionId of sessionIds) {
    const captured = captureAuthoringEvidenceSession(db, sessionId);
    legacyHash.update(`${JSON.stringify({ sessionId })}\n`);
    for (const item of captured.items) legacyHash.update(serializeCanonicalEvidenceItem(item));
    sessions.push({
      evidence: captured.evidence,
      revisionInput: captured.revisionInput,
      usableCanonicalEvidence: captured.usableCanonicalEvidence
    });
  }
  return {
    manifest: {
      evidenceRevision: `sha256:${legacyHash.digest("hex")}`,
      sessions: sessions.map(({ evidence }) => evidence)
    },
    sessions
  };
}

function authoringEvidenceSessionSnapshot(
  sessionId: string,
  items: SessionTranscriptItem[]
): AuthoringEvidenceSessionSnapshot {
    const sessionHash = createHash("sha256");
    sessionHash.update(`${JSON.stringify({ sessionId })}\n`);
    const coverage = {
      assistantMessages: 0,
      checkpoints: 0,
      fileEffects: 0,
      messages: 0,
      runtimeSignals: 0,
      toolCalls: 0,
      toolResults: 0,
      userMessages: 0
    };
    const counts = new Map<SessionTranscriptKind, number>();
    let firstObservedAt: string | undefined;
    let lastObservedAt: string | undefined;
    let totalItems = 0;
    let usableCanonicalEvidence = false;

    for (const item of items) {
      const serialized = serializeCanonicalEvidenceItem(item);
      sessionHash.update(serialized);
      totalItems += 1;
      firstObservedAt ??= item.observedAt || undefined;
      lastObservedAt = item.observedAt || lastObservedAt;
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
      if (isUsableAuthoringEvidenceItem(item)) {
        usableCanonicalEvidence = true;
      }
      if (item.kind === "message") {
        coverage.messages += 1;
        if (item.role === "user") coverage.userMessages += 1;
        if (item.role === "assistant") coverage.assistantMessages += 1;
      } else if (item.kind === "tool_call") {
        coverage.toolCalls += 1;
      } else if (item.kind === "tool_result") {
        coverage.toolResults += 1;
      } else if (item.kind === "file_effect") {
        coverage.fileEffects += 1;
      } else if (item.kind === "checkpoint") {
        coverage.checkpoints += 1;
      } else if (item.kind === "runtime_signal") {
        coverage.runtimeSignals += 1;
      }
    }

    const evidence = {
      coverage,
      firstObservedAt,
      kindCounts: transcriptKinds.flatMap((kind) => {
        const count = counts.get(kind);
        return count ? [{ count, kind }] : [];
      }),
      lastObservedAt,
      sessionId,
      totalItems,
      warnings: []
    } satisfies WorkbenchAuthoringEvidenceManifest["sessions"][number];
    return {
      evidence,
      revisionInput: {
        sessionDigest: `sha256:${sessionHash.digest("hex")}`,
        sessionId
      },
      usableCanonicalEvidence
    };
}

function isUsableAuthoringEvidenceItem(item: SessionTranscriptItem): boolean {
  return item.lowValue !== true && hasSemanticRedactedText(item.narrativeText ?? item.text);
}

function scaffoldEvidenceCatalogScore(item: ScaffoldEvidenceCatalogItemLike): number {
  if (isDemotedScaffoldEvidenceItem(item)) return 0;
  if (item.kind === "message" && item.role === "user") return 400;
  if (item.kind === "message" && item.role === "assistant") return 350;
  if (item.kind === "message") return 200;
  if (item.kind === "tool_result") return 150;
  if (item.kind === "checkpoint") return 140;
  if (item.kind === "file_effect") return 130;
  if (item.kind === "tool_call") return 100;
  if (item.kind === "runtime_signal") return 80;
  return 50;
}

function scaffoldEvidenceText(item: ScaffoldEvidenceCatalogItemLike): string {
  return `${item.text ?? ""}\n${item.narrativeText ?? ""}`.trim();
}

function isAgentsOrSkillInstructionDump(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^#\s*AGENTS\.md\b/i.test(trimmed)) return true;
  if (/\bAGENTS\.md instructions\b/i.test(trimmed) && trimmed.length >= 80) return true;
  if (/^<skill\b/i.test(trimmed)) return true;
  if (/<(?:skills_instructions|permissions instructions|INSTRUCTIONS|project-doc)\b/i.test(trimmed)) {
    // Instruction envelopes without a short standalone user ask dominate the row.
    const withoutTags = trimmed
      .replace(/<\/?[a-z][\w:-]*(?:\s+[^>]*)?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (withoutTags.length < 40) return true;
    if (/^#\s*AGENTS\.md\b/i.test(trimmed) || /##\s*Skills\b/i.test(trimmed)) return true;
  }
  if (/^##\s*Skills\b/i.test(trimmed) && /\b(?:skill|instructions)\b/i.test(trimmed)) return true;
  return false;
}

function isDeveloperSandboxPolicyText(text: string): boolean {
  const trimmed = text.trim();
  return [
    "Filesystem sandboxing defines which files can be read or written.",
    "Network access is restricted.",
    "# Codex Behavioral Guidelines",
    "Knowledge cutoff:",
    "Current date:",
    "You are Codex,",
    "You are an AI assistant"
  ].some((prefix) => trimmed.startsWith(prefix)) ||
    (/\b(?:filesystem )?sandbox(?:ing)?\b/i.test(trimmed) &&
      /\b(?:policy|restricted|network access|read or written)\b/i.test(trimmed) &&
      trimmed.length < 600);
}

function isApprovalAssessmentWrapperText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\bapproval assessment\b/i.test(trimmed)) return true;
  if (/\bprovide (?:your )?(?:an )?approval\b/i.test(trimmed) && /\brisk_level\b/i.test(trimmed)) {
    return true;
  }
  if (/\brisk_level\b/i.test(trimmed) && /\boutcomes?\b/i.test(trimmed) &&
      /\b(?:allow|deny|reject|approve)\b/i.test(trimmed) &&
      !/\b(?:implement|fix|publish|author|migrate|repair)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isPureJsonAssistantAllowText(
  text: string,
  role: ScaffoldEvidenceCatalogItemLike["role"],
  kind: ScaffoldEvidenceCatalogItemLike["kind"]
): boolean {
  if (kind !== "message") return false;
  if (role !== "assistant" && role !== "system" && role !== "tool") {
    // Still demote pure allow JSON even when role is missing/unknown on catalog rows.
    if (role === "user") return false;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0 || keys.length > 8) return false;
    const allowedKeys = new Set([
      "risk_level",
      "riskLevel",
      "outcome",
      "decision",
      "reason",
      "rationale",
      "explanation",
      "approval",
      "status"
    ]);
    if (!keys.every((key) => allowedKeys.has(key))) return false;
    const outcome = String(record.outcome ?? record.decision ?? record.approval ?? record.status ?? "");
    if (/\ballow\b/i.test(outcome)) return true;
    if ("risk_level" in record || "riskLevel" in record) {
      return keys.every((key) => allowedKeys.has(key));
    }
    return false;
  } catch {
    return false;
  }
}

function serializeCanonicalEvidenceItem(item: SessionTranscriptItem): string {
  return `${JSON.stringify({
    additions: item.additions,
    argumentsRedacted: item.argumentsRedacted,
    deletions: item.deletions,
    details: item.details,
    exitCode: item.exitCode,
    itemId: item.itemId,
    kind: item.kind,
    label: item.label,
    lowValue: item.lowValue,
    narrativeText: item.narrativeText,
    observedAt: item.observedAt,
    role: item.role,
    sourceRef: item.sourceRef,
    staged: item.staged,
    status: item.status,
    text: item.text,
    toolName: item.toolName
  })}\n`;
}

function strictSessionIds(sessionIds: string[]): string[] {
  if (sessionIds.some((sessionId) => sessionId.trim().length === 0)) {
    throw new Error("Authoring evidence session IDs must not contain blank values.");
  }
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error("Authoring evidence session IDs must not contain duplicate values.");
  }
  return [...sessionIds].sort();
}

function strictRevisionInputs(inputs: AuthoringEvidenceRevisionInput[]): AuthoringEvidenceRevisionInput[] {
  const sessionIds = strictSessionIds(inputs.map(({ sessionId }) => sessionId));
  const bySessionId = new Map(inputs.map((input) => [input.sessionId, input]));
  return sessionIds.map((sessionId) => {
    const input = bySessionId.get(sessionId)!;
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.sessionDigest)) {
      throw new Error(`Guided authoring evidence session digest is invalid for ${sessionId}.`);
    }
    return input;
  });
}

function normalizedSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.filter((sessionId) => sessionId.length > 0))].sort();
}
