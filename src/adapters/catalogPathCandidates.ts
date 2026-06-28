import { resolve } from "node:path";
import { canScanHarness, harnessForRuntime, type HarnessCatalogEntry } from "./harnessCatalog.ts";
import type { AdapterPathCandidate } from "./pathTypes.ts";
import type { DiscoveryContext, RuntimeKind } from "./types.ts";

export function catalogPathCandidatesForRuntime(runtime: RuntimeKind, context: DiscoveryContext): AdapterPathCandidate[] {
  const harness = harnessForRuntime(runtime);
  if (!harness || !canScanHarness(harness)) return [];
  return catalogPathCandidatesForHarness(harness, context);
}

export function catalogPathCandidatesForHarness(harness: HarnessCatalogEntry, context: DiscoveryContext): AdapterPathCandidate[] {
  const paths = new Set<string>();
  for (const envName of harness.envOverrides) {
    const value = process.env[envName]?.trim();
    const expanded = value ? expandCatalogPath(value, context) : undefined;
    if (expanded) paths.add(expanded);
  }
  for (const catalogPath of harness.knownCandidatePaths) {
    const expanded = expandCatalogPath(catalogPath, context);
    if (expanded) paths.add(expanded);
  }

  return [...paths].map((path) => candidateForPath(harness, path));
}

function expandCatalogPath(catalogPath: string, context: DiscoveryContext): string | undefined {
  if (!catalogPath || catalogPath.startsWith("project:") || catalogPath.includes("*")) return undefined;
  let expanded = catalogPath;
  if (expanded === "~") expanded = context.homeDir;
  else if (expanded.startsWith("~/")) expanded = `${context.homeDir}${expanded.slice(1)}`;
  expanded = expanded.replace(/%APPDATA%/gi, process.env.APPDATA ?? `${context.homeDir}/AppData/Roaming`);
  expanded = expanded.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? `${context.homeDir}/AppData/Local`);
  return resolve(expanded);
}

function candidateForPath(harness: HarnessCatalogEntry, path: string): AdapterPathCandidate {
  const contentKind = contentKindForPath(harness, path);
  return {
    confidence: "heuristic",
    contentKind,
    maxDepth: 4,
    purpose: `${harness.label} catalog candidate`,
    relativePath: path,
    runtime: harness.runtime,
    sourceKind: sourceKindForContentKind(harness, contentKind)
  };
}

function contentKindForPath(harness: HarnessCatalogEntry, path: string): AdapterPathCandidate["contentKind"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".vscdb") || lower.endsWith(".db") || lower.endsWith(".sqlite")) return "sqlite-file";
  if (lower.endsWith(".jsonl")) return "jsonl-file";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.includes(".history")) return "markdown-files";
  if (harness.sourceKinds.includes("jsonl") && /session|conversation|project|history|transcript/.test(lower)) return "jsonl-tree";
  return "directory";
}

function sourceKindForContentKind(
  harness: HarnessCatalogEntry,
  contentKind: AdapterPathCandidate["contentKind"]
): AdapterPathCandidate["sourceKind"] {
  if (contentKind === "sqlite-file" && harness.sourceKinds.includes("sqlite")) return "sqlite";
  if ((contentKind === "jsonl-file" || contentKind === "jsonl-tree") && harness.sourceKinds.includes("jsonl")) return "jsonl";
  if (contentKind === "markdown-files" && harness.sourceKinds.includes("ui_signal")) return "ui_signal";
  return "inference";
}
