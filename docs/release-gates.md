# Masthead Release Gates

This document tracks the current implementation against the PRD MVP Definition of Done and product invariants. It is the release closeout guide for the local-first, harness-neutral session data layer.

## Launch Closeout Flow

Run these from the Masthead checkout being released:

```bash
npm run check:product-contract
npm run verify:no-citations
npm run doctor
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml
npm run dogfood:fixture
npm run dogfood:live
```

Before claiming a release candidate is healthy, verify the rendered app or `doctor` output against the same daemon database identity that the UI and MCP launch config use. A compatible `/health` response is the compatibility oracle: it must identify Masthead, the daemon API version, runtime mode, data directory, database path, database ID, migration state, capabilities, and read/write state.

Release docs must preserve these launch boundaries:

- Codex is the first supported adapter.
- The core session graph remains adapter-neutral.
- MCP is read-only for launch.
- Local SQLite is canonical for Masthead-owned product data.
- Remote enrichment is optional, scoped, redacted, previewable, and auditable.
- Live Now is a view over collected session data, not the product category.

## CI And Security Gates

`.github/workflows/ci.yml` is the required fast verification workflow. It runs `npm ci`, `npm run verify`, installs the Linux Tauri dependencies, and runs `cargo test --manifest-path src-tauri/Cargo.toml` on Node 24.15.0.

`.github/workflows/security.yml` runs CodeQL for the TypeScript/JavaScript surface and dependency review on pull requests. `.github/dependabot.yml` keeps npm and GitHub Actions dependencies visible through weekly update PRs.

`.github/workflows/release-smoke.yml` is a manual or tag-triggered release-candidate check. It repeats the full verification path and adds `npm run dogfood:fixture`. Real `npm run dogfood:live` remains a human acceptance step because it depends on local Codex data.

The current workflow policy uses official GitHub action version tags such as `actions/checkout@v4`, `actions/setup-node@v4`, and `github/codeql-action/*@v4`. A future hardening pass may pin third-party actions to full commit SHAs; do not mix tag and SHA pinning silently in one PR.

## Current Status

The current build is a Codex-first vertical slice with:

- React session-control UI with a left session rail, wide natural-language operations scan, right-side technical inspector, lifecycle session lanes, a calm operations brief above counters, copy-first compact session cards, live connection strip, filtered attention queue, search/filtering, operations panels, restrained motion, and responsive desktop/mobile layout.
- Adapter-neutral TypeScript core for normalized events, session derivation, attention rules, deterministic stale-verification/high-risk/shared-resource risk signals, conflict detection, history, evidence packets, privacy redaction, latest-feedback snapshots, LLM attention validation, sanitized plain-language copy generation, replay projection, and live projection envelopes.
- Sanitized fixture replay that shows three Codex sessions, one approval request, one failed command, one exact-file conflict, unrelated repo separation, degraded attribution, privacy suppression, ordered lifecycle lanes, and selected-session inspector evidence.
- Codex hook adapter, fail-open hook helper, loopback ingestion server, normalized `/projection` endpoint, event-triggered and periodic known-session Git snapshot refresh, hook onboarding docs, and a path-scoped `hooks.json` admin CLI with preview, install, strict verify, disable, uninstall, backup, atomic write, symlink refusal, and rollback behavior.
- Dogfood CLI gates covering fixture sessions, attention, failed-command evidence, exact-file conflict, unrelated repo safety, degraded attribution, privacy suppression, calm ops copy, feedback snapshot privacy, local retention controls, four lifecycle lanes, stale disposition freshness, idle-vs-ended separation, terminal outcome labels, evidence-backed LLM outcome candidates, modal evidence compactness, and attention latency metadata; `npm run doctor` checks live collector and hook readiness, while `npm run dogfood:live` remains the strict seeded live-conflict gate.
- Append-only TypeScript store, file-backed live ingestion persistence, local searchable history panel, history search/export/delete semantics, manual retention pruning, native Tauri SQLite commands for append/read/export/clear/prune, local review disposition persistence, startup disposition hydration, and UI wiring for local export/delete/retention/review actions.
- One-command live launcher that starts the local collector and Vite UI together, plus UI polling that defaults to live ingestion and shows an explicit disconnected state when the collector is unavailable. Fixture replay is an explicit demo mode.
- Thin Tauri desktop shell that compiles with native store commands registered.

Real local Codex dogfooding has now been run in this environment: the Masthead-managed hook was installed into the user-level Codex `hooks.json`, reviewed through Codex's official startup hook prompt, trusted, and used to observe three real concurrent `codex exec` sessions with live Git snapshots. The remaining command-failure limitation is upstream payload shape: real Codex `PostToolUse` hook payloads currently include tool metadata and output text but not shell exit status, so the live failed-command gate is proven with an explicit metadata event rather than inferred from a real failed shell hook.

## MVP Gates

| Gate | Status | Notes |
| --- | --- | --- |
| Runs locally without account, cloud database, required API key, or internet after installation | Partial | `npm run dev` starts the local collector and UI together; tests, explicit fixture replay, dogfood CLI, and Tauri shell work locally. No account/cloud/API key is required. Packaged installation is not implemented yet. |
| Installs, verifies, disables, and uninstalls Masthead-managed Codex hook through explicit admin flow | Implemented for current Codex install | Path-scoped admin CLI targets official Codex `hooks.json` matcher groups, rejects `config.toml`, previews without writing, creates missing files with `0600`, uses backups plus atomic writes, refuses symlinks, strictly verifies command/timeout, and supports disable/uninstall/rollback. User-level install and official Codex hook trust were dogfooded locally. |
| Discovers at least three simultaneous Codex sessions as live cards | Implemented for current Codex slice | Clean live verification observed three real `codex exec` sessions from `/home/tyler/Documents/Masthead` and projected them as live cards without fixture or dogfood data. |
| Cards show project, safe work area, lifecycle state, duration, last activity, unresolved attention | Implemented for replay/live events | Projection derives these fields, then renders plain-language copy and allowlisted work-area labels first while keeping branch/worktree, paths, evidence, and other technical state in details. Real hook sessions without explicit project/title now fall back to the working-directory basename and `Codex session` title instead of `Unknown project` / `Untitled session`. |
| First screen organizes sessions by lifecycle | Implemented for replay/live events | Ordered lanes are `Running`, `Idle`, `Needs action`, and `History`. Running and idle sessions stay in their lifecycle columns even when they have attention/conflict indicators; only ended sessions can enter `Needs action`. Live projections now include terminal sessions instead of hiding them from the board. |
| Session details open outside compact cards instead of expanding cards inline | Implemented for current UI | The primary desktop UI uses a persistent right-side inspector with plain-language session copy first, then lifecycle/outcome, worktree state, review history, attention/conflicts, evidence references, timeline, and safe actions. The modal wrapper remains for compatibility and keeps focus management tests covered. |
| Quiet sessions become idle without being treated as ended | Implemented for live/replay | Live projection passes the current generated time into lifecycle derivation so a quiet non-terminal session can age into `Idle`. Silence alone never creates an ended outcome. |
| Approval request or user question creates top-priority Needs attention item within about one second | Partial | Approval request is P0 in fixture and live synthetic hook projection. Dogfood verifies 40ms simulated receive latency. Real Codex hook latency is unverified. |
| Failed command visible with exit status, command category, timestamp, supporting event reference | Implemented for fixture and explicit live metadata | Browser verification showed `Exit 2 / test / 2026-06-23T02:05:00.000Z / event-auth-test-failed`. Fixture dogfood and live dogfood both pass the failed-command evidence gate. Real Codex `PostToolUse` payloads do not currently expose shell exit status, so Masthead does not infer failures from output text. |
| Three repeated equivalent failures create possible-loop/repeated-failure item without interrupting on transient failure | Implemented in core tests | Covered by attention/session reducer tests. |
| Completion without observed verification creates review-needed item | Implemented in core tests | Covered by attention/session reducer/outcome tests. |
| Same Git worktree family and same repo-relative path creates high-severity conflict | Implemented for replay/core/live collector | Exact file overlap is covered by conflict tests, fixture dogfood, and a black-box ingest server test that creates two live session snapshots from a temp Git repo and projects one high-severity conflict. |
| Unrelated repositories do not create a false hard conflict | Implemented for replay/core | Covered by conflict tests and dogfood. |
| Same-working-directory attribution is clearly labeled degraded unless direct evidence proves ownership | Implemented for replay/UI/live collector | Core conflict attribution, replay indicators, modal attribution note, UI tests, dogfood, browser verification, and live temp-repo conflict projection cover degraded attribution. |
| Raw prompts, full transcripts, full diffs, full command output, secret contents, screenshots, browser state, shell history, and local database contents are not captured by default | Implemented for current slice | Redaction, hook redaction, real `PostToolUse` output/patch suppression, real `Stop` last-assistant-message suppression, local redacted latest-feedback snapshots, evidence-packet omission, sanitized copy-input allowlists, fixture privacy suppression, and dogfood cover the default. Full settings UI remains future work. |
| Masthead-local retention controls expire only configured Masthead-local record classes | Implemented for current slice | Manual 30-day retention pruning is wired through the pure TypeScript policy engine, file-backed live collector store, browser fallback, Tauri SQLite command, and Operations UI confirmation flow. Pinned record IDs and unresolved attention are preserved, review dispositions are excluded from the default app-store prune, and all results report `touchedExternalState: false`. Codex sessions, Git state, source files, shell history, browser state, and external services are untouched. |
| Local history, unresolved alerts, and review dispositions survive restart | Implemented for current slice | File-backed live ingestion and native SQLite store persist records; restart persistence is black-box tested for live hook events and native `review_disposition` records. The UI hydrates stored review dispositions on startup, applies them to fixture/live projections, and exposes a local history panel with project, session, file/path, command/cmd, status, branch, alert, conflict, outcome, and disposition filters. |
| Review dispositions never hide newer session activity | Implemented for current slice | Session/card dispositions are freshness-checked against card activity and attention creation time. Stale dispositions remain visible only as modal review history; visible attention, summary counts, and lifecycle lanes are rebuilt after review actions. |
| Complete local data deletion removes Masthead-local history without touching Codex, Git, source files, or external services | Partial | Core/file store and native SQLite clear operations return `touchedExternalState: false`. UI export/delete controls now call native commands with two-step delete confirmation, reject any native clear result that claims external mutation, and clear hydrated review dispositions from the board. |
| Fixture replay and dogfood tests cover MVP scenarios without private credentials | Implemented for current slice | Fixture/dogfood cover the core supervision loop without private credentials. Live dogfood now covers real Codex hook trust, three real sessions, live Git snapshots, exact-file conflict, degraded attribution, and explicit failed-command metadata. |

## Product Invariants

| Invariant | Status | Notes |
| --- | --- | --- |
| Evidence before claims | Maintained for current slice | Attention, conflict, outcome, replay, LLM validation, history, and UI views carry evidence references. |
| Local by default | Maintained for current slice | The app runs from local fixture/core/native code and a loopback collector without accounts or cloud storage. Remote LLM is off by default. |
| Observe before control | Maintained | Safe actions exclude approval, shell execution, Git mutation, browser control, agent steering, and external-state mutation. Hook config changes are isolated to explicit admin flows. |
| Adapter-neutral core | Maintained | Core contracts use normalized sessions/events/attention/conflicts rather than Codex-specific UI models. Future adapters are intentionally deferred until the Codex vertical proof is real. |
| Uncertainty is visible | Maintained for replay | Degraded session/conflict attribution is explicit in cards, expanded details, tests, dogfood, and browser verification. |
| Quiet when healthy | Partial | Current UI prioritizes attention/conflict/failure states and uses restrained styling. Longer-running daily dogfood is still needed to tune noise. |

## Implemented Artifacts

- JSON schemas live under `schemas/`.
- Store facade and file-backed persistence live in `src/core/store.ts`.
- Native store frontend wrapper lives in `src/app/nativeStoreClient.ts`.
- Native SQLite store and Tauri commands live in `src-tauri/src/native_store.rs`.
- Local retention policy helpers live in `src/core/retention.ts`.
- Codex adapter, ingestion state, live projection envelope helper, and Git observer live in `src/core/codexAdapter.ts`, `src/core/ingestion.ts`, `src/core/liveProjection.ts`, and `src/core/gitObserver.ts`.
- Fail-open hook helper, ingestion server, live app launcher, doctor CLI, hook admin CLI, demo script, fixture dogfood CLI, and live dogfood CLI live under `scripts/`.
- Hook config admin transforms live in `src/core/hookAdmin.ts`.
- Hook onboarding docs live in `docs/hook-onboarding.md`.
- Pure Git observer parsing lives in `src/core/gitObserver.ts`.
- Evidence-packet and remote LLM preview gating live in `src/core/evidencePacket.ts`.
- History search/export/delete semantics live in `src/core/history.ts`.
- Review disposition creation and projection overlay semantics live in `src/core/reviewDispositions.ts`.
- Deterministic risk classification for high-risk paths and shared local resources lives in `src/core/risk.ts`.
- LLM attention evidence validation lives in `src/core/llmAttention.ts`.
- Deterministic and optional OpenAI-backed session copy lives in `src/core/sessionCopy.ts` and `src/core/openaiSessionCopy.ts`.
- React Live Board UI, live projection client, and local export/delete/review action wiring live under `src/app/`, `src/ui/`, and `src/styles/`.
- Sanitized replay fixture lives in `fixtures/v0/replay-three-sessions-board.json`.
- Native shell sources and icon live under `src-tauri/`.

## Current Verification

- `npm test -- --run`: 36 files and 214 tests passing when loopback tests are allowed to bind `127.0.0.1`.
- `npm run typecheck`: passing.
- `npm run dogfood` / `npm run dogfood:fixture`: passing with 3 sessions, 4 attention items, 1 failed-command evidence item, 1 exact-file conflict, 0 unrelated repo hard conflicts, degraded attribution, privacy suppression, calm ops copy, feedback snapshot privacy with a positive bounded feedback sample, retention controls, four lifecycle lanes, stale disposition freshness, idle-not-ended behavior, terminal outcome labels, evidence-backed LLM outcome validation, modal evidence compactness, and 40ms simulated attention latency.
- `npm run build`: passing.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- `cargo test native_store_tests` in `src-tauri`: 5 tests passing.
- Review disposition verification: local safe actions create append-only `review_disposition` records, `snoozedUntil` persists through the native store, startup hydration reads stored dispositions, reviewed sessions can move from `completed_unreviewed` to `completed_reviewed`, dismissed/snoozed attention leaves visible queues without deleting evidence, expected conflict dispositions suppress conflict attention while preserving conflict cards, fresh attention after an older session disposition remains visible, and summary/lifecycle lanes rebuild after review actions.
- History browser verification: app navigation includes History; the panel searches fixture/live `/events` evidence plus stored local records via the core history engine; fielded filters cover project, session, file/path, command/cmd, status, branch, alert, conflict, outcome, and disposition; quoted command values are supported; no-match searches show explicit zero results; browser-local fallback storage round-trips append/read/export/clear/prune with `touchedExternalState: false`.
- Control desktop browser verification: in-app Browser at 1280x800 rendered the left session rail, center operations scan, and right session inspector in the first viewport; rail/center scan text contained no raw branch/path/command/event/hash markers; selecting a rail session updated the right inspector without opening the old modal; responsive checks at 390, 641, 760, and 1280 px had no horizontal overflow, with rail/center/inspector stacked from 760px down.
- Risk-rule verification: stale verification requires `file.changed` evidence after verification or a real before/after Git snapshot delta, a lone dirty snapshot observed after a passing test does not alert, high-risk metadata paths create deterministic P2 attention while sensitive path-only contents stay excluded, explicit port/local-database/migration resource collisions create shared-resource conflicts, duplicate resource events from one session do not collide, and completed historical sessions are excluded from visible shared-resource conflicts.
- `cargo check` in `src-tauri`: passing.
- Hook helper/admin verification: malformed and oversized stdin fail open without posting, official Codex `hooks.json` matcher groups install idempotently, missing and mismatched hook events fail strict verification, `config.toml` paths are rejected, symlinked hook files are refused, install writes missing files with `0600`, existing hook groups are preserved, uninstall removes only Masthead handlers, and rollback restores the latest backup.
- User-level hook verification: installed Masthead hooks into `/home/tyler/.codex/hooks.json`, verified `0600` permissions, used Codex's official startup hook review prompt to trust four hooks, then confirmed real `SessionStart` and `Stop` events reached the live collector from an interactive Codex smoke session.
- Ingest server black-box verification: `POST /ingest` accepts normalized hook events, duplicate provider events do not append, `GET /projection` returns live board state, malformed payloads create diagnostics without events, restart reloads persisted normalized events from the file-backed store, temp Git repo changes project into live exact-file conflict cards, `/refresh` updates known live Git sessions after later file changes without broad filesystem scanning, and `POST /retention` prunes persisted live event history while updating in-memory projection state.
- Real Codex hook payload verification: real `PostToolUse` payloads are normalized by hook event name, Bash tool events become command metadata without storing raw `toolResponse`, and patch tool events become file-change metadata without storing patch bodies.
- `npm run doctor`: passing against the live launcher with collector and user-level Codex hooks ready.
- `npm run dogfood:live`: strict seeded live-conflict gate remains intentionally scenario-dependent. On this unseeded live collector, live source, live session count, attention queue, lifecycle lanes, `calm_ops_copy`, and `feedback_snapshot_privacy` passed; the seeded failed-command/conflict/degraded-attribution gates failed because the current live store did not contain those scenarios.
- Fresh event-store privacy check: latest feedback seed with prompt-injection text stored only a redacted `latestFeedbackSnapshot` and `lastAssistantMessageSummary`; the snapshot omitted injected instructions, raw command text, relative path text, and secret-like strings.
- In-app Browser verification at `http://127.0.0.1:5173/`: using the in-app Browser/iab path, live and fixture boards were checked at 390px, 768px, and 1280px. The operations brief renders above counters, cards appear in the first viewport when sessions exist, no horizontal overflow was observed, and brief/card text had no direct address, alarm words, raw title leak, branch/path leak, technical enum leak, code fences, or secret-like strings. A selected seeded session showed deterministic state first and latest feedback second; a selected non-feedback session omitted the feedback section. Remote LLM remains off by default; the OpenAI-enabled copy path is covered by mocked Responses API tests.

## Deferred Release-Gate Gaps

- Add a first-class way to obtain real Codex shell exit status from live hooks, or document an official companion event source if Codex keeps exit status out of `PostToolUse`.
- Dogfood a real approval request, unrelated-repo case, and measured hook-to-board latency from the trusted user-level hook.
- Extend live observation beyond known-session Git refresh and explicit event payloads into broader process, port, local-database, and filesystem watcher behavior.
- Add native notification policy, coalescing, and larger-history pagination/virtualization controls.
- Add packaged desktop installation/build commands beyond the current local Vite/Tauri development shell.
- Harden optional OpenAI copy enrichment with an in-app redacted payload preview and user-facing audit controls before broad release.
