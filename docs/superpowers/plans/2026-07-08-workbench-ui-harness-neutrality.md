# Workbench UI, Harness Neutrality, And Runtime Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Workbench look and feel like the rest of Masthead, fix harness-neutral identity (including Codex catalog/live parity and Grok mislabeled as Claude Code), repair residual live-projection test drift, and course-correct only the agent-facing docs that would send implementers the wrong way—without Workbench pipeline dogfood or a full docs rewrite.

**Architecture:** Work stays in the dirty f503 worktree. Do not revert Workbench V1 pipeline/backend work. Visual work reuses existing Logbook/Sources surface patterns (`surface-panel`, dense table + rail, metal toolbar language, Phosphor icons, `AppButton`). Runtime attribution is fixed at the live ingest/hook boundary so Grok Build (Claude-compatible hook protocol) cannot double-count as Claude Code. Harness catalog and live connector lists are unified around one release-target set. Docs changes are minimal and agent-directional only (OpenWiki + AGENTS product hierarchy).

**Tech Stack:** React/TS renderer, Masthead daemon, Vitest, Phosphor icons, CSS in `src/styles/masthead.css`, live hook scripts under `scripts/`, SQLite dev DB at `~/.local/share/masthead-dev/`.

**Worktree (mandatory):**

```text
/home/tyler/.codex/worktrees/f503/Masthead
```

Do not start a competing Vite server on `5173`. Masthead Dev Electron owns that port. Verify UI in the running Electron Dev app / in-app Browser at `http://127.0.0.1:5173/`.

---

## Out Of Scope

- Workbench pipeline dogfood (queue enrichment, publish flows, agent handoff end-to-end on real data).
- Full OpenWiki/PRD/docs rewrite.
- Reverting or rewriting Workbench V1 backend/CLI/MCP.
- Reintroducing Logbook bulk enrichment / Sources per-session transcript import as primary UX.
- Instructional Workbench hero/onboarding/command-cookbook copy.
- Collaborative micro-tweaks Tyler will call out live after this plan lands (those come after implementation).

---

## Confirmed Facts From Investigation

### Runtime misattribution (Grok → Claude Code)

Current Grok Build session `019f42f6-8ada-7001-afff-c722e75faf45` appears on Now as:

- `runtime: claude_code`
- `harness: Claude Code`

But the DB shows **dual attribution** for the same `source_session_id`:

| runtime | sources | reports (sample) |
|---|---|---|
| `claude_code` | `claude_code.hook`, `masthead:claude_code-hook` | 55 each |
| `grok` | `grok.hook`, `masthead:grok-hook` | 55 each |

Two canonical sessions exist for the same source id:

- `runtime:claude_code:...`
- `runtime:grok:...`

Installed hooks:

- `~/.grok/hooks/masthead.json` → `/ingest?runtime=grok` (correct)
- `~/.claude/settings.json` → `/ingest?runtime=claude_code`

Grok Build uses the Claude-style hook protocol. For this session, **both** Claude and Grok Masthead hooks fire on every event (1:1 pairing, identical `observedAt`). Projection currently surfaces the Claude Code card. Only one dual-runtime `source_session_id` exists in the live DB today (this Grok session), so the bug is real and localized, not global corruption.

Also relevant:

- `defaultLiveRuntime` in `src/daemon/server.ts` is `"claude_code"`.
- `runtimeFromAdapter` in `src/core/liveIdentity.ts` only searches `RUNTIME_KINDS` (excludes `codex` from `COMPAT_RUNTIME_KINDS`). That is a latent neutrality/scoping footgun.

### Harness catalog vs live connectors

| Layer | Runtimes |
|---|---|
| Live connectors (`LIVE_CONNECTOR_RUNTIMES` / `LIVE_INGEST_RUNTIMES`) | codex, claude_code, cursor, grok, opencode, omp, pi, hermes |
| UI harness catalog (`HARNESS_CATALOG`) | 7 active, **no codex** |
| `COMPAT_RUNTIME_KINDS` | codex only |

Product framing must stay harness-neutral: live connectors feed the canonical DB; Now/Workbench/Logbook are views. Codex is a live connector, not “the product.”

### Workbench UI

- Sidebar icon `workbench` reuses Logbook’s `BookOpenText`.
- Panel is a basic table + rail with custom CSS that does not fully share Logbook/Sources chrome (toolbar density, empty states, surface shell, status chips, metal controls).
- Dev DB has **0** `publish_path` sessions, **182** published, **357** not-added. Empty publish-path is currently correct ops state—not a disconnect. Empty UI still needs to look intentional.

### Docs

OpenWiki quickstart still lists the old hierarchy without Workbench. Do not rewrite everything; do stop agents from treating Logbook/Sources as the enrichment/import workflow owners.

---

## File Map

| Area | Primary files |
|---|---|
| Runtime attribution | `scripts/masthead-hook.js`, `src/daemon/server.ts`, `src/core/liveIdentity.ts`, `src/adapters/live/hookAdapter.ts`, live-state ingest path, tests under `src/daemon/__tests__/`, `src/core/__tests__/` |
| Harness catalog | `src/adapters/types.ts`, `src/adapters/harnessCatalog.ts`, `src/adapters/capabilities.ts`, Sources/Settings consumers, `docs/reference/live-connectors.md` only if labels are wrong |
| Workbench icon | `src/ui/icons/icon-registry.ts`, sidebar tests |
| Workbench UI | `src/ui/workbench/WorkbenchPanel.tsx`, `src/ui/workbench/__tests__/`, `src/styles/masthead.css`, optional `src/app/surfaces/WorkbenchSurface.tsx` |
| Projection tests | `src/core/__tests__/fixtureReplay.test.ts`, related live-state tests if still failing |
| Agent-facing docs | `openwiki/quickstart.md`, optionally `openwiki/architecture.md` / `AGENTS.md` product hierarchy only |

---

## Task 1: Prove And Fix Grok↔Claude Runtime Double Attribution

**Files:**
- Modify: `scripts/masthead-hook.js`
- Modify: `src/daemon/server.ts` (only if daemon-side fallback still mis-defaults)
- Modify: `src/core/liveIdentity.ts` (use full live runtime set, not import-only `RUNTIME_KINDS`)
- Test: add/extend hook + live-state tests (new or existing under `src/core/__tests__/` / `src/daemon/__tests__/liveStateApi.test.ts` / hook admin tests)

### Diagnosis already known

Grok Build is dual-invoking Claude Code Masthead hooks and Grok Masthead hooks for the same session id. Query-param runtime alone is insufficient when the **wrong install** also runs.

### Required behavior

1. Hook script resolves runtime in this order:
   1. `MASTHEAD_RUNTIME` env (explicit install pin)
   2. Host detection from process/env (Grok vs Claude vs others) when unambiguous
   3. `runtime` query param on `MASTHEAD_INGEST_URL`
   4. payload `runtime` / `adapter`
2. Live connector install commands set `MASTHEAD_RUNTIME=<runtime>` in addition to the query param (defense in depth).
3. When host detection says Grok, never report `claude_code` even if the Claude settings.json hook command line is the one that fired.
4. Daemon `runtimeFromAdapter` / projection scoping accept all live runtimes including `codex` (`ALL_RUNTIME_KINDS` or `LIVE_INGEST_RUNTIMES`).
5. Prefer not inventing silent session merges for historical dual rows in this pass; stop new dual posts first. Optional later cleanup of ghost `claude_code` clones can be a follow-up if needed.

- [ ] **Step 1: Write failing tests for host-aware runtime resolution**

Add a focused unit-testable export path (either pure helpers extracted from `masthead-hook.js` into a small shared module under `scripts/` or `src/core/`, or test via existing hook/admin harness). Minimum cases:

```ts
// Example expected contract
expect(resolveHookRuntime({
  env: { MASTHEAD_RUNTIME: "grok", MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code" },
  payload: {}
})).toBe("grok");

expect(resolveHookRuntime({
  env: { MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code" },
  // simulate Grok host markers (choose real markers discovered during implementation)
  envMarkers: { isGrokBuild: true },
  payload: {}
})).toBe("grok");

expect(resolveHookRuntime({
  env: { MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code" },
  envMarkers: { isClaudeCode: true },
  payload: {}
})).toBe("claude_code");
```

Also add/adjust:

```ts
// liveIdentity
expect(runtimeFromAdapter("codex")).toBe("codex");
expect(runtimeFromAdapter("grok")).toBe("grok");
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
npm test -- --run src/core/__tests__/liveIdentity.test.ts # and new hook runtime test path
```

Expected: FAIL on codex and/or Grok-overrides-Claude cases.

- [ ] **Step 3: Implement host-aware runtime resolution**

In hook path:

- Extract pure `resolveHookRuntime(...)`.
- Detect Grok via durable signals found during implementation (examples to probe: process path containing `grok`, `GROK_*` env, parent process name, config home `~/.grok`). Prefer signals that do not false-positive Claude.
- Detect Claude Code similarly (`CLAUDE_*`, `~/.claude`, parent binary).
- State report body and ingest attribution must use the resolved runtime.
- Install command builder (`src/daemon/liveConnectorSettings.ts`) should emit:

```bash
MASTHEAD_RUNTIME='grok' MASTHEAD_INGEST_URL='.../ingest?runtime=grok' MASTHEAD_STATE_URL='.../live/state' ...
```

for every live runtime (not only Grok).

Fix `runtimeFromAdapter`:

```ts
import { ALL_RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";

export function runtimeFromAdapter(value: string | undefined): RuntimeKind | undefined {
  return ALL_RUNTIME_KINDS.find((runtime) => runtime === value);
}
```

If daemon still defaults unknown adapters to `claude_code`, leave the default only for true unknowns, never for dual-reported Grok sessions that already carry explicit runtime.

- [ ] **Step 4: Re-run tests**

```bash
npm test -- --run src/core/__tests__/liveIdentity.test.ts src/daemon/__tests__/liveConnectorSettings.test.ts src/daemon/__tests__/liveStateApi.test.ts
```

Expected: PASS for touched files.

- [ ] **Step 5: Live verification (no Workbench dogfood)**

Restart Masthead Dev service after daemon rebuild if needed:

```bash
systemctl --user restart masthead-dev-electron.service
```

Then generate a new Grok Build hook activity (or Settings → Grok connector test) and confirm:

- new `live_state_reports` for that activity are `runtime=grok` only
- Now card harness label is **Grok Build**, not Claude Code

Do **not** require cleaning the existing dual historical session in this task unless a tiny projection preference is needed to stop showing the ghost Claude card for the same source id. If needed, prefer the runtime with explicit matching install source (`masthead:grok-hook` / `grok.hook`) over default `claude_code` when both exist for the same `sourceSessionId` and host detection/install pins conflict—keep that change tightly tested.

- [ ] **Step 6: Commit**

```bash
git add scripts/masthead-hook.js src/core/liveIdentity.ts src/daemon/liveConnectorSettings.ts src/daemon/server.ts src/**/__tests__/**
git commit -m "$(cat <<'EOF'
fix: stop Grok live sessions being attributed as Claude Code

Pin MASTHEAD_RUNTIME on installs, resolve hook runtime with host detection,
and accept all live runtimes (including codex) in projection identity helpers.
EOF
)"
```

---

## Task 2: Align Harness Catalog With Live Connectors (Harness-Neutral)

**Files:**
- Modify: `src/adapters/harnessCatalog.ts`
- Modify: `src/adapters/types.ts` only if Codex support level / visibility needs explicit live treatment
- Modify/tests: `src/adapters/__tests__/capabilities.test.ts`, Sources onboarding/import tests if they assert catalog membership
- Touch labels/copy only where Codex is erased or treated as sole product

### Required product rules

1. Release-target live set is eight harnesses: Codex, Claude Code, Cursor, Grok Build, Hermes, Pi, Oh My Pi, OpenCode.
2. Codex may remain “compat/history-rich” in import maturity language, but must not be invisible in live-capable surfaces when Settings reports it installed.
3. Never frame the product as “Codex Live Connector.”
4. Sources stays capture/permissions; Workbench stays per-session transcript import.

- [ ] **Step 1: Write failing catalog/capability tests**

```ts
import { HARNESS_CATALOG, harnessForRuntime } from "../harnessCatalog";
import { LIVE_CONNECTOR_RUNTIMES } from "../../daemon/liveConnectorSettings";

test("catalog covers every live connector runtime", () => {
  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    expect(harnessForRuntime(runtime), runtime).toBeTruthy();
  }
});

test("codex is present as a live-capable catalog entry", () => {
  const codex = harnessForRuntime("codex");
  expect(codex?.supportsLiveWatch).toBe(true);
  expect(codex?.visibility).not.toBe("hidden_legacy");
});
```

If circular import is awkward (catalog ↔ daemon), put shared runtime list in `src/adapters/` or `src/shared/` and have both import it. Prefer extracting:

```ts
// e.g. src/adapters/liveRuntimes.ts
export const LIVE_CONNECTOR_RUNTIMES = [...] as const;
```

and re-export from `liveConnectorSettings.ts` / `server.ts`.

- [ ] **Step 2: Run tests, confirm fail**

```bash
npm test -- --run src/adapters/__tests__/
```

Expected: FAIL because Codex missing from catalog / live list not shared.

- [ ] **Step 3: Add Codex catalog entry + shared live runtime list**

Add a first-class catalog entry for Codex, roughly:

```ts
active(
  "codex",
  "Codex",
  ["OpenAI Codex"],
  "Codex local hooks and session history.",
  "active_transcript", // or active_metadata if import maturity is weaker—match real adapter capabilities
  ["hook", "jsonl"],
  ["~/.codex", /* existing known paths from adapters */],
  ["MASTHEAD_CODEX_HOME", "CODEX_HOME"],
  { live: true, tokens: true, files: true }
)
```

Tune `supportLevel` / `runtimeStatus` from existing Codex adapter capabilities—do not invent import features Codex lacks. If Codex is import-limited, keep import flags honest while `supportsLiveWatch: true`.

Ensure Sources filters, Now harness filter, and Settings live cards all draw from the same runtime vocabulary.

- [ ] **Step 4: Grep for Codex-only framing in UI strings**

```bash
rg -n "Codex Live|No live Codex|codex-only|Codex sessions yet" src/ui src/app openwiki docs/reference -g '!**/plans/**'
```

Replace product-level strings with harness-neutral wording (e.g. “No live sessions yet”). Keep Codex as a normal harness label where the runtime is actually Codex.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- --run src/adapters src/ui/sources src/daemon/__tests__/settingsApi.test.ts src/daemon/__tests__/liveConnectorSettings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: align harness catalog with live connector runtimes

Make Codex a first-class live-capable catalog entry and keep product framing
harness-neutral across Sources/Now/Settings.
EOF
)"
```

---

## Task 3: Distinct Workbench Icon

**Files:**
- Modify: `src/ui/icons/icon-registry.ts`
- Test: `src/ui/__tests__/observabilitySidebar.test.tsx` (and any icon snapshot/registry tests)

### Decision

Use Phosphor **`Wrench`** for Workbench (operations/tooling). Logbook keeps **`BookOpenText`**. Alternatives if Wrench feels too “settings”: `Hammer` or `Toolbox`. Default recommendation: **`Wrench`**.

- [ ] **Step 1: Update registry**

```ts
import { Wrench, /* existing imports */ } from "@phosphor-icons/react";

export const iconRegistry = {
  // ...
  logbook: BookOpenText,
  workbench: Wrench,
  // ...
};
```

- [ ] **Step 2: Assert sidebar icons differ**

In sidebar test, assert Workbench and Logbook do not share the same icon component / `data` name if the test harness exposes it. At minimum, render both links and ensure both labels exist; add registry unit assertion:

```ts
expect(iconRegistry.workbench).not.toBe(iconRegistry.logbook);
```

- [ ] **Step 3: Run tests + visual check in Electron Dev**

```bash
npm test -- --run src/ui/__tests__/observabilitySidebar.test.tsx
```

In-app Browser: Workbench nav icon distinct from Logbook.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): give Workbench a distinct wrench icon"
```

---

## Task 4: Workbench Visual Alignment (Ops Surface, Not Hero)

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/styles/masthead.css` (workbench section + shared surface reuse)
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Optional: `src/app/surfaces/WorkbenchSurface.tsx` class list only

### Design contract

From `design.md` / AGENTS surface archetypes:

- Workbench = dense table + Activity rail (Logbook-like IA).
- Shared visual language with Logbook/Sources; **not** Now live cards.
- No instructional hero, onboarding, CLI recipes, board lanes.
- Empty publish-path state must look like intentional ops idle, not broken empty app.

### Reuse, don’t invent

Mirror patterns from:

- `src/ui/HistoryPanel.tsx` / Logbook table chrome
- `src/ui/sources/SourcesConnectedDashboard.tsx` metal toolbar
- `AppButton`, status chips, `surface-panel`, `CanonicalErrorPanel` / `EmptyPanel` if already used elsewhere for ops empties

### Concrete UI targets

1. **Shell:** `workbench-panel` sits cleanly in `app-surface` / `surface-panel` like Logbook; consistent padding with other surfaces.
2. **Toolbar:** metal/observability toolbar language; compact count + actions (`Copy Agent Prompt`, `Select Visible`, `Clear`, `Refresh`); no H1 teaching copy.
3. **Table:** match Logbook density (header row, mono data, selection highlight, hover, column alignment). Status tokens should look like existing chips/pills, not raw badges on a bare HTML table.
4. **Activity rail:** same surface card language as inspectors elsewhere (border, title label mono, quiet empty text).
5. **Not Added summary:** compact facts block (counts/reasons), not a second primary table.
6. **Empty publish-path:** short ops status only, e.g. `No publish-path sessions` + muted subline about Not Added total if present. No “What is Workbench?” copy.
7. **Responsive:** table + rail stack on narrow widths like other dense surfaces; run surface contract check after.

- [ ] **Step 1: Extend WorkbenchPanel tests for chrome/empty state**

```tsx
test("renders ops empty state without instructional hero copy", () => {
  const html = renderToStaticMarkup(
    <WorkbenchPanel sessions={[]} loading={false} notAddedSummary={{ total: 357, reasons: [{ reason: "metadata_only", count: 259 }] }} />
  );
  expect(html).toContain("No publish-path sessions");
  expect(html).not.toMatch(/what is workbench|get started|run mastheadctl|command cookbook/i);
  expect(html).toContain("Not Added");
});

test("uses distinct workbench surface structure for table and activity rail", () => {
  // existing selection/handoff tests remain
});
```

Keep existing no-CLI-token guards.

- [ ] **Step 2: Restyle WorkbenchPanel + CSS**

Implementation guidance:

- Wrap toolbar in classes shared with other metal toolbars where possible (`observability-toolbar metal-toolbar` or workbench-specific equivalents that copy their spacing/height).
- Prefer existing CSS variables: `--ink`, `--mute`, `--line`, `--blue`, `--surface`, control heights from `design.md`.
- Table headers: uppercase/mute mono labels consistent with Logbook (Logbook uses mixed patterns—match Logbook table header treatment, not Now cards).
- Selected row: existing blue soft highlight is fine; ensure hover parity.
- Activity rail cards: reuse surface border/radius tokens (`--radius` / `rounded.card` values already in CSS vars).

Avoid adding new design tokens unless necessary.

- [ ] **Step 3: Run UI tests**

```bash
npm test -- --run src/ui/workbench src/ui/__tests__/navigation.test.tsx
npm run check:surface-contract
npm run verify:no-citations
```

Expected: PASS.

- [ ] **Step 4: In-app Browser visual pass**

At `http://127.0.0.1:5173/`:

- Workbench at desktop, tablet, narrow widths
- Compare chrome to Logbook and Sources
- Confirm icon change from Task 3
- Confirm empty publish-path looks intentional
- Confirm no CLI tokens / hero teaching blocks

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(ui): align Workbench chrome with Logbook/Sources ops surfaces

Dense table + activity rail, metal toolbar language, intentional empty state,
no instructional hero copy.
EOF
)"
```

---

## Task 5: Repair Residual Live Projection Test Failures

**Files:**
- Investigate: `src/core/__tests__/fixtureReplay.test.ts`
- Possibly: `src/core/__tests__/liveRuntimeStates.test.ts`, `src/core/__tests__/reviewDispositions.test.ts` (or current names from last evidence)
- Possibly: `src/core/replay.ts` only if a real regression exists (do not casually change product behavior to silence tests)

### Known failure

```text
fixtureReplay.test.ts: expected 0 to be greater than or equal to 3 for board.summary.active
```

Handoff notes this pre-existed the last-activity label fix, but it still blocks clean closeout.

- [ ] **Step 1: Reproduce with full stack trace and board dump**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
npm test -- --run src/core/__tests__/fixtureReplay.test.ts
```

Temporarily log (in test only while debugging):

```ts
console.log(board.summary, board.cards.map((c) => ({
  id: c.sessionId,
  state: c.stateLabel,
  runtimeState: c.runtimeState,
  displayState: c.displayState,
  lastActivityLabel: c.lastActivityLabel
})));
```

- [ ] **Step 2: Classify root cause**

Use systematic debugging:

1. Did active-count semantics change (running/idle/attention)?
2. Did fixture timestamps become “stale” relative to projection `now`?
3. Did last-activity/`now` changes in `replay.ts` alter lifecycle classification?
4. Is the test obsolete relative to intentional product behavior?

- [ ] **Step 3: Fix the right layer**

- If product regression: fix `replay.ts` / state classification with a regression test.
- If fixture stale: update fixture timestamps or pass explicit `now` into `projectFixture`.
- If assertion obsolete: update assertion to the new intentional summary semantics and document why in the test name/comment.

Do **not** weaken assertions just to go green.

- [ ] **Step 4: Run broader projection suite**

```bash
npm test -- --run src/core/__tests__/fixtureReplay.test.ts src/core/__tests__/projection.test.ts src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/filterBoard.test.ts
# plus any still-failing liveRuntimeStates / reviewDispositions files discovered
```

Expected: previously failing files green, or remaining failures listed explicitly.

- [ ] **Step 5: Commit**

```bash
git commit -m "test: repair fixture replay active-count expectations after live-state semantics"
```

---

## Task 6: Minimal Agent-Facing Doc Course-Correction (Not A Docs Project)

**Files:**
- Modify: `openwiki/quickstart.md`
- Optional light touch: `openwiki/architecture.md`, `AGENTS.md` product hierarchy only
- Do **not** rewrite `prd.md` or historical plans unless a sentence actively misleads agents into wrong ownership

### Required message

Product hierarchy agents should internalize:

1. canonical session database
2. Workbench (raw → publish pipeline)
3. Logbook (published/searchable only)
4. read-only MCP
5. live Now (shallow)
6. Sources (capture + source-scoped transcript permissions)

- [ ] **Step 1: Update OpenWiki quickstart hierarchy and domain links**

Replace the old five-item list with the hierarchy above. Add one sentence:

- Workbench owns transcript import/cleanup/enrichment/publication.
- Logbook is published-only.
- Sources is not the per-session import workflow.

Add a “Where to go next” bullet for Workbench code:

- UI: `src/ui/workbench/`
- Controller: `src/app/workbench/`
- Pipeline/CLI: `src/workbench/`, `src/cli/`, daemon workbench repos

- [ ] **Step 2: Patch AGENTS.md product hierarchy only if it still omits Workbench**

Keep it short. Do not expand into a second design doc.

- [ ] **Step 3: Grep OpenWiki for actively wrong ownership**

```bash
rg -n "bulk enrich|transcript import|Logbook.*enrich|Sources.*import workflow|Codex-only|Codex Live Connector" openwiki AGENTS.md
```

Fix only misleading lines.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: point OpenWiki/AGENTS at Workbench-stage product hierarchy"
```

---

## Task 7: Verification And Closeout

**Do not claim done without evidence.**

- [ ] **Step 1: Focused verification**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
npm run typecheck
npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
npm test -- --run \
  src/core/__tests__/liveIdentity.test.ts \
  src/core/__tests__/fixtureReplay.test.ts \
  src/core/__tests__/projection.test.ts \
  src/adapters \
  src/daemon/__tests__/liveConnectorSettings.test.ts \
  src/daemon/__tests__/liveStateApi.test.ts \
  src/ui/workbench \
  src/ui/__tests__/observabilitySidebar.test.tsx \
  src/ui/__tests__/liveBoard.test.tsx \
  src/ui/__tests__/navigation.test.tsx
```

- [ ] **Step 2: Broader test run; list remaining failures explicitly**

```bash
npm test -- --run
```

Record any remaining failures with file names and whether they are pre-existing vs introduced.

- [ ] **Step 3: Runtime / UI smoke (no Workbench pipeline dogfood)**

With Electron Dev running:

1. Now shows multi-runtime cards; this Grok session (or a fresh Grok activity) labels **Grok Build**.
2. Workbench looks consistent with Logbook/Sources; distinct icon; intentional empty state.
3. Sources/Settings still show full live connector set including Codex.
4. No `No live Codex sessions yet` product framing.
5. Ports: daemon `17373`, UI `5173`, worktree-backed processes.

- [ ] **Step 4: Evidence note**

Append a short section to `docs/acceptance/workbench-v1-evidence.md` **or** write a tiny `docs/acceptance/2026-07-08-ui-harness-touchups.md` with:

- commands run
- pass/fail
- browser observations
- remaining failures

- [ ] **Step 5: Hand back to Tyler for collaborative micro-tweaks**

Stop for visual pairing. Do not start random extra polish beyond this plan unless Tyler asks.

---

## Suggested Implementation Order

1. Task 1 — runtime attribution (user-visible correctness, highest trust)
2. Task 2 — harness catalog alignment
3. Task 3 — Workbench icon (quick win)
4. Task 4 — Workbench visual alignment
5. Task 5 — projection test repair
6. Task 6 — minimal agent doc course-correction
7. Task 7 — verification/closeout

Tasks 3 and 5 can parallelize after Task 1 if needed. Task 4 depends on Task 3 only weakly (icon is independent) but should land before final visual sign-off.

---

## Risk Notes

- **Dirty worktree:** only touch files needed for these tasks; do not “clean up” unrelated Workbench V1 diffs.
- **Hook reinstall:** changing install command shape may require reinstalling live connectors for `MASTHEAD_RUNTIME` pins to land on disk. Plan for Settings reinstall or `hooks install` path during verification.
- **Historical dual sessions:** fixing forward attribution may leave one ghost Claude card until retention/cleanup; decide explicitly in Task 1 whether a tiny projection preference is worth it.
- **defaultLiveRuntime = claude_code:** after Task 1, re-evaluate whether default should be removed/replaced with “required explicit runtime” for `/ingest` without query param. Prefer explicit runtime required for new accepts if tests allow—do not silently keep inventing Claude Code identity.
- **Empty Workbench queue:** visual empty state only; no pipeline dogfood in this plan.

---

## Self-Review Against User Intent

| Ask | Task |
|---|---|
| Work in f503 worktree | Header + all commands |
| Plan first, don’t implement yet | This document only |
| Don’t dogfood Workbench pipeline | Out of scope + Task 4 empty-state only |
| Workbench looks bad / unintuitive | Task 4 |
| Distinct Workbench icon | Task 3 |
| Align harnesses / kill Codex-only framing | Task 2 |
| Grok shows as Claude Code; check other harnesses | Task 1 |
| Docs not a big project, but don’t mislead agents; OpenWiki maybe | Task 6 |
| Projection/test debt | Task 5 |
| Then collaborate on small tweaks | Task 7 handback |

No placeholder steps remain for the above scope.
