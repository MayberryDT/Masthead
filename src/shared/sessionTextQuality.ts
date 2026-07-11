export type SessionTextQualityContext = {
  project?: string;
  sessionId?: string;
  sourceSessionId?: string;
};

export function cleanSessionText(value: string | null | undefined, maxLength = 96): string | undefined {
  const cleaned = value
    ?.replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trim()}...` : cleaned;
}

export function isWeakSessionTitle(value: string | null | undefined, context: SessionTextQualityContext = {}): boolean {
  const cleaned = cleanSessionText(value);
  const normalized = cleaned?.toLowerCase();
  if (!cleaned || !normalized) return true;
  if (!/[a-z0-9]/i.test(cleaned)) return true;
  if (context.sessionId && normalized === context.sessionId.toLowerCase()) return true;
  if (context.sourceSessionId && normalized === context.sourceSessionId.toLowerCase()) return true;
  if (isInstructionWrapper(cleaned)) return true;
  if (isGenericSessionTitle(cleaned, context.project)) return true;
  if (isWeakGeneratedTitle(cleaned)) return true;
  if (isOpaqueIdentifier(cleaned)) return true;
  if (looksLikeSerializedPayload(cleaned)) return true;
  if (containsSensitiveMarker(cleaned)) return true;
  return false;
}

export function isUsefulSessionTitle(value: string | null | undefined, context: SessionTextQualityContext = {}): value is string {
  return !isWeakSessionTitle(value, context);
}

export function firstUsefulSessionTitle(
  candidates: Array<string | null | undefined>,
  context: SessionTextQualityContext = {}
): string | undefined {
  for (const candidate of candidates) {
    const cleaned = cleanSessionText(candidate);
    if (isUsefulSessionTitle(cleaned, context)) return cleaned;
  }
  return undefined;
}

export function isWeakLiveSummary(value: string | null | undefined): boolean {
  const cleaned = cleanSessionText(value, 140);
  if (!cleaned) return true;
  if (looksLikeSerializedPayload(cleaned)) return true;
  if (containsSensitiveMarker(cleaned)) return true;
  if (looksLikeRawCommand(cleaned)) return true;
  if (/\b(?:codex|claude code|opencode|hermes|grok build|oh my pi|pi) (?:hook|plugin) event\b/i.test(cleaned)) return true;
  if (!/[a-z0-9]/i.test(cleaned)) return true;
  if (/\bwaiting for LLM\b/i.test(cleaned) || /\bLLM headline access\b/i.test(cleaned)) return true;
  if (/^session narrative\s*:/i.test(cleaned)) return true;
  if (/^board headlines\s*:\s*waiting for LLM\b/i.test(cleaned)) return true;
  if (/\bpaused after latest collected evidence\b/i.test(cleaned)) return true;
  if (isWeakGeneratedTitle(cleaned)) return true;
  return false;
}

export function hasAcceptableDisplayCopy(
  input: {
    title?: string | null;
    headline?: string | null;
    summary?: string | null;
  },
  context: SessionTextQualityContext = {}
): boolean {
  if (isUsefulSessionTitle(input.title, context)) return true;
  if (!isWeakLiveSummary(input.headline)) return true;
  if (!isWeakLiveSummary(input.summary)) return true;
  return false;
}

function isInstructionWrapper(value: string): boolean {
  return /^(complete|finish|do|handle)\s+(the\s+)?(assignment|task|request)\s+(below|above|only)?(?:,\s*\w+)?[:\s]*$/i.test(value);
}

function isGenericSessionTitle(value: string, project: string | undefined): boolean {
  const normalized = value.trim().toLowerCase();
  const projectPrefix = project?.trim().toLowerCase();
  const genericTitles = new Set([
    "codex session",
    "untitled session",
    "new session",
    "session",
    "session work",
    "chat session",
    "recent activity",
    "session narrative",
    "session narrative work",
    "current work"
  ]);
  if (genericTitles.has(normalized)) return true;
  if (projectPrefix && (normalized === `${projectPrefix} session` || normalized === `${projectPrefix} codex session`)) return true;
  return /^(codex|claude|cursor|masthead)?\s*(work\s*)?session\s*\d*$/i.test(value);
}

function isWeakGeneratedTitle(value: string): boolean {
  const normalized = value.replace(/[.!?]+$/g, "").trim();
  return (
    /\b(?:for|about)\s+(?:the\s+)?(?:codex hook event|session narrative)\b/i.test(normalized) ||
    /^(?:project\s+)?codex hook event\b/i.test(normalized) ||
    /^session narrative is active\b/i.test(normalized) ||
    /^session narrative(?:\s+work)?$/i.test(normalized) ||
    /^recent activity\b/i.test(normalized) ||
    /\b(?:ready for review|needs review|need review|work is focused on)\b/i.test(normalized) ||
    /\bhas recent (?:[\w .-]+\s+)?activity\b/i.test(normalized) ||
    /\bbeing (?:fixed|updated|reviewed|validated) for\b/i.test(normalized)
  );
}

function isOpaqueIdentifier(value: string): boolean {
  const normalized = value.trim();
  const withoutSessionSuffix = normalized.replace(/\s+session$/i, "").trim();
  if (withoutSessionSuffix !== normalized) return isOpaqueIdentifier(withoutSessionSuffix);
  if (
    /^[0-9a-f]{12,}$/i.test(normalized) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    return true;
  }
  if (/^session[-_:][a-z0-9][a-z0-9_-]{5,}$/i.test(normalized)) return true;
  return !/\s/.test(normalized) && /^[a-z0-9_-]{24,}$/i.test(normalized);
}

function looksLikeSerializedPayload(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[") || value.includes('"event"') || value.includes("\\n") || /^https?:\/\//i.test(value);
}

function containsSensitiveMarker(value: string): boolean {
  return (
    /\b(?:private|confidential|secret|token|password)\b/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/.test(value) ||
    /@/.test(value)
  );
}

function looksLikeRawCommand(value: string): boolean {
  return /^(?:npm|pnpm|yarn|node|python|python3|bash|sh|zsh|git|curl|cat|sed|rg|grep)\s+/.test(value);
}
