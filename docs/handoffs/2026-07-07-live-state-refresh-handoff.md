# Masthead Live-State Refresh Handoff

Date: 2026-07-07

## Evidence Boundary

This handoff was reconstructed from the current Masthead repository state, Git history, accessible Codex thread summaries, OpenWiki, and local docs. GBrain searches for this Masthead plan/thread context returned no pages, and the broken Codex thread ID `019f3bb8-c11e-7f52-865d-3026762db4c5` was not visible in the local Codex thread index.

Assumption: the "original implementation plan" is the July 7 Board refresh/liveness/blocked-semantics plan. That plan was introduced with the implementation commit, so this document treats the confirmed change boundary as:

- Baseline before the plan implementation: `a7e6671` / `fix: repair live harness board projection` / 2026-07-07 01:37 MDT.
- Implementation commit: `b47e8dc` / `Refine Masthead UI and session views` / 2026-07-07 15:31 MDT.
- Merge commit: `c16ea0c` / `Merge implement-live-state-refresh` / 2026-07-07 15:32 MDT.
- Follow-up commit: `5830ac3` / `test: keep live state api fixtures fresh` / 2026-07-07 15:34 MDT.

If the intended baseline was the earlier July 5 live multi-harness connector plan, the broader range is much larger and includes release, adapter, source, UI, notification, and enrichment work. Use this document as the high-confidence handoff for the July 7 live-state refresh delta.

## Product Context

Masthead is a local-first, harness-neutral session data layer and session manager. The correct product hierarchy remains canonical session database first, then Logbook/search, read-only MCP access, live Now/Board view, and source/import administration. The Board is a live projection over collected session data; it is not the product's primary identity and should not be planned as a monitoring-only console.

## Original Plan Goal

The July 7 plan aimed to make the Board refresh interval enforce live freshness and to narrow live `Blocked` semantics. The intended contract was:

- `Active` requires fresh proof: either a fresh `working` state report or a recent work-implying event inside the refresh grace window.
- `Blocked` means only a current permission/approval stop.
- User questions, generic waiting-for-user statuses, `needs_input`, and bypass/full-access permission modes must not create live Board blockers.
- Stale event-derived activity and stale unresolved approval blockers must expire.
- UI components should trust projection state rather than independently inferring blocked/waiting status from labels.

## Confirmed Changes Made

### Central Live Permission Policy

New policy helpers now centralize live permission semantics. Search anchors: `livePermission.ts`, `approvalEventRequiresPermission`, `liveStateImpliedByEvent`, `eventIsWorkingProof`.

Implemented behavior:

- Ordinary `approval.requested` events imply live `blocked`.
- Bypass/full-access/off/disabled permission modes do not imply blockers.
- `user.question` does not imply live `blocked` or `working`.
- `approval.resolved`, `user.response`, `turn.started`, and `command.started` imply `working`.
- `turn.completed`, `session.closed`, and `session.completed` imply `idle`.

### Explicit Live-State Model

The implementation added a normalized live-state report model. Search anchors: `LiveStateReport`, `normalizeLiveStateReport`, `reportIsFresh`, `liveStateKey`.

Implemented behavior:

- Semantic states: `working`, `blocked`, `idle`, `unknown`.
- Display states: `working`, `blocked`, `done`, `idle`, `unknown`.
- Authorities: `hook`, `plugin`, `tailer`, `process`, `inferred`.
- Default TTLs: working 30 seconds, blocked 10 minutes, idle 24 hours, unknown 60 seconds.
- State aliases normalize `running`/`active` to `working`, approval-only blocking aliases to `blocked`, and `waiting`/`done`/`completed` to `idle`.
- User-input aliases were removed from live blocked normalization.
- Report IDs are stable hashes over key fields, state, observation time, sequence, source event, and payload.

### Live-State Persistence And API

The daemon now stores current runtime-state reports beside canonical event history. Search anchors: `live_state_reports`, `liveStateRepository`, `POST /live/state`, `GET /live/state`.

Implemented behavior:

- New SQLite table `live_state_reports` with indexes by runtime/source session, canonical session, and source/runtime time.
- `POST /live/state` accepts trusted local state reports and returns `accepted`, `ignored_stale`, `ignored_expired`, `disabled`, or `malformed`.
- `GET /live/state` returns latest reports, with optional filters for runtime, source session ID, canonical session ID, and fresh-only mode.
- Stale reports are ignored by sequence or older observation time. Expired reports are ignored on write.
- Global kill switch: `MASTHEAD_LIVE_CAPTURE=0`.
- Per-runtime kill switch: `MASTHEAD_LIVE_CAPTURE_<RUNTIME>=0`.
- Hook ingestion opportunistically derives and persists live-state reports, but hook event capture fails open if live-state persistence fails.

### Projection State Selection

Board projection now overlays fresh live-state evidence onto canonical session replay. Search anchors: `selectEffectiveLiveState`, `eventWorkingGraceMsForRefresh`, `approvalBlockerTtlMsForRefresh`, `runtimeState`, `displayState`, `stateAuthority`.

Implemented behavior:

- Fresh blocked live-state reports win first.
- Fresh unresolved approval blockers can hold a card in live blocked state.
- Fresh working/idle/unknown live-state reports override older event inference.
- Fresh work-implying events can keep a card active inside the refresh grace window.
- Stale work-implying events demote to idle/stalled instead of remaining active.
- Running sessions without fresh live proof demote to idle.
- `turn.completed` can display as idle/done rather than session closure.
- With the default 10 second Board refresh, event-derived Active expires after about 20 seconds. Approval blocker TTL is 12x refresh interval, clamped between 60 seconds and 10 minutes.

### Approval Blocker Derivation

The implementation added explicit live blocker derivation. Search anchors: `deriveLiveBlockers`, `LiveBlockerKind`.

Implemented behavior:

- Only approval blockers are opened.
- `user.question` does not open a live blocker.
- Bypass approvals do not open live blockers.
- Approval blockers resolve on matching `approval.resolved`, matching `command.started`, non-waiting `turn.completed`, or `session.closed`.
- Unresolved blockers expire by age when the projection supplies a maximum age.

### Board Card And UI Semantics

Board card fields and labels now align around the projection's effective state. Search anchors: `isBlockedSessionCard`, `statusTokenLabel`, `sessionStatePillLabel`, `SessionCard`.

Implemented behavior:

- Cards can carry `runtimeState`, `displayState`, `stateAuthority`, `stateObservedAt`, `stateMessage`, and `stateStale`.
- Card state pill labels collapse to `Active`, `Idle`, or `Blocked`.
- The previous waiting-specific UI path was removed from the card status label path.
- Blocked card styling now depends on projection-visible blocked fields rather than generic waiting labels.

### Connectors, Hook Helper, Smoke, And Doctor

Generated live connectors and local diagnostics now understand the paired event/state-report model. Search anchors: `masthead-hook.js`, `runtimeProfiles`, `liveConnectorSettings`, `smoke:live`, `doctor`.

Implemented behavior:

- Live connectors post two signal types when available: canonical events to `/ingest` and current runtime state to `/live/state`.
- Generated connector state machines were updated so user questions and `needs_input` do not become live blocked reports.
- Connector tests validate both ingest and live-state paths.
- Smoke checks post synthetic events and live-state reports for the focused runtime set and verify Board overlays.
- Doctor reports live-state endpoint health, capture kill-switch state, connector install status, and recent state-report metadata.

### Live Explain And Headline Facts

The daemon exposes more diagnostics for why a card has its current state. Search anchors: `GET /sessions/:sessionId/live-explain`, `buildLiveHeadlineFacts`.

Implemented behavior:

- `live-explain` reports the selected authority, latest state report, latest event fallback, unresolved blockers, fallback reason, and staleness.
- Live headline facts now include bounded recent transcript messages, recent events, latest live state, blockers, changed file basenames, latest command, and a fingerprint. This gives headline refreshes a compact freshness input.

### Documentation Updates

Updated docs describe the new live-state API and Board overlay behavior. Search anchors: docs titled `Board`, `Live Connectors`, and `Daemon API Reference`.

Important doc points now present:

- Board is a live projection over continuously collected session data.
- `/live/state` is documented as a local write endpoint.
- `/sessions/:sessionId/live-explain` is documented as a diagnostic endpoint.
- Live connectors are documented as posting both `/ingest` events and `/live/state` reports.

## Follow-Up Commit

`5830ac3` changed the live-state API tests to generate fresh timestamps dynamically. This avoids fixture reports expiring as wall-clock time advances and keeps tests from failing because static July 2026 timestamps become stale.

## Test Coverage Added Or Updated

The implementation added or updated tests around:

- Central permission policy.
- Live-state normalization, TTLs, and freshness.
- Approval blocker derivation and expiration.
- Effective live-state selection.
- Projection overlays and lane placement.
- Live-state repository write/read/staleness behavior.
- Live-state HTTP API behavior.
- Hook-derived live-state reports.
- Generated connector live-state behavior.
- Board card state labels and blocked/active/idle visual classes.
- Notification behavior for blocked/session-ended cases.

Focused search anchors for test review:

- `livePermission.test`
- `liveState.test`
- `liveBlockers.test`
- `liveProjectionState.test`
- `liveStateRepository.test`
- `liveStateApi.test`
- `liveHookAdapter.test`
- `liveConnectorSettings.test`
- `observabilitySessionCard.test`
- `liveSessionEndedNotifications.test`

## Known Issues And Risks To Review In The Next Plan

1. The broken Codex thread itself could not be read. Treat this handoff as evidence-backed reconstruction from Git, docs, and tests, not a transcript-derived account.

2. The `Board` reference doc currently says unresolved approval/question blockers can hold a card in needs-action. The implementation is approval-only, and tests explicitly say user questions are not live blockers. The doc should be corrected unless product intent changed.

3. `live-explain` appears to derive blockers without passing the projection's approval-blocker TTL or refresh-derived grace window. That may let the diagnostic endpoint report stale unresolved blockers differently from `/projection`. The next plan should verify and align `live-explain` with projection semantics.

4. Historical ended cards can still be treated as blocked by helper logic when `outcomeLabel` or `endReason` is blocked. That may be intentional for historical outcome display, but it should be reviewed against the strict statement that live `Blocked` means only a current permission stop.

5. Projection fetches only fresh live-state reports, so stale report metadata may not reach card fields during normal projection. If the UI should explicitly show `stateStale` for expired reports, the data fetch/selector contract needs review.

6. Generated connector state machines are covered by tests, but the next agent should run a real local preview and focused live smoke before treating the behavior as release-ready.

7. Local Git still records many prunable Codex worktrees whose directories no longer exist. That matches the broken-session symptom and can confuse thread handoffs. Do not build new plans around stale worktree paths.

## Suggested Verification For The Next Agent

Before changing code, re-run focused proof on the current checkout:

```text
npm test -- --run livePermission liveState liveBlockers liveProjectionState liveStateApi liveHookAdapter liveConnectorSettings observabilitySessionCard liveSessionEndedNotifications
npm run typecheck
npm run smoke:live
npm run doctor:json
```

If doing UI acceptance, launch with Masthead's harness-neutral dev entrypoint and inspect the rendered Board, not only process state:

```text
npm run dev
```

Expected manual cases:

- Fresh `working` report renders Active.
- Expired working proof renders Idle.
- Fresh approval request renders Blocked.
- Resolved approval stops rendering Blocked.
- User question does not render live Blocked.
- Bypass/full-access approval does not render live Blocked.
- `live-explain` matches the card state from `/projection`.

## Ready-To-Paste Prompt For ChatGPT

I want to discuss and possibly create a new implementation plan for Masthead's Board live-state refresh semantics after a partially completed implementation.

Context:

- Masthead is a local-first, harness-neutral session data layer and session manager. Treat canonical session storage, Logbook/search, and read-only MCP access as core product identity; the Board/Now surface is a live projection over collected data, not a standalone monitoring console.
- A July 7 implementation plan tried to make Board refresh enforce live freshness and make live `Blocked` mean only a current permission/approval stop.
- Confirmed Git evidence: baseline `a7e6671`, implementation `b47e8dc`, merge `c16ea0c`, follow-up `5830ac3`.
- The broken Codex source thread is inaccessible, so use this handoff as reconstruction from Git/docs/tests, not as a complete transcript.

What has already changed:

- Central permission policy was added with anchors `approvalEventRequiresPermission`, `liveStateImpliedByEvent`, and `eventIsWorkingProof`.
- Live-state reports were added with semantic states `working`, `blocked`, `idle`, `unknown`; authorities `hook`, `plugin`, `tailer`, `process`, `inferred`; TTLs for working/blocked/idle/unknown; and stable report IDs.
- Daemon storage and endpoints now exist for `/live/state`, backed by a `live_state_reports` table and repository. The API supports stale/expired/disabled/malformed outcomes and kill switches `MASTHEAD_LIVE_CAPTURE` plus per-runtime variants.
- Hook ingestion opportunistically derives live-state reports from runtime events.
- Board projection now uses fresh live-state reports, unresolved approval blockers, and refresh-derived event grace windows to choose effective card state.
- Cards can expose `runtimeState`, `displayState`, `stateAuthority`, `stateObservedAt`, `stateMessage`, and `stateStale`.
- Approval blockers are now approval-only; user questions and bypass approvals should not live-block the Board.
- Generated live connectors and smoke/doctor flows were updated to validate both `/ingest` and `/live/state`.
- `live-explain` and live headline facts were added or expanded.
- Tests were added/updated around permission policy, live-state normalization, blockers, projection state selection, repository/API behavior, hook-derived reports, generated connectors, Board cards, and notifications.

Known concerns to review:

- The Board reference doc says unresolved approval/question blockers can hold a card in needs-action, but code/tests are approval-only. Decide whether to fix docs or code.
- `live-explain` may derive blockers without the same blocker TTL or refresh grace window as `/projection`, so diagnostics may disagree with cards.
- Historical ended cards may still look blocked through outcome/end-reason helper logic. Decide whether that is acceptable historical state or violates the live `Blocked` contract.
- Projection currently asks for fresh live-state reports only, so expired state report details may not surface as `stateStale`.
- Real local smoke and rendered UI acceptance should still be run before treating this as done.

Before doing implementation:

- Find the Masthead repo from the current workspace.
- Read local agent/repo instructions, OpenWiki quickstart, product requirements, and the master design source.
- Inspect the actual current code, docs, tests, and Git history. Do not rely only on this handoff.
- Decide whether the July 7 implementation is good, stale, incomplete, over-scoped, or should be simplified.
- Call out contradictions between docs, tests, and code before proposing changes.

Task:

- Produce a new implementation plan that audits and completes the live-state refresh/blocked-semantics work.
- Keep scope narrow: do not redesign Board layout, lanes, filters, navigation, or Masthead's product identity.
- Prioritize semantic correctness, observable proof, and focused cleanup over broad refactors.
- Include tests before code changes wherever a behavior is currently ambiguous or broken.

Validation:

- Include focused unit/API tests for any changed semantics.
- Include `npm run typecheck`.
- Include live smoke or doctor checks if connector or daemon behavior changes.
- Include rendered Board acceptance at relevant viewport widths if UI behavior changes.
- Include specific manual cases for Active, Idle, Blocked, user questions, bypass approvals, resolved approvals, stale working proof, and `live-explain` parity.

Output:

- Start with review findings and recommendation.
- Then give the proposed implementation plan with steps and verification for each step.
- Do not push, merge, close issues, label, or post public comments unless explicitly asked.
