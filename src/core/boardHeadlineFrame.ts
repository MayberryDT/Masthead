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
  failureReason?: string;
};

export type BoardHeadlineValidationResult =
  | { ok: true; frame: BoardHeadlineFrame }
  | {
      ok: false;
      reason: "invalid_shape" | "weak_subject" | "weak_disposition" | "unsafe_text" | "unsupported_state";
    };

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
    subject: subject.slice(0, 96),
    disposition: disposition.slice(0, 180),
    state: candidate.state as BoardHeadlineState,
    subjectKind: candidate.subjectKind as BoardHeadlineSubjectKind,
    confidence: candidate.confidence as BoardHeadlineConfidence,
    evidence: evidence.map((value) => value.slice(0, 180))
  };

  return { ok: true, frame };
}

export function isUnsafeText(value: string): boolean {
  return (
    hasUnsafeCredentialName(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /\bhttps?:\/\//i.test(value) ||
    /::[-\w]+\{[^}]*\}/i.test(value) ||
    /\[url\]/i.test(value)
  );
}

function hasUnsafeCredentialName(value: string): boolean {
  return value
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
    .some((token) => {
      if (token !== token.toUpperCase()) return false;

      const parts = token.split("_").filter(Boolean);
      if (parts.some((part) => part === "SECRET" || part === "TOKEN" || part === "PASSWORD")) {
        return true;
      }

      return parts.includes("KEY") && parts.some((part) => part === "API" || part === "AUTH" || part === "ACCESS");
    });
}

function cleanSlot(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
