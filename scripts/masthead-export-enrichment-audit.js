#!/usr/bin/env node
import { readFileSync } from "node:fs";

const DEFAULT_FILE = "/tmp/masthead-enrichment-audit.jsonl";

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const file = options.file ?? DEFAULT_FILE;
  const raw = readFileSync(file, "utf8");
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => parseLine(line, index + 1))
    .filter((event) => matchesFilters(event, options))
    .slice(-(options.limit ?? 200))
    .map(sanitizeValue);

  const output = options.pretty ? JSON.stringify(events, null, 2) : events.map((event) => JSON.stringify(event)).join("\n");
  process.stdout.write(`${output}${output ? "\n" : ""}`);
}

function parseArgs(args) {
  const options = { kind: "all", limit: 200, pretty: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === "--file") options.file = value;
    else if (arg === "--session") options.session = value;
    else if (arg === "--kind") options.kind = value;
    else if (arg === "--since") options.since = value;
    else if (arg === "--limit") options.limit = parsePositiveInteger(value, "--limit");
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!["durable", "board", "all"].includes(options.kind)) throw new Error("--kind must be durable, board, or all");
  return options;
}

function parseLine(line, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON on line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function matchesFilters(event, options) {
  if (options.session && event.sessionId !== options.session && event.sourceSessionId !== options.session) return false;
  if (options.kind !== "all" && typeof event.kind === "string" && !event.kind.startsWith(`${options.kind}.`)) return false;
  if (options.since && typeof event.at === "string" && event.at < options.since) return false;
  return true;
}

function sanitizeValue(value, depth = 0) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value);
  if (value === undefined) return undefined;
  if (depth >= 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeValue(entry, depth + 1));
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 120)) {
    if (/(password|token|secret|api[_-]?key|authorization)$/i.test(key)) {
      output[key] = "[redacted-secret]";
      continue;
    }
    output[key] = sanitizeValue(entry, depth + 1);
  }
  return output;
}

function sanitizeText(value) {
  return value
    .replace(/\bOPENAI_API_KEY\s*=\s*\S+/gi, "[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\b(password|token|secret|key)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[redacted-secret]")
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/https?:\/\/[^\s"'`]+/gi, "[redacted-url]");
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/masthead-export-enrichment-audit.js [options]

Options:
  --file <path>       Audit JSONL file (default: ${DEFAULT_FILE})
  --session <id>      Filter by canonical or source session id
  --kind <kind>       durable, board, or all (default: all)
  --since <iso>       Keep events at or after this ISO timestamp
  --limit <number>    Max events to print from the tail (default: 200)
  --pretty           Print a formatted JSON array instead of JSONL
  --help             Show this help
`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
