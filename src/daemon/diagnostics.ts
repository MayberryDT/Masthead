import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type RuntimeDiagnosticSeverity = "info" | "warning" | "error";

export type RuntimeDiagnosticEvent = {
  id: number;
  at: string;
  kind: string;
  message: string;
  severity: RuntimeDiagnosticSeverity;
  details?: unknown;
};

const maxEvents = 200;
const slowRequestThresholdMs = parsePositiveInteger(process.env.MASTHEAD_SLOW_REQUEST_MS, 1_000);
const verboseDiagnostics = process.env.MASTHEAD_DIAGNOSTIC_LOGS === "1";
const diagnosticLogFile = process.env.MASTHEAD_DIAGNOSTIC_LOG_FILE;
const events: RuntimeDiagnosticEvent[] = [];
let nextEventId = 1;

export function recordRuntimeDiagnostic(input: {
  kind: string;
  message: string;
  severity?: RuntimeDiagnosticSeverity;
  details?: unknown;
}): RuntimeDiagnosticEvent {
  const event: RuntimeDiagnosticEvent = {
    at: new Date().toISOString(),
    details: input.details === undefined ? undefined : sanitizeDiagnosticValue(input.details),
    id: nextEventId,
    kind: input.kind,
    message: input.message,
    severity: input.severity ?? "info"
  };
  nextEventId += 1;
  events.push(event);
  while (events.length > maxEvents) events.shift();

  if (event.severity === "error") {
    console.error(`[masthead] ${event.message}`, event.details ?? "");
  } else if (event.severity === "warning") {
    console.warn(`[masthead] ${event.message}`, event.details ?? "");
  } else if (verboseDiagnostics) {
    console.log(`[masthead] ${event.message}`, event.details ?? "");
  }
  writeDiagnosticLog(event);

  return event;
}

export function recordRequestDiagnostic(input: {
  elapsedMs: number;
  method?: string;
  pathname: string;
  statusCode: number;
}): void {
  if (input.statusCode < 400 && input.elapsedMs < slowRequestThresholdMs) return;
  recordRuntimeDiagnostic({
    details: {
      elapsedMs: input.elapsedMs,
      method: input.method ?? "GET",
      pathname: input.pathname,
      statusCode: input.statusCode
    },
    kind: "http_request",
    message:
      input.statusCode >= 400
        ? `HTTP ${input.method ?? "GET"} ${input.pathname} returned ${input.statusCode}`
        : `HTTP ${input.method ?? "GET"} ${input.pathname} took ${input.elapsedMs}ms`,
    severity: input.statusCode >= 500 || input.elapsedMs >= slowRequestThresholdMs * 5 ? "warning" : "info"
  });
}

export function runtimeDiagnosticsSnapshot(): {
  generatedAt: string;
  maxEvents: number;
  logFile?: string;
  events: RuntimeDiagnosticEvent[];
} {
  return {
    events: [...events],
    generatedAt: new Date().toISOString(),
    ...(diagnosticLogFile ? { logFile: diagnosticLogFile } : {}),
    maxEvents
  };
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack
    };
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeDiagnosticValue(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    output[key] = sanitizeDiagnosticValue(entry, depth + 1);
  }
  return output;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function writeDiagnosticLog(event: RuntimeDiagnosticEvent): void {
  if (!diagnosticLogFile) return;
  if (event.severity === "info" && !verboseDiagnostics) return;
  try {
    mkdirSync(dirname(diagnosticLogFile), { recursive: true });
    appendFileSync(diagnosticLogFile, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.error("[masthead] failed to write diagnostic log", sanitizeDiagnosticValue(error));
  }
}
