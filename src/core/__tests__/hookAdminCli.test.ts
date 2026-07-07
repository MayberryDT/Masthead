import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, open, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const adminScript = new URL("../../../scripts/masthead-hook-admin.js", import.meta.url);
const hookCommand = "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest?runtime=codex node /app/scripts/masthead-hook.js";

describe("Masthead hook admin CLI", () => {
  test("preview prints official hooks.json shape without writing a file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const configPath = path.join(dir, "hooks.json");

    const result = await runAdmin(["preview", "--config", configPath, "--command", hookCommand, "--timeout", "2"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(await readBackups(dir, configPath)).toHaveLength(0);
    await expect(readFile(configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(result.stdout)).toEqual({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 2 }] }]
      }
    });
  });

  test("install creates a missing hooks.json and uses Codex matcher groups", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const configPath = path.join(dir, "hooks.json");

    const result = await runAdmin(["install", "--config", configPath, "--command", hookCommand]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("Backup: none; config file did not exist");
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(0);
    const config = await readConfig(configPath);
    const info = await lstat(configPath);
    expect(info.mode & 0o777).toBe(0o600);
    expect(config).toMatchObject({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }]
      }
    });
  });

  test("quotes generated default command executable and hook path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const configPath = path.join(dir, "hooks.json");

    const result = await runAdmin(["preview", "--config", configPath]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    const config = JSON.parse(result.stdout);
    const command = config.hooks.SessionStart[0].hooks[0].command;
    const expectedHookPath = path.join(path.dirname(adminScript.pathname), "masthead-hook.js");
    expect(command).toContain(quoteShell(process.execPath));
    expect(command).toContain(quoteShell(expectedHookPath));
    expect(command).toContain("/ingest?runtime=codex");
  });

  test("install creates a backup and merges Masthead handlers with existing hook groups", async () => {
    const { configPath, dir } = await writeConfig({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [{ type: "command", command: "node existing.js", statusMessage: "Existing" }]
          }
        ],
        Stop: [
          {
            hooks: [{ type: "command", command: hookCommand, timeout: 3 }]
          }
        ]
      }
    });

    const result = await runAdmin(["install", "--config", configPath, "--command", hookCommand]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(1);
    await expect(readConfig(configPath)).resolves.toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [{ type: "command", command: "node existing.js", statusMessage: "Existing" }]
          },
          { matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }
        ],
        Stop: [{ hooks: [{ type: "command", command: hookCommand, timeout: 3 }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }]
      }
    });
  });

  test("verify reports missing Masthead hook events without writing a backup", async () => {
    const { configPath, dir } = await writeConfig({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }]
      }
    });

    const result = await runAdmin(["verify", "--config", configPath]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Missing Masthead hook events");
    expect(result.stdout).toContain("PermissionRequest");
    expect(result.stdout).toContain("UserPromptSubmit");
    expect(result.stdout).toContain("PostToolUse");
    expect(result.stdout).toContain("PreToolUse");
    expect(result.stdout).toContain("Stop");
    expect(result.stderr).toBe("");
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(0);
  });

  test("verify reports mismatched Masthead hook definitions", async () => {
    const { configPath } = await writeConfig({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }]
      }
    });

    const result = await runAdmin(["verify", "--config", configPath, "--command", `${hookCommand} --changed`, "--timeout", "1"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Mismatched Masthead hook events");
    expect(result.stdout).toContain("SessionStart");
    expect(result.stdout).toContain("Stop");
  });

  test("verify accepts the intended command and timeout", async () => {
    const { configPath } = await writeConfig({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand, timeout: 1 }] }]
      }
    });

    const result = await runAdmin(["verify", "--config", configPath, "--command", hookCommand, "--timeout", "1"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("Masthead hooks installed");
  });

  test("uninstall creates a backup and removes only Masthead hook handlers", async () => {
    const { configPath, dir } = await writeConfig({
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "node existing.js" },
              { type: "command", command: hookCommand }
            ]
          }
        ],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }],
        CustomEvent: [{ hooks: [{ type: "command", command: "node custom.js" }] }]
      }
    });

    const result = await runAdmin(["uninstall", "--config", configPath]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(1);
    await expect(readConfig(configPath)).resolves.toEqual({
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "node existing.js" }] }],
        PermissionRequest: [],
        CustomEvent: [{ hooks: [{ type: "command", command: "node custom.js" }] }]
      }
    });
  });

  test("disable is accepted as an uninstall alias", async () => {
    const { configPath } = await writeConfig({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: hookCommand }] }]
      }
    });

    const result = await runAdmin(["disable", "--config", configPath]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    await expect(readConfig(configPath)).resolves.toEqual({
      hooks: {
        Stop: []
      }
    });
  });

  test("rollback creates a backup and restores the latest prior backup", async () => {
    const { configPath, dir } = await writeConfig({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "node existing.js" }] }]
      }
    });
    await expect(runAdmin(["install", "--config", configPath, "--command", hookCommand])).resolves.toMatchObject({
      code: 0
    });
    const installed = await readConfig(configPath);
    await sleep(5);
    await expect(runAdmin(["uninstall", "--config", configPath])).resolves.toMatchObject({ code: 0 });

    const result = await runAdmin(["rollback", "--config", configPath]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("Rolled back Masthead hook config");
    await expect(readConfig(configPath)).resolves.toEqual(installed);
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(3);
  });

  test("malformed JSON fails clearly without creating a backup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const configPath = path.join(dir, "hooks.json");
    await writeFile(configPath, "{ bad json", "utf8");

    const result = await runAdmin(["install", "--config", configPath, "--command", hookCommand]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Malformed JSON");
    expect(await readFile(configPath, "utf8")).toBe("{ bad json");
    await expect(readBackups(dir, configPath)).resolves.toHaveLength(0);
  });

  test("refuses to mutate config.toml because Codex warns when inline hooks and hooks.json mix", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const configPath = path.join(dir, "config.toml");
    await writeFile(configPath, "model = \"gpt-5.5\"\n", "utf8");

    const result = await runAdmin(["install", "--config", configPath, "--command", hookCommand]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("hooks.json");
    expect(await readFile(configPath, "utf8")).toBe("model = \"gpt-5.5\"\n");
  });

  test("refuses to mutate a symlinked hooks file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
    const targetPath = path.join(dir, "target-hooks.json");
    const configPath = path.join(dir, "hooks.json");
    await writeFile(targetPath, "{}\n", "utf8");
    await symlink(targetPath, configPath);

    const result = await runAdmin(["install", "--config", configPath, "--command", hookCommand]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Refusing to mutate symlinked hook config");
    expect(await readFile(targetPath, "utf8")).toBe("{}\n");
  });
});

async function writeConfig(config: unknown): Promise<{ configPath: string; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-"));
  const configPath = path.join(dir, "hooks.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, dir };
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function readConfig(configPath: string): Promise<unknown> {
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function readBackups(dir: string, configPath: string): Promise<string[]> {
  const prefix = `${path.basename(configPath)}.masthead-backup-`;
  return (await readdir(dir)).filter((entry) => entry.startsWith(prefix)).sort();
}

async function runAdmin(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const dir = await mkdtemp(path.join(tmpdir(), "masthead-hook-admin-output-"));
  const stdoutPath = path.join(dir, "stdout.txt");
  const stderrPath = path.join(dir, "stderr.txt");
  const stdoutFile = await open(stdoutPath, "w+");
  const stderrFile = await open(stderrPath, "w+");
  const child = spawn(process.execPath, [adminScript.pathname, ...args], {
    env,
    stdio: ["ignore", stdoutFile.fd, stderrFile.fd]
  });
  const [code] = (await once(child, "close")) as [number | null];
  await stdoutFile.close();
  await stderrFile.close();
  return {
    code,
    stdout: await readFile(stdoutPath, "utf8"),
    stderr: await readFile(stderrPath, "utf8")
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
