import type { GitChangedPath, NormalizedEvent } from "./types";

const highRiskPathPatterns = [
  /(^|\/)migrations?\//i,
  /(^|\/)schema\.(sql|ts|tsx|js|json)$/i,
  /(^|\/)(auth|billing|payments?|checkout|security)(\/|\.|-|_)/i,
  /(^|\/)(package-lock|pnpm-lock|yarn\.lock|bun\.lockb)$/i,
  /(^|\/)(package|deno|cargo|composer)\.(json|toml|lock)$/i,
  /(^|\/)(deploy|netlify|vercel|docker|compose|terraform|pulumi|cloudflare)(\.|\/|-|_)/i,
  /(^|\/)\.github\/workflows\//i
];

const migrationCommandPatterns = [/\bmigrate\b/i, /\bsupabase\b.*\bdb\b/i, /\bprisma\b.*\bmigrate\b/i];

export function isHighRiskPath(path: string): boolean {
  return highRiskPathPatterns.some((pattern) => pattern.test(path));
}

export function highRiskChangedPaths(paths: GitChangedPath[]): GitChangedPath[] {
  return paths.filter((changedPath) => changedPath.sensitivity !== "sensitive_path_only" && isHighRiskPath(changedPath.path));
}

export function resourceKeysForEvent(event: NormalizedEvent): string[] {
  return unique([
    ...stringArrayPayload(event.payload.sharedResources),
    ...stringArrayPayload(event.payload.resources),
    ...resourceObjectPayload(event.payload.resource),
    ...resourceObjectPayload(event.payload.sharedResource),
    ...portPayload(event.payload.port),
    ...localDatabasePayload(event.payload.localDatabase),
    ...migrationCommandResource(event)
  ]);
}

function stringArrayPayload(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function resourceObjectPayload(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const maybe = value as { kind?: unknown; id?: unknown; name?: unknown };
  const id = typeof maybe.id === "string" ? maybe.id : typeof maybe.name === "string" ? maybe.name : undefined;
  const kind = typeof maybe.kind === "string" ? maybe.kind : "resource";
  return id ? [`${kind}:${id}`] : [];
}

function portPayload(value: unknown): string[] {
  if (typeof value === "number") return [`port:${value}`];
  if (typeof value === "string" && value.length > 0) return [`port:${value}`];
  return [];
}

function localDatabasePayload(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [`local-db:${value}`];
  if (typeof value === "object" && value !== null) {
    const maybe = value as { id?: unknown; name?: unknown; path?: unknown };
    const id =
      typeof maybe.id === "string"
        ? maybe.id
        : typeof maybe.name === "string"
          ? maybe.name
          : typeof maybe.path === "string"
            ? maybe.path
            : undefined;
    return id ? [`local-db:${id}`] : [];
  }
  return [];
}

function migrationCommandResource(event: NormalizedEvent): string[] {
  if (event.type !== "command.started" && event.type !== "command.finished") return [];
  const command = String(event.payload.normalizedCommand ?? event.payload.command ?? "");
  if (!migrationCommandPatterns.some((pattern) => pattern.test(command))) return [];

  const repo = event.workspace?.gitCommonDir ?? event.workspace?.repoRoot ?? event.workspace?.worktreePath;
  return repo ? [`migration:${repo}`] : ["migration:unknown"];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
