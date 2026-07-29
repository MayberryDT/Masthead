# G2 — Grok ~5-minute “session start” heartbeat diagnosis

**Issue:** ISSUE-G2 (plan `2026-07-28-authoring-quality-queue-and-grok-spam.md`)  
**Branch:** `docs/g2-grok-heartbeat-diagnosis`  
**Base:** `47f63ed6`  
**Date:** 2026-07-28  
**Scope:** read-only diagnosis + this note (no product behavior change)

---

## Verdict

**External Grok Build creates the empty / near-empty sessions on a ~5 minute cadence. Masthead does not.**

Masthead then **amplifies** them on two independent paths:

1. **Live hook** — installed `SessionStart` command posts to `/ingest?runtime=grok` → durable session with title **`Grok Build: session start`** on Now.
2. **Import** — `~/.grok/sessions/**/chat_history.jsonl` unit planning/parsing enrolls Workbench rows that fail meaningful-evidence checks and land in **Quality review** (not suppress).

**Recommend: suppress-only (G1).** Cancel or no-op G3 product “stop the timer” work — there is no Masthead timer to kill. Optional G3 later is only adapter/precheck hardening, not a source heartbeat fix.

---

## Evidence (host disk + code, 2026-07-28)

### 1. On-disk Grok sessions fire every exact 5.0 minutes

Under `~/.grok/sessions/%2Fhome%2Ftyler/` (encoded cwd `/home/tyler`):

| Era | Shape | Cadence |
|---|---|---|
| ~2026-06-29 → 2026-07-03 | `chat_history.jsonl` **1× `system` only**, ~1907 bytes | inter-arrival **5.0 min** (median) |
| 2026-07-28 (ongoing) | `system` + `user`, ~47295 bytes, **no assistant/tools** | inter-arrival **5.0 min** |

Sample of recent home-cwd sessions (local mtimes):

```text
13:05:32  019fa9e7-…  gap=5.0m  size=47295
13:00:30  019fa9e2-…  gap=5.0m  size=47295
12:55:29  019fa9de-…  gap=5.0m  size=47295
…
```

Volume snapshot (home cwd tree only):

- **1071** conversation dirs
- **1009** with `summary.json` `agent_name: "grok-build-plan"`
- **50** legacy system-only shells; **~996** in the modern system+skills-reminder shape

These directories and files are written by **Grok Build itself** under `~/.grok/sessions/`. Masthead never creates `chat_history.jsonl`.

### 2. Modern “empty” payload is not a real user turn

Representative `summary.json` (2026-07-28):

```json
{
  "info": { "id": "019fa9e7-…", "cwd": "/home/tyler" },
  "session_summary": "",
  "num_messages": 1,
  "num_chat_messages": 2,
  "agent_name": "grok-build-plan",
  "generated_title": null
}
```

`chat_history.jsonl`:

1. **`type: system`** — Grok CLI system prompt  
2. **`type: user`** — content is only `<system-reminder>…skills are available…` (no `<user_query>`, no tools, no assistant)

So the shell looks like “has a user message” to naive message counts, but it is **plan-agent bootstrap / skills injection**, not a human prompt.

### 3. Live hook path produces the “session start” title

Installed Grok hooks (`~/.grok/hooks/masthead.json`) register **SessionStart** (and UserPromptSubmit, Pre/PostToolUse, Stop, …) to:

```text
MASTHEAD_RUNTIME=grok … masthead-hook.js → http://127.0.0.1:17373/ingest?runtime=grok
```

Runtime profile maps the event:

```173:183:src/adapters/live/runtimeProfiles.ts
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.response",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "turn.completed",
      stopfailure: "turn.completed",
      sessionend: "session.closed"
    },
```

`summaryFrom` in `src/core/liveHookAdapter.ts` builds a label from the hook event name when no task preview exists:

- `SessionStart` → **`Grok Build: Session Start`** (profile label + normalized event name)

Durable title write path (`src/daemon/db/sessionRepository.ts` `upsertSession`):

- For `session.started`, uses `usefulSessionTitleFromSummary(event.summary)`
- That helper **filters** bare `* hook event` strings but **does not** strip `Grok Build: session start`
- Observed in local dev DB: title **`Grok Build: session start`**, project_label `tyler`, lifecycle `running`

Note: `sessionReducer.usefulSessionTitle` **does** treat `Grok Build: session start` as non-title, so board projection and DB upsert disagree slightly; **cosmetic only** — sessions still exist either way.

Live observation during diagnosis: `masthead-hook.js` processes were spawning against the production connector while new home-cwd Grok sessions appeared — consistent with SessionStart dual-write (disk transcript + live ingest).

### 4. Import path independently materializes the same shells

Grok import discovery (`src/adapters/grok/discovery.ts`):

- Candidates include `~/.grok/hooks` and `~/.grok/sessions`
- **`discoverGrokSources` only returns `chat_history.jsonl` under sessions** (not hook config files)

Unit plan/parse (`src/adapters/grok/transcriptUnit.ts`):

- One unit per conversation dir: `unitId = grok:{conversationId}`
- Emits `message` records for `system` / `user` / `assistant`
- Summary metadata becomes a session-shaped record when `summary.json` exists (empty title → no useful title)

There is **no** `setInterval` / 5-minute poller under `src/adapters/grok/*` or live adapters that invents sessions. Import only reads what Grok already wrote.

### 5. Why they hit Quality review instead of suppress today

`runCaptureQualityPrecheck` (`src/workbench/qualityPrecheck.ts`):

| Condition | Disposition |
|---|---|
| zero evidence | suppress / `empty` |
| messages==0 and only low-value | suppress / `hook_only` |
| messages==0 and only runtime signals | suppress / `diagnostic_only` |
| user + assistant | keep |
| else (including **user-only, no tools/files**) | **review / `insufficient_evidence`** |

Modern heartbeat shells have **one “user” message** (skills reminder) → not `hook_only` / not `empty` → **review**. That matches plan symptom: Grok session-start spam in Quality review / package path.

Legacy system-only shells (no user) may already suppress depending on coverage classification; the active ~5m pattern is the **system + system-reminder user** shape.

### 6. What is *not* the source

- **Not** a Masthead daemon heartbeat / import job timer creating sessions.
- **Not** `~/.grok/hooks/*.json` import (discover path does not parse hook install JSON as sessions).
- **Not** duplicate identity for one conversation: each 5m tick gets a **new UUID** conversation dir (`sourceSessionId` / session id change every time).
- Host systemd user timers / crontab did not show a 5-minute Grok job; the writer is the running **Grok Build** process family (e.g. `grok agent stdio`) with `agent_name: grok-build-plan` sessions under home cwd.

---

## Path map (live vs import)

```text
Grok Build (external)
  └─ every ~5m: new ~/.grok/sessions/<encoded-cwd>/<uuid>/
        chat_history.jsonl  (system [+ skills system-reminder "user"])
        summary.json        (agent_name=grok-build-plan, empty title)
        events.jsonl, …

Path A — LIVE (Now / board)
  SessionStart hook → masthead-hook.js → POST /ingest?runtime=grok
    → liveHookAdapter map SessionStart → session.started
    → summary "Grok Build: Session Start"
    → sessionRepository title "Grok Build: session start"
    → Now card / running lifecycle until idle TTL

Path B — IMPORT (Workbench / quality)
  discoverGrokSources → planGrokTranscriptUnits → parseGrokTranscriptUnit
    → message rows (system + user-reminder)
    → capture quality precheck → review (insufficient_evidence)
    → Quality review / package path spam
```

Both paths are **downstream of external session creation**. Fixing only live or only import leaves the other channel dirty.

---

## Root cause (one paragraph)

**Grok Build’s plan agent (`agent_name: grok-build-plan`) periodically materializes a new home-cwd session (~every 5 minutes) with system prompt and a non-human skills `system-reminder` user row, never a real task.** Masthead’s correctly wired Grok SessionStart hooks and jsonl import faithfully capture each new conversation id, so Now shows **“Grok Build: session start”** shells and Workbench Quality review accumulates incomplete units. There is no Masthead bug that invents a 5-minute timer; the product gap is **lack of suppress rules** for these low-value shells (G1 / D3).

---

## Recommendation

### Prefer **suppress-only (G1)** — do this

Align with frozen decision **D3**: empty / session-start-only Grok → **Not Added** (`hook_only` or new `session_start_only`), not review.

G1 should treat as suppress when **all** of:

- runtime is Grok (or source is Grok transcript / hook), and
- no assistant / tool / file evidence, and
- “user” text is absent **or** only low-value (`<system-reminder>`, skills catalog, generic session-start copy), and/or
- only system + hook lifecycle signals

Do **not** suppress real Grok conversations with human user + assistant (or tools/files).

Also covered by plan **D4** for incomplete Grok once import-complete/ended: auto Not Added rather than long review aging alone.

### **G3 product source-fix — cancel / no-op**

| Option | Verdict |
|---|---|
| G3 “stop Masthead creating empty sessions on a timer” | **Cancel** — no such timer exists |
| Disable Grok SessionStart hook entirely | **Not recommended** as primary fix — loses legitimate live starts; still imports disks |
| Stop Grok Build plan heartbeat externally | **Out of product scope** (Grok CLI/agent behavior); document only |
| Optional later hardening (if still needed after G1) | Adapter-level skip of `agent_name=grok-build-plan` units with no real user_query; or live ignore SessionStart until first UserPromptSubmit with non-reminder text — product choice, not required to clear review |

### One-line code?

No safe one-line fix for the **session spam root**. The closest cosmetic inconsistency (`usefulSessionTitleFromSummary` accepting `Grok Build: session start` while `sessionReducer` rejects it) only renames/clears titles; it does not stop enrollment or review. Leave to G1/G3 policy, not a drive-by in G2.

---

## Implications for G1 acceptance fixtures

Minimum fixtures G1 should add:

1. **Live-shaped:** single `session.started` / hook-only or system-only → suppress.  
2. **Import-shaped modern heartbeat:** system + user whose text is only `<system-reminder>` skills list, no assistant/tools → suppress (not review).  
3. **Negative:** Grok with real user + assistant (and/or tools) → keep or existing rules, **not** suppress.

---

## Files read (non-exhaustive)

| Area | Path |
|---|---|
| Grok adapter | `src/adapters/grok/{adapter,discovery,transcriptUnit,parser}.ts` |
| Live profile / hook adapter | `src/adapters/live/runtimeProfiles.ts`, `hookAdapter.ts`, `src/core/liveHookAdapter.ts` |
| Title / session upsert | `src/core/sessionReducer.ts`, `src/daemon/db/sessionRepository.ts` |
| Quality | `src/workbench/qualityPrecheck.ts` |
| Host | `~/.grok/hooks/masthead.json`, `~/.grok/sessions/%2Fhome%2Ftyler/**` |

---

## G3 path one-liner

**Cancel G3 timer fix; rely on G1 suppress for `grok-build-plan` system(+system-reminder) shells; only reopen G3 for optional adapter skip-until-real-user if suppress is insufficient.**
