import { resolve } from "node:path";
import { resolveMastheadDataPaths } from "../shared/dataPaths.ts";

export type WorkbenchDatabasePathOptions = {
  args: string[];
  env?: NodeJS.ProcessEnv;
};

export function resolveWorkbenchDatabasePath(options: WorkbenchDatabasePathOptions): string {
  const explicit = explicitDatabasePath(options.args);
  if (explicit) return resolve(explicit);
  return resolveMastheadDataPaths({ env: options.env }).databasePath;
}

function explicitDatabasePath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") return args[index + 1];
    if (arg.startsWith("--db=")) return arg.slice("--db=".length);
  }
  return undefined;
}

