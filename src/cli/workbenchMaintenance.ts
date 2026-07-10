import { resolveWorkbenchDatabasePath } from "./dbPath.ts";
import { errorResult, jsonResult, type CliResult } from "./output.ts";
import { wipePublishedArtifactState } from "../daemon/db/sessionArtifactRepository.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";

export async function runWipePublishedMaintenance(
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  if (!args.includes("--confirm")) {
    return errorResult("missing_argument", "Pass --confirm to wipe published Logbook/artifact state", json);
  }
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    return jsonResult({ databasePath, ok: true, ...wipePublishedArtifactState(db) });
  } finally {
    db.close();
  }
}
