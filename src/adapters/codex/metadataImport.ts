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
      const parsed = safeJson(line);
      const sessionId = sourceSessionId(parsed, file);
      const observedAt = stringField(parsed, ["timestamp", "created_at", "createdAt", "updated_at", "updatedAt"]) ?? new Date(0).toISOString();
      const metadata = {
        observedAt,
        project: stringField(parsed, ["project", "cwd", "repo_root", "repoRoot"]),
        sessionId,
        title: stringField(parsed, ["title", "objective", "prompt"])
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

function safeJson(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
