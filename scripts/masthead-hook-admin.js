#!/usr/bin/env node
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const REQUIRED_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop"];
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOOK_COMMAND = `MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest?runtime=codex MASTHEAD_HOOK_TIMEOUT_MS=750 ${quoteShell(process.execPath)} ${quoteShell(path.join(scriptDir, "masthead-hook.js"))}`;
const DEFAULT_TIMEOUT_SECONDS = 1;

class CliError extends Error {}

try {
  await main(process.argv.slice(2));
} catch (error) {
  await writeStderr(error instanceof CliError ? error.message : `Hook admin failed: ${error.message}`);
  process.exitCode = 1;
}

async function main(argv) {
  const args = parseArgs(argv);

  if (args.action === "help") {
    await writeStdout(usage());
    return;
  }

  if (args.action === "verify") {
    const { config } = await readHooksConfig(args.configPath, { allowMissing: false });
    const result = verifyMastheadHookConfig(config, args);
    if (result.installed) {
      await writeStdout(`Masthead hooks installed for: ${REQUIRED_HOOK_EVENTS.join(", ")}`);
      return;
    }
    await writeStdout(
      [
        result.missingEvents.length ? `Missing Masthead hook events: ${result.missingEvents.join(", ")}` : undefined,
        result.mismatchedEvents.length ? `Mismatched Masthead hook events: ${result.mismatchedEvents.join(", ")}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
    process.exitCode = 1;
    return;
  }

  if (args.action === "preview") {
    const { config } = await readHooksConfig(args.configPath, { allowMissing: true });
    await writeStdout(JSON.stringify(installMastheadHookConfig(config, args), null, 2));
    return;
  }

  if (args.action === "install") {
    const { config, existed } = await readHooksConfig(args.configPath, { allowMissing: true });
    const backupPath = existed ? await createBackup(args.configPath, "install") : undefined;
    const next = installMastheadHookConfig(config, args);
    await writeJsonConfig(args.configPath, next);
    await writeStdout(
      [
        `Installed Masthead hooks in ${args.configPath}`,
        backupPath ? `Backup: ${backupPath}` : "Backup: none; config file did not exist"
      ].join("\n")
    );
    return;
  }

  if (args.action === "uninstall" || args.action === "disable") {
    const { config, existed } = await readHooksConfig(args.configPath, { allowMissing: true });
    const backupPath = existed ? await createBackup(args.configPath, args.action) : undefined;
    const next = uninstallMastheadHookConfig(config);
    await writeJsonConfig(args.configPath, next);
    await writeStdout(
      [
        `Uninstalled Masthead hooks from ${args.configPath}`,
        backupPath ? `Backup: ${backupPath}` : "Backup: none; config file did not exist"
      ].join("\n")
    );
    return;
  }

  if (args.action === "rollback") {
    const latestBackup = await findLatestBackup(args.configPath);
    await readHooksConfig(latestBackup, { allowMissing: false });
    const rollbackBackup = await createBackup(args.configPath, "rollback");
    await copyFile(latestBackup, args.configPath);
    await writeStdout(
      [
        `Rolled back Masthead hook config at ${args.configPath}`,
        `Restored: ${latestBackup}`,
        `Backup: ${rollbackBackup}`
      ].join("\n")
    );
  }
}

function parseArgs(argv) {
  const [action, ...rest] = argv;
  if (!action || action === "help" || action === "--help" || action === "-h") {
    return { action: "help" };
  }

  if (!["preview", "install", "verify", "disable", "uninstall", "rollback"].includes(action)) {
    throw new CliError(`Unknown action: ${action}\n\n${usage()}`);
  }

  let configPath;
  let command = DEFAULT_HOOK_COMMAND;
  let timeout = DEFAULT_TIMEOUT_SECONDS;
  let statusMessage;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--config" || arg === "-c") {
      configPath = readOptionValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--command") {
      command = readOptionValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--command=")) {
      command = arg.slice("--command=".length);
      continue;
    }
    if (arg === "--timeout") {
      timeout = parseTimeout(readOptionValue(rest, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeout = parseTimeout(arg.slice("--timeout=".length));
      continue;
    }
    if (arg === "--status-message") {
      statusMessage = readOptionValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--status-message=")) {
      statusMessage = arg.slice("--status-message=".length);
      continue;
    }
    throw new CliError(`Unknown option: ${arg}\n\n${usage()}`);
  }

  if (!configPath) {
    throw new CliError("Missing required --config <path>. Use ~/.codex/hooks.json for user-level Codex hooks.");
  }
  if (configPath.endsWith(".toml")) {
    throw new CliError("Masthead manages Codex hooks.json files, not config.toml. Use ~/.codex/hooks.json.");
  }

  return {
    action,
    command,
    configPath: path.resolve(configPath),
    statusMessage,
    timeout
  };
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliError(`Missing value for ${optionName}`);
  }
  return value;
}

function parseTimeout(value) {
  const timeout = Number.parseInt(value, 10);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60) {
    throw new CliError("--timeout must be an integer from 1 to 60 seconds");
  }
  return timeout;
}

async function readHooksConfig(configPath, options) {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && options.allowMissing) {
      return { config: {}, existed: false };
    }
    if (error?.code === "ENOENT") {
      throw new CliError(`Config file not found: ${configPath}`);
    }
    throw error;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new CliError(`Malformed JSON in ${configPath}: ${error.message}`);
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError(`Config file must contain a JSON object: ${configPath}`);
  }
  if ("hooks" in config && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) {
    throw new CliError(`Config hooks field must be an object: ${configPath}`);
  }

  return { config, existed: true };
}

async function writeJsonConfig(configPath, config) {
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true });
  const mode = await targetMode(configPath);
  const tmpPath = path.join(dir, `.${path.basename(configPath)}.masthead-tmp-${backupStamp()}.json`);
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(tmpPath, mode);
  await rename(tmpPath, configPath);
}

function quoteShell(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function createBackup(configPath, operation) {
  await assertRegularFile(configPath);
  const backupPath = `${configPath}.masthead-backup-${backupStamp()}-${operation}.json`;
  await copyFile(configPath, backupPath);
  return backupPath;
}

async function targetMode(configPath) {
  try {
    const info = await lstat(configPath);
    if (info.isSymbolicLink()) throw new CliError(`Refusing to mutate symlinked hook config: ${configPath}`);
    if (!info.isFile()) throw new CliError(`Hook config path is not a regular file: ${configPath}`);
    return info.mode & 0o777;
  } catch (error) {
    if (error?.code === "ENOENT") return 0o600;
    throw error;
  }
}

async function assertRegularFile(configPath) {
  const info = await lstat(configPath);
  if (info.isSymbolicLink()) throw new CliError(`Refusing to mutate symlinked hook config: ${configPath}`);
  if (!info.isFile()) throw new CliError(`Hook config path is not a regular file: ${configPath}`);
}

function backupStamp() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${process.hrtime.bigint()}`;
}

async function findLatestBackup(configPath) {
  const dir = path.dirname(configPath);
  const prefix = `${path.basename(configPath)}.masthead-backup-`;
  const entries = await readdir(dir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const backupPath = path.join(dir, entry.name);
        const info = await stat(backupPath);
        return { path: backupPath, mtimeMs: info.mtimeMs, name: entry.name };
      })
  );

  backups.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  if (!backups[0]) {
    throw new CliError(`No Masthead hook backups found for ${configPath}`);
  }
  return backups[0].path;
}

function installMastheadHookConfig(config, options) {
  const next = cloneConfig(config);
  next.hooks ??= {};

  for (const eventName of REQUIRED_HOOK_EVENTS) {
    let repairedExistingHook = false;
    const groups = [...(next.hooks[eventName] ?? [])].map((group) => {
      const nextGroup = cloneGroup(group);
      if (!isOfficialGroup(nextGroup)) return nextGroup;
      nextGroup.hooks = (nextGroup.hooks ?? []).map((entry) => {
        if (!isMastheadHook(entry)) return entry;
        repairedExistingHook = true;
        return mastheadHook(options);
      });
      return nextGroup;
    });
    if (!repairedExistingHook) {
      groups.push({
        matcher: "*",
        hooks: [mastheadHook(options)]
      });
    }
    next.hooks[eventName] = groups;
  }

  return next;
}

function uninstallMastheadHookConfig(config) {
  const next = cloneConfig(config);
  next.hooks ??= {};

  for (const [eventName, groups] of Object.entries(next.hooks)) {
    next.hooks[eventName] = (groups ?? [])
      .map(cloneGroup)
      .map(removeMastheadHooksFromGroup)
      .filter((group) => !isOfficialGroup(group) || (group.hooks ?? []).length > 0);
  }

  return next;
}

function verifyMastheadHookConfig(config, expected) {
  const hooks = config.hooks ?? {};
  const missingEvents = [];
  const mismatchedEvents = [];

  for (const eventName of REQUIRED_HOOK_EVENTS) {
    const handlers = (hooks[eventName] ?? [])
      .filter(isOfficialGroup)
      .flatMap((group) => group.hooks)
      .filter(isMastheadHook);
    if (handlers.length === 0) {
      missingEvents.push(eventName);
      continue;
    }
    if (expected && !handlers.some((handler) => matchesExpectedHook(handler, expected))) {
      mismatchedEvents.push(eventName);
    }
  }

  return {
    installed: missingEvents.length === 0 && mismatchedEvents.length === 0,
    missingEvents,
    mismatchedEvents
  };
}

function mastheadHook(options) {
  const hook = {
    type: "command",
    command: options.command,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_SECONDS
  };
  if (options.statusMessage) hook.statusMessage = options.statusMessage;
  return hook;
}

function isMastheadHook(entry) {
  return entry?.type === "command" && typeof entry.command === "string" && entry.command.includes(MASTHEAD_HOOK_MARKER);
}

function matchesExpectedHook(handler, expected) {
  if (expected.command && handler.command !== expected.command) return false;
  if (expected.timeout !== undefined && handler.timeout !== expected.timeout) return false;
  if (expected.statusMessage !== undefined && handler.statusMessage !== expected.statusMessage) return false;
  return true;
}

function removeMastheadHooksFromGroup(group) {
  if (!isOfficialGroup(group)) return group;
  return {
    ...group,
    hooks: (group.hooks ?? []).filter((entry) => !isMastheadHook(entry))
  };
}

function isOfficialGroup(group) {
  return Array.isArray(group.hooks);
}

function cloneGroup(group) {
  if (!isOfficialGroup(group)) return { ...group };
  return {
    ...group,
    hooks: [...group.hooks]
  };
}

function cloneConfig(config) {
  return structuredClone(config);
}

function usage() {
  return [
    "Usage: node scripts/masthead-hook-admin.js <preview|install|verify|disable|uninstall|rollback> --config <path> [--command <hook-command>] [--timeout <seconds>] [--status-message <text>]",
    "",
    "This explicit admin tool edits only the hooks.json file passed with --config.",
    "Use ~/.codex/hooks.json for user-level Codex hooks.",
    `Default hook command: ${DEFAULT_HOOK_COMMAND}`
  ].join("\n");
}

function writeStdout(message) {
  return writeStream(process.stdout, `${message}\n`);
}

function writeStderr(message) {
  return writeStream(process.stderr, `${message}\n`);
}

function writeStream(stream, message) {
  return new Promise((resolve, reject) => {
    stream.write(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
