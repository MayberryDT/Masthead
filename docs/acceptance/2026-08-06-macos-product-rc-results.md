# macOS product RC results — 2026-08-06 (MacinCloud TX089)

**Operator:** agent (SSH + daemon HTTP API; no RDP visual pass)  
**Host:** `macincloud` / TX089  
**Artifact:** DMG → `~/Applications/Masthead.app` (from `~/src/Masthead/out/make/Masthead.dmg`)  
**Checklist:** [macos-product-rc-checklist.md](./macos-product-rc-checklist.md)  
**Inventory:** [macos-macincloud-host-inventory.md](./macos-macincloud-host-inventory.md)

## Overall

**Partial pass.** Install, empty honesty, Discover, Codex Enable/Test, fixture **import**, synthetic **live ingest**, Workbench list, MCP status, V5 request create/bootstrap, and quit/relaunch data survival all worked via API.

**Not done:** RDP UI visual pass, real Codex login + trusted hooks + real agent turn, full authoring save/finish/publish to Logbook, Cursor/Claude Code lanes, signing.

---

## Lane results

| Lane | Result | Notes |
| --- | --- | --- |
| **0 Install baseline** | **Pass** | DMG installed to `~/Applications`; quarantine stripped; app + daemon up on `127.0.0.1:17373`; data dir Application Support |
| **1 Discover** | **Pass (API)** | 8 catalog runtimes; 7 `not_found`; Codex `found` (empty `~/.codex` then hooks/history); scan honest missing until fixtures |
| **A Empty honesty** | **Pass (API)** | Before fixtures: projection 0 cards, workbench 0, logbook 0, sqlite sessions 0 |
| **3 Codex setup** | **Partial** | Enable wrote `~/.codex/hooks.json`; Test **passed**; still `needs_action: trust_hooks`. CLI doctor: **Not logged in** |
| **B Import** | **Pass (fixtures)** | Staged 3 then +5 Codex rollouts under `~/.codex/sessions`; `POST /sources/connect` transcript_full succeeded; Workbench **7** sessions (6 compileReady) |
| **C Live capture** | **Partial** | Synthetic `POST /ingest?runtime=codex` session_started accepted; Now **1 idle card**. Not a real Codex app session; Ready not reached |
| **6 Surfaces** | **API pass / UI blocked** | Now/Workbench/Logbook/Sources/MCP via HTTP. **No RDP** visual verification of chrome/layout |
| **D Publish** | **Partial** | V5 request created (`authoring-v5-request:eaae63b5-…`); bootstrap → `nextAction.kind=start`. No agent save/finish; **Logbook still 0** |
| **8 Stability** | **Pass** | Quit/relaunch: health 200, workbench total still 2→ later 7 after re-import path; projection retained live card |

---

## Evidence highlights

### Install / health

- Port: `17373`
- Data: `~/Library/Application Support/masthead/masthead.sqlite`
- `release.json` in app: version `0.1.15`, gitSha `58c7e0fb…`
- **Bug:** runtime health reports `buildVersion` / `buildSha` = **`development`** (not the packaged release.json values). Also after relaunch. Identity for V5 uses `development`.

### Discover (after empty install)

- Summary: `ready:0 needsAction:0 notInstalled:8 notFound:7` (Codex presence found via `~/.codex` dir)
- Scan: all adapters `not_detected` until history staged

### Enable / Test Codex

- Hooks path: `~/.codex/hooks.json` (Masthead-managed hook commands → packaged node + `masthead-hook.js`)
- Test: `lastTest.status=passed` (connector wiring only)
- Live remains `needs_action` / `trust_hooks` even after synthetic ingest + `confirm-activation`

### Import

- Job `import_job:eb2ef266…` then later re-connect: transcript import **succeeded**
- Completion report (first job): 3 sessions discovered/hydrated, 7 records imported, 1 suppressed, 2 on package path initially; later 7 workbench rows after extra fixtures

### Live (synthetic)

- Ingest accepted event `codex:codex-session-1:start`
- Projection: `idle:1`, card title `Codex: session started`

### Authoring V5

- Request id: `authoring-v5-request:eaae63b5-d682-442d-b766-edb1f8f17be8`
- Handoff startCommand:  
  `mastheadctl workbench author bootstrap --request '…' --json`
- Bootstrap ready with `nextAction.kind=start` (claim pack); **stopped before start** (no agent authoring loop)

### Codex doctor (real harness)

- `Not logged in`
- No credentials; websocket/auth failures expected for interactive agent

---

## Bugs / product issues found on macOS RC

1. **Packaged health identity is `development`/`development`** despite correct `release.json` in the bundle. Breaks “one build SHA everywhere” release gate.
2. **Codex stays `needs_action: trust_hooks` after connector test and after synthetic live ingest** — may be correct (requires real Codex trust), but `confirm-activation` after live event did not move to ready either.
3. **`GET /sessions` and some session detail paths 404** while Workbench list shows sessions — API surface asymmetry; UI may use different routes.
4. **No RDP visual QA** this run — traffic lights, empty states, first-run coordinator UX unverified by human eye.

---

## What still needs to be done

### Blocked on human / credentials

1. **RDP UI pass** on MacinCloud (`:6000`): Now, Workbench, Logbook, Sources, Settings at desktop + narrow.
2. **`codex login`** (or API key) on TX089, then:
   - Trust Masthead hooks in Codex (`/hooks`)
   - Real short agent session
   - Prove Now updates from real hooks (not only synthetic ingest)
3. **Optional:** first-run Cursor/Claude Code if those products matter for macOS launch.

### Product engineering

4. **Fix packaged build identity** so health/capabilities/ctl report `0.1.15` + full git SHA from `release.json`.
5. **Commit** packaging + acceptance docs from this Mac work (still uncommitted on Veelox).
6. **Authoring end-to-end on Mac:** run `start` → inspect → scaffold → save → finish for the open V5 request (needs agent or hand-authored draft JSON) until Logbook has ≥1 published dossier.
7. Re-evaluate Codex ready transition after real trust + real event.

### Explicitly later

8. Apple Developer ID + notarization for distribution off this Mac.
9. Full 10/50 authoring dogfood (S7).

---

## How to resume on the Mac

```bash
ssh macincloud
export PATH="/opt/homebrew/bin:$PATH"
# App should be in ~/Applications; daemon http://127.0.0.1:17373
curl -sS http://127.0.0.1:17373/health | python3 -m json.tool | head
curl -sS http://127.0.0.1:17373/workbench/sessions?limit=20 | python3 -m json.tool | head

# Open V5 request (if still present)
"$HOME/Library/Application Support/masthead/bin/mastheadctl" \
  workbench author status \
  --request 'authoring-v5-request:eaae63b5-d682-442d-b766-edb1f8f17be8' --json
```

RDP: connect to TX089 RDP port **6000** (per SSH config notes) for visual surface pass.
