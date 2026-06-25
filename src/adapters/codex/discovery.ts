import { access, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { DiscoveryContext, DiscoveredSource } from "../types.ts";

export type CodexDiscoveryResult = {
  catalogs: DiscoveredSource[];
  transcripts: DiscoveredSource[];
};

export type CodexSourceCandidate = {
  id: string;
  label: string;
  path: string;
  preflightPattern: string;
  expectedKind: "file" | "directory";
  kind: "jsonl";
};

export function codexSourceCandidates(homeDir: string): CodexSourceCandidate[] {
  const root = join(homeDir, ".codex");
  return [
    {
      expectedKind: "file",
      id: "session-index",
      kind: "jsonl",
      label: "Codex session index",
      path: join(root, "session_index.jsonl"),
      preflightPattern: ".codex/session_index.jsonl"
    },
    {
      expectedKind: "file",
      id: "history",
      kind: "jsonl",
      label: "Codex prompt history",
      path: join(root, "history.jsonl"),
      preflightPattern: ".codex/history.jsonl"
    },
    {
      expectedKind: "directory",
      id: "sessions",
      kind: "jsonl",
      label: "Codex active session transcripts",
      path: join(root, "sessions"),
      preflightPattern: ".codex/sessions/**/*.jsonl"
    },
    {
      expectedKind: "directory",
      id: "archived-sessions",
      kind: "jsonl",
      label: "Codex archived session transcripts",
      path: join(root, "archived_sessions"),
      preflightPattern: ".codex/archived_sessions/**/*.jsonl"
    }
  ];
}

export async function discoverCodexSources(context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const candidates = codexSourceCandidates(context.homeDir);
  const sources: DiscoveredSource[] = [];
  for (const candidate of candidates) {
    if (isExcluded(candidate.path, context.exclusions)) continue;
    if (!(await exists(candidate.path))) continue;
    const info = await stat(candidate.path);
    sources.push({
      confidence: "authoritative",
      path: candidate.path,
      runtime: "codex",
      runtimeVersion: info.isDirectory() ? "directory" : "file",
      schemaVersion: "codex-local-jsonl",
      sourceId: `codex-${candidate.id}`,
      sourceKind: candidate.kind
    });
  }
  return sources;
}

export async function discoverCodexDiscovery(context: DiscoveryContext): Promise<CodexDiscoveryResult> {
  const catalogs = await discoverCodexSources(context);
  const transcripts = await discoverCodexTranscriptFiles(context);
  return { catalogs, transcripts };
}

export async function discoverCodexTranscriptFiles(context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const codexRoot = join(context.homeDir, ".codex");
  const roots = [
    { id: "sessions", path: join(codexRoot, "sessions") },
    { id: "archived-sessions", path: join(codexRoot, "archived_sessions") }
  ];
  const transcripts: DiscoveredSource[] = [];

  for (const root of roots) {
    if (isExcluded(root.path, context.exclusions)) continue;
    if (!(await exists(root.path))) continue;
    const info = await stat(root.path);
    if (info.isDirectory()) {
      for (const file of await jsonlFiles(root.path, context.exclusions)) {
        const relativePath = relative(root.path, file).replaceAll("\\", "/");
        transcripts.push({
          confidence: "authoritative",
          path: file,
          runtime: "codex",
          runtimeVersion: "file",
          schemaVersion: "codex-transcript-jsonl",
          sourceId: `codex-${root.id}:${relativePath}`,
          sourceKind: "jsonl"
        });
      }
    }
  }
  return transcripts.toSorted((a, b) => String(a.path).localeCompare(String(b.path)));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isExcluded(path: string, exclusions: DiscoveryContext["exclusions"]): boolean {
  return exclusions.some((exclusion) => path.includes(exclusion.pattern));
}

async function jsonlFiles(directory: string, exclusions: DiscoveryContext["exclusions"]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (isExcluded(path, exclusions)) continue;
    if (entry.isDirectory()) {
      files.push(...(await jsonlFiles(path, exclusions)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}
