import { hasSemanticRedactedText, redactText } from "../core/redaction.ts";

/** Aligned with live task preview / safeFactLabel so titles survive the facts pipeline. */
const TITLE_MAX_CHARS = 80;
const TITLE_MIN_CHARS = 8;

/**
 * Privacy-safe short label from user-turn text for adapter session titles.
 * No LLM; redacts secrets/URLs; truncates at a word boundary.
 */
export function shortUserDerivedTitle(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  let redacted = redactText(collapsed)
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[SECRET:api_key]")
    .replace(/\bhttps?:\/\/[^\s"'`<>]+/gi, "[redacted-url]")
    .replace(/\bwww\.[^\s"'`<>]+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim();

  if (!redacted) return undefined;
  if (/\bhttps?:\/\//i.test(redacted) || /^https[-_:]/i.test(redacted)) return undefined;
  if (!hasSemanticRedactedText(redacted)) return undefined;

  const truncated = truncateAtWordBoundary(redacted, TITLE_MAX_CHARS);
  if (truncated.length < TITLE_MIN_CHARS) return undefined;
  return truncated;
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(maxChars * 0.6) ? slice.slice(0, lastSpace) : slice;
  return base.replace(/[.,;:!?-]+$/g, "").trim();
}
