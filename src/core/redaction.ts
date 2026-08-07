const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const REDACTION_PLACEHOLDER_PATTERN = /\[(?:SECRET:[^\]]+|redacted)\]/gi;
const REDACTION_SECRET_KIND_PATTERN = /\[SECRET:([^\]]+)\]/gi;
const REDACTION_STRUCTURAL_LABEL_PATTERN =
  /(^[ \t]*|[{\[,][ \t]*)(["']?)([\p{L}\p{N}_][\p{L}\p{N}_.\-/ ]*)\2[ \t]*[:=]/gmu;
const REDACTION_WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const REDACTION_WRAPPER_TOKENS = new Set([
  "api",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "email",
  "header",
  "headers",
  "key",
  "metadata",
  "password",
  "private",
  "secret",
  "token",
  "user",
  "username",
  "value"
]);

const CLI_SECRET_FLAG_PATTERN =
  /(?:^|[\s"'`])(?:--?(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth-token|cookie|credentials?))\b(?:\s*(?:=|\s)\s*[^\s"'`]+)?/gi;

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [SECRET:bearer_token]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [SECRET:bearer_token]"],
  [/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[SECRET:credentials]@"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[SECRET:email]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[SECRET:github_token]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[SECRET:github_token]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[SECRET:slack_token]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[SECRET:aws_access_key]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[SECRET:api_key]"],
  [/\b[0-9a-f]{32,}\b/gi, "[SECRET:hex_token]"],
  [/\b(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "[SECRET:database_url]"],
  [/Cookie:\s*[^\n\r]+/gi, "Cookie: [SECRET:cookie]"],
  [/\b(AWS|GOOGLE|OPENAI|ANTHROPIC|SUPABASE|GITHUB)?_?(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s\n\r]+/gi, "[SECRET:env_secret]"],
  [CLI_SECRET_FLAG_PATTERN, " [SECRET:cli_flag]"]
];

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env(?:\..*)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.sqlite(?:3|)$/i,
  /\.db$/i
];

const SENSITIVE_KEY_TOKENS: Record<string, true> = {
  password: true,
  passwd: true,
  pwd: true,
  secret: true,
  token: true,
  cookie: true,
  cookies: true,
  credential: true,
  credentials: true,
  authorization: true,
  auth: true,
  privatekey: true,
  accesskey: true,
  apikey: true,
  sessioncookie: true,
  setcookie: true
};

const SENSITIVE_KEY_WITH_KEY_MODIFIERS: Record<string, true> = {
  api: true,
  private: true,
  access: true,
  secret: true,
  auth: true,
  session: true
};

export function redactText(input: string): string {
  let redacted = input.replace(PRIVATE_KEY_PATTERN, "[SECRET:private_key]");
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function hasSemanticRedactedText(input: string): boolean {
  const placeholderKinds = [...input.matchAll(REDACTION_SECRET_KIND_PATTERN)].map((match) => match[1] ?? "");
  const hasPlaceholder = placeholderKinds.length > 0 || /\[redacted\]/i.test(input);
  if (!hasPlaceholder) return /[\p{L}\p{N}]/u.test(input);

  const wrapperTokens = new Set(REDACTION_WRAPPER_TOKENS);
  for (const kind of placeholderKinds) {
    for (const token of redactionIdentifierTokens(kind)) wrapperTokens.add(token.toLowerCase());
  }
  const retained = input
    .replace(REDACTION_PLACEHOLDER_PATTERN, " ")
    .replace(REDACTION_STRUCTURAL_LABEL_PATTERN, (match, prefix: string, _quote: string, label: string) =>
      isRedactionWrapperLabel(label, wrapperTokens) ? prefix : match
    );
  return redactionIdentifierTokens(retained).some((token) => !wrapperTokens.has(token.toLowerCase()));
}

function isRedactionWrapperLabel(label: string, wrapperTokens: Set<string>): boolean {
  const labelTokens = redactionIdentifierTokens(label);
  if (labelTokens.length === 0) return false;
  if (labelTokens.every((token) => wrapperTokens.has(token.toLowerCase()))) return true;
  const normalized = label.trim();
  return /^x[-_.]/i.test(normalized) || /(?:^|[-_.])header$/i.test(normalized);
}

function redactionIdentifierTokens(value: string): string[] {
  return value
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .match(REDACTION_WORD_PATTERN) ?? [];
}

export function isSensitiveKey(key: string): boolean {
  const tokens = redactionIdentifierTokens(key).map((token) => token.toLowerCase());
  if (tokens.length === 0) return false;

  const compact = tokens.join("");
  if (SENSITIVE_KEY_TOKENS[compact]) return true;
  if (tokens.some((token) => SENSITIVE_KEY_TOKENS[token])) return true;
  if (tokens.includes("key") && tokens.some((token) => SENSITIVE_KEY_WITH_KEY_MODIFIERS[token])) {
    return true;
  }
  return false;
}

export function redactJsonValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? "[SECRET:json_field]" : redactJsonValue(entry)
    ])
  );
}

export function redactCommandOutput(input: string, maxLength = 2000): { text: string; truncated: boolean } {
  const redacted = redactText(input);
  if (redacted.length <= maxLength) {
    return { text: redacted, truncated: false };
  }
  return { text: redacted.slice(0, maxLength), truncated: true };
}

export function redactPath(path: string): { path: string; sensitivity: "metadata" | "sensitive_path_only" } {
  const sensitivity = SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))
    ? "sensitive_path_only"
    : "metadata";
  return { path, sensitivity };
}
