# macOS in-depth product dogfood — results (2026-08-06)

**Host:** Remote macOS arm64 dogfood machine (rental; details private)  
**Plan:** [2026-08-06-macos-in-depth-product-test-plan.md](./2026-08-06-macos-in-depth-product-test-plan.md)  
**Artifact:** DMG → `~/Applications/Masthead.app` (rebuilt with identity fix)  
**Evidence on host (deleted at teardown):** `~/masthead-rc-evidence/` (~40M) + `~/masthead-rc-seed/` (~1.7G)  
**Repo samples:** `docs/acceptance/2026-08-06-macos-in-depth-results/`

## Overall grade: **Closed — ship-confidence for macOS dogfood**

Multi-harness **Discover / Enable / Test / Import / Workbench / Live / V5 publish / Logbook / MCP / identity / relaunch** exercised successfully on a remote macOS host. Later same-day closeout closed the earlier gaps for Codex hook trust, live agent authoring, and visual pass. See [2026-08-06-macos-dogfood-closeout.md](./2026-08-06-macos-dogfood-closeout.md).

**Still out of scope / skipped:** OpenCode seed, finishing all 40 authoring packs, paid Developer ID signing.

---

## Identity fix (engineering)

**Bug:** packaged health reported `buildVersion/buildSha = development` despite `release.json`.

**Fix shipped in tree:**

- `src/daemon/releaseIdentity.ts` — resolve from env + `release.json` candidates  
- `healthService` / `server` use `resolveReleaseIdentity()`  
- Electron `buildDaemonEnv` injects `MASTHEAD_BUILD_*` from packaged `release.json`

**Verified on Mac after rebuild:**

```text
buildVersion 0.1.15
buildSha 58c7e0fbcc91427bef232ead0edc50196e867cf1
```

---

## Seed from the Linux donor machine

| Source | Staged on Mac |
| --- | --- |
| Codex | **~500** rollouts under `~/.codex/sessions` + `auth.json` + `config.toml` |
| Claude Code | projects jsonl sample + settings |
| Cursor | `state.vscdb` → Application Support **and** `~/.config` |
| Grok | session sample + auth + hooks dir |
| Hermes | session sample + auth |
| OMP | session sample |
| Live fixtures | `masthead-rc-seed/fixtures/live/*` |
| Masthead LLM env | `masthead-rc-seed/auth/masthead.env.local` (OPENAI present) |

---

## Phase results

| Phase | Result | Notes |
| --- | --- | --- |
| Clean install + identity | **Pass** | Health matches release.json |
| Discover multi-harness | **Pass** | Codex 508, Claude 15, Cursor 1, Grok 10, Hermes 10, OMP 40 history counts |
| Enable / Test | **Pass** | Claude/Cursor/Grok/Hermes/OMP → ready after enable+test; **Codex remains `needs_action: trust_hooks`** (expected without UI trust) |
| Import multi-harness | **Pass (with issues)** | 6 jobs; Codex `succeeded_with_issues` (~300k records); others succeeded; Workbench **~494** then **471** after relaunch |
| Workbench depth | **Pass (API)** | Multi-runtime mix: codex 451, claude 14, hermes 10, grok 10, omp 7, cursor 2; **481 compileReady** |
| Live | **Partial** | Synthetic ingest for codex/claude/cursor/grok/omp → **5 Now cards**; real Codex app trust not completed |
| Authoring → Logbook | **Pass** | Request `authoring-v5-request:c8f5eb46-…`; pack finish **published 5 / rejected 1**; Logbook **total 5** |
| MCP | **Pass** | ready, 16 tools |
| Stability | **Pass** | Quit/relaunch: identity intact, wb 471, logbook 5 |

### Import job snapshot

| Runtime | Job terminal | Approx imported records |
| --- | --- | --- |
| codex | succeeded_with_issues | 300009 |
| omp | succeeded | 21685 |
| hermes | succeeded | 1085 |
| grok | succeeded | 743 |
| claude_code | succeeded | 212 |
| cursor | succeeded_with_issues | 2 |
| opencode | skipped | no history |

### Workbench by runtime (post-import)

`codex: 451 · claude_code: 14 · hermes: 10 · grok: 10 · omp: 7 · cursor: 2`  
compileReady **481** / quality passed **481** / unchecked **13**

### Logbook (publish)

5 × `session_dossier` after evidence-grounded V5 save/finish (1 hard_reject for instruction-like title).

---

## What still needs human / follow-up

1. **RDP visual pass** (cloud Mac vendor :6000) — surfaces/chrome not eyeballed this run.  
2. **Real Codex live:** open Codex.app, trust Masthead hooks (`/hooks`), run a real short session (auth files are already on the Mac).  
3. Optional **LLM agent authoring** instead of scripted grounded drafts (OPENAI key is on Mac seed env).  
4. Optional OpenCode history seed.  
5. **Commit** identity fix + packaging + acceptance docs on a branch (not done automatically).  
6. Codex import “succeeded_with_issues” + 300k record cap — worth understanding later.

---

## Product findings

1. **Identity leak fixed** — was blocking honest release identity.  
2. **Multi-harness import works on darwin** for Codex, Claude Code, Cursor, Grok, Hermes, OMP.  
3. **V5 publish works on macOS** when evidenceRefs point at catalog message ids.  
4. **Empty evidenceRefs → hard_reject** — expected quality gate; first publish attempt documented this.  
5. **Codex Ready ≠ Test passed** — still needs host trust of hooks.  
6. HTTP V5 `start` requires full `expectedIdentity` body; **CLI start works** without that hassle.

---

## How to resume dogfood on the Mac

```bash
ssh remote-mac
export PATH="/opt/homebrew/bin:$PATH"
open ~/Applications/Masthead.app
curl -sS http://127.0.0.1:17373/health | python3 -m json.tool | head
curl -sS 'http://127.0.0.1:17373/workbench/sessions?limit=5' | python3 -m json.tool | head
curl -sS 'http://127.0.0.1:17373/logbook/search?q=&limit=10' | python3 -m json.tool | head
# Evidence + seed kept:
ls ~/masthead-rc-evidence ~/masthead-rc-seed
```
