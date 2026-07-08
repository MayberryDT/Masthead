import type { BoardHeadlineInput } from "./boardHeadlineInput.ts";
import {
  renderBoardHeadlineFrame,
  validateBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineSubjectKind,
  type BoardHeadlineView
} from "./boardHeadlineFrame.ts";

export function buildPendingBoardHeadlineView(_input: BoardHeadlineInput): BoardHeadlineView {
  return {
    headline: "Updating session status...",
    source: "pending",
    status: "pending"
  };
}

export function buildWaitingForTranscriptBoardHeadlineView(_input: BoardHeadlineInput): BoardHeadlineView {
  return {
    headline: "Waiting for transcript...",
    source: "pending",
    status: "pending"
  };
}

export function buildOfflineBoardHeadlineView(input: BoardHeadlineInput): BoardHeadlineView {
  const candidate = offlineFrame(input);
  const validated = validateBoardHeadlineFrame(candidate);
  const frame = validated.ok ? validated.frame : validatedFallbackFrame(input);

  return {
    headline: renderBoardHeadlineFrame(frame),
    frame,
    source: "offline",
    status: "ready"
  };
}

function offlineFrame(input: BoardHeadlineInput): BoardHeadlineFrame {
  const subject = offlineSubject(input);

  return {
    subject,
    disposition: offlineDisposition(input),
    state: input.stateHint,
    subjectKind: inferSubjectKind(subject),
    confidence: "low",
    evidence: input.evidence.slice(0, 4)
  };
}

function validatedFallbackFrame(input: BoardHeadlineInput): BoardHeadlineFrame {
  const frame: BoardHeadlineFrame = {
    subject: offlineSubject(input),
    disposition: fallbackDisposition(input),
    state: input.stateHint,
    subjectKind: "project",
    confidence: "low",
    evidence: []
  };
  const validated = validateBoardHeadlineFrame(frame);

  return validated.ok ? validated.frame : fallbackBoardHeadlineFrame(input);
}

function fallbackBoardHeadlineFrame(input: BoardHeadlineInput): BoardHeadlineFrame {
  return {
    subject: projectSubject(input) ?? "Session",
    disposition: fallbackDisposition(input),
    state: input.stateHint === "unknown" ? "paused" : input.stateHint,
    subjectKind: "project",
    confidence: "low",
    evidence: []
  };
}

function offlineSubject(input: BoardHeadlineInput): string {
  for (const candidate of input.subjectCandidates) {
    const normalized = normalizeSubject(candidate);
    if (normalized && !isGenericSubject(normalized)) {
      return normalized;
    }
  }

  const workContext = normalizeSubject(input.facts.workContext?.label);
  if (workContext && !isGenericSubject(workContext)) return workContext;

  const title = normalizeSubject(input.facts.title);
  if (title && !isGenericSubject(title) && !isOpaqueIdentifier(title)) return title;

  return projectSubject(input) ?? "Session";
}

function projectSubject(input: BoardHeadlineInput): string | undefined {
  const project = input.facts.project?.replace(/\s+/g, " ").trim().replace(/[.?!,:;]+$/g, "");
  if (!project) return undefined;
  // Project labels are always usable subjects (including "Masthead"), except placeholder unknown.
  if (/^unknown project$/i.test(project)) return undefined;
  return project;
}

function normalizeSubject(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.?!,:;]+$/g, "");
  if (!cleaned) return undefined;
  if (/^board headlines?\b/i.test(cleaned)) return undefined;
  if (/^session narrative\b/i.test(cleaned)) return undefined;
  return cleaned;
}

function isGenericSubject(value: string): boolean {
  const normalized = value.toLowerCase();
  return /^(masthead|ui|changes?|updates?|sessions?|work|recent activity|ui changes?|board headlines?|session narrative(?: work)?|unknown project)$/.test(
    normalized
  );
}

function isOpaqueIdentifier(value: string): boolean {
  const normalized = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) return true;
  if (/^[0-9a-f]{12,}$/i.test(normalized)) return true;
  if (/\s+session$/i.test(normalized) && isOpaqueIdentifier(normalized.replace(/\s+session$/i, ""))) return true;
  return false;
}

function offlineDisposition(input: BoardHeadlineInput): string {
  switch (input.stateHint) {
    case "blocked":
      return `blocked by ${blockedFailure(input)}`;
    case "needs_verification":
      return "needs verification after recent changes";
    case "paused":
      return "idle after latest activity";
    case "completed":
      return "ready for review";
    case "failed":
      return "failed on latest recorded evidence";
    case "waiting":
      return "waiting for the next required input";
    case "active":
      return "in progress";
    case "unknown":
      return "latest activity recorded";
  }
}

function blockedFailure(input: BoardHeadlineInput): string {
  return input.dispositionHints.find(isSafeBlockedFailure) ?? "recorded session evidence";
}

function isSafeBlockedFailure(hint: string): boolean {
  if (!/\b(?:failed|blocked|missing)\b/i.test(hint)) return false;
  if (/\bhttps?:\/\//i.test(hint)) return false;
  if (/::[-\w]+\{[^}]*\}/i.test(hint)) return false;
  if (/\[url\]/i.test(hint)) return false;
  if (/\bsk-[A-Za-z0-9_-]+\b/i.test(hint)) return false;
  if (hasUnsafeCredentialName(hint)) return false;
  return true;
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

function fallbackDisposition(input: BoardHeadlineInput): string {
  if (input.stateHint === "blocked") return "blocked by recorded session evidence";
  if (input.stateHint === "active") return "in progress";
  if (input.stateHint === "paused") return "idle after latest activity";
  return "latest activity recorded";
}

function inferSubjectKind(subject: string): BoardHeadlineSubjectKind {
  const normalized = subject.toLowerCase();

  if (/\bsettings?\b/.test(normalized)) return "settings";
  if (/\btests?\b|\.test\./.test(normalized)) return "test";
  if (/\bimports?\b|transcript import/.test(normalized)) return "import";
  if (/\bdocs?\b|documentation|readme|\.md\b/.test(normalized)) return "docs";
  if (/\bsources?\b|adapter/.test(normalized)) return "source";
  if (/\bbugs?\b|fix|failure|failed|error|regression/.test(normalized)) return "bug";
  if (/\bfeatures?\b|headline|board|frame|workbench\b/.test(normalized)) return "feature";
  return "project";
}
