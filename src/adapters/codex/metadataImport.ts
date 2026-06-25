import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

export async function* importCodexMetadata(source: DiscoveredSource): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const files = (await stat(source.path)).isDirectory()
    ? (await readdir(source.path))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => join(source.path ?? "", name))
        .toSorted()
    : [source.path];

  for (const file of files) {
    const reader = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      if (!line.trim()) continue;
      const parsed = parseJson(line);
      if (!parsed.ok) {
        yield diagnosticRecord(source, file, line, lineNumber, parsed.message);
        continue;
      }
      const sessionId = sourceSessionId(parsed.value, file);
      const observedAt = stringField(parsed.value, ["timestamp", "created_at", "createdAt", "updated_at", "updatedAt"]) ?? new Date(0).toISOString();
      const metadata = {
        observedAt,
        project: stringField(parsed.value, ["project", "cwd", "repo_root", "repoRoot"]),
        sessionId,
        title: stringField(parsed.value, ["title", "objective", "prompt"])
      };
      yield {
        diagnostics: [],
        normalized: {
          confidence: sessionId ? "inferred" : "heuristic",
          kind: "event",
          sourceRef: {
            runtimeVersion: source.runtimeVersion,
            schemaVersion: source.schemaVersion,
            sourceKind: "jsonl",
            sourcePath: file
          },
          value: metadata
        },
        observedAt,
        payload: metadata,
        payloadHash: hashLine(line),
        source: { ...source, path: file },
        sourceRecordKey: `${basename(file)}:${lineNumber}`
      };
    }
  }
}

function parseJson(line: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null) return { ok: true, value: parsed as Record<string, unknown> };
    return { ok: false, message: "Codex metadata record was not a JSON object." };
  } catch {
    return { ok: false, message: "Codex metadata record was malformed JSON." };
  }
}

function diagnosticRecord(source: DiscoveredSource, file: string, line: string, lineNumber: number, message: string): AdapterRecord {
  const observedAt = new Date(0).toISOString();
  return {
    diagnostics: [
      {
        code: "malformed_json",
        message,
        observedAt,
        severity: "error"
      }
    ],
    normalized: {
      confidence: "heuristic",
      kind: "event",
      sourceRef: {
        runtimeVersion: source.runtimeVersion,
        schemaVersion: source.schemaVersion,
        sourceKind: "jsonl",
        sourcePath: file
      },
      value: {}
    },
    observedAt,
    payload: {},
    payloadHash: hashLine(line),
    source: { ...source, path: file },
    sourceRecordKey: `${basename(file)}:${lineNumber}`
  };
}

function sourceSessionId(value: Record<string, unknown>, file: string): string {
  return stringField(value, ["session_id", "sessionId", "conversation_id", "conversationId", "id"]) ?? basename(file, ".jsonl");
}

function stringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}
