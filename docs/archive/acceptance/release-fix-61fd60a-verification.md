# Feature verification — release fix `61fd60a` plus post-audit repair

Per-feature checks for the release-fix batch and the 2026-07-06 repair pass. Current evidence includes full `npm run verify` and Electron smoke.

## Contamination notice

During an earlier verification attempt, **`POST /settings/llm-provider`** was issued against the **shared** dev daemon at `http://127.0.0.1:17373` (intended toggle flip + restore). That used **real write endpoints** on the `masthead-dev` SQLite store—not an isolated temp DB. **Do not treat subsequent live reads as a clean baseline.**

**Latest read-only `GET /settings` on shared `17373` (re-check when editing this doc):** `remoteEnrichmentEnabled: false`, `activeProvider: openai`. Earlier transcript reads differed (writes during flip/restore); treat any single snapshot as **point-in-time**, not proof the store was never left in another state.

All **authoritative** toggle/save behavior should be taken from **`src/daemon/__tests__/settingsApi.test.ts`** (ephemeral in-process daemon). Further write-path checks must use **`smoke:*` temp dirs**, vitest fixtures, or a dedicated `MASTHEAD_DATA_DIR`—not the running Electron/`masthead-dev` connector without explicit user approval.

**Live probes on `17373` (not verification evidence):** `POST /settings/llm-provider` (toggle experiment); `POST /enrichment/rebuild` with `scope: "sessionIds"` and invalid ids on shared store. Use temp-data harness only for future write-path E2E.

## 1. Settings — remote toggle vs provider save (P0 / issue 3)

| Layer | Result | Evidence |
|--------|--------|----------|
| Daemon API | **Pass** | `settingsApi.test.ts`: partial POST with `remoteEnrichmentEnabled: false` keeps provider configured; toggle off without re-entering key |
| UI unit | **Pass** | `operationsPanel.test.tsx`: remote flip sends `POST` with `remoteEnrichmentEnabled`; `SettingsSurface.test.tsx`: motion toggle via `aria-label` |
| Browser (read-only) | **Pass** | Settings surface shows “Remote enrichment” section and “Session ended notifications” |
| Live save timing &lt;5s | **Not tested** | Plan P0 item |
| Dossier open on Electron Dev | **Not tested** | Plan P0 item |

---

## 2. Now — headline source cue (issue 2)

| Layer | Result | Evidence |
|--------|--------|----------|
| Unit / render | **Pass** | `observabilitySessionCard.test.tsx` + `SessionCard` `HeadlineSourceBadge` |
| Browser | **Pass** | At least one `.headline-source` on Board with live projection |
| Thread A vs B | **Pass (code)** | Badge uses headline source/status, not `remoteEnrichmentEnabled` |

---

## 3. Sources — import progress (issue 4)

| Layer | Result | Evidence |
|--------|--------|----------|
| Unit | **Pass** | `ImportProgressPanel.test.tsx`: progress bar %, `is-stale`, stalled copy |
| Shared helper | **Pass** | `deriveImportVisibilityState` in `sourceImport.ts` |
| Import pipeline | **Pass** | `npm run smoke:import` (isolated temp DB) |
| **E2E UI during running import** | **Not verified** | `smoke:import` does not assert progress bar movement or stale styling in rendered Sources |

---

## 4. Sources — harness detail modal (issue 5)

| Layer | Result | Evidence |
|--------|--------|----------|
| Unit | **Pass** | `AdapterRow.test.tsx`: modal with hook settings + “Test live connectors” |
| Browser | **Partial** | Sources loads; adapter modal / hook test button not clicked in this pass |

---

## 5. Logbook — bulk enrich (issue 6)

| Layer | Result | Evidence |
|--------|--------|----------|
| Controller | **Pass (code)** | `useLogbookController`: `selectedSessionIds`, `bulkEnrichSelected` → `rebuildEnrichments({ scope: "sessionIds", ... })` |
| Table UI | **Pass** | `LogbookTable` / row tests; browser: row checkboxes present |
| Bulk toolbar UI | **Pass (unit)** | `LogbookToolbar.test.tsx`: `bulkSelectionCount={1}` → `1 selected`, `Enrich selected`, `.logbook-bulk-actions`. **Browser E2E** still not confirmed |
| API `sessionIds` on `/enrichment/rebuild` | **Pass (isolated daemon)** | `server.test.ts`: temp DB, `scope: "sessionIds"`, `sessionIds: ["session:rebuild","missing"]` → `requested: 1`, dry-run, no row writes. **Not** logbook column refresh E2E |
| **E2E enrich → column refresh** | **Not verified** | No non–dry-run rebuild + logbook refresh in this pass |
| Large-run warning (&gt;50) | **Not verified** | Not implemented or not exercised in tests |

---

## 6. Session transition notifications (issue 1)

| Layer | Result | Evidence |
|--------|--------|----------|
| Transition logic | **Pass** | `liveSessionEndedNotifications.test.ts` plus `sessionTransitionNotificationsApp.test.tsx`: first projection is a baseline; running→idle notifies once; disabled preference suppresses notify |
| IPC allowlist / preload | **Pass** | `ipcSecurity.test.ts`, `desktopBridge.test.ts`, and `smoke:electron`: typed notification bridge is exposed and raw IPC is not exposed |
| Main-process notification helper | **Pass** | `notifications.test.ts`: supported notification constructs/shows; unsupported environments skip; invalid transition rejected |
| Electron smoke | **Pass** | `npm run smoke:electron` passed on 2026-07-06 |
| Native OS delivery | **Manual not observed** | Automated checks cover the Electron path; no manual desktop toast was observed in this pass |
---

## Automated batch (2026-07-06)

- `npm run verify`: pass; 220 test files, 1195 tests, build, endpoint matrix, and live/compatibility/import/MCP smokes.
- `npm run smoke:electron`: pass; Electron 42.5.0, preload bridge, typed notification bridge, custom chrome, renderer privilege checks, and hover latency.
- Focused checks run during repair: `sourcesPanel.test.tsx`, `worktreeConnector.test.ts`, `check:endpoint-matrix`, and `smoke:compatibility`.

---

## Summary

| Feature | Code + unit/smoke | Browser read-only | True E2E |
|---------|-------------------|-------------------|----------|
| Settings toggle/save | Yes | Partial (copy only) | Automated save-path tests; no manual latency/dossier pass |
| Headline cue | Yes | Yes | Yes (cue visible live) |
| Import progress UI | Yes | Partial (section only) | Automated import smoke; no manual live-job bar observation |
| Adapter modal | Yes | Partial | No manual hook test click |
| Logbook bulk | Yes | Partial (checkboxes only) | Automated scoped rebuild; no manual enrich→refresh pass |
| Notifications | Yes | Yes (preference and Electron bridge) | Automated transition + Electron smoke; native toast not manually observed |

Verdict: the previous failing release ladder is repaired. The remaining gaps are manual product-signoff items, not automated release-ladder failures. Use isolated temp data / `dev:electron` for future write or notification checks—not the shared `masthead-dev` daemon without disclosure.