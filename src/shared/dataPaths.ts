import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type MastheadDataPaths = {
  dataDirectory: string;
  databasePath: string;
  legacyJournalPath: string;
  runtimeDirectory: string;
  exportsDirectory: string;
  logsDirectory: string;
};

export type DataPathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

export function resolveMastheadDataPaths(options: DataPathOptions = {}): MastheadDataPaths {
  const env = options.env ?? process.env;
  const dataDirectory = resolve(env.MASTHEAD_DATA_DIR || defaultDataDirectory(options.platform ?? process.platform, options.homeDir ?? homedir(), env));

  return {
    dataDirectory,
    databasePath: resolve(env.MASTHEAD_DB_PATH || join(dataDirectory, "masthead.sqlite")),
    legacyJournalPath: resolve(env.MASTHEAD_STORE_PATH || join(dataDirectory, "legacy", "events.ndjson")),
    runtimeDirectory: join(dataDirectory, "runtime"),
    exportsDirectory: join(dataDirectory, "exports"),
    logsDirectory: join(dataDirectory, "logs")
  };
}

function defaultDataDirectory(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string {
  if (platform === "darwin") return join(homeDir, "Library", "Application Support", "Masthead Dev");
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homeDir, "AppData", "Local"), "Masthead Dev");
  return join(homeDir, ".local", "share", "masthead-dev");
}
