import { validatePageRevisionV1, validatePublishPageRequestV1 } from "./contract.ts";
import type { PageRevisionV1, PublishPageRequestV1 } from "./types.ts";

export type EgressSeverity = "block" | "warn" | "info";

export type EgressFinding = {
  severity: EgressSeverity;
  code: string;
  path: string;
  message: string;
};

export type EgressScanResult = {
  decision: "ready" | "needs_review" | "blocked";
  findings: EgressFinding[];
};

const INTERNAL_FIELD_NAMES = new Set([
  "artifactId",
  "fingerprint",
  "hostId",
  "localArtifactId",
  "repoRoot",
  "sessionId",
  "sourceSessionId",
  "worktreePath",
]);
const TRANSCRIPT_FIELD_NAMES = new Set([
  "files",
  "messages",
  "rawTranscript",
  "timeline",
  "tools",
  "transcript",
  "transcriptRows",
]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i,
  /\bAuthorization:\s*Bearer\s+[^\s]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/,
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s'"`]+/i,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /\b(?:[A-Z][A-Z0-9_]*_)?(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s]+/,
];
const ABSOLUTE_PATH_PATTERNS = [
  /(?:^|[\s"'`])\/(?:home|Users|private|var|etc|opt|workspace|tmp)\/[^^\s"'`]+/,
  /\b[A-Za-z]:\\(?:Users|ProgramData|Windows|workspace|temp)\\[^\s"']+/,
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const HTML_PATTERN = /<\/?[a-z][^>]*>/i;
const COMMAND_OUTPUT_PATTERN = /(?:^diff --git |\n(?:stdout|stderr):|\n\$\s)/m;
const PRIVATE_REPOSITORY_PATTERN = /https:\/\/[^\s]*(?:private|internal)[^\s]*/i;
const REVIEW_LANGUAGE_PATTERN = /\b(?:customer|production|prod(?:uction)? database)\b/i;

export function scanPageEgress(page: PageRevisionV1): EgressScanResult {
  const findings = scanValue(page, "");
  const validation = validatePageRevisionV1(page);
  if (!validation.ok) {
    findings.push(...validation.issues.map((issue) => finding("block", "invalid_portable_schema", issue.path, "Portable Page schema validation failed")));
  }
  return finalize(findings);
}

export function scanCompleteOutboundRequest(value: unknown): EgressScanResult {
  const findings = scanValue(value, "");
  const validation = validatePublishPageRequestV1(value);
  if (!validation.ok) {
    findings.push(...validation.issues.map((issue) => finding("block", "invalid_publish_request", issue.path, "Outbound request validation failed")));
  }
  return finalize(findings);
}

function scanValue(value: unknown, path: string): EgressFinding[] {
  if (typeof value === "string") return scanText(value, path);
  if (Array.isArray(value)) return value.flatMap((item, index) => scanValue(item, `${path}/${index}`));
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = `${path}/${escapeJsonPointer(key)}`;
    const findings: EgressFinding[] = [];
    if (INTERNAL_FIELD_NAMES.has(key)) {
      findings.push(finding("block", "internal_identifier", entryPath, "Internal local identifiers are not publishable"));
    }
    if (TRANSCRIPT_FIELD_NAMES.has(key)) {
      findings.push(finding("block", "transcript_shaped_data", entryPath, "Transcript-shaped local data is not publishable"));
    }
    return [...findings, ...scanValue(entry, entryPath)];
  });
}

function scanText(value: string, path: string): EgressFinding[] {
  const findings: EgressFinding[] = [];
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    findings.push(finding("block", "secret_detected", path, "Confirmed secret or credential detected"));
  }
  if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    findings.push(finding("block", "absolute_path", path, "Absolute local path detected"));
  }
  if (HTML_PATTERN.test(value)) {
    findings.push(finding("block", "html_content", path, "Raw HTML is not publishable"));
  }
  if (COMMAND_OUTPUT_PATTERN.test(value)) {
    findings.push(finding("block", "complete_command_output", path, "Complete command output is not publishable"));
  }
  if (path.includes("/sourceLinks/") && !value.startsWith("https://")) {
    findings.push(finding("block", "unsafe_source_link", path, "Source links must be approved public HTTPS URLs"));
  }
  if (EMAIL_PATTERN.test(value)) {
    findings.push(finding("warn", "personal_identifier", path, "Potential personal information requires review"));
  }
  if (PRIVATE_REPOSITORY_PATTERN.test(value)) {
    findings.push(finding("warn", "private_repository_url", path, "Potential private repository URL requires review"));
  }
  if (REVIEW_LANGUAGE_PATTERN.test(value)) {
    findings.push(finding("warn", "sensitive_context", path, "Potential customer or production context requires review"));
  }
  if (path.endsWith("/text") && Array.from(value).length > 4_000) {
    findings.push(finding("block", "evidence_text_too_long", path, "Evidence text exceeds the public limit"));
  }
  return findings;
}

function finalize(findings: EgressFinding[]): EgressScanResult {
  const unique = [...new Map(findings.map((item) => [`${item.severity}:${item.code}:${item.path}`, item])).values()];
  if (unique.some((item) => item.severity === "block")) return { decision: "blocked", findings: unique };
  if (unique.some((item) => item.severity === "warn")) return { decision: "needs_review", findings: unique };
  return { decision: "ready", findings: unique };
}

function finding(severity: EgressSeverity, code: string, path: string, message: string): EgressFinding {
  return { severity, code, path, message };
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function scanPublishPageRequestEgress(request: PublishPageRequestV1): EgressScanResult {
  return scanCompleteOutboundRequest(request);
}
