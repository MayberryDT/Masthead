const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [SECRET:bearer_token]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [SECRET:bearer_token]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[SECRET:github_token]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[SECRET:api_key]"],
  [/\b(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "[SECRET:database_url]"],
  [/Cookie:\s*[^\n\r]+/gi, "Cookie: [SECRET:cookie]"],
  [/\b(AWS|GOOGLE|OPENAI|ANTHROPIC|SUPABASE|GITHUB)?_?(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s\n\r]+/gi, "[SECRET:env_secret]"],
  [/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[SECRET:credentials]@"]
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
