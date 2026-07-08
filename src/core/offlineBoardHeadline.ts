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
    if (
      normalized &&
      !isGenericSubject(normalized) &&
      !isWeakAreaSubject(normalized, input) &&
      !isWeakFilenameEvidence(normalized) &&
      !isOpaqueIdentifier(normalized)
    ) {
      return normalized;
    }
  }

  const workContext = normalizeSubject(input.facts.workContext?.label);
  if (workContext && !isGenericSubject(workContext) && !isWeakAreaSubject(workContext, input)) {
    return workContext;
  }

  const title = normalizeSubject(input.facts.title);
  if (title && !isGenericSubject(title) && !isOpaqueIdentifier(title) && !isWeakAreaSubject(title, input)) {
    return title;
  }

  // Prefer specific non-filename evidence (commit subjects, short phrases) before project/runtime.
  const phraseEvidence = subjectFromEvidence(input.evidence, { allowFilenames: false });
  if (phraseEvidence) return phraseEvidence;

  const projectRuntime = projectRuntimeSubject(input);
  if (projectRuntime) return projectRuntime;

  const fileEvidence = subjectFromEvidence(input.evidence, { allowFilenames: true });
  if (fileEvidence) return fileEvidence;

  return projectSubject(input) ?? "Session";
}

/** Broad path-cluster area labels that collapse many sessions when used as the only subject. */
function isWeakAreaSubject(value: string, input: BoardHeadlineInput): boolean {
  const normalized = value.toLowerCase().replace(/\s+work$/i, "").trim();
  const weakAreas = new Set([
    "settings ui",
    "settings",
    "ui",
    "test",
    "tests",
    "documentation",
    "docs",
    "auth",
    "session",
    "mixed area"
  ]);
  if (!weakAreas.has(normalized)) return false;

  // Allow Settings UI only when clusters are settings-focused or transcript evidence mentions settings.
  if (normalized === "settings ui" || normalized === "settings") {
    const clusters = input.facts.workContext?.pathClusters ?? [];
    const settingsFocused =
      clusters.length > 0 && clusters.every((cluster) => cluster === "settings" || cluster === "ui") && clusters.includes("settings");
    const transcriptMentionsSettings = (input.facts.recentTranscriptMessages ?? []).some((message) => /\bsettings?\b/i.test(message));
    return !(settingsFocused || transcriptMentionsSettings);
  }

  // Other single-word area labels are weak unless they are the only path cluster.
  const clusters = input.facts.workContext?.pathClusters ?? [];
  return clusters.length !== 1;
}

function subjectFromEvidence(evidence: string[], options: { allowFilenames: boolean } = { allowFilenames: true }): string | undefined {
  for (const raw of evidence) {
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 8 || cleaned.length > 72) continue;
    if (/^grok build hook event$/i.test(cleaned)) continue;
    if (/^high-risk change$/i.test(cleaned)) continue;
    if (/^codex hook event\b/i.test(cleaned)) continue;
    if (/\bhttps?:\/\//i.test(cleaned)) continue;
    if (/^(npm|pnpm|yarn|node|git|rg|curl)\b/i.test(cleaned)) continue;
    // Tool names and tool-call noise (read_file, todo_write, update_goal, etc.)
    if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(cleaned)) continue;
    if (/^(read_file|write|search_replace|todo_write|update_goal|run_terminal_command|spawn_subagent|grep|list_dir)\b/i.test(cleaned)) {
      continue;
    }
    if (/^[a-f0-9-]{12,}(?:\s+session)?$/i.test(cleaned)) continue;
    // Prefer short noun-phrase-ish evidence without command noise.
    if (/^(fix|feat|docs|test|chore)[:(\s]/i.test(cleaned)) {
      const subject = cleaned.replace(/^(fix|feat|docs|test|chore)[:\s]*/i, "").replace(/\s+/g, " ").trim();
      if (subject.length >= 6 && subject.length <= 56) return subject.replace(/[.?!]+$/g, "");
    }
    // File basenames that are specific components (never README.md / package.json / etc.).
    if (options.allowFilenames) {
      if (isWeakFilenameEvidence(cleaned)) continue;
      if (/^[A-Za-z][A-Za-z0-9]+(?:Card|Panel|Surface|Toolbar|Board|Workbench|Controller|Repository)\.(?:tsx?|jsx?)$/i.test(cleaned)) {
        return cleaned.replace(/\.[^.]+$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
      }
    } else if (/\.[a-z0-9]+$/i.test(cleaned) && !/\s/.test(cleaned)) {
      continue;
    }
    if (/^[A-Za-z][\w .-]{5,55}$/.test(cleaned) && !/[{}`|=]/.test(cleaned) && !/\.[a-z0-9]+$/i.test(cleaned)) {
      return cleaned.replace(/[.?!]+$/g, "");
    }
  }
  return undefined;
}

function isWeakFilenameEvidence(value: string): boolean {
  if (!/\.[a-z0-9]+$/i.test(value) || /\s/.test(value)) return false;
  const ext = value.split(".").pop()?.toLowerCase() ?? "";
  // Bare docs / config files are almost never good session subjects.
  if (["md", "txt", "json", "yml", "yaml", "toml", "lock", "css", "scss"].includes(ext)) return true;
  const base = value.replace(/\.[^.]+$/, "").toLowerCase();
  return /^(readme|changelog|license|package|tsconfig|vite\.config|index|main|app|utils?|helpers?|types?|constants?|styles?|masthead)$/i.test(
    base
  );
}

function projectRuntimeSubject(input: BoardHeadlineInput): string | undefined {
  const project = projectSubject(input);
  const runtime = input.facts.runtime?.trim().toLowerCase();
  if (!project || !runtime) return undefined;
  const labels: Record<string, string> = {
    codex: "Codex",
    claude_code: "Claude Code",
    cursor: "Cursor",
    grok: "Grok Build",
    opencode: "OpenCode",
    omp: "Oh My Pi",
    pi: "Pi",
    hermes: "Hermes"
  };
  const harness = labels[runtime];
  if (!harness) return project;
  return `${project} · ${harness}`;
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
  if (/^[0-9a-f]{8,}$/i.test(normalized)) return true;
  if (/^[0-9a-f]{6,}(?:-[0-9a-f]+){1,}\b/i.test(normalized)) return true;
  const withoutSession = normalized.replace(/\s+session$/i, "").trim();
  if (withoutSession !== normalized) return isOpaqueIdentifier(withoutSession);
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
