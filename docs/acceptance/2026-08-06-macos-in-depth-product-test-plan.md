# macOS in-depth product test plan (cloud Mac vendor)

**Status:** plan only — no execution in this document  
**Date:** 2026-08-06  
**Goal:** Prove Masthead on macOS as a **real multi-harness product**, not packaging or a thin API smoke.  
**Host under test:** remote macOS arm64 dogfood host  
**Donor machine:** Linux development workstation + artificial fixtures where donor data is thin  

**Supersedes for depth:** the shallow 2026-08-06 RC run  
([2026-08-06-macos-product-rc-results.md](./2026-08-06-macos-product-rc-results.md)).  
That run proved install + fixture import + synthetic ingest. This plan is the full dogfood.

**Related**

- [macos-product-rc-checklist.md](./macos-product-rc-checklist.md) — surface checklist skeleton  
- [macos-remote-mac-host-inventory.md](./macos-remote-mac-host-inventory.md) — Mac empty baseline  
- [sources-v2.md](../reference/sources-v2.md) — Discover → Enable → Activate → Test → Ready  
- [product-release-gate.md](./product-release-gate.md) — release identity / V5 rules  

---

## 1. Why the last pass was shallow

| What we did | Why it is not enough |
| --- | --- |
| DMG install + health | Packaging, not product depth |
| Empty Discover | Correct but only the empty path |
| Tiny synthetic Codex JSONL (handful of lines) | No real volume, no multi-project noise, no bad/partial files |
| Synthetic live `session_started` POST | Bypasses harness hook trust, CLI, and app |
| Workbench list + V5 request create | Stopped before author save/finish/publish |
| No RDP | Never proved UI, first-run coordinator, or chrome |
| Single “primary” harness story | Missed Cursor SQLite, Claude projects, Grok, Hermes, OMP |

**Definition of done for this plan:** an evidence packet that a skeptical human can use to answer  
“Would I run Masthead daily on a Mac with my real agent histories?” — multi-harness, import scale,  
live path, Workbench → Logbook, MCP, stability — with explicit fails and identity bugs fixed or  
tracked.

---

## 2. Donor reality on the donor Linux host (what we can move)

Point-in-time inventory (2026-08-06). Re-probe before transfer.

| Runtime | Home / store | Size (approx) | Auth / config present | Role in plan |
| --- | --- | --- | --- | --- |
| **Codex** | `~/.codex` (~26G total); `sessions` **~8.9G**, **~3654** jsonl | Huge | `auth.json`, `config.toml`, `hooks.json` | **Primary** import + live |
| **Claude Code** | `~/.claude` (~202M); `projects/**/*.jsonl`, `history.jsonl` | Medium | `settings.json` (+ Masthead backups) | Second import + live |
| **Cursor** | `~/.config/Cursor` (~133M); `state.vscdb` + workspaceStorage | Medium | App state DB | SQLite adapter path |
| **Grok Build** | `~/.grok` (~6.4G); hooks + sessions tree | Large | `auth.json`, `config.toml`, `hooks/` | Import + live hooks |
| **Hermes** | `~/.hermes` (~4.3G) | Large | `auth.json`, `config.yaml` | Import + plugin live |
| **OMP** | `~/.omp` (~325M); `agent/…` | Medium | plugins dir | Import + extension live |
| **OpenCode** | `~/.config/opencode`, `~/.local/share/opencode`, `~/.opencode` | Mixed | config/plugins | Import if history present; else fixture |
| **Pi** | `~/.pi` (~48K) | Thin | — | Discover honesty + synthetic if needed |

**Also on the donor Linux host:** production/dev Masthead DBs under `~/.config/masthead*` / `~/.local/share/masthead-dev` — useful for **reference counts / SQL probes**, not as the Mac product DB (path/layout differ; prefer re-import on Mac).

**Mac today:** Codex.app / Claude.app / Cursor.app installed; almost no harness homes until we seed them.

---

## 3. Principles

1. **Product over packaging** — every phase ends in Now / Workbench / Sources / Logbook / MCP outcomes.  
2. **Multi-harness by design** — at least **four** runtimes with real or faithful history (target: Codex, Claude Code, Cursor, plus Grok **or** Hermes **or** OMP).  
3. **Two import depths** — (a) curated **sample** for speed, (b) **stress** subset large enough to hurt (time, disk, quality).  
4. **Live is not optional for the primary harness** — at least one runtime must go Enable → Activate → real or high-fidelity hook traffic → Now.  
5. **Secrets are explicit** — transfer auth only with a written allow-list; cloud Mac vendor is a managed third-party host. Prefer short-lived copies, wipe protocol at end.  
6. **Evidence or it did not happen** — command outputs, counts, request IDs, screenshots (RDP), sqlite queries in a results file.  
7. **Disk hygiene** — do **not** rsync entire 26G Codex home by default; stage tiers. Prefer delete over archive on Mac after the run (AGENTS local disk rules).  
8. **Fix blockers that invalidate the dogfood** — e.g. packaged `buildSha=development` must be fixed **before** claiming release identity, or the test plan includes a required pre-step fix.

---

## 4. Secrets and credentials policy

### 4.1 Allowed to copy (with user confirmation at execute time)

| Asset | Purpose | Risk |
| --- | --- | --- |
| Codex `auth.json` + enough of `config.toml` to run | Real `codex` sessions / hook trust on Mac | High — full account |
| Claude settings if required for CLI | Live Claude Code | High |
| Grok `auth.json` | Live Grok if exercised | High |
| Hermes `auth.json` | Live Hermes if exercised | High |

### 4.2 Prefer not to copy whole

- Entire `~/.codex` (26G), entire `~/.grok` / `~/.hermes` trees, attachment blobs, browser profiles, MCP OAuth lock junk.

### 4.3 Transfer mechanics (when executing)

1. Stage under a **dedicated** Mac path, e.g. `~/masthead-rc-seed/` then symlink or rsync into `~/.codex` etc.  
2. Use `rsync -a --chmod=...` so mode 600 is preserved for auth files.  
3. Record checksums of auth files; never print secret contents into logs or acceptance markdown.  
4. End-of-test **wipe checklist**: remove auth files from Mac, or full harness homes if ephemeral RC account.  
5. If user refuses credentials: **import-only** tiers still run; live lanes marked blocked with fixture-only ingest called out as incomplete.

### 4.4 Artificial credentials

Where we cannot use real auth:

- **Import:** pure history files (no auth required).  
- **Live:** synthetic ingest + connector Test still run, but lane is **not** “real live pass.”  
- **Authoring:** local agent with env keys on Mac **or** hand-authored V5 draft JSON for finish — document which.

---

## 5. Data staging plan (Linux → Mac)

### 5.1 Tier A — Curated multi-harness sample (must ship first)

**Target disk:** &lt; 500 MB total preferred; hard cap 2 GB.

| Runtime | What to copy / synthesize | Suggested volume |
| --- | --- | --- |
| Codex | Selected rollouts from `~/.codex/sessions` spanning multiple days/projects + 1–2 known “good” and 1 partial/broken | **80–150** jsonl files (~100–400 MB if cherry-picked by `find … -size`) |
| Claude | `projects/` trees with real jsonl + `history.jsonl` if small | All of `projects` if &lt; 100M; else sample 20–40 sessions |
| Cursor | `User/globalStorage/state.vscdb` (+ `-wal`/`-shm` if needed) and 1–2 `workspaceStorage/*/state.vscdb` | Full Cursor user DB (~tens of MB) |
| Grok | Sample under `~/.grok/sessions` (or adapter-known layout) + hooks dir structure | 20–50 sessions or ≤200 MB |
| Hermes | Sample session files / state that adapter expects | 10–30 sessions or ≤200 MB |
| OMP | `~/.omp/agent/sessions` (or catalog path) sample | 10–30 sessions |
| OpenCode | History if present under share/config; else generate from live fixtures | As available |

**Also copy (structure only, rewrite paths on Mac):**

- Example `hooks.json` templates from donor **after** path rewrite to Mac packaged node + hook script (do not leave the donor host absolute paths).

### 5.2 Tier B — Codex stress import (after Tier A green)

| Item | Plan |
| --- | --- |
| Volume | **500–1500** rollouts or **~1–2 GB** of sessions (not full 8.9G unless disk/time allows) |
| Selection | Stratified: recent month + older month + multi-cwd + tool-heavy + compacted |
| Pass bar | Import job completes or fails with **actionable** partial report; Workbench counts reconcile with completion report; no daemon crash; time recorded |
| Out of scope unless requested | Full 8.9G / 3654-file copy |

### 5.3 Tier C — Artificial enrichment (fill gaps)

Use when donor data is thin for a runtime:

1. Expand repo fixtures (`fixtures/adapters/codex`, `src/adapters/__fixtures__/{grok,hermes}`, live hook fixtures).  
2. Generator script (to be written at execute time): emit N Codex-compatible rollouts with distinct `session_meta.id`, multi-turn, tools, timestamps.  
3. Live fixtures already present: `codex-session-start`, `claude-user-prompt-submit`, `cursor-before-submit-prompt`, `grok-pre-tool-use`, `omp-session-start`, `opencode-chat-message`.

Artificial data **supplements** Tier A; it does not replace multi-harness real history for Codex/Claude/Cursor if donor has them.

### 5.4 Placement on Mac (catalog paths)

| Runtime | Place on Mac |
| --- | --- |
| Codex | `~/.codex/sessions/...`, auth/config as decided |
| Claude Code | `~/.claude/projects/...`, settings |
| Cursor | `~/Library/Application Support/Cursor/...` **and/or** `~/.config/Cursor/...` (adapter checks both Linux-style and macOS Application Support — seed **both** or the path catalog uses on darwin after a dry Discover) |
| Grok | `~/.grok/...` |
| Hermes | `~/.hermes/...` |
| OMP | `~/.omp/agent/...` |
| OpenCode | `~/.config/opencode`, `~/.local/share/opencode` |

**Dry-run Discover** after each seed; adjust paths until `presence=found` and `historySessionCount` &gt; 0 for that runtime.

### 5.5 Transfer commands (sketch — execute later)

```text
# From the donor Linux host — example pattern (paths finalized at execute time)
rsync -a --relative \
  .codex/auth.json .codex/config.toml \
  remote-mac:~/masthead-rc-seed/

# Sampled sessions: list file → rsync --files-from
# Cursor DB:
rsync -a ~/.config/Cursor/User/globalStorage/state.vscdb* remote-mac:~/masthead-rc-seed/cursor/
```

Prefer **one seed tree + install script** on Mac that maps into final homes atomically.

---

## 6. Environment preparation on Mac

1. Install/confirm Masthead from **DMG → Applications** (not only `out/`).  
2. Optional clean data dir: wipe `~/Library/Application Support/masthead` for a true multi-harness first-run (after backing nothing precious — current RC data is disposable).  
3. Fix or note **build identity bug** (`development` vs `release.json`) before identity-gated claims.  
4. PATH: Homebrew node for tooling; Codex CLI via `/Applications/Codex.app/Contents/Resources/codex` symlink into `~/bin`.  
5. Install CLIs as needed: Claude Code CLI if desktop-only is insufficient; `rg` if Codex doctor requires it.  
6. Free disk: keep **≥ 20 GB** free before Tier B.  
7. RDP available for visual phases (cloud Mac vendor **:6000**).

---

## 7. Test architecture (phases)

Run in order. Do not skip evidence. Fail closed: if a phase fails hard, stop or continue only with documented waiver.

```text
Phase 0  Preflight + seed transfer
Phase 1  Clean install + identity
Phase 2  Discover multi-harness honesty
Phase 3  Enable / Activate / Test (all seeded live-capable runtimes)
Phase 4  Import Tier A (multi-harness)
Phase 5  Workbench depth on imported corpus
Phase 6  Live real (primary) + synthetic secondary
Phase 7  Authoring → Logbook (at least one full publish; optional multi-pack)
Phase 8  MCP + Settings
Phase 9  Stability / relaunch / concurrent open
Phase 10 RDP visual matrix
Phase 11 Import Tier B stress (Codex)
Phase 12 Teardown / secret wipe / report
```

---

## 8. Phase detail

### Phase 0 — Preflight + seed

- [ ] Re-inventory donor Linux host sizes; build Tier A file lists  
- [ ] User confirm: **which auth files may leave the donor host**  
- [ ] Transfer seed; verify modes 600 on secrets  
- [ ] Install script places catalog paths  
- [ ] Record seed manifest (file counts, total bytes, runtimes) — no secret bodies  

**Exit:** Mac has multi-harness homes; seed manifest checked in as evidence path under `docs/acceptance/…-seed-manifest.md` (hashes of non-secret trees only).

### Phase 1 — Clean install + identity

- [ ] DMG install; first launch  
- [ ] Health: daemon up, data dir Application Support  
- [ ] **Assert** `buildVersion` / `buildSha` match `release.json` (or file bug + patch before continuing identity claims)  
- [ ] Doctor / capabilities / mastheadctl agree on instance  

**Exit:** healthy app; identity either correct or explicit known-bug with workaround.

### Phase 2 — Discover multi-harness

- [ ] `POST /sources/connectors/discover` + `discover-history`  
- [ ] `POST /sources/scan`  
- [ ] For each seeded runtime: `presence=found`, history counts &gt; 0  
- [ ] Unseeded runtimes: `not_found`  
- [ ] RDP: Sources UI matches API (chips, rows, no false ready)  

**Exit:** Discover matrix table in results (runtime × presence × historyCount).

### Phase 3 — Enable / Activate / Test

For each live-capable seeded runtime (Codex, Claude Code, Cursor, Grok, …):

- [ ] Enable → managed config path written  
- [ ] Test → pass or recorded fail with message  
- [ ] Activation: Codex trust hooks in **real** Codex app if auth present; Hermes plugin enable; Cursor restart/login if required  
- [ ] Row state before any real live event documented  

**Exit:** connector matrix (runtime × live state × lastTest × actionRequired).

### Phase 4 — Import Tier A (multi-harness)

For each runtime with history:

- [ ] `POST /sources/connect` with `runtimes: [...]`, `importScope.mode: transcript_full` (or per-product first-run Everything)  
- [ ] Wait for import jobs; capture completion reports  
- [ ] Reconcile: sessions created vs workbench total vs suppressed/quality_review  
- [ ] At least **three** runtimes contribute sessions to Workbench  

**Pass bar**

- No daemon crash  
- Per-runtime job terminal state succeeded or partial with honest importHealth  
- Workbench shows multi-runtime labels  
- Spot-check 3 sessions per runtime (title, last activity, transcript available)  

### Phase 5 — Workbench depth

- [ ] Filters by runtime / quality / publish path  
- [ ] Quality review path for failing fixtures (partial jsonl, tool-heavy)  
- [ ] Claim / release if still in product  
- [ ] Session detail / transcript read for ≥5 sessions across ≥2 runtimes  
- [ ] Copy Agent Prompt / V5 create on a **5–12** compile-ready selection spanning ≥1 runtime (prefer multi-runtime if product allows; else single-runtime pack)  

**Pass bar:** operator can select, understand quality, and produce a durable V5 request without API spelunking only.

### Phase 6 — Live

#### 6A Primary real live (Codex preferred)

If auth allowed:

- [ ] `codex login` / auth file live  
- [ ] Trust hooks  
- [ ] Real short session (`codex exec` or interactive) under a known cwd  
- [ ] Now card appears without synthetic POST  
- [ ] Connector moves toward ready per product rules  
- [ ] Workbench eventually sees the session (live and/or import catch-up)  

If auth refused: mark **blocked**; run 6B only and fail “real live” objective.

#### 6B Secondary synthetic live (all enabled runtimes)

- [ ] Fire each live fixture against correct ingest/runtime  
- [ ] Projection cards / idle-running counts change  
- [ ] No cross-runtime contamination of session ids  

### Phase 7 — Authoring → Logbook

- [ ] Bootstrap open V5 request → start pack  
- [ ] Inspect + scaffold for pack  
- [ ] Save publishable drafts (agent or scripted valid draft meeting quality gates)  
- [ ] Finish pack; request complete if single pack  
- [ ] **Logbook** shows published dossiers; inspector body/provenance  
- [ ] MCP keyword search finds ≥1 published title/keyword  

**Pass bar:** at least **one** published `session_dossier` on macOS from imported evidence.  
**Stretch:** soft_flag + hard_reject paths in same pack; optional artifact yes/no.

### Phase 8 — MCP + Settings

- [ ] MCP status ready; tool list non-empty  
- [ ] Read-only search/detail against published artifacts  
- [ ] Settings: Data path, Agent access, no crash  
- [ ] Confirm MCP cannot mutate (spot negative test)  

### Phase 9 — Stability

- [ ] Quit app fully; relaunch; sessions + logbook + open V5 state intact  
- [ ] Kill daemon child only if safe; recovery behavior  
- [ ] Second open of same app: no silent dual writers (or clear error)  
- [ ] Memory/disk: note growth after Tier A import  

### Phase 10 — RDP visual matrix

For Now, Workbench, Logbook, Sources, Settings at **desktop + narrow**:

- [ ] No blank shell; traffic lights; connection honesty  
- [ ] Empty vs populated states both previously captured (screenshot after seed)  
- [ ] First-run coordinator if clean install path re-run on secondary data dir  

Store screenshots under a dated acceptance evidence folder (or GBrain-linked paths — not raw secrets).

### Phase 11 — Tier B Codex stress

- [ ] Stage larger Codex sample  
- [ ] Full transcript import; wall-clock; peak disk  
- [ ] Completion report reconcile  
- [ ] Spot quality: sample of 20 random sessions openable  
- [ ] Daemon still healthy; UI still usable  

**Pass bar:** completes without crash; performance numbers recorded; no silent data loss.

### Phase 12 — Teardown + report

- [ ] Wipe auth from Mac (or full seed) per policy  
- [ ] Leave or wipe Masthead DB as user prefers  
- [ ] Write **results** doc: pass/fail matrix, bugs filed, times, counts  
- [ ] Optional: commit plan+results; no credentials in git  

---

## 9. Evidence package (required outputs)

Single folder or doc set, e.g. `docs/acceptance/2026-08-XX-macos-in-depth-results/`:

1. `seed-manifest.md` — runtimes, file counts, bytes (no secrets)  
2. `discover-matrix.json` / table  
3. `connector-matrix.json` / table  
4. `import-reports/` — job completion JSON per runtime  
5. `counts.md` — sqlite + workbench + logbook + MCP before/after  
6. `live.md` — real vs synthetic  
7. `authoring.md` — request id, receipt, logbook artifact ids  
8. `identity.md` — buildVersion/buildSha vs release.json  
9. `rdp/` — screenshots  
10. `bugs.md` — each defect with severity and repro  

---

## 10. Pass / fail rubric (overall)

| Grade | Criteria |
| --- | --- |
| **Ship-confidence (mac dogfood)** | Phases 1–10 pass; ≥3 runtimes imported; real live on ≥1; ≥1 Logbook publish; identity correct; RDP clean |
| **Conditional** | Import + Workbench multi-harness solid; live or publish blocked only on external auth; bugs filed with workarounds |
| **Fail** | Crash on import, false Discover, empty Workbench after “success”, identity still `development` with no fix, or only single-harness toy fixtures |

---

## 11. Engineering work likely required during execute (not this plan’s implementation)

Call out so execute session is not surprised:

1. **Packaged release identity** (`development` leak) — fix before identity claims.  
2. **Cursor path on darwin** — confirm Application Support vs `~/.config` after seed.  
3. **V5 draft tooling** — script or agent to fill 5–12 publishable sessions if no LLM on Mac.  
4. **Seed installer script** — map `masthead-rc-seed` → catalog homes with path rewrite for hooks.  
5. **Session detail API gaps** — if UI works but some GET routes 404, verify via UI + alternate endpoints.  
6. **Optional:** stratified Codex sampler script (`find` + size + recent).  

---

## 12. Effort estimate (execute)

| Block | Calendar time (one focused agent + RDP) |
| --- | --- |
| Seed selection + transfer + path fixups | 2–4 h |
| Phases 1–5 (install → import depth) | 3–6 h |
| Phase 6 live (with auth) | 1–3 h |
| Phase 7 authoring publish | 2–4 h (depends on agent) |
| Phase 8–10 | 2–3 h |
| Phase 11 stress | 2–6 h (size-dependent) |
| Report + wipe | 1 h |

**Total:** roughly **1.5–3 working days** for a real in-depth pass, not an afternoon.

---

## 13. Explicit non-goals

- Apple Developer ID / notarization  
- Full 8.9G Codex copy unless Tyler orders it  
- Windows/Linux parity in the same run  
- Production cold-activation Xvfb path  
- Committing secrets or full session corpora to git  
- Replacing unit/integration CI  

---

## 14. Decision checklist before execute

### Locked (2026-08-06, Tyler)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | **Auth** | Any auth files may be copied to cloud Mac vendor (Codex / Claude / Grok / Hermes / etc.). Handle carefully (mode 600, no git, no log dumps of contents). |
| 2 | **Tier B Codex stress** | **~500 session files** (not full 8.9G corpus). |
| 3 | **Authoring** | Prefer **agent with keys on the Mac** when possible; fall back to scripted V5 drafts only if agent path is blocked. |
| 4 | **Data retention** | **Keep** seed + Masthead DB on Mac after the run for ongoing dogfood (no mandatory wipe of product data). Still avoid committing secrets to git. |
| 5 | **Identity bug** | See §14.1 — treat as a **required understanding + Phase 1 check**; prefer fix during execute if it still shows `development`. |

### 14.1 What the “identity bug” is (plain language)

When we installed the **packaged** Mac app from the DMG, the bundle correctly contained:

```text
Contents/Resources/daemon/release.json
→ version "0.1.15"
→ gitSha "58c7e0fb…"  (full 40-char commit)
```

But the **running daemon’s** `GET /health` (and `mastheadctl workbench capabilities`) reported:

```text
buildVersion: "development"
buildSha: "development"
```

So the product’s own “who am I?” APIs did **not** match the release file baked into the app.

**Why it matters**

- Release gate: packaged app, CLI, health, and capabilities should agree on one version + one git SHA.  
- V5 authoring pins `expectedIdentity.buildSha` / database / instance — a fake `development` SHA is confusing and can mask “wrong binary” problems.  
- It is **not** Gatekeeper/signing; it is “the app doesn’t advertise its real build.”

**What we do in this dogfood**

1. Phase 1: re-check health vs `release.json`.  
2. If still `development`: **fix or root-cause during execute** (likely Electron/daemon not loading packaged `release.json` / env override).  
3. Do not call the Mac RC “release-identity green” until health matches the package.

---

## 15. Immediate next step after plan approval

Decisions in §14 are locked.

1. Build Tier A multi-harness file lists + ~500-file Codex Tier B list on the donor Linux host.  
2. Transfer seed (including allowed auth) to cloud Mac vendor; install into catalog paths.  
3. Execute Phases 1–12 with continuous evidence; keep Mac data for dogfood.  
4. Prefer agent+keys for authoring publish; keep results under `docs/acceptance/`.

**Execute when Tyler says to run the plan** (this section is no longer “plan only” once execution starts).
