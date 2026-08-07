import { isSensitiveKey, redactText } from "./redaction.ts";

export type BoardHeadlineState =
  | "active"
  | "blocked"
  | "needs_verification"
  | "paused"
  | "completed"
  | "failed"
  | "waiting"
  | "unknown";

export type BoardHeadlineSubjectKind =
  | "feature"
  | "component"
  | "bug"
  | "test"
  | "import"
  | "settings"
  | "docs"
  | "source"
  | "project"
  | "unknown";

export type BoardHeadlineConfidence = "high" | "medium" | "low";

export type BoardHeadlineFrame = {
  subject: string;
  disposition: string;
  state: BoardHeadlineState;
  subjectKind: BoardHeadlineSubjectKind;
  confidence: BoardHeadlineConfidence;
  evidence: string[];
};

export type BoardHeadlineSource = "llm" | "offline" | "pending" | "enrichment";

export type BoardHeadlineView = {
  headline: string;
  frame?: BoardHeadlineFrame;
  source: BoardHeadlineSource;
  status: "ready" | "pending" | "unavailable";
  generatedAt?: string;
  model?: string;
  provider?: string;
  refreshKeyHash?: string;
  freshness?: "fresh" | "stale";
  failureReason?: string;
};

export type BoardHeadlineValidationResult =
  | { ok: true; frame: BoardHeadlineFrame }
  | {
      ok: false;
      reason: "invalid_shape" | "weak_subject" | "weak_disposition" | "unsafe_text" | "unsupported_state";
    };

const MAX_SUBJECT_LENGTH = 56;
const MAX_DISPOSITION_LENGTH = 96;
const MAX_EVIDENCE_LENGTH = 180;

const allowedStates = new Set<BoardHeadlineState>([
  "active",
  "blocked",
  "needs_verification",
  "paused",
  "completed",
  "failed",
  "waiting",
  "unknown"
]);

const allowedKinds = new Set<BoardHeadlineSubjectKind>([
  "feature",
  "component",
  "bug",
  "test",
  "import",
  "settings",
  "docs",
  "source",
  "project",
  "unknown"
]);

const allowedConfidence = new Set<BoardHeadlineConfidence>(["high", "medium", "low"]);

export function renderBoardHeadlineFrame(frame: BoardHeadlineFrame): string {
  const subject = cleanSlot(frame.subject).replace(/:+$/g, "");
  const disposition = cleanSlot(frame.disposition).replace(/[.!?]+$/g, "");
  return `${subject}: ${lowercaseFirst(disposition)}.`;
}

export function validateBoardHeadlineFrame(candidate: unknown): BoardHeadlineValidationResult {
  if (!isRecord(candidate)) return { ok: false, reason: "invalid_shape" };
  if (
    typeof candidate.subject !== "string" ||
    typeof candidate.disposition !== "string" ||
    typeof candidate.state !== "string" ||
    typeof candidate.subjectKind !== "string" ||
    typeof candidate.confidence !== "string" ||
    !Array.isArray(candidate.evidence)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  if (!allowedStates.has(candidate.state as BoardHeadlineState)) {
    return { ok: false, reason: "unsupported_state" };
  }
  if (!allowedKinds.has(candidate.subjectKind as BoardHeadlineSubjectKind)) {
    return { ok: false, reason: "unsupported_state" };
  }
  if (!allowedConfidence.has(candidate.confidence as BoardHeadlineConfidence)) {
    return { ok: false, reason: "invalid_shape" };
  }
  if (candidate.evidence.some((value) => typeof value !== "string")) {
    return { ok: false, reason: "invalid_shape" };
  }

  const subject = cleanSlot(candidate.subject);
  const disposition = cleanSlot(candidate.disposition);
  const evidence = candidate.evidence.map(cleanSlot).filter(Boolean).slice(0, 6);

  if (isUnsafeText(subject) || isUnsafeText(disposition) || evidence.some(isUnsafeText)) {
    return { ok: false, reason: "unsafe_text" };
  }
  if (!subject) return { ok: false, reason: "weak_subject" };
  if (!disposition) return { ok: false, reason: "weak_disposition" };

  const frame: BoardHeadlineFrame = {
    subject: compactSlot(subject, MAX_SUBJECT_LENGTH),
    disposition: compactSlot(disposition, MAX_DISPOSITION_LENGTH),
    state: candidate.state as BoardHeadlineState,
    subjectKind: candidate.subjectKind as BoardHeadlineSubjectKind,
    confidence: candidate.confidence as BoardHeadlineConfidence,
    evidence: evidence.map((value) => compactSlot(value, MAX_EVIDENCE_LENGTH))
  };

  return { ok: true, frame };
}

export function isUnsafeText(value: string): boolean {
  return (
    hasUnsafeCredentialName(value) ||
    hasInternalStatusToken(value) ||
    redactText(value) !== value ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /\b[a-z][a-z0-9+.-]{1,31}:[^\s]/i.test(value) ||
    /[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)+/.test(value) ||
    /\b[A-Za-z]:\/(?:[^/:*?"<>|\r\n\s]+\/?)+/.test(value) ||
    /\\\\[^\\\s]+\\[^\\\s]+/.test(value) ||
    /(?:^|[^A-Za-z0-9_])(?:~|\.{1,2})?\/\S+/.test(value) ||
    /::[-\w]+\{[^}]*\}/i.test(value) ||
    /\[url\]/i.test(value)
  );
}

function hasInternalStatusToken(value: string): boolean {
  return /\b(?:api_error|completed_unreviewed|invalid_output|needs_attention|not_configured|validation_failed|waiting_for_approval|waiting_for_user)\b/i.test(
    value
  );
}

function hasUnsafeCredentialName(value: string): boolean {
  const tokens = value.split(/[^A-Za-z0-9_-]+/).filter(Boolean);
  for (const token of tokens) {
    // Field-style names (password, cookie, privateKey, ...). Bare "auth" is too common in product copy.
    if (isSensitiveKey(token) && token.toLowerCase() !== "auth") return true;

    if (token === token.toUpperCase()) {
      const parts = token.split("_").filter(Boolean);
      if (parts.some((part) => part === "SECRET" || part === "TOKEN" || part === "PASSWORD")) {
        return true;
      }
      if (parts.includes("KEY") && parts.some((part) => part === "API" || part === "AUTH" || part === "ACCESS")) {
        return true;
      }
    }

    const flagName = token.replace(/^--?/, "");
    if (
      /^(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth-token|cookie|credentials?)$/i.test(
        flagName
      )
    ) {
      return true;
    }
  }
  return false;
}

function cleanSlot(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactSlot(value: string, maxLength: number): string {
  const cleaned = cleanSlot(value);
  if (cleaned.length <= maxLength) return cleaned;
  const candidate = cleaned.slice(0, maxLength + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const compacted = wordBoundary >= Math.floor(maxLength * 0.65) ? candidate.slice(0, wordBoundary) : cleaned.slice(0, maxLength);
  return compacted.replace(/[,:;.!?\s]+$/g, "").trim();
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
