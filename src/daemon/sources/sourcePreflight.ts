import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterDiagnostic, DiscoveryContext, RuntimeKind } from "../../adapters/types.ts";

export type SourcePreflightDto = {
  path: string;
  exists: boolean;
  readable: boolean;
  kind: "file" | "directory" | "missing" | "other";
  fileCount: number;
  byteCount: number;
  candidateSessionCount: number;
  lastModifiedAt?: string;
  diagnostics: AdapterDiagnostic[];
};

export type SourcePreflightResult = {
  runtime: RuntimeKind;
  state: "connected" | "degraded" | "not_detected";
  discoveredCount: number;
  diagnostics: AdapterDiagnostic[];
  checkedPaths: SourcePreflightDto[];
};

const codexCandidates = [
  { path: "session_index.jsonl", kind: "jsonl-lines" },
  { path: "history.jsonl", kind: "jsonl-lines" },
  { path: "sessions", kind: "jsonl-files" },
  { path: "archived_sessions", kind: "jsonl-files" }
] as const;

export async function sourcePreflight(context: DiscoveryContext): Promise<SourcePreflightResult[]> {
  const codexRoot = join(context.homeDir, ".codex");
  const checkedPaths = await Promise.all(codexCandidates.map((candidate) => preflightCodexPath(join(codexRoot, candidate.path), candidate.kind, context.now)));
  const diagnostics = checkedPaths.flatMap((path) => path.diagnostics);
  const discoveredCount = checkedPaths.reduce((total, path) => total + path.candidateSessionCount, 0);
  const existing = checkedPaths.filter((path) => path.exists);
  if (existing.length === 0) {
    diagnostics.push({
      code: "codex_sources_not_detected",
      message: "No Codex local session store was found in ~/.codex.",
      observedAt: context.now,
      severity: "warning"
    });
  }
  const state = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "degraded" : discoveredCount > 0 ? "connected" : "not_detected";
  return [{ checkedPaths, diagnostics, discoveredCount, runtime: "codex", state }];
}

export async function preflightCodexPath(path: string, countMode: "jsonl-lines" | "jsonl-files" = "jsonl-lines", observedAt = new Date().toISOString()): Promise<SourcePreflightDto> {
  try {
    await access(path);
  } catch {
    return { path, exists: false, readable: false, kind: "missing", fileCount: 0, byteCount: 0, candidateSessionCount: 0, diagnostics: [] };
  }

  try {
    const info = await stat(path);
    if (info.isFile()) {
      return { path, exists: true, readable: true, kind: "file", fileCount: 1, byteCount: info.size, candidateSessionCount: await countValidJsonLines(path), lastModifiedAt: info.mtime.toISOString(), diagnostics: [] };
    }
    if (info.isDirectory()) {
      const files = await jsonlFiles(path);
      const stats = await Promise.all(files.map(async (file) => ({ file, info: await stat(file) })));
      const candidateSessionCount = countMode === "jsonl-files" ? files.length : (await Promise.all(files.map((file) => countValidJsonLines(file)))).reduce((total, count) => total + count, 0);
      return { path, exists: true, readable: true, kind: "directory", fileCount: files.length, byteCount: stats.reduce((total, entry) => total + entry.info.size, 0), candidateSessionCount, lastModifiedAt: stats.map((entry) => entry.info.mtime.toISOString()).toSorted().at(-1) ?? info.mtime.toISOString(), diagnostics: [] };
    }
    return { path, exists: true, readable: true, kind: "other", fileCount: 0, byteCount: info.size, candidateSessionCount: 0, lastModifiedAt: info.mtime.toISOString(), diagnostics: [diagnostic("source_unsupported_kind", `Checked ${path}; path is not a file or directory.`, "warning", observedAt)] };
  } catch (error) {
    return { path, exists: true, readable: false, kind: "other", fileCount: 0, byteCount: 0, candidateSessionCount: 0, diagnostics: [diagnostic("source_unreadable", `Checked ${path}; path could not be read.`, "error", observedAt, error)] };
  }
}

async function countValidJsonLines(path: string): Promise<number> {
  const text = await readFile(path, "utf8");
  let count = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      JSON.parse(trimmed);
      count += 1;
    } catch {
      // Ignore corrupt lines; import jobs surface record-level failures.
    }
  }
  return count;
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

function diagnostic(code: string, message: string, severity: AdapterDiagnostic["severity"], observedAt: string, error?: unknown): AdapterDiagnostic {
  return {
    code,
    details: error instanceof Error ? error.message : undefined,
    message,
    observedAt,
    severity
  };
}
