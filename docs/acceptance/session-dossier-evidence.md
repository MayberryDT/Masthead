# Session Dossier Acceptance Evidence

Generated during the Masthead session dossier implementation pass.

## Automated

| Check | Result | Evidence |
| --- | --- | --- |
| Focused dossier suite | PASS | `npm test -- src/daemon/db/__tests__/sessionDossierRepository.test.ts src/daemon/db/__tests__/sessionRepository.test.ts src/core/__tests__/worktreeConnector.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/sessionLibraryDetail.test.tsx src/ui/__tests__/sessionInspector.test.tsx` -> 7 files, 46 tests passed. |
| Product verification | PASS | `npm run verify` -> no citations, product contract, surface contract, typecheck, 129 files and 519 tests, production build, endpoint matrix, live/compat/import/MCP smokes passed. |
| Rust tests | PASS | `cargo test --manifest-path src-tauri/Cargo.toml` -> 23 tests passed. |
| Doctor | PASS | `npm run doctor:json` -> `ok: true`; logbook check reported `Logbook has 9 sessions and a canonical dossier loaded.` |
| Local preview | PASS | `npm run dev` running at `http://127.0.0.1:5173`; `curl -I http://127.0.0.1:5173` returned HTTP 200. |
| Real token-bearing dossier | PASS | Live dossier for `session:8e20c69164ce0bd20f6c8e300376d771` returned `totalTokens: 48654735`, matching the canonical `model_usage` aggregate. |
| Audit gap closeout | PASS | Follow-up audit gaps were patched: context packet includes `MCP included`, tools render output previews, timeline and narrative provenance render bounded source refs, and high-risk file changes create dossier attention. `npm run verify` passed again after these patches. |
| Restarted dev server | PASS | `npm run dev` was restarted after backend changes; `doctor:json` passed and a live context packet included `MCP included: yes`. |

## Manual Board Check

| Case | Result | Evidence |
| --- | --- | --- |
| Open active Board session | COVERED BY TEST | `SessionDetailModal` renders the shared modal shell with `SessionDossier` for a live selected session. |
| Canonical dossier loads | PASS | `doctor:json` loaded a canonical dossier for `session:8e20c69164ce0bd20f6c8e300376d771`; Board cards carry `canonicalSessionId` and `App` fetches `/sessions/:id/dossier` when the modal opens. |
| Live-only fallback works | PASS | `SessionDossier.test.tsx` verifies the live-only fallback banner and safe review actions. |
| Files changed section useful | PASS | `SessionDossier.test.tsx` verifies canonical file evidence rendering; repository tests seed and assert file effects. |
| Tools/verification section useful | PASS | Repository tests assert verification classification; UI tests verify tool and verification rendering. |
| Timeline filters work | PASS | `SessionDossier` exposes All, User, Assistant, Tools, Files, Checkpoints, and Attention filters; UI tests verify the filter labels render. |
| Copy context packet works | PASS | `SessionDossier.test.tsx` verifies the Copy context button calls `navigator.clipboard.writeText` with the canonical context packet. |
| Unsupported Open Codex action hidden | PASS | `SessionDossier.test.tsx` verifies source-opening actions are not rendered. |

## Manual Logbook Check

| Case | Result | Evidence |
| --- | --- | --- |
| Open historical session | COVERED BY TEST | `SessionLibraryDetail` renders the modal shell with the shared `SessionDossier` body for a canonical Logbook session. |
| Same dossier component used | PASS | Board `SessionDetailModal` and Logbook `SessionLibraryDetail` both import `SessionDossier`. |
| Transcript excerpts visible | PASS | `SessionDossier.test.tsx` verifies transcript excerpts render from canonical dossier data. |
| Provenance visible | PASS | `SessionDossier.test.tsx` verifies canonical IDs, source ID, MCP inclusion, source confidence, and narrative provenance render. |

## Browser Tool Note

The Codex in-app Browser/iab tool was requested through tool discovery but was not exposed in this session. Per the repository instructions, no standalone Playwright or external browser-control fallback was used.
