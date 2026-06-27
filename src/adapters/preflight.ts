import { access, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { readJsonlFile } from "./generic/jsonl.ts";
import type { AdapterDiagnostic, DiscoveryContext, RuntimeKind } from "./types.ts";
import type { AdapterPathCandidate, AdapterPathPreflight, AdapterRuntimePreflight } from "./pathTypes.ts";
import { pathCandidatesForRuntime } from "./pathCandidates.ts";

const maxPreflightParseBytes = 1_000_000;

export async function preflightAdapterRuntime(
  context: DiscoveryContext,
  runtime: RuntimeKind,
  candidates: AdapterPathCandidate[] = pathCandidatesForRuntime(runtime)
): Promise<AdapterRuntimePreflight> {
  const checkedPaths = await Promise.all(candidates.map((candidate) => preflightAdapterPathCandidate(context, candidate)));
  const diagnostics = checkedPaths.flatMap((path) => path.diagnostics);
  const discoveredCount = checkedPaths.reduce((total, path) => total + (path.candidateRecordCount || path.candidateFileCount), 0);
  const state = diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "degraded"
    : discoveredCount > 0
      ? "connected"
      : "not_detected";
  return { checkedPaths, diagnostics, discoveredCount, runtime, state };
}

export async function preflightAdapterPathCandidate(context: DiscoveryContext, candidate: AdapterPathCandidate): Promise<AdapterPathPreflight> {
  const absolutePath = resolveCandidatePath(context.homeDir, candidate.relativePath);
  await access(absolutePath).catch(() => undefined);

  try {
    const info = await stat(absolutePath);
    if (info.isFile()) {
      const jsonlResult = candidate.contentKind === "jsonl-file" && info.size <= maxPreflightParseBytes ? await readJsonlFile(absolutePath, context.now) : undefined;
      return {
        absolutePath,
        byteCount: info.size,
        candidateFileCount: 1,
        candidateRecordCount: jsonlResult?.records.length ?? 1,
        contentKind: candidate.contentKind,
        diagnostics: jsonlResult?.diagnostics ?? [],
        exists: true,
        kind: "file",
        lastModifiedAt: info.mtime.toISOString(),
        readable: true,
        relativePath: candidate.relativePath,
        runtime: candidate.runtime
      };
    }

    if (info.isDirectory()) {
      const files = await listCandidateFiles(absolutePath, candidate.maxDepth ?? 2, candidate.contentKind);
      const stats = await Promise.all(files.map(async (path) => ({ info: await stat(path), path })));
      return {
        absolutePath,
        byteCount: stats.reduce((total, entry) => total + entry.info.size, 0),
        candidateFileCount: files.length,
        candidateRecordCount: files.length,
        contentKind: candidate.contentKind,
        diagnostics: [],
        exists: true,
        kind: "directory",
        lastModifiedAt: latestDate(stats.map((entry) => entry.info.mtime.toISOString())) ?? info.mtime.toISOString(),
        readable: true,
        relativePath: candidate.relativePath,
        runtime: candidate.runtime
      };
    }

    return preflightOtherPath(context, candidate, absolutePath, info.size, info.mtime.toISOString());
  } catch (error) {
    try {
      await access(absolutePath);
    } catch {
      return missingPreflight(context, candidate, absolutePath);
    }
    return unreadablePreflight(context, candidate, absolutePath, error);
  }
}

function resolveCandidatePath(homeDir: string, relativePath: string): string {
  if (!relativePath || relativePath === "." || relativePath.startsWith("..")) {
    throw new Error(`Adapter path candidate must be a bounded relative path: ${relativePath}`);
  }
  if (isAbsolute(relativePath)) return relativePath;
  const home = resolve(homeDir);
  const absolutePath = resolve(home, relativePath);
  if (absolutePath !== home && !absolutePath.startsWith(`${home}${sep}`)) {
    throw new Error(`Adapter path candidate escapes home directory: ${relativePath}`);
  }
  return absolutePath;
}

async function listCandidateFiles(directory: string, maxDepth: number, contentKind: AdapterPathCandidate["contentKind"]): Promise<string[]> {
  if (maxDepth < 0) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listCandidateFiles(path, maxDepth - 1, contentKind)));
    else if (entry.isFile() && shouldCountFile(entry.name, contentKind)) files.push(path);
  }
  return files;
}

function shouldCountFile(name: string, contentKind: AdapterPathCandidate["contentKind"]): boolean {
  if (contentKind === "jsonl-tree" || contentKind === "jsonl-file") return name.endsWith(".jsonl");
  if (contentKind === "sqlite-file") return name.endsWith(".sqlite") || name.endsWith(".db");
  if (contentKind === "markdown-files") return name.endsWith(".md") || name.endsWith(".markdown") || name.includes("history");
  return true;
}

function missingPreflight(context: DiscoveryContext, candidate: AdapterPathCandidate, absolutePath: string): AdapterPathPreflight {
  return {
    absolutePath,
    byteCount: 0,
    candidateFileCount: 0,
    candidateRecordCount: 0,
    contentKind: candidate.contentKind,
    diagnostics: [],
    exists: false,
    kind: "missing",
    readable: false,
    relativePath: candidate.relativePath,
    runtime: candidate.runtime
  };
}

function unreadablePreflight(context: DiscoveryContext, candidate: AdapterPathCandidate, absolutePath: string, error: unknown): AdapterPathPreflight {
  return {
    absolutePath,
    byteCount: 0,
    candidateFileCount: 0,
    candidateRecordCount: 0,
    contentKind: candidate.contentKind,
    diagnostics: [diagnostic("adapter_path_unreadable", `Adapter path could not be read: ${candidate.relativePath}`, "error", context.now, error)],
    exists: true,
    kind: "other",
    readable: false,
    relativePath: candidate.relativePath,
    runtime: candidate.runtime
  };
}

function preflightOtherPath(
  context: DiscoveryContext,
  candidate: AdapterPathCandidate,
  absolutePath: string,
  byteCount: number,
  lastModifiedAt: string
): AdapterPathPreflight {
  return {
    absolutePath,
    byteCount,
    candidateFileCount: 0,
    candidateRecordCount: 0,
    contentKind: candidate.contentKind,
    diagnostics: [diagnostic("adapter_path_unsupported_kind", `Adapter path is not a file or directory: ${candidate.relativePath}`, "warning", context.now)],
    exists: true,
    kind: "other",
    lastModifiedAt,
    readable: true,
    relativePath: candidate.relativePath,
    runtime: candidate.runtime
  };
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

function latestDate(values: string[]): string | undefined {
  return values.toSorted().at(-1);
}
