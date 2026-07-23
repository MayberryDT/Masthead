import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("Masthead Dev launcher template", () => {
  test("builds the current checkout before replacing or starting a daemon", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    const sameDataIndex = source.indexOf('if daemon_data_matches "$port"; then');
    const buildIndex = source.indexOf("Building Masthead daemon...");

    expect(buildIndex).toBeGreaterThan(-1);
    expect(sameDataIndex).toBeGreaterThan(buildIndex);
    expect(source).toContain("Restarting the same-data Masthead daemon with the current checkout");
    expect(source).not.toContain('"$NPM_BIN" run dev:electron');
    expect(source).toContain('CANONICAL_RENDERER_URL="http://127.0.0.1:5173"');
    expect(source).toContain('MASTHEAD_ELECTRON_RENDERER_URL="$CANONICAL_RENDERER_URL"');
    expect(source).toContain('ELECTRON_BIN="$APP_DIR/node_modules/electron/dist/electron"');
    expect(source).toContain('"$ELECTRON_BIN" "$APP_DIR"');
    expect(source).not.toContain('"$NODE_BIN" "$APP_DIR/node_modules/.bin/electron-forge" start');
    expect(source).toContain("KillMode=control-group");
  });

  test("keeps the desktop identity branded as Masthead Dev with the dev icon", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    expect(source).toContain('const iconPath = join(repo, "public", "assets", "masthead-logo-sail-dev.svg");');
    expect(source).toContain("Name=Masthead Dev");
    expect(source).toContain("Icon=${iconPath}");
  });

  test("claims canonical port 5173 by stopping same-repo browser dev launchers", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    expect(source).toContain("stop_stale_browser_dev_processes");
    expect(source).toContain("is_masthead_browser_dev_process");
    expect(source).toContain("node scripts/masthead-live-dev.js");
    expect(source).toContain("vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort");
    expect(source.indexOf("stop_stale_browser_dev_processes")).toBeLessThan(source.indexOf("start_dev_daemon"));
  });

  test("loads ignored local env and pins the UI to the compatible daemon", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    expect(source).toContain("load_local_env");
    expect(source).toContain('"$APP_DIR/.env" "$APP_DIR/.env.local"');
    expect(source).toContain("daemon_is_compatible");
    expect(source).toContain('curl -fsS --max-time 5 "http://127.0.0.1:$port/health"');
    expect(source).toContain('if daemon_is_healthy "$port" || port_is_listening "$port"; then');
    expect(source).toContain("j?.data?.dataDirectory === process.env.EXPECTED_DATA_DIR");
    expect(source).toContain('ACTIVE_PROJECTION_URL="$ACTIVE_DAEMON_BASE_URL/projection"');
    expect(source).toContain('VITE_MASTHEAD_PROJECTION_URL="$ACTIVE_PROJECTION_URL"');
    expect(source).toContain('MASTHEAD_PORT="$ACTIVE_DAEMON_PORT"');
  });

  test("installs and advertises the current checkout authoring CLI before starting the daemon", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    expect(source).toContain('const cliLauncherPath = join(devInstanceDir, "bin", process.platform === "win32" ? "mastheadctl.cmd" : "mastheadctl");');
    expect(source).toContain('const cliEntry = join(repo, "dist", "daemon", "src", "cli", "mastheadctl.js");');
    expect(source).toContain('CLI_LAUNCHER=${shellQuote(cliLauncherPath)}');
    expect(source).toContain('MASTHEAD_CLI_COMMAND="$CLI_LAUNCHER"');
    expect(source).toContain("install_active_cli_launcher");
    expect(source).toContain("MASTHEAD_INSTANCE_MANIFEST");
    expect(source).not.toContain("exec env MASTHEAD_DAEMON_URL");
    expect(source).toContain("daemon_authoring_is_compatible");
    expect(source).toContain('j?.bundleVersion === "workbench-authoring-v5"');
    expect(source).toContain('j?.policyVersion === "workbench-authoring-v5"');
    expect(source).toContain('const expected = ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"]');
    expect(source).toContain('EXPECTED_BASE_URL="http://127.0.0.1:$port"');
    expect(source).toContain('j?.baseUrl === process.env.EXPECTED_BASE_URL');
    expect(source).not.toContain('j?.bundleVersion === "workbench-authoring-v4"');
    expect(source).toContain("stop_stale_authoring_daemon");
    expect(source).toContain("await access(cliEntry, constants.R_OK)");
    expect(source).toContain('spawnSync(npmBin, ["run", "build:daemon"]');
    expect(source.indexOf("await installCliLauncher()")).toBeLessThan(source.indexOf("await writeFile(launcherPath"));
  });

  test("atomically binds the active CLI launcher before spawning the selected daemon port", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");
    const start = source.slice(source.indexOf("start_dev_daemon()"), source.indexOf('if [[ "\\${MASTHEAD_DEV_LAUNCH_CHILD'));
    const bindIndex = start.indexOf('set_active_daemon "$port"');
    const spawnIndex = start.indexOf('log "Starting Masthead daemon');

    expect(bindIndex).toBeGreaterThan(-1);
    expect(spawnIndex).toBeGreaterThan(bindIndex);
    expect(start).toContain('local daemon_pid');
    expect(start).toContain('daemon_pid="$!"');
    expect(start).toContain('cleanup_failed_dev_daemon "$daemon_pid"');
    expect(source).toContain('rm -f "$LOG_DIR/dev-daemon.pid"');
    expect(source).toContain('wait "$pid" 2>/dev/null || true');
  });
});
