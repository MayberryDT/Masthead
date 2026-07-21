import type { MastheadDatabase } from "./sqlite.ts";

export type MastheadDataRevisionScope = "logbook" | "workbench";

export type MastheadDataRevisions = Record<MastheadDataRevisionScope, number>;

type ActiveRevisionOperation = {
  bumped: Set<MastheadDataRevisionScope>;
  depth: number;
};

const activeOperations = new WeakMap<MastheadDatabase, ActiveRevisionOperation>();

export function getDataRevisions(db: MastheadDatabase): MastheadDataRevisions {
  const rows = db.prepare(
    "SELECT scope, revision FROM masthead_data_revisions ORDER BY scope"
  ).all() as Array<{ revision: number; scope: MastheadDataRevisionScope }>;
  const revisions: MastheadDataRevisions = { logbook: 0, workbench: 0 };
  for (const row of rows) revisions[row.scope] = row.revision;
  return revisions;
}

export function bumpDataRevisionInTransaction(
  db: MastheadDatabase,
  scope: MastheadDataRevisionScope
): void {
  if (!db.isTransaction) throw new Error("data_revision_bump_requires_transaction");
  const operation = activeOperations.get(db);
  if (operation?.bumped.has(scope)) return;
  const result = db.prepare(
    `UPDATE masthead_data_revisions
     SET revision = revision + 1, updated_at = ?
     WHERE scope = ?`
  ).run(new Date().toISOString(), scope);
  if (result.changes !== 1) throw new Error(`data_revision_scope_missing:${scope}`);
  operation?.bumped.add(scope);
}

/** Deduplicates scope bumps made by several low-level writes in one logical operation. */
export function withDataRevisionOperation<T>(db: MastheadDatabase, callback: () => T): T {
  const existing = activeOperations.get(db);
  if (existing) {
    existing.depth += 1;
    try {
      return callback();
    } finally {
      existing.depth -= 1;
    }
  }

  const operation: ActiveRevisionOperation = { bumped: new Set(), depth: 1 };
  activeOperations.set(db, operation);
  try {
    return callback();
  } finally {
    activeOperations.delete(db);
  }
}
