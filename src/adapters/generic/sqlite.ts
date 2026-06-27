import { DatabaseSync } from "node:sqlite";
import type { AdapterDiagnostic } from "../types.ts";

export type SqliteInspectionResult = {
  ok: boolean;
  path: string;
  tables: string[];
  diagnostics: AdapterDiagnostic[];
};

export function inspectSqliteDatabase(path: string, observedAt: string): SqliteInspectionResult {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
      .all() as Array<{ name: string }>;
    return { diagnostics: [], ok: true, path, tables: rows.map((row) => row.name) };
  } catch (error) {
    return {
      diagnostics: [
        {
          code: "sqlite_inspect_failed",
          details: error instanceof Error ? error.message : String(error),
          message: "SQLite candidate could not be inspected.",
          observedAt,
          severity: "warning"
        }
      ],
      ok: false,
      path,
      tables: []
    };
  } finally {
    db?.close();
  }
}
