import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function cursorCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_CURSOR_HOME ?? join(context.homeDir, ".config", "Cursor");
  const dbPath = process.env.CURSOR_DB_PATH;
  return [
    ...(dbPath ? [candidate("Cursor global SQLite state", dbPath, "sqlite-file")] : []),
    candidate("Cursor global SQLite state", join(root, "User", "globalStorage", "state.vscdb"), "sqlite-file"),
    candidate("Cursor workspace storage", join(root, "User", "workspaceStorage"), "sqlite-file")
  ];
}

function candidate(purpose: string, relativePath: string, contentKind: AdapterPathCandidate["contentKind"]): AdapterPathCandidate {
  return { confidence: "heuristic", contentKind, maxDepth: 4, purpose, relativePath, runtime: "cursor", sourceKind: "sqlite" };
}
