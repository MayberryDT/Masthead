import { redactText } from "./redaction.ts";
import type { LatestFeedbackSnapshot } from "./types";

const MAX_CHARS = 400;

const fileExtensionPattern =
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|yml|yaml|css|scss|rs|py|go|java|rb|php|sh|sql|env|lock)\b/gi;
const relativePathPattern = /\b(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+\b/gi;
const absolutePathPattern = /(?:~|\.{1,2})?\/(?:[\w.@-]+\/)+[\w.@-]+/g;
const commandPattern =
  /\b(?:npm|pnpm|yarn|bun|node|npx|curl|git|cargo|pytest|python3?|pip|make|go|rspec|bundle)\b(?:\s+[^.;,\n]*)?/gi;
const secretNamePattern = /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*(?:\s*=\s*[^\s.,;]+)?\b/gi;
const secretLikePattern = /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]+)\b/g;

export function buildLatestFeedbackSnapshot(
  raw: string,
  options: { observedAt: string }
): LatestFeedbackSnapshot | undefined {
  const normalized = raw.trim();
  if (!normalized) return undefined;

  const redacted = sanitizeFeedback(normalized);
  const operational = operationalText(redacted);
  if (!operational) return undefined;

  const text = truncateSentence(operational, MAX_CHARS);
  return {
    text,
    source: "stop_hook",
    observedAt: options.observedAt,
    redacted: true,
    bytesIn: Buffer.byteLength(raw),
    charsOut: text.length,
    claims: detectClaims(text)
  };
}

function sanitizeFeedback(value: string): string {
  return redactText(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    .replace(absolutePathPattern, "[path]")
    .replace(relativePathPattern, "[path]")
    .replace(fileExtensionPattern, "[file]")
    .replace(commandPattern, "[command]")
    .replace(secretNamePattern, "[secret]")
    .replace(secretLikePattern, "[secret]")
    .replace(/\[SECRET:[^\]]+\]/gi, "[secret]")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function operationalText(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const operationalSentences = sentences.filter((sentence) => operationalPattern.test(sentence));
  return operationalSentences.slice(0, 4).join(" ").trim();
}

function truncateSentence(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  return `${clipped.slice(0, sentenceEnd > 120 ? sentenceEnd : maxChars).trim()}...`;
}

function detectClaims(value: string): LatestFeedbackSnapshot["claims"] {
  const claims = new Set<LatestFeedbackSnapshot["claims"][number]>();
  if (/\b(done|all set|complete|completed|finished|implemented)\b/i.test(value)) claims.add("claims_complete");
  if (/\b(blocked|stuck|waiting|cannot continue)\b/i.test(value)) claims.add("mentions_blocked");
  if (/\b(test|tests|verification|check|build)\b/i.test(value)) claims.add("mentions_tests");
  if (/\b(fail|failed|failing|error|exception|timeout)\b/i.test(value)) claims.add("mentions_error");
  if (/\[path]|\[file]|\b(file|files|changed|edited|updated)\b/i.test(value)) claims.add("mentions_files");
  return [...claims].toSorted();
}

const operationalPattern =
  /\b(done|all set|complete|completed|finished|implemented|blocked|stuck|waiting|test|tests|verification|check|build|fail|failed|failing|error|exception|timeout|file|files|changed|edited|updated)\b|\[path]|\[file]/i;
