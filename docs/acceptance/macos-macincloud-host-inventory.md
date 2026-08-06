# MacinCloud host inventory (TX089)

**Captured:** 2026-08-06  
**Host:** `TX089.macincloud.com` / SSH alias `macincloud`  
**User:** `user945425`  
**Purpose:** Record what is actually available for **product** testing of Masthead on macOS (not packaging).

This is a point-in-time snapshot. Re-run the probe commands before a product RC if the cloud image may have changed.

---

## Machine

| Field | Value |
| --- | --- |
| Hardware | Apple M4, arm64, 16 GB RAM |
| OS | macOS 26.2 (Build 25C56) |
| Shell home | `/Users/user945425` → `/Volumes/Macintosh_HD/Users/user945425` |
| Free space (home volume) | ~182 GB |
| Xcode | Present (`/Applications/Xcode.app`) |
| Admin | Non-admin `_developer` account (no sudo assumed) |

---

## Build toolchain (packaging — already used)

| Tool | Status |
| --- | --- |
| Homebrew | `/opt/homebrew/bin/brew` |
| Node (host) | Homebrew **v25.9.0** (not relocatable; packaging downloads official Node) |
| npm | 11.12.1 |
| git | Apple Git 2.50.1 |
| Network | Reachable: GitHub, nodejs.org, registry.npmjs.org |

Masthead sources + build tree: `~/src/Masthead`  
DMG (from packaging work): `~/src/Masthead/out/make/Masthead.dmg`  
Packaged app: `~/src/Masthead/out/Masthead-darwin-arm64/Masthead.app`

---

## Coding harnesses: CLI on PATH

| Binary | On PATH? |
| --- | --- |
| `codex` | **No** |
| `claude` | **No** |
| `opencode` | **No** |
| `gemini` | **No** |
| `cursor` | **No** |
| `hermes` / `omp` / `t3` | **No** |

So: **no agent CLI is installed for the shell user** even when GUI apps exist.

---

## Coding harnesses: GUI apps under `/Applications`

| App | Bundle id | Version (Info.plist) | Notes |
| --- | --- | --- | --- |
| **Codex.app** | `com.openai.codex` | 26.730.61639 | ~1.4 GB; embedded CLI at `/Applications/Codex.app/Contents/Resources/codex` → reports `codex-cli 0.147.0-alpha.1.2` |
| **Claude.app** | `com.anthropic.claudefordesktop` | 1.25927.0 | Desktop app (not Claude Code CLI home) |
| **Cursor.app** | `com.todesktop.230313mzl4w4u92` | 3.15.6 | ~1.2 GB |
| ChatGPT.app | `com.openai.chat` | 1.2026.183 | Not a Masthead catalog harness |
| Visual Studio Code.app | `com.microsoft.VSCode` | 1.132.0 | Editor only |

---

## Harness data / history roots (Masthead catalog paths)

Probed for catalog-relevant paths. **All absent for this user** at capture time:

| Runtime | Expected roots (catalog / adapters) | Present? |
| --- | --- | --- |
| Codex | `~/.codex/sessions`, `~/.codex/hooks.json` (`CODEX_HOME`) | **No** `~/.codex` |
| Claude Code | `~/.claude/projects`, `conversations`, `history` | **No** `~/.claude` |
| Cursor | `~/Library/Application Support/Cursor/...` | **No** Cursor Application Support |
| OpenCode | `~/.opencode`, `~/.local/share/opencode`, `~/.config/opencode` | **No** |
| Grok Build | `~/.grok/hooks`, `~/.grok/sessions` | **No** |
| Hermes / Pi / OMP | `~/.hermes`, `~/.pi`, `~/.omp`, … | **No** |

Also absent: Application Support folders named Codex / Claude / Cursor / OpenAI for this user; no matching Preferences or Saved Application State names found in a shallow scan.

**Implication:** Discover on a clean Masthead install should honestly report harnesses as **not found** (or GUI-present but no history/live roots), until:

1. a harness is **logged in / first-run** so it creates its config + session store, and/or  
2. CLI is on PATH and used so `~/.codex` (etc.) appears, and/or  
3. fixtures / imported history are staged deliberately.

GUI apps being installed does **not** mean Masthead has anything to import or hook yet.

---

## Masthead runtime state on this host

| Path | Notes |
| --- | --- |
| `~/Library/Application Support/masthead` | Exists (~4 MB); packaged Electron userData |
| `…/masthead.sqlite` | Present |
| Sessions in DB | **`sessions` count = 0** |
| `raw_events` | 0 |
| `import_jobs` | 0 |
| `ingest_sources` | 0 |
| `source_scan_runs` | 1 (scan activity without product data) |
| Dev path `…/Masthead Dev` | Absent |

So: prior packaging smoke left an **empty** product DB, not a dogfood corpus.

---

## Auth / live capture readiness

| Requirement | Status |
| --- | --- |
| Codex CLI usable | Embedded binary works (`--version` / help); not on PATH; **no login / no `~/.codex`** observed |
| Codex sessions to import | **None** |
| Cursor / Claude Code history | **None** |
| OpenAI/Anthropic auth for agents | **Unknown** — no harness home dirs; do not assume cloud image has user credentials |
| Can download `@openai/codex` from npm | Yes (registry reachable; latest seen `0.146.1`) |

**Live capture and import cannot be proven until at least one harness has local state and (for live) a working connector + real or synthetic session activity.**

---

## Probe commands (re-run)

```bash
ssh macincloud
export PATH="/opt/homebrew/bin:$PATH"

# CLIs
for c in codex claude opencode gemini cursor hermes; do command -v "$c" || echo "MISS $c"; done

# Apps
ls /Applications | egrep -i 'Codex|Claude|Cursor|ChatGPT|Code'

# Catalog homes
ls -la ~/.codex ~/.claude ~/.opencode ~/.grok ~/.hermes 2>/dev/null
ls -la ~/Library/Application\ Support/Cursor 2>/dev/null

# Embedded Codex
/Applications/Codex.app/Contents/Resources/codex --version

# Masthead DB
sqlite3 "$HOME/Library/Application Support/masthead/masthead.sqlite" \
  "SELECT COUNT(*) FROM sessions; SELECT COUNT(*) FROM import_jobs; SELECT COUNT(*) FROM ingest_sources;"
```

---

## Product testing consequences

1. **Empty-machine honesty is a valid first RC lane:** Discover with zero found harnesses, empty Now/Workbench/Logbook, no false “connected” harnesses.  
2. **Import lane is blocked** until history exists (create sessions with Codex CLI/app after login, stage fixtures, or copy a known `~/.codex/sessions` tree).  
3. **Live lane is blocked** until Enable → Activate → Test for a real harness, then a real agent turn (or connector test + real event).  
4. **Recommended primary dogfood harness on this host:** Codex (app + embedded CLI already present); secondary GUI: Cursor once Application Support appears after login.

See the product RC checklist: [macos-product-rc-checklist.md](./macos-product-rc-checklist.md).
