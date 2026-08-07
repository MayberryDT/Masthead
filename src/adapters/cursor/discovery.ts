import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function cursorCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  // Redirected/test homes must stay under context.homeDir and never escape via Cursor env homes.
  const allowEnvOverrides = context.homeDir === homedir();
  const envRoot = allowEnvOverrides ? process.env.MASTHEAD_CURSOR_HOME?.trim() : undefined;
  const dbPath = allowEnvOverrides ? process.env.CURSOR_DB_PATH?.trim() : undefined;
  const appDataRoot = allowEnvOverrides
    ? (process.env.APPDATA ?? join(context.homeDir, "AppData", "Roaming"))
    : join(context.homeDir, "AppData", "Roaming");
  const roots = envRoot
    ? [envRoot]
    : [
        join(context.homeDir, ".config", "Cursor"),
        join(context.homeDir, "Library", "Application Support", "Cursor"),
        join(appDataRoot, "Cursor")
      ];

  return [
    ...(dbPath ? [candidate("Cursor global SQLite state", dbPath, "sqlite-file")] : []),
    ...roots.flatMap((root) => [
      candidate("Cursor global SQLite state", join(root, "User", "globalStorage", "state.vscdb"), "sqlite-file"),
      candidate("Cursor workspace storage", join(root, "User", "workspaceStorage"), "sqlite-file")
    ])
  ];
}

function candidate(purpose: string, relativePath: string, contentKind: AdapterPathCandidate["contentKind"]): AdapterPathCandidate {
  return {
    confidence: "heuristic",
    contentKind,
    maxDepth: 4,
    purpose,
    relativePath,
    runtime: "cursor",
    sourceKind: "sqlite"
  };
}
