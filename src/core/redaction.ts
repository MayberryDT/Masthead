const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const REDACTION_PLACEHOLDER_PATTERN = /\[(?:SECRET:[^\]]+|redacted)\]/gi;
const REDACTION_ONLY_WRAPPER_PATTERN = /^(?:(?:authorization\s*:\s*)?bearer|cookie\s*:?)$/i;

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
  [/\b(AWS|GOOGLE|OPENAI|ANTHROPIC|SUPABASE|GITHUB)?_?(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s\n\r]+/gi, "[SECRET:env_secret]"]
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

export function redactText(input: string): string {
  let redacted = input.replace(PRIVATE_KEY_PATTERN, "[SECRET:private_key]");
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function hasSemanticRedactedText(input: string): boolean {
  const retained = input.replace(REDACTION_PLACEHOLDER_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!retained || REDACTION_ONLY_WRAPPER_PATTERN.test(retained)) return false;
  return /[\p{L}\p{N}]/u.test(retained);
}

export function redactJsonValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJsonValue(entry)]));
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
