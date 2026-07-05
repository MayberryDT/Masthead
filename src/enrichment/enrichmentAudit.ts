import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export type EnrichmentAuditKind =
  | "durable.started"
  | "durable.facts"
  | "durable.draft"
  | "durable.provider_request"
  | "durable.provider_response"
  | "durable.validation"
  | "durable.persisted"
  | "durable.failed"
  | "board.started"
  | "board.input"
  | "board.provider_request"
  | "board.provider_response"
  | "board.validation"
  | "board.applied"
  | "board.failed";

export type EnrichmentAuditEvent = {
  id: string;
  at: string;
  kind: EnrichmentAuditKind;
  sessionId?: string;
  sourceSessionId?: string;
  runtime?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  inputFingerprint?: string;
  refreshId?: string;
  refreshIntervalMs?: number;
  status?: string;
  latencyMs?: number;
  details?: unknown;
};

export type SanitizeOptions = {
  includeText?: boolean;
  maxText?: number;
  includeProviderPayload?: boolean;
};

export type EnrichmentAuditLogger = {
  enabled: boolean;
  record(event: Omit<EnrichmentAuditEvent, "id" | "at">): void;
};

const DEFAULT_AUDIT_FILE = `${homedir()}/.masthead/enrichment-audit.jsonl`;
const DEFAULT_MAX_TEXT = 1_200;

export function createEnrichmentAuditLogger(env: NodeJS.ProcessEnv = process.env): EnrichmentAuditLogger {
  const enabled = env.MASTHEAD_ENRICHMENT_AUDIT === "1";
  const file = env.MASTHEAD_ENRICHMENT_AUDIT_FILE || DEFAULT_AUDIT_FILE;
  const options: SanitizeOptions = {
    includeProviderPayload: env.MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_PROVIDER_PAYLOAD === "1",
    includeText: env.MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_TEXT === "1",
    maxText: parsePositiveInteger(env.MASTHEAD_ENRICHMENT_AUDIT_MAX_TEXT, DEFAULT_MAX_TEXT)
  };

  return {
    enabled,
    record(event) {
      if (!enabled) return;
      const row: EnrichmentAuditEvent = {
        ...event,
        at: new Date().toISOString(),
        details: event.details === undefined ? undefined : sanitizeEnrichmentAuditValue(event.details, options),
        id: randomUUID()
      };
      try {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch (error) {
        console.error("[masthead] failed to write enrichment audit event", sanitizeEnrichmentAuditValue(error, options));
      }
    }
  };
}

export function sanitizeEnrichmentAuditValue(value: unknown, options: SanitizeOptions = {}, depth = 0): unknown {
  const maxText = options.maxText ?? DEFAULT_MAX_TEXT;
  if (value instanceof Error) {
    return {
      message: sanitizeText(value.message, options),
      name: value.name,
      stack: sanitizeText(value.stack, options)
    };
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value, options);
  if (value === undefined) return undefined;
  if (depth >= 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeEnrichmentAuditValue(entry, options, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    if (isSecretKey(key)) {
      output[key] = "[redacted-secret]";
      continue;
    }
    if (!options.includeProviderPayload && /^(requestPayload|rawOutput|parsedOutput)$/i.test(key)) {
      output[key] = "[provider-payload-redacted]";
      continue;
    }
    output[key] = sanitizeEnrichmentAuditValue(entry, options, depth + 1);
  }
  return output;
}

function sanitizeText(value: string | undefined, options: SanitizeOptions): string | undefined {
  if (value === undefined) return undefined;
  let output = value
    .replace(/\bOPENAI_API_KEY\s*=\s*\S+/gi, "[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\b(password|token|secret|key)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[redacted-secret]")
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/https?:\/\/[^\s"'`]+/gi, "[redacted-url]");

  if (!options.includeText && output.length > 80) {
    output = `${output.slice(0, 80)}[truncated]`;
  }
  const maxText = options.maxText ?? DEFAULT_MAX_TEXT;
  if (output.length > maxText) return `${output.slice(0, maxText)}[truncated]`;
  return output;
}

function isSecretKey(key: string): boolean {
  return /(password|token|secret|api[_-]?key|key)$/i.test(key);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
