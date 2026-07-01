export type DerivedTranscriptFileEffect = {
  effectKind: "added" | "deleted" | "modified";
  path: string;
};

type TranscriptEffectInput = {
  arguments?: unknown;
  cwd?: string;
  repoRoot?: string;
  toolName?: string;
  worktreePath?: string;
};

type PatchOperation = DerivedTranscriptFileEffect["effectKind"];

const FILE_KEYS = new Set(["file", "filename", "filePath", "path", "paths", "target"]);
const ROOT_KEYS = new Set(["cwd", "repoRoot", "repo_root", "worktreePath", "worktree_path"]);

export function deriveTranscriptFileEffects(input: TranscriptEffectInput): DerivedTranscriptFileEffect[] {
  if (!isMutationTool(input.toolName)) return [];
  const roots = workspaceRoots(input);
  const effects = [
    ...patchFileEffects(input.arguments, roots),
    ...structuredFileEffects(input.arguments, roots)
  ];
  const byKey = new Map<string, DerivedTranscriptFileEffect>();
  for (const effect of effects) {
    byKey.set(`${effect.effectKind}\0${effect.path}`, effect);
  }
  return [...byKey.values()].slice(0, 200);
}

function isMutationTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return /\b(?:apply_patch|edit|file_change|str_replace_editor|update_file|write)\b/i.test(toolName);
}

function patchFileEffects(value: unknown, roots: string[]): DerivedTranscriptFileEffect[] {
  const effects: DerivedTranscriptFileEffect[] = [];
  for (const text of stringValues(value)) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(line.trim());
      if (!match) continue;
      const path = safeCanonicalPath(match[2], roots);
      if (!path) continue;
      effects.push({ effectKind: patchOperation(match[1] as "Add" | "Delete" | "Update"), path });
    }
  }
  return effects;
}

function structuredFileEffects(value: unknown, roots: string[]): DerivedTranscriptFileEffect[] {
  const effects: DerivedTranscriptFileEffect[] = [];
  visitRecords(value, (key, candidate) => {
    if (!FILE_KEYS.has(key)) return;
    for (const pathValue of Array.isArray(candidate) ? candidate : [candidate]) {
      if (typeof pathValue !== "string") continue;
      const path = safeCanonicalPath(pathValue, roots);
      if (path) effects.push({ effectKind: "modified", path });
    }
  });
  return effects;
}

function workspaceRoots(input: TranscriptEffectInput): string[] {
  const roots = [input.cwd, input.repoRoot, input.worktreePath];
  visitRecords(input.arguments, (key, value) => {
    if (ROOT_KEYS.has(key) && typeof value === "string") roots.push(value);
  });
  return roots.map(normalizePath).filter((value): value is string => Boolean(value));
}

function safeCanonicalPath(value: string | undefined, roots: string[]): string | undefined {
  const normalized = normalizePath(value);
  if (!normalized) return undefined;
  const relative = normalized.startsWith("/")
    ? roots.map((root) => relativeToRoot(normalized, root)).find((candidate): candidate is string => Boolean(candidate))
    : normalized.replace(/^\.\//, "");
  if (!relative) return undefined;
  if (relative.startsWith("../") || relative.includes("/../") || relative.startsWith("~")) return undefined;
  if (relative.startsWith(".ssh/") || relative.includes("/.ssh/")) return undefined;
  if (/[^\S ]/.test(relative)) return undefined;
  if (/^https?:\/\//i.test(relative)) return undefined;
  return relative;
}

function relativeToRoot(path: string, root: string | undefined): string | undefined {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot || !path.startsWith(`${normalizedRoot}/`)) return undefined;
  return path.slice(normalizedRoot.length + 1);
}

function normalizePath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll("\\", "/").replace(/^['"]|['"]$/g, "");
  if (!normalized) return undefined;
  return normalized.replace(/\/+/g, "/");
}

function patchOperation(value: "Add" | "Delete" | "Update"): PatchOperation {
  if (value === "Add") return "added";
  if (value === "Delete") return "deleted";
  return "modified";
}

function stringValues(value: unknown): string[] {
  const values: string[] = [];
  visitValues(value, (candidate) => {
    if (typeof candidate === "string") values.push(candidate);
  });
  return values;
}

function visitRecords(value: unknown, visitor: (key: string, value: unknown) => void): void {
  visitValues(value, (candidate) => {
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      visitor(key, entry);
    }
  });
}

function visitValues(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value);
  if (Array.isArray(value)) {
    for (const entry of value) visitValues(entry, visitor);
    return;
  }
  if (!isRecord(value)) return;
  for (const entry of Object.values(value)) visitValues(entry, visitor);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
