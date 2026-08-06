# macOS product RC checklist (MacinCloud)

**Purpose:** Prove Masthead’s **product loop on macOS** — discover harnesses, import/live capture, Now, Workbench, Logbook — not packaging.

**Host baseline:** [macos-macincloud-host-inventory.md](./macos-macincloud-host-inventory.md)  
**Sources contract:** [sources-v2.md](../reference/sources-v2.md)  
**Data paths:** [data-paths.md](../architecture/data-paths.md)  
**Packaging only:** [macos-release-build.md](../reference/macos-release-build.md)

**Release identity under test**

| Field | Value (fill when running) |
| --- | --- |
| Date | |
| Build version / git SHA | |
| Artifact | DMG path / Applications path |
| Operator | |
| Host | `macincloud` / TX089 |

**Rules**

- Install and run from the **DMG → Applications** path when testing “user install,” not only `out/` from the build tree.
- Adhoc signature: first open may need **right-click → Open**. That is not a product pass by itself.
- Do **not** mark a section pass from packaged smoke alone.
- Prefer evidence: screenshot notes, `curl` health JSON, sqlite counts, or Activity/receipt text — not “looked fine.”

---

## Preflight (host)

Use inventory doc; re-probe if image may have changed.

- [ ] SSH `macincloud` works; `export PATH="/opt/homebrew/bin:$PATH"`
- [ ] Free disk ≥ 10 GB on home volume
- [ ] DMG under test present (e.g. `~/src/Masthead/out/make/Masthead.dmg`)
- [ ] Known harness state recorded:
  - [ ] Codex CLI/app / `~/.codex` present or absent
  - [ ] Cursor Application Support present or absent
  - [ ] Claude Code `~/.claude` present or absent
  - [ ] Any other catalog runtime present or absent
- [ ] Decide which lanes apply this run (check all that apply):

| Lane | When |
| --- | --- |
| **A. Empty host honesty** | No harness homes / no history (current TX089 default) |
| **B. Import** | At least one harness history root with real or fixture sessions |
| **C. Live capture** | Harness installable + Enable/Activate + real or proven live event |
| **D. Publish path** | After B and/or C have sessions in Workbench |

As of the 2026-08-06 inventory: **A is mandatory; B/C/D require setup first.**

---

## 0. Clean install baseline

Goal: one installed app, one data directory, healthy daemon.

- [ ] Quit all Masthead processes
- [ ] Optional clean slate: stop app, then remove or rename  
      `~/Library/Application Support/masthead`  
      (only for intentional first-run; do not do this on a precious DB)
- [ ] Mount DMG → copy `Masthead.app` to `~/Applications` or `/Applications`
- [ ] Launch from Finder (not only `open` from build tree)
- [ ] App window appears; no immediate crash loop
- [ ] Daemon healthy: e.g. health endpoint or in-app connection shows live (not stuck “No live connection” when daemon is up)
- [ ] Data dir is under Application Support (`…/masthead` for packaged app)
- [ ] Quit and relaunch once → same DB, still healthy

**Evidence:** health JSON or Doctor summary; data dir path; version/SHA if shown.

---

## 1. Sources — Discover (always)

Goal: catalog rows and presence match reality (Sources V2).

- [ ] Open **Sources**
- [ ] Full catalog visible (Codex, Claude Code, Cursor, Grok Build, Hermes, Pi, OMP, OpenCode) — not only “found”
- [ ] Run **Discover**
- [ ] Presence matches inventory:
  - [ ] Runtimes with no local roots → `not_found` (or equivalent honest empty)
  - [ ] No false `ready` for harnesses that were never enabled
- [ ] No silent install of hooks/plugins on Discover alone
- [ ] Summary chips (found / needs action / not found) are not nonsense

**If apps are installed but homes empty (TX089):** note whether UI distinguishes “app on disk” vs “Masthead candidate path found.” Failure mode to watch: claiming Codex is ready because Codex.app exists while `~/.codex` is missing.

---

## 2. Lane A — Empty-host honesty (required when no harness data)

Goal: product does not invent sessions or sources.

- [ ] **Now:** empty or honest empty; no fake live cards
- [ ] **Workbench:** no sessions or clear empty; no `No live connection` when daemon is healthy
- [ ] **Logbook:** empty of published artifacts (or only real prior publishes)
- [ ] No import job inventing rows without user action
- [ ] sqlite still `sessions = 0` if no user import/live (optional check)

**Pass criteria:** honest empty product, not “it looks broken.”

---

## 3. Setup for lanes B/C (blockers until done)

Do not skip if claiming import or live works on this Mac.

### 3a. Codex (recommended primary on TX089)

- [ ] Put Codex CLI on PATH **or** document use of  
      `/Applications/Codex.app/Contents/Resources/codex`
- [ ] `codex login` (or app login) succeeds **or** blocked on credentials (record which)
- [ ] After use, `~/.codex` exists (or `CODEX_HOME` set and recorded)
- [ ] At least one session under `…/sessions` **or** a deliberate fixture tree copied there
- [ ] For live: Enable writes Masthead-managed hooks; activation notes Codex **trust hooks** (`/hooks`) per Sources V2

### 3b. Cursor (optional secondary)

- [ ] Launch Cursor, complete first-run so Application Support appears
- [ ] Confirm catalog path exists (e.g. `…/Cursor/User/globalStorage/state.vscdb` or workspaceStorage)
- [ ] Discover marks Cursor `found` when appropriate

### 3c. Claude Code (optional)

- [ ] Claude Code CLI/home — not only Claude desktop app
- [ ] `~/.claude/…` history present before claiming import

### 3d. Fixture fallback (if auth impossible)

- [ ] Stage known-good Codex (or other) session fixtures into a catalog path under this user home
- [ ] Document fixture origin and path
- [ ] Discover finds them; import proceeds under Lane B

---

## 4. Lane B — Import / history

Goal: history on disk → canonical sessions in Workbench (deeper than Now).

Prerequisite: §3 left real history or fixtures.

- [ ] Discover shows target runtime **found** (history signal OK as secondary)
- [ ] First-run coordinator **or** Workbench import path used deliberately (Sources V2: bulk history is not the main Sources job; first-run may offer Everything / recent range)
- [ ] Import job completes without crash
- [ ] Workbench lists imported sessions with plausible titles/times/runtimes
- [ ] Opening a session shows transcript/metadata consistent with source (within permission model)
- [ ] Re-import / re-scan does not duplicate-explode sessions (identity stable)
- [ ] sqlite `sessions` count &gt; 0

**Evidence:** session count before/after; one known session id or title.

---

## 5. Lane C — Live capture

Goal: Sources Enable → Activate → Test → real activity → Now (and eventually Workbench depth).

Prerequisite: harness can run on this Mac (§3).

- [ ] Sources: **Enable** for the runtime (hooks/plugin written; no full home wipe)
- [ ] **Activate** host steps completed (e.g. Codex trust hooks)
- [ ] **Test** connector passes **or** failure is specific and actionable (not silent)
- [ ] Row reaches **ready** only when contract allows (installed ≠ ready if `needs_action`)
- [ ] Start a **real** short agent session on that harness (or proven live event path)
- [ ] **Now** shows a live/recent card for that session (shallow presence)
- [ ] Daemon ingest/live state updates (diagnostics or UI last event time)
- [ ] Workbench can deepen that session when allowed (transcript/import as product allows)

**Evidence:** Sources row state; Now card; optional diagnostics log path under data dir.

---

## 6. Surfaces with real data (after B and/or C)

### Now

- [ ] Live/idle/blocked (or equivalent) truthful for captured sessions
- [ ] Selecting a card opens detail without crash
- [ ] Connection status matches daemon reality

### Workbench

- [ ] Table shows imported/live sessions
- [ ] Selection works; Activity rail shows relevant events
- [ ] Filters/search usable on small set
- [ ] **Copy Agent Prompt** (if in scope for this RC): creates V5 request / start packet **or** honest disabled reason — stop before full agent dogfood unless Lane D extended

### Logbook

- [ ] Still empty until something is **published**
- [ ] After publish (Lane D): only published artifacts; inspector opens body/provenance
- [ ] No bulk session-row confusion (artifact-first)

### Settings

- [ ] Compact settings card opens
- [ ] Data / Agent access (MCP) / Advanced readable
- [ ] MCP status reflects local daemon (read-only; paths make sense on macOS)

---

## 7. Lane D — Publish / artifact path (optional for first macOS RC)

Goal: at least one session becomes a Logbook artifact.

- [ ] Select session(s) in Workbench ready for authoring
- [ ] Run authoring path available on this build (agent prompt / local agent) **or** mark blocked with reason
- [ ] On success: Logbook shows published dossier
- [ ] MCP search can find it (if MCP exercised)
- [ ] Receipt/Activity totals reconcile with Logbook for that request

Full 10/50 dogfood is **not** required for “macOS product shell works”; one published artifact is enough for a thin Lane D pass.

---

## 8. Stability / macOS-specific

- [ ] Quit app fully; relaunch; same sessions still present
- [ ] Kill daemon only if product supports recovery; relaunch recovers or fails closed honestly
- [ ] No second silent instance fighting the same port without clear error
- [ ] After adhoc Gatekeeper Open once, subsequent opens work for this user
- [ ] Paths remain under Application Support (no accidental Linux `~/.local/share` on darwin)

---

## 9. Explicit non-goals for this checklist

- Developer ID signing / notarization / clean Gatekeeper on other Macs  
- Linux production cold-activation / Xvfb  
- Full S7 10/50/full authoring dogfood (unless this run is declared S7)  
- App Store submission  
- Proving every catalog harness if only Codex is set up  

---

## Result summary

| Lane | Result (pass / fail / blocked) | Notes |
| --- | --- | --- |
| 0 Install baseline | | |
| 1 Discover | | |
| A Empty honesty | | |
| 3 Setup harness | | |
| B Import | | |
| C Live | | |
| 6 Surfaces | | |
| D Publish | | |
| 8 Stability | | |

**Overall macOS product RC:** pass / fail / blocked  

**Blockers for next session:**

1.  
2.  
3.  

**Next actions:**
