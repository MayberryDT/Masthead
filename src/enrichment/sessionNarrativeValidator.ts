export type NarrativeField = "title" | "liveSummary" | "outcome" | "searchSummary";

export type NarrativeValidationFailure =
  | "empty"
  | "too_short"
  | "too_long"
  | "generic"
  | "missing_subject"
  | "raw_payload"
  | "path_or_url"
  | "first_person"
  | "direct_address"
  | "secret_like"
  | "status_only"
  | "command_like"
  | "commit_like"
  | "weak_updated_phrase";

export type NarrativeValidationResult =
  | { ok: true; value: string }
  | { ok: false; failures: NarrativeValidationFailure[]; value: string };

export function validateNarrativeField(field: NarrativeField, value: string | undefined): NarrativeValidationResult {
  const normalized = normalizeNarrativeText(value);
  const failures: NarrativeValidationFailure[] = [];

  if (!normalized) failures.push("empty");
  if (normalized && normalized.length < minLength(field)) failures.push("too_short");
  if (normalized && normalized.length > maxLength(field)) failures.push("too_long");
  if (isGeneric(normalized)) failures.push("generic");
  if (isStatusOnly(normalized)) failures.push("status_only");
  if (looksLikeRawPayload(normalized)) failures.push("raw_payload");
  if (looksLikePathOrUrl(normalized)) failures.push("path_or_url");
  if (containsFirstPerson(normalized)) failures.push("first_person");
  if (containsDirectAddress(normalized)) failures.push("direct_address");
  if (containsSecretLikeValue(normalized)) failures.push("secret_like");
  if (looksLikeCommand(normalized)) failures.push("command_like");
  if (looksLikeCommitHash(normalized)) failures.push("commit_like");
  if (isWeakUpdatedPhrase(normalized)) failures.push("weak_updated_phrase");
  if (field !== "searchSummary" && !hasSubjectSignal(normalized)) failures.push("missing_subject");

  return failures.length === 0 ? { ok: true, value: normalized } : { ok: false, failures, value: normalized };
}

export function normalizeNarrativeText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
}

function minLength(field: NarrativeField): number {
  if (field === "title") return 10;
  return 18;
}

function maxLength(field: NarrativeField): number {
  if (field === "title") return 72;
  if (field === "searchSummary") return 420;
  return 140;
}

function isGeneric(value: string): boolean {
  const normalized = value.replace(/[.!?]+$/g, "").toLowerCase();
  return [
    "session",
    "codex session",
    "masthead session",
    "session is complete",
    "session update",
    "codex hook event",
    "runtime signal",
    "recent activity",
    "masthead session had recent activity",
    "updated files",
    "changed files",
    "changed files were updated in this session",
    "done",
    "ready for history",
    "filed in history"
  ].includes(normalized);
}

function isStatusOnly(value: string): boolean {
  return /^(active|idle|running|complete|completed|done|deployed|updated|fixed|ready|blocked|failed)[.!?]?$/i.test(value);
}

function isWeakUpdatedPhrase(value: string): boolean {
  return (
    /^updated\s+(files?|changes?|done|deployed|complete|completed|session|work|recent activity)(?:\s+.*)?[.!?]?$/i.test(
      value
    ) ||
    /^codex hook event\b/i.test(value) ||
    /^changed\s+files?\s+were\s+updated(?:\s+.*)?[.!?]?$/i.test(value) ||
    /\bwork is focused on\b/i.test(value) ||
    /\bbeing (?:fixed|updated|reviewed|validated) for\b/i.test(value) ||
    /\bhas recent (?:[\w .-]+\s+)?activity\b/i.test(value)
  );
}

function looksLikeRawPayload(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[") || value.includes('"event"') || value.includes("{cwd=") || value.includes("::-");
}

function looksLikePathOrUrl(value: string): boolean {
  return /https?:\/\//i.test(value) || /(?:~|\.{1,2})?\/(?:[\w.@-]+\/)+[\w.@-]+/.test(value);
}

function containsFirstPerson(value: string): boolean {
  return /\b(i|me|my|mine|we|our|ours)\b/i.test(value);
}

function containsDirectAddress(value: string): boolean {
  return /\b(you|your|tyler|please|let'?s)\b/i.test(value);
}

function containsSecretLikeValue(value: string): boolean {
  return /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(value) || /\bsk-[A-Za-z0-9_-]+\b/i.test(value);
}

function looksLikeCommand(value: string): boolean {
  return /\b(npm|pnpm|yarn|cargo|git|node|python|bash|sh)\s+[\w:-]/i.test(value);
}

function looksLikeCommitHash(value: string): boolean {
  return /\b[0-9a-f]{7,40}\b/i.test(value);
}

function hasSubjectSignal(value: string): boolean {
  const words = value.replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/^(updated|fixed|added|removed|changed|deployed|completed|done)\b/i.test(value) && words.length < 4) return false;
  return /[a-z]/i.test(value);
}
