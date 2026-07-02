import type { BoardHeadlineInput } from "./boardHeadlineInput";
import {
  renderBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineSubjectKind,
  type BoardHeadlineView
} from "./boardHeadlineFrame";

export function buildPendingBoardHeadlineView(_input: BoardHeadlineInput): BoardHeadlineView {
  return {
    headline: "Generating headline...",
    source: "pending",
    status: "pending"
  };
}

export function buildOfflineBoardHeadlineView(input: BoardHeadlineInput): BoardHeadlineView {
  const frame: BoardHeadlineFrame = {
    subject: offlineSubject(input),
    disposition: offlineDisposition(input),
    state: input.stateHint,
    subjectKind: inferSubjectKind(offlineSubject(input)),
    confidence: "low",
    evidence: input.evidence.slice(0, 4)
  };

  return {
    headline: renderBoardHeadlineFrame(frame),
    frame,
    source: "offline",
    status: "ready"
  };
}

function offlineSubject(input: BoardHeadlineInput): string {
  for (const candidate of input.subjectCandidates) {
    const normalized = normalizeSubject(candidate);
    if (normalized && !isGenericSubject(normalized)) {
      return normalized;
    }
  }

  return "Board headlines";
}

function normalizeSubject(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.?!,:;]+$/g, "");
  if (!cleaned) return undefined;
  if (/^board headlines?\b/i.test(cleaned)) return "Board headlines";
  return cleaned;
}

function isGenericSubject(value: string): boolean {
  return /^(masthead|session|work|ui changes)$/i.test(value);
}

function offlineDisposition(input: BoardHeadlineInput): string {
  switch (input.stateHint) {
    case "blocked":
      return `blocked by ${blockedFailure(input)}`;
    case "needs_verification":
      return "needs verification after recent changes";
    case "paused":
      return "paused after latest collected evidence";
    case "completed":
      return "latest outcome is ready for review";
    case "failed":
      return "failed on latest recorded evidence";
    case "waiting":
      return "waiting for the next required input";
    case "active":
    case "unknown":
      return "waiting for LLM headline access";
  }
}

function blockedFailure(input: BoardHeadlineInput): string {
  return (
    input.dispositionHints.find((hint) => /\b(?:failed|blocked|missing)\b/i.test(hint)) ??
    "recorded session evidence"
  );
}

function inferSubjectKind(subject: string): BoardHeadlineSubjectKind {
  const normalized = subject.toLowerCase();

  if (/\bsettings?\b/.test(normalized)) return "settings";
  if (/\btests?\b|\.test\./.test(normalized)) return "test";
  if (/\bimports?\b|transcript import/.test(normalized)) return "import";
  if (/\bdocs?\b|documentation|readme|\.md\b/.test(normalized)) return "docs";
  if (/\bsources?\b|adapter/.test(normalized)) return "source";
  if (/\bbugs?\b|fix|failure|failed|error|regression/.test(normalized)) return "bug";
  if (/\bfeatures?\b|headline|board|frame/.test(normalized)) return "feature";
  return "unknown";
}
