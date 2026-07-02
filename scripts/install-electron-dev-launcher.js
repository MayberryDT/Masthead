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
  return ["masthead://app", "http://127.0.0.1:5173", "http://localhost:5173"].join(",");
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
CANONICAL_RENDERER_URL="http://127.0.0.1:5173"
VITE_BIN="$APP_DIR/node_modules/vite/bin/vite.js"
ELECTRON_BIN="$APP_DIR/node_modules/electron/dist/electron"
ALLOWED_ORIGINS=${shellQuote(devAllowedOrigins())}
ACTIVE_DAEMON_PORT="17373"
ACTIVE_DAEMON_BASE_URL="http://127.0.0.1:17373"
ACTIVE_PROJECTION_URL="$ACTIVE_DAEMON_BASE_URL/projection"

export PATH="$(dirname "$NODE_BIN"):$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export npm_config_update_notifier=false

mkdir -p "$LOG_DIR" "$DATA_DIR/legacy"

log() {
  echo "$(date -Is) $*" >>"$LOG_FILE"
}

load_local_env() {
  local file
  for file in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    [[ -f "$file" ]] || continue
    log "Loading local environment from $file"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  done
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

is_masthead_browser_dev_process() {
  local pid="$1" cwd cmd
  [[ -n "$pid" && "$pid" != "$$" && "$pid" != "$PPID" ]] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$APP_DIR" ]] || return 1
  cmd="$(read_cmdline "$pid")"
  case "$cmd" in
    "npm run dev"|\
    "sh -c npm run version:sync && npm run build:daemon && node scripts/masthead-live-dev.js"|\
    "node scripts/masthead-live-dev.js"|\
    "$NODE_BIN $APP_DIR/scripts/masthead-live-dev.js"|\
    *"vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort"*)
      return 0
      ;;
  esac
  return 1
}

wait_for_port_to_close() {
  local port="$1"
  for _ in {1..40}; do
    if ! curl -fsS --max-time 1 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

daemon_is_healthy() {
  local port="$1"
  curl -fsS --max-time 5 "http://127.0.0.1:$port/health" >/dev/null 2>&1
}

daemon_is_compatible() {
  local port="$1" health
  health="$(curl -fsS --max-time 5 "http://127.0.0.1:$port/health" 2>/dev/null)" || return 1
  EXPECTED_DATA_DIR="$DATA_DIR" "$NODE_BIN" -e 'let input = ""; process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { try { const j = JSON.parse(input); process.exit(j?.data?.dataDirectory === process.env.EXPECTED_DATA_DIR ? 0 : 1); } catch { process.exit(1); } });' <<<"$health"
}

set_active_daemon() {
  local port="$1"
  ACTIVE_DAEMON_PORT="$port"
  ACTIVE_DAEMON_BASE_URL="http://127.0.0.1:$port"
  ACTIVE_PROJECTION_URL="$ACTIVE_DAEMON_BASE_URL/projection"
}

port_is_listening() {
  local port="$1"
  ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN
}

find_available_daemon_port() {
  local port="$1"
  while (( port <= 17420 )); do
    if ! port_is_listening "$port"; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
  return 1
}

ui_is_masthead_dev() {
  curl -fsS --max-time 1 "$CANONICAL_RENDERER_URL/" 2>/dev/null | grep -q '<title>Masthead</title>'
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

stop_stale_browser_dev_processes() {
  local pid cmd stale_pids
  stale_pids="$(pgrep -u "$(id -u)" -f 'npm run dev|masthead-live-dev.js|vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort' 2>/dev/null || true)"
  for pid in $stale_pids; do
    if is_masthead_browser_dev_process "$pid"; then
      cmd="$(read_cmdline "$pid")"
      log "Stopping stale Masthead browser dev process $pid: $cmd"
      kill "$pid" 2>/dev/null || true
    fi
  done

  sleep 1

  for pid in $stale_pids; do
    if is_masthead_browser_dev_process "$pid"; then
      cmd="$(read_cmdline "$pid")"
      log "Force stopping stale Masthead browser dev process $pid: $cmd"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

start_dev_ui() {
  if ui_is_masthead_dev; then
    log "Masthead dev UI already healthy at $CANONICAL_RENDERER_URL"
    return 0
  fi

  log "Starting Masthead Vite dev UI at $CANONICAL_RENDERER_URL"
  (
    cd "$APP_DIR"
    exec env \\
      VITE_MASTHEAD_PROJECTION_URL="$ACTIVE_PROJECTION_URL" \\
      "$NODE_BIN" "$VITE_BIN" --host 127.0.0.1 --port 5173 --strictPort
  ) >>"$LOG_FILE" 2>&1 &

  echo "$!" >"$LOG_DIR/dev-ui.pid"

  for _ in {1..80}; do
    if ui_is_masthead_dev; then
      log "Masthead dev UI is ready at $CANONICAL_RENDERER_URL"
      return 0
    fi
    sleep 0.25
  done

  log "Masthead dev UI did not become ready at $CANONICAL_RENDERER_URL. Port 5173 may be occupied by another process."
  return 1
}

build_electron_dev_bundles() {
  log "Building Electron main and preload dev bundles..."
  if (
    cd "$APP_DIR"
    "$NODE_BIN" "$VITE_BIN" build --config "$APP_DIR/vite.main.config.ts" --outDir "$APP_DIR/.vite/build" --emptyOutDir=false
    "$NODE_BIN" "$VITE_BIN" build --config "$APP_DIR/vite.preload.config.ts" --outDir "$APP_DIR/.vite/build" --emptyOutDir=false
  ) >>"$LOG_FILE" 2>&1; then
    log "Electron main and preload dev bundles are ready."
    return 0
  fi

  local build_status=$?
  log "Electron dev bundle build failed with exit status $build_status."
  return "$build_status"
}

start_dev_daemon() {
  local port="17373"
  if daemon_is_compatible "$port"; then
    set_active_daemon "$port"
    log "Masthead daemon already healthy at $ACTIVE_DAEMON_BASE_URL"
    return 0
  fi

  if daemon_is_healthy "$port" || port_is_listening "$port"; then
    log "Port 17373 is occupied by a Masthead daemon with a different data directory; using an isolated dev daemon port."
    port="$(find_available_daemon_port 17374)"
  else
    wait_for_port_to_close "$port" || log "Port 17373 stayed occupied by an unhealthy process; daemon start may fail."
  fi

  log "Building Masthead daemon..."
  if (cd "$APP_DIR" && "$NPM_BIN" run build:daemon) >>"$LOG_FILE" 2>&1; then
    log "Masthead daemon build complete."
  else
    local build_status=$?
    log "Masthead daemon build failed with exit status $build_status."
    return "$build_status"
  fi

  log "Starting Masthead daemon at http://127.0.0.1:$port"
  (
    cd "$APP_DIR"
    exec env \\
      MASTHEAD_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \\
      MASTHEAD_DATA_DIR="$DATA_DIR" \\
      MASTHEAD_DB_PATH="$DB_PATH" \\
      MASTHEAD_HOST="127.0.0.1" \\
      MASTHEAD_HOOK_TRANSCRIPT_CATCHUP="1" \\
      MASTHEAD_MCP_COMMAND="$NODE_BIN" \\
      MASTHEAD_MCP_ENTRY="$MCP_ENTRY" \\
      MASTHEAD_PORT="$port" \\
      MASTHEAD_STORE_PATH="$STORE_PATH" \\
      "$NODE_BIN" "$DAEMON_ENTRY"
  ) >>"$LOG_FILE" 2>&1 &

  echo "$!" >"$LOG_DIR/dev-daemon.pid"

  for _ in {1..240}; do
    if daemon_is_compatible "$port"; then
      set_active_daemon "$port"
      log "Masthead daemon is ready at $ACTIVE_DAEMON_BASE_URL."
      return 0
    fi
    sleep 0.25
  done

  log "Masthead daemon did not become ready at http://127.0.0.1:$port"
  return 1
}

if [[ "\${MASTHEAD_DEV_LAUNCH_CHILD:-}" != "1" ]]; then
  log "=== Masthead dev desktop handoff $(date -Is) ==="
  MASTHEAD_DEV_LAUNCH_CHILD=1 nohup "$0" >/dev/null 2>&1 &
  exit 0
fi

log "=== Masthead dev desktop launch $(date -Is) ==="
log "App dir: $APP_DIR"

load_local_env
stop_stale_electron_processes
stop_stale_browser_dev_processes
start_dev_daemon
start_dev_ui

log "Syncing Masthead version metadata..."
if (cd "$APP_DIR" && "$NPM_BIN" run version:sync) >>"$LOG_FILE" 2>&1; then
  log "Masthead version metadata is current."
else
  sync_status=$?
  log "Masthead version sync failed with exit status $sync_status."
  exit "$sync_status"
fi

build_electron_dev_bundles

cd "$APP_DIR"
log "Starting Masthead Electron dev app against $CANONICAL_RENDERER_URL."
exec env \\
  MASTHEAD_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \\
  MASTHEAD_DATA_DIR="$DATA_DIR" \\
  MASTHEAD_DB_PATH="$DB_PATH" \\
  MASTHEAD_MCP_ENTRY="$MCP_ENTRY" \\
  MASTHEAD_NODE_PATH="$NODE_BIN" \\
  MASTHEAD_PORT="$ACTIVE_DAEMON_PORT" \\
  MASTHEAD_STORE_PATH="$STORE_PATH" \\
  MASTHEAD_ELECTRON_DEV=1 \\
  MASTHEAD_ELECTRON_RENDERER_URL="$CANONICAL_RENDERER_URL" \\
  "$ELECTRON_BIN" "$APP_DIR" >>"$LOG_FILE" 2>&1
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
