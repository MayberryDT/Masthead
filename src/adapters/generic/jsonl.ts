import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { AdapterDiagnostic } from "../types.ts";

export type JsonlRecord = {
  lineNumber: number;
  byteOffset: number;
  raw: string;
  value: unknown;
};

export type JsonlParseOptions = {
  observedAt: string;
  sourcePath: string;
};

export type JsonlParseResult = {
  records: JsonlRecord[];
  diagnostics: AdapterDiagnostic[];
};

export function parseJsonlLines(text: string, options: JsonlParseOptions): JsonlParseResult {
  const records: JsonlRecord[] = [];
  const diagnostics: AdapterDiagnostic[] = [];
  let byteOffset = 0;
  let lineNumber = 1;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        records.push({
          byteOffset,
          lineNumber,
          raw: line,
          value: JSON.parse(trimmed) as unknown
        });
      } catch (error) {
        diagnostics.push({
          code: "jsonl_malformed_line",
          details: `Failed to parse ${options.sourcePath} line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
          message: "JSONL record could not be parsed.",
          observedAt: options.observedAt,
          severity: "warning"
        });
      }
    }
    byteOffset += Buffer.byteLength(line) + 1;
    lineNumber += 1;
  }

  return { diagnostics, records };
}

export async function readJsonlFile(path: string, observedAt: string): Promise<JsonlParseResult> {
  return parseJsonlLines(await readFile(path, "utf8"), { observedAt, sourcePath: path });
}
