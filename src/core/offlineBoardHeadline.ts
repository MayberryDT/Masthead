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
    disposition: offlineDisposition(input, subject),
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
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(masthead|ui|changes?|updates?|sessions?|work|recent activity|ui changes?|board headlines?|session narrative(?: work)?|unknown project)$/.test(normalized)) {
    return true;
  }
  if (/^(?:codex|claude code|cursor|opencode|hermes|grok build|oh my pi|pi)(?:\s+(?:hook|plugin|extension))?(?:\s+event)?$/i.test(normalized)) {
    return true;
  }
  if (/^subagent-[0-9a-f-]+$/i.test(normalized)) return true;
  // sessionReducer / adapters fall back to `${project} session` and similar labels.
  // Reject those as board subjects so they cannot collide across cards; projectSubject
  // / projectRuntimeSubject still provide non-colliding last-resort subjects.
  if (isProjectSessionFallbackLabel(normalized)) return true;
  return false;
}

/**
 * Labels that are only project + "session" or pure project·harness chrome — not real work subjects.
 * Opaque UUID/hex "… session" strings are handled by isOpaqueIdentifier instead.
 */
function isProjectSessionFallbackLabel(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  // `${project} session`, `codex session`, multi-word project names, optional harness infix.
  // e.g. "Masthead session", "Nova OS session", "codex session", "Masthead codex session"
  if (/^.+\s+session$/i.test(normalized)) {
    const stem = normalized.replace(/\s+session$/i, "").trim();
    if (!stem) return false;
    // Leave pure opaque id handling to isOpaqueIdentifier (UUID/hex stems).
    if (/^[0-9a-f]{8,}(?:-[0-9a-f]+)*$/i.test(stem)) return false;
    return true;
  }

  // Pure project · harness labels (middle-dot or bullet) without work-topic substance.
  // e.g. "Masthead · Codex", "Nova OS • Grok Build"
  if (
    /^.+\s*[·•]\s*(?:codex|claude(?:\s+code)?|cursor|grok(?:\s+build)?|hermes|opencode|oh my pi|omp|pi)$/i.test(
      normalized
    )
  ) {
    return true;
  }

  return false;
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

function offlineDisposition(input: BoardHeadlineInput, subject?: string): string {
  // Blocked keeps explicit "blocked by …" shape for inspectors and tests.
  if (input.stateHint === "blocked") {
    return `blocked by ${blockedFailure(input)}`;
  }

  const specific = dispositionFromSessionEvidence(input);
  let disposition = specific;
  if (!disposition) {
    switch (input.stateHint) {
      case "needs_verification":
        disposition = "needs verification after recent changes";
        break;
      case "paused":
        disposition = idleDispositionFallback(input);
        break;
      case "completed":
        disposition = "ready for review";
        break;
      case "failed":
        disposition = "failed on latest recorded evidence";
        break;
      case "waiting":
        disposition = waitingDispositionFallback(input);
        break;
      case "active":
        disposition = activeDispositionFallback(input);
        break;
      case "unknown":
        disposition = "latest activity recorded";
        break;
    }
  }

  const resolvedSubject = subject ?? offlineSubject(input);
  if (isWeakSubjectForDisposition(resolvedSubject, input)) {
    return diversifyDispositionWithEvidence(disposition, input);
  }
  return disposition;
}

/**
 * Disposition-local weak check. Leave subject acceptance rules alone (Task 1).
 * Project labels, project·harness, single-token, and "X session" subjects need
 * evidence tokens so same-subject cards still read differently.
 */
function isWeakSubjectForDisposition(subject: string, input: BoardHeadlineInput): boolean {
  const normalized = subject.replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  const project = projectSubject(input);
  if (project && normalized.toLowerCase() === project.toLowerCase()) return true;

  // Project · harness runtime labels (e.g. "Masthead · Grok Build")
  if (/^.+\s*[·•]\s*\S/.test(normalized)) {
    if (project && new RegExp(`^${escapeRegExp(project)}\\s*[·•]`, "i").test(normalized)) return true;
    // Any pure project·runtime style with a known harness tail is weak.
    if (/\s*[·•]\s*(codex|claude code|cursor|grok build|opencode|oh my pi|pi|hermes)\s*$/i.test(normalized)) {
      return true;
    }
  }

  if (/^.+\s+session$/i.test(normalized)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  // Single token / short label without a task phrase.
  if (words.length <= 1) return true;

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prefer a distinguishing evidence token (file basename, tool name, short failure)
 * when subject is weak so two same-project cards do not share identical headlines.
 */
function diversifyDispositionWithEvidence(base: string, input: BoardHeadlineInput): string {
  const token = dispositionEvidenceToken(input);
  if (!token) return base;

  const tokenLower = token.toLowerCase();
  if (base.toLowerCase().includes(tokenLower)) return base;
  // Also treat "SessionCard" as covered by "Session Card" style subjects already in base.
  const tokenStem = tokenLower.replace(/\.[a-z0-9]+$/i, "");
  if (tokenStem.length >= 4 && base.toLowerCase().includes(tokenStem)) return base;

  const fileLike = isDispositionFileToken(token);
  const toolLike = isDispositionToolToken(token);

  // Natural phrasing for common generic bases.
  if (/^editing files$/i.test(base) && fileLike) {
    return clipDisposition(`editing ${token}`);
  }
  if (/^making file changes$/i.test(base) && fileLike) {
    return clipDisposition(`changing ${token}`);
  }
  if (/^inspecting the workspace$/i.test(base) && fileLike) {
    return clipDisposition(`inspecting ${token}`);
  }
  if (/^running checks$/i.test(base) && fileLike) {
    return clipDisposition(`running checks on ${token}`);
  }
  if (/^in progress$/i.test(base)) {
    return clipDisposition(`in progress · ${token}`);
  }
  if (/^working through tool calls$/i.test(base) && toolLike) {
    return clipDisposition(`working via ${token}`);
  }
  if (/^quiet after /i.test(base) || /^no new /i.test(base) || /^stalled with /i.test(base)) {
    if (fileLike) return clipDisposition(`quiet after ${token}`);
    if (toolLike) return clipDisposition(`quiet after ${token}`);
    return clipDisposition(`quiet after ${token}`);
  }
  if (/^latest activity recorded$/i.test(base) || /^ready for review$/i.test(base)) {
    return clipDisposition(`${base} · ${token}`);
  }
  if (/^failed on latest recorded evidence$/i.test(base)) {
    return clipDisposition(`failed · ${token}`);
  }
  if (/^needs verification after recent changes$/i.test(base)) {
    return clipDisposition(`needs verification · ${token}`);
  }
  if (/^waiting for /i.test(base)) {
    return clipDisposition(`${base} · ${token}`);
  }

  // Default: append middle-dot token; stay under disposition cap.
  return clipDisposition(`${base} · ${token}`);
}

function dispositionEvidenceToken(input: BoardHeadlineInput): string | undefined {
  // Prefer recent file basenames (already basenames — no sensitive paths).
  for (const raw of input.facts.recentFileBasenames) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name || name.length < 3 || name.length > 48) continue;
    if (/[\\/]/.test(name) || name.startsWith("~")) continue;
    if (isUnsafeDispositionToken(name)) continue;
    // Skip only the weakest doc/config basenames that add no session color.
    if (isWeakFilenameEvidence(name) && /\.(md|txt|json|yml|yaml|toml|lock|css|scss)$/i.test(name)) {
      continue;
    }
    if (/^(readme|changelog|license|package)(\.|$)/i.test(name)) continue;
    return name;
  }

  // Tool names next.
  for (const raw of input.facts.recentToolNames) {
    const tool = raw.replace(/\s+/g, " ").trim();
    if (!tool || tool.length < 3 || tool.length > 40) continue;
    if (isUnsafeDispositionToken(tool)) continue;
    return tool;
  }

  // Short failure snippet.
  for (const raw of input.facts.recentCommandFailures) {
    const failure = raw.replace(/\s+/g, " ").trim();
    if (!failure || failure.length < 6) continue;
    if (!isSafeBlockedFailure(failure) && !isUsefulDispositionSnippet(failure)) continue;
    if (isUnsafeDispositionToken(failure)) continue;
    // Prefer a compact token: first ~40 chars at a word boundary.
    if (failure.length <= 40) return failure;
    const clipped = failure.slice(0, 41);
    const boundary = clipped.lastIndexOf(" ");
    return (boundary >= 16 ? clipped.slice(0, boundary) : failure.slice(0, 40)).trim();
  }

  // Last resort: short evidence items that look like file/tool tokens.
  for (const raw of input.evidence) {
    const item = raw.replace(/\s+/g, " ").trim();
    if (!item || item.length < 3 || item.length > 48) continue;
    if (/[\\/]/.test(item) || item.startsWith("~")) continue;
    if (isUnsafeDispositionToken(item)) continue;
    if (isDispositionFileToken(item) || isDispositionToolToken(item)) return item;
  }

  return undefined;
}

function isDispositionFileToken(value: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(value) && !/\s/.test(value) && !/[\\/]/.test(value);
}

function isDispositionToolToken(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(value);
}

function isUnsafeDispositionToken(value: string): boolean {
  if (/\bhttps?:\/\//i.test(value)) return true;
  if (/::[-\w]+\{[^}]*\}/i.test(value)) return true;
  if (/\bsk-[A-Za-z0-9_-]+\b/i.test(value)) return true;
  if (hasUnsafeCredentialName(value)) return true;
  if (/(?:^|[^A-Za-z0-9_])(?:~|\.{1,2})?\/\S+/.test(value)) return true;
  return false;
}

/**
 * Build a short disposition from real session signals so idle cards are not all
 * "idle after latest activity".
 */
function dispositionFromSessionEvidence(input: BoardHeadlineInput): string | undefined {
  const status = input.primaryStatus.toLowerCase();
  const facts = input.facts;
  const attention = facts.attentionTitles.map((title) => title.trim()).filter(Boolean);
  const failures = facts.recentCommandFailures.map((value) => value.trim()).filter(Boolean);
  const tools = facts.recentToolNames.map((value) => value.trim()).filter(Boolean);
  const events = facts.recentEvents.map((event) => event.summary.trim()).filter(Boolean);
  const files = facts.recentFileBasenames.map((value) => value.trim()).filter(Boolean);
  const fileCount = facts.changedFileCount ?? 0;

  // Command failures before generic risk labels.
  const failure = failures.find((value) => isSafeBlockedFailure(value) || isUsefulDispositionSnippet(value));
  if (failure && (input.stateHint === "blocked" || input.stateHint === "failed" || input.stateHint === "paused")) {
    if (/\btest\b|\bvitest\b|\bjest\b|\bpytest\b/i.test(failure)) return "last test run failed";
    if (/\bbuild\b|\bcompile\b/i.test(failure)) return "last build failed";
    return `last command failed`;
  }

  // Recent event summaries (git commit, npm test, etc.) — preferred over blanket risk copy.
  for (const summary of events) {
    const fromEvent = dispositionFromEventSummary(summary, input.stateHint);
    if (fromEvent) return fromEvent;
  }
  for (const hint of input.dispositionHints) {
    const fromHint = dispositionFromEventSummary(hint, input.stateHint);
    if (fromHint) return fromHint;
  }
  for (const item of input.evidence) {
    const fromEvidence = dispositionFromEventSummary(item, input.stateHint);
    if (fromEvidence) return fromEvidence;
  }

  // Attention / risk — keep, but layer on file-count detail when that is all we have.
  const riskAttention = attention.find((title) => /\bhigh[- ]?risk\b/i.test(title) || /\brisk\b/i.test(title));
  if (riskAttention && (input.stateHint === "paused" || input.stateHint === "unknown")) {
    if (fileCount >= 50) return `high-risk change still open across ${fileCount} files`;
    if (fileCount >= 10) return "high-risk change still open with many file edits";
    if (files.some((name) => /workbench|headline|sessioncard|icon-registry/i.test(name))) {
      return "high-risk UI change still open";
    }
    return "high-risk change still open";
  }
  const cleanAttention = attention.find((title) => isUsefulDispositionSnippet(title) && !/\bhigh[- ]?risk\b/i.test(title));
  if (cleanAttention && (input.stateHint === "paused" || input.stateHint === "waiting" || input.stateHint === "blocked")) {
    return clipDisposition(cleanAttention);
  }

  // Tool activity
  if (tools.length > 0) {
    const lastTool = tools[0]!;
    if (input.stateHint === "active") {
      if (/edit|write|search_replace|apply/i.test(lastTool)) return "editing files";
      if (/test|vitest|npm/i.test(lastTool)) return "running checks";
      if (/read|grep|search|list/i.test(lastTool)) return "inspecting the workspace";
      return "working through tool calls";
    }
    if (input.stateHint === "paused" || input.stateHint === "unknown") {
      if (/edit|write|search_replace|apply/i.test(lastTool)) return "quiet after last file edit";
      if (/test|vitest/i.test(lastTool)) return "quiet after last test run";
      if (/commit|git/i.test(lastTool)) return "quiet after last commit";
      if (/read|grep|search|list/i.test(lastTool)) return "quiet after last inspection";
      return "quiet after last tool activity";
    }
  }

  // File churn
  if (fileCount >= 20 && (input.stateHint === "paused" || input.stateHint === "unknown")) {
    return `quiet after ${fileCount} file changes`;
  }
  if (fileCount >= 3 && (input.stateHint === "paused" || input.stateHint === "unknown")) {
    return "quiet after recent file changes";
  }
  if (files.some((name) => /\.test\.|\.spec\.|__tests__/i.test(name)) && input.stateHint === "paused") {
    return "quiet after test file changes";
  }
  if (files.some((name) => /workbench|headline|sessioncard/i.test(name)) && input.stateHint === "paused") {
    return "quiet after UI changes";
  }

  // Primary status nuances — reserve "stalled with no new turns" for true stalled status only.
  // Idle/paused after a completed turn or recent reading work should not use this copy.
  if ((status === "stalled" || status === "possibly_looping") && input.stateHint !== "active") {
    return "stalled with no new turns";
  }
  if (status.includes("waiting") && input.stateHint !== "active") return "waiting for the next required input";

  return undefined;
}

function dispositionFromEventSummary(summary: string, stateHint: BoardHeadlineInput["stateHint"]): string | undefined {
  const cleaned = summary.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 120) return undefined;
  if (!isUsefulDispositionSnippet(cleaned) && !/git |npm |vitest|commit|test/i.test(cleaned)) return undefined;

  const idle = stateHint === "paused" || stateHint === "unknown" || stateHint === "completed";
  const active = stateHint === "active";

  if (/\bgit\s+commit\b|\bgit commit\b|fix\([^)]+\):|feat\([^)]+\):|docs\([^)]+\):/i.test(cleaned) || /^fix:|^feat:|^docs:|^test:|^chore:/i.test(cleaned)) {
    return idle ? "quiet after last commit" : active ? "committing changes" : "after last commit";
  }
  if (/\bnpm test\b|\bvitest\b|\bjest\b|\bpytest\b|\btest run\b/i.test(cleaned)) {
    if (/\bfail/i.test(cleaned)) return "last test run failed";
    return idle ? "quiet after last test run" : active ? "running tests" : "after last test run";
  }
  if (/\bnpm run build\b|\btsc\b|\btypecheck\b|\bbuild\b/i.test(cleaned)) {
    if (/\bfail/i.test(cleaned)) return "last build failed";
    return idle ? "quiet after last build" : active ? "building" : "after last build";
  }
  if (/\bgit add\b|\bgit status\b|\bgit diff\b/i.test(cleaned)) {
    return idle ? "quiet after git review" : active ? "reviewing git changes" : "after git review";
  }
  if (/^grok build hook event$/i.test(cleaned) || /^codex hook event\b/i.test(cleaned)) {
    return idle ? "hook activity settled" : undefined;
  }
  return undefined;
}

function idleDispositionFallback(input: BoardHeadlineInput): string {
  const status = input.primaryStatus.toLowerCase();
  if (status === "stalled" || status === "possibly_looping") return "stalled with no new turns";
  if ((input.facts.changedFileCount ?? 0) > 0) return "no new agent turns";
  if (input.facts.recentToolNames.length > 0) return "no new tool activity";
  return "no new agent activity";
}

function activeDispositionFallback(input: BoardHeadlineInput): string {
  const tools = input.facts.recentToolNames;
  if (tools.some((tool) => /test|vitest/i.test(tool))) return "running checks";
  if (tools.some((tool) => /edit|write|search_replace/i.test(tool))) return "editing files";
  if (tools.some((tool) => /read|grep|search|list/i.test(tool))) return "inspecting the workspace";
  if ((input.facts.changedFileCount ?? 0) > 0) return "making file changes";
  return "in progress";
}

function waitingDispositionFallback(input: BoardHeadlineInput): string {
  if (input.signals.includes("approval_waiting")) return "waiting for approval";
  if (input.signals.includes("user_reply_waiting")) return "waiting for a user reply";
  return "waiting for the next required input";
}

function isUsefulDispositionSnippet(value: string): boolean {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 6 || cleaned.length > 72) return false;
  if (/\bhttps?:\/\//i.test(cleaned)) return false;
  if (/::[-\w]+\{[^}]*\}/i.test(cleaned)) return false;
  if (/\bsk-[A-Za-z0-9_-]+\b/i.test(cleaned)) return false;
  if (hasUnsafeCredentialName(cleaned)) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(cleaned)) return false; // tool names
  if (/^grok build hook event$/i.test(cleaned) || /^codex hook event\b/i.test(cleaned)) return false;
  if (/^high-risk change$/i.test(cleaned)) return true;
  if (/[{}`|=]/.test(cleaned)) return false;
  return true;
}

function clipDisposition(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.?!]+$/g, "");
  if (cleaned.length <= 72) return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  return `${cleaned.slice(0, 69).trim()}...`;
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
  if (input.stateHint === "active") return activeDispositionFallback(input);
  if (input.stateHint === "paused") return idleDispositionFallback(input);
  if (input.stateHint === "waiting") return waitingDispositionFallback(input);
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
