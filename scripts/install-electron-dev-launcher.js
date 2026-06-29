#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const repo = process.cwd();
const nodeBin = process.execPath;
const nodeDir = dirname(nodeBin);
const npmBin = join(nodeDir, process.platform === "win32" ? "npm.cmd" : "npm");
const home = homedir();
const binDir = join(home, ".local", "bin");
const applicationsDir = join(home, ".local", "share", "applications");
const systemdUserDir = join(home, ".config", "systemd", "user");
const stateDir = join(home, ".local", "state", "masthead");
const launcherPath = join(binDir, "masthead-dev-desktop");
const desktopPath = join(applicationsDir, "ai.animas.masthead-dev.desktop");
const servicePath = join(systemdUserDir, "masthead-dev-electron.service");
const iconPath = join(repo, "public", "assets", "masthead-logo-sail.png");

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function devAllowedOrigins() {
  const origins = new Set(["masthead://app"]);
  for (let port = 5173; port <= 5199; port += 1) {
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://localhost:${port}`);
  }
  return Array.from(origins).join(",");
}

const launcher = `#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${shellQuote(repo)}
LOG_DIR=${shellQuote(stateDir)}
LOG_FILE="$LOG_DIR/dev-desktop.log"
NODE_BIN=${shellQuote(nodeBin)}
NPM_BIN=${shellQuote(npmBin)}
DATA_DIR="$HOME/.local/share/masthead-dev"
DB_PATH="$DATA_DIR/masthead.sqlite"
STORE_PATH="$DATA_DIR/legacy/events.ndjson"
DAEMON_ENTRY="$APP_DIR/dist/daemon/src/daemon/main.js"
MCP_ENTRY="$APP_DIR/dist/daemon/src/mcp/server.js"
ALLOWED_ORIGINS=${shellQuote(devAllowedOrigins())}

export PATH="$(dirname "$NODE_BIN"):$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export npm_config_update_notifier=false

mkdir -p "$LOG_DIR" "$DATA_DIR/legacy"

log() {
  echo "$(date -Is) $*" >>"$LOG_FILE"
}

read_cmdline() {
  tr '\\0' ' ' <"/proc/$1/cmdline" 2>/dev/null | sed 's/[[:space:]]*$//' || true
}

is_masthead_electron_process() {
  local pid="$1" cwd cmd
  [[ -n "$pid" && "$pid" != "$$" && "$pid" != "$PPID" ]] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$APP_DIR" ]] || return 1
  cmd="$(read_cmdline "$pid")"
  case "$cmd" in
    *"masthead-dev-desktop"*|*"gtk-launch ai.animas.masthead-dev"*|*"systemctl --user restart masthead-dev-electron.service"*)
      return 1
      ;;
    "npm run dev:electron"|\
    "sh -c npm run version:sync && npm run build:daemon && MASTHEAD_ELECTRON_DEV=1 electron-forge start"|\
    "sh -c npm run version:sync && MASTHEAD_ELECTRON_DEV=1 electron-forge start"|\
    "node $APP_DIR/node_modules/.bin/electron-forge start"|\
    "$NODE_BIN $APP_DIR/node_modules/.bin/electron-forge start"|\
    "$NODE_BIN $APP_DIR/node_modules/@electron-forge/cli/dist/electron-forge-start.js"*|\
    "$APP_DIR/node_modules/electron/dist/electron"*)
      return 0
      ;;
  esac
  return 1
}

wait_for_port_to_close() {
  for _ in {1..40}; do
    if ! curl -fsS --max-time 1 http://127.0.0.1:17373/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

daemon_is_healthy() {
  curl -fsS --max-time 1 http://127.0.0.1:17373/health >/dev/null 2>&1
}

stop_stale_electron_processes() {
  local pid cmd stale_pids
  stale_pids="$(pgrep -u "$(id -u)" -f 'npm run dev:electron|electron-forge start|/node_modules/electron/dist/electron' 2>/dev/null || true)"
  for pid in $stale_pids; do
    if is_masthead_electron_process "$pid"; then
      cmd="$(read_cmdline "$pid")"
      log "Stopping stale Masthead Electron process $pid: $cmd"
      kill "$pid" 2>/dev/null || true
    fi
  done

  sleep 1

  for pid in $stale_pids; do
    if is_masthead_electron_process "$pid"; then
      cmd="$(read_cmdline "$pid")"
      log "Force stopping stale Masthead Electron process $pid: $cmd"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

start_dev_daemon() {
  if daemon_is_healthy; then
    log "Masthead daemon already healthy at http://127.0.0.1:17373"
    return 0
  fi

  wait_for_port_to_close || log "Port 17373 stayed occupied by an unhealthy process; daemon start may fail."

  log "Building Masthead daemon..."
  if (cd "$APP_DIR" && "$NPM_BIN" run build:daemon) >>"$LOG_FILE" 2>&1; then
    log "Masthead daemon build complete."
  else
    local build_status=$?
    log "Masthead daemon build failed with exit status $build_status."
    return "$build_status"
  fi

  log "Starting Masthead daemon at http://127.0.0.1:17373"
  (
    cd "$APP_DIR"
    exec env \\
      MASTHEAD_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \\
      MASTHEAD_DATA_DIR="$DATA_DIR" \\
      MASTHEAD_DB_PATH="$DB_PATH" \\
      MASTHEAD_HOST="127.0.0.1" \\
      MASTHEAD_MCP_COMMAND="$NODE_BIN" \\
      MASTHEAD_MCP_ENTRY="$MCP_ENTRY" \\
      MASTHEAD_PORT="17373" \\
      MASTHEAD_STORE_PATH="$STORE_PATH" \\
      "$NODE_BIN" "$DAEMON_ENTRY"
  ) >>"$LOG_FILE" 2>&1 &

  echo "$!" >"$LOG_DIR/dev-daemon.pid"

  for _ in {1..80}; do
    if daemon_is_healthy; then
      log "Masthead daemon is ready."
      return 0
    fi
    sleep 0.25
  done

  log "Masthead daemon did not become ready at http://127.0.0.1:17373"
  return 1
}

if [[ "\${MASTHEAD_DEV_LAUNCH_CHILD:-}" != "1" ]]; then
  log "=== Masthead dev desktop handoff $(date -Is) ==="
  MASTHEAD_DEV_LAUNCH_CHILD=1 nohup "$0" >/dev/null 2>&1 &
  exit 0
fi

log "=== Masthead dev desktop launch $(date -Is) ==="
log "App dir: $APP_DIR"

stop_stale_electron_processes
start_dev_daemon

log "Syncing Masthead version metadata..."
if (cd "$APP_DIR" && "$NPM_BIN" run version:sync) >>"$LOG_FILE" 2>&1; then
  log "Masthead version metadata is current."
else
  sync_status=$?
  log "Masthead version sync failed with exit status $sync_status."
  exit "$sync_status"
fi

cd "$APP_DIR"
log "Starting Masthead Electron dev app without forcing daemon rebuild."
exec env \\
  MASTHEAD_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \\
  MASTHEAD_DATA_DIR="$DATA_DIR" \\
  MASTHEAD_DB_PATH="$DB_PATH" \\
  MASTHEAD_MCP_ENTRY="$MCP_ENTRY" \\
  MASTHEAD_NODE_PATH="$NODE_BIN" \\
  MASTHEAD_STORE_PATH="$STORE_PATH" \\
  MASTHEAD_ELECTRON_DEV=1 \\
  "$NODE_BIN" "$APP_DIR/node_modules/.bin/electron-forge" start >>"$LOG_FILE" 2>&1
`;

const desktopEntry = `[Desktop Entry]
Type=Application
Version=1.0
Name=Masthead Dev
Comment=Launch Masthead Electron dev app with live Vite reload
Exec=systemctl --user restart masthead-dev-electron.service
Path=${repo}
Icon=${iconPath}
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=masthead
`;

const service = `[Unit]
Description=Masthead Electron Dev

[Service]
Type=simple
WorkingDirectory=${repo}
Environment=MASTHEAD_DEV_LAUNCH_CHILD=1
ExecStart=${launcherPath}
KillMode=control-group
TimeoutStopSec=15
Restart=no

[Install]
WantedBy=default.target
`;

await mkdir(binDir, { recursive: true });
await mkdir(applicationsDir, { recursive: true });
await mkdir(systemdUserDir, { recursive: true });
await mkdir(stateDir, { recursive: true });
await writeFile(launcherPath, launcher, "utf8");
await chmod(launcherPath, 0o755);
await writeFile(desktopPath, desktopEntry, { mode: 0o755 });
await writeFile(servicePath, service, "utf8");

spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
spawnSync("update-desktop-database", [applicationsDir], { stdio: "ignore" });

console.log(`Installed ${launcherPath}`);
console.log(`Installed ${servicePath}`);
console.log(`Installed ${desktopPath}`);
console.log(`Logs: ${join(stateDir, "dev-desktop.log")}`);
