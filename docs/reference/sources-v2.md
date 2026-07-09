# Sources V2 Contract

**Status:** accepted product contract  
**Decision record:** [ADR 0010](../adr/0010-sources-v2-live-connect-only.md)  
**Design source:** `design.md` (Sources surface archetype)  
**Supersedes for Sources UI:** import-centric framing in older Sources docs and first-run flows that center history connect / import jobs

This document is the scope fence for Sources V2 implementation. If a Sources change does not serve this contract, it does not belong on Sources.

---

## 1. Product job

Sources is the **harness connection control plane for live capture**.

It exists so Masthead can:

1. discover which supported coding harnesses are installed on the local machine,
2. install or repair Masthead-managed live connectors (hooks, plugins, extensions),
3. surface host-specific activation that install alone cannot complete,
4. prove the wire with a test,
5. leave the rest of session deepening to Workbench.

### One-line ownership map

| Surface | Owns |
|---|---|
| **Sources** | Harness presence, live connector install/repair/uninstall, activation status, connector test |
| **Now** | Shallow live session presence (working / idle / blocked, identity, last activity) |
| **Workbench** | Captured-session pipeline: transcript checks/import, quality, enrichment, publication, purge/suppress |
| **Logbook** | Published sessions only |
| **Settings** | Global app/data policy; may deep-link to connector management but does not replace Sources |

### Explicit non-goals for Sources V2

Sources V2 is **not**:

- a session browser or session table,
- an import job dashboard,
- a transcript permission workspace for bulk history,
- a Workbench substitute,
- a token/model usage board,
- a whole-home filesystem crawler.

---

## 2. Data flow after connect

```text
Sources: Discover + Enable live connectors
        ↓
Harness emits lifecycle/tool/state signals (fail-open)
        ↓
Daemon ingest + live/state → canonical session identity + shallow runtime signals
        ↓
Now: live cards
        ↓
Workbench: deepen selected sessions (transcript/metadata when allowed) → publish
        ↓
Logbook: published only
```

Rules:

- Live capture may create canonical session identity and runtime-state rows **before** any transcript permission.
- Deeper transcript/message import remains **Workbench-owned** and must respect source-scoped permission when that permission model is used.
- Sources does not queue “import all history for this harness” as its primary action.
- History adapters and import APIs may continue to exist in the daemon for Workbench; they are not the Sources V2 product loop.

---

## 3. Happy path

```text
Discover → Select → Enable → Activate → Test → Ready
```

### Discover

User-triggered or first-run automatic.

Discover merges:

1. **Presence preflight** — known local paths, CLI homes, env overrides for each release-target runtime.
2. **Live connector status** — installed / missing / needs repair / needs host action for each live target.
3. Optional **history-exists signal** — “local history store found” may appear as a secondary badge only. It must not reopen import-job UX on Sources.

Discover **must not** silently install hooks or plugins.

Bounded scan only (ADR 0008): known app data dirs, known CLI homes, supported overrides, user-added custom locations. No unbounded recursive home crawl.

### Select

First-run may default-select all **found** live-capable harnesses.

Later Discover surfaces newly found harnesses as **Detected — enable?** without mutating unselected harnesses.

### Enable

Explicit user action (single harness or “enable selected / enable all detected”).

Enable means:

- install or repair Masthead-managed live connector files/config for that runtime,
- preserve unrelated user hooks/plugins,
- remove or replace only Masthead-managed entries on repair/uninstall,
- fail open: connector install failures do not crash the app; they become row-level error/needs-repair state.

Enable is **not** “session is published” and **not** “history fully imported.”

### Activate

Host-specific steps that Masthead cannot finish by writing files alone.

Examples:

| Runtime | After Enable | Ready requires |
|---|---|---|
| Claude Code, Grok Build | hook config written | usually Enable + optional Test |
| Cursor | hooks written | may need app login/restart |
| OpenCode, OMP, Pi | plugin/extension written | usually Enable + optional Test |
| **Codex** | `hooks.json` written | user reviews/trusts hooks in Codex (`/hooks`). Stale trust hashes are silently skipped, including for `codex exec` |
| **Hermes** | Python plugin under `~/.hermes/plugins/masthead-live/` + `plugins.enabled` | plugin enabled and loadable by Hermes CLI/gateway |

Sources must model **installed ≠ ready** whenever activation remains.

### Test

Synthetic round-trip against validation ingest / live-state endpoints (existing settings test path).

Test proves Masthead can accept connector payloads. It does not require a real user agent turn. Optional copy may guide a real one-shot CLI check for dogfood.

### Ready

Live connector is installed, no pending host action, and last test is passed **or** a real live event has been observed for that runtime (implementation may use either or both; UI must not claim Ready when `needs_action` is set).

Ready harnesses can produce Now cards from real sessions without further Sources work.

---

## 4. Surface IA

### Archetype

**Connector list + detail drawer** (shared metal language; not Now cards, not Logbook table, not import jobs).

### Always-visible release targets

Show the full live-capable catalog, not only detected harnesses:

- Codex
- Claude Code
- Cursor
- Grok Build
- Hermes
- Pi
- Oh My Pi (OMP)
- OpenCode

### Top bar

- **Discover** (rescan presence + live status)
- Last discover time
- Summary chips: `N ready · N needs action · N not found`
- Optional bulk: **Enable all detected** (explicit)

### Row fields (minimum)

For each harness:

- Label / runtime identity
- **Presence:** `not_found` | `found`
- **Live:** `not_installed` | `needs_action` | `ready` | `error`
- `actionRequired` when live is `needs_action` (e.g. `trust_hooks`, `enable_plugin`, `login`, `repair`)
- Last live event time (if any)
- Last test status/time (if any)
- Primary CTA: Enable | Repair | Test (context-dependent)

### Detail drawer (minimum)

- Managed config path(s)
- Ingest + live-state endpoints
- Actions: Enable/Repair, Test, Uninstall
- Activation checklist (only when relevant)
- Advanced: checked paths, diagnostics (collapsed)
- Honest capture copy: live presence + shallow runtime signals; deeper session data is Workbench

### First-run

Same loop as above, guided:

1. Discover  
2. Select detected harnesses  
3. Enable live capture  
4. Show remaining activation steps  
5. Close → user can open Now / Workbench  

No primary CTA for bulk history import or transcript approval.

### Empty / quiet states

- No harnesses found: quiet operator empty state + Discover
- All ready: quiet summary, no celebration marketing
- Needs action: yellow/attention only on rows that need human steps

---

## 5. Connector status model

Canonical statuses for Sources V2 UI and DTO merge:

### Presence

| Value | Meaning |
|---|---|
| `not_found` | No known path/CLI home/config detected for this runtime |
| `found` | Local install footprint detected |

### Live

| Value | Meaning |
|---|---|
| `not_installed` | Masthead connector not installed |
| `needs_action` | Connector files present or install attempted, but host action or repair remains |
| `ready` | Installed, no pending host action, test and/or real event confidence met |
| `error` | Install/uninstall/test failed with a reportable error |

### `actionRequired` (optional enum)

Suggested values:

- `trust_hooks` — Codex-style review/trust
- `enable_plugin` — plugin present but not enabled in host config
- `login` — host app auth required
- `repair` — mismatched/stale managed connector
- `restart_host` — host must reload config

### DTO sketch (implementation guide)

```ts
type HarnessConnectorDto = {
  runtime: LiveConnectorRuntime;
  label: string;
  presence: "not_found" | "found";
  live: "not_installed" | "needs_action" | "ready" | "error";
  actionRequired?: "trust_hooks" | "enable_plugin" | "login" | "repair" | "restart_host";
  actionMessage?: string;
  configPath?: string;
  endpoint?: string;
  stateEndpoint?: string;
  lastLiveEventAt?: string;
  lastTest?: { status: "passed" | "failed"; testedAt: string; message: string };
  checkedPaths?: string[];
  diagnostics?: string[];
  supportsActions: boolean;
};
```

Discover returns the full catalog list. Enable/Test/Uninstall call existing runtime-specific hook routes where possible; do not invent a second install stack.

---

## 6. Runtime connector rules

### Shared rules

- Fail-open: hook/plugin failures never block the harness agent loop.
- Preserve foreign hooks/plugins; only manage Masthead-marked entries.
- Pin runtime on install (`MASTHEAD_RUNTIME` / runtime query / plugin constants).
- Privacy: live hooks send redacted shallow signals by default; full transcripts are not Sources’ job.
- Uninstall removes only Masthead-managed pieces and leaves user config otherwise intact.

### Codex

- Managed file: `~/.codex/hooks.json` (user-level).
- After install/repair, trust may be stale; untrusted hooks are skipped.
- UI: `needs_action` + `trust_hooks` until user re-trusts via Codex `/hooks` (or equivalent).
- Do not forge `trusted_hash` entries in `config.toml` as a product shortcut.

### Hermes

- Managed install is a **Python** plugin: `~/.hermes/plugins/masthead-live/{plugin.yaml,__init__.py}`.
- Must appear in `plugins.enabled` (install enables it).
- Bare JS `index.js` is not a valid Hermes connector.
- CLI + gateway plugin hooks only; do not claim gateway-only hook dirs cover `hermes chat`.

### Claude Code / Grok / Cursor / OpenCode / OMP / Pi

- Use existing managed hook/plugin/extension paths.
- Mark `needs_action` only when host-specific blockers are known (e.g. Cursor auth).

---

## 7. First install vs later discover

### First install

1. Auto-Discover once when Sources setup is empty / no live connectors ready (exact gate implementation may use setup status, but criteria must be connect-oriented, not import-job-oriented).
2. Present detected harnesses selected by default.
3. Enable selected.
4. Show activation checklist for remaining hosts.
5. Optional Test all enabled.

### Later (new harness installed on machine)

1. User presses **Discover**.
2. Newly found harnesses appear as found + not_installed (or needs_action).
3. User Enables that harness.
4. Activation + Test as needed.

Discover never reinstalls every harness silently. Repair is explicit per row or explicit bulk repair of `needs_action`/`error` rows if offered.

---

## 8. Relationship to Workbench and transcript permission

- Source-scoped transcript permission may remain a **data-model** concept used by Workbench.
- Sources V2 UI does **not** center transcript permission grant as a primary setup step.
- Workbench performs per-session transcript import only when policy allows.
- Captured live sessions may appear in Workbench queues without Sources import-job UI.
- Moving import jobs, progress panels, and completion reports off Sources is intentional, not unfinished work.

---

## 9. What moves where

| Current Sources baggage | Disposition |
|---|---|
| Import jobs table / progress / completion reports | Workbench (or retire if unused) |
| Metadata / transcript import CTAs on Sources | Workbench |
| “Connect selected” history inventory as primary CTA | Remove from Sources primary loop |
| Live connector install/test/uninstall | **Keep — core of Sources V2** |
| Presence scan / preflight / checked paths | **Keep — Discover** |
| Harness catalog | **Keep — row list** |
| First-run onboarding shell | Keep structure; rewrite steps to Discover/Enable/Activate |
| Doctor connector checks | Keep; extend for activation gaps |

Daemon history adapters stay available for Workbench; Sources V2 simply stops driving them as the main UX.

---

## 10. Implementation phases (for builders)

1. **Contract freeze** — this doc + design.md archetype + openwiki Sources chapter (done when accepted).
2. **Connector DTO merge** — presence scan + live hook settings → `HarnessConnectorDto[]`.
3. **Sources UI rebuild** — list + detail + Discover/Enable/Test/Uninstall; strip import-primary UI.
4. **First-run slim wizard** — same actions as the main surface.
5. **Activation fidelity** — Codex trust, Hermes enable, other known host gates.
6. **Handoff** — Ready connectors feed Now; Workbench deepens sessions.
7. **Cleanup** — delete or quarantine import-centric Sources UI tests/copy; update doctor messaging.

Backend: recompose existing APIs. UI: rebuild. Do not greenfield a second connector system.

---

## 11. Acceptance criteria

Sources V2 is done only when all of the following hold:

1. **First install:** machine with Claude + Codex present → Discover finds both → Enable installs connectors → Claude can capture real CLI without further Sources work → Codex shows `needs_action` until `/hooks` trust, then captures (or captures under explicit trust-bypass only for automation dogfood).
2. **Later discover:** install Hermes after Masthead setup → Discover finds it → Enable installs Python plugin + enables it → real `hermes chat` creates a hermes session/live state in the DB.
3. **No silent mutation:** Discover does not install hooks; Enable is required.
4. **No import dashboard:** Sources primary UI has no import job table / bulk metadata import CTA.
5. **Installed ≠ ready:** Codex with stale trust is not shown as Ready.
6. **Uninstall safety:** uninstall removes only Masthead-managed connector pieces.
7. **Workbench boundary:** no Sources requirement to import transcripts before Now can show live presence.
8. **Visual contract:** Sources uses connector rows + detail, not Now live-card composition and not Logbook table composition.

---

## 12. Copy and language

Prefer:

- Discover, Enable, Repair, Test, Uninstall, Ready, Needs action, Not found

Avoid on Sources:

- Import sessions, Import jobs, Transcript approval (as primary), Publish, Enrich, Queue depth

Honest sentence for detail panels:

> Masthead will capture live session presence and shallow runtime signals from this harness. Deeper transcript and session processing happens in Workbench.

---

## 13. Doc index

| Doc | Role after V2 |
|---|---|
| `docs/reference/sources-v2.md` | **This contract — Sources product source of truth** |
| `docs/adr/0010-sources-v2-live-connect-only.md` | Decision record |
| `design.md` | Visual/archetype source of truth |
| `openwiki/sources.md` | Agent-facing summary of V2 |
| `docs/reference/sources.md` | Legacy reference; import sections are historical / Workbench-bound |
| `docs/adr/0008-…` | Bounded scan + catalog still apply; import onboarding UI superseded |
| `docs/adr/0009-…` | Workbench/Logbook ownership unchanged |
| `docs/reference/live-connectors.md` | Technical install paths for hooks/plugins |
