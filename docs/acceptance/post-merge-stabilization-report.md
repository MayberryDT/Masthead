# Post-Merge Stabilization Report

## Final commit

- Commit: branch head containing this report
- Branch: codex/post-merge-stabilization
- Date: 2026-06-26T07:31:23-06:00

## Verification

| Command | Result |
|---|---|
| npm run verify | PASS after raising the required Node runtime to 24.15.0 |
| cargo test --manifest-path src-tauri/Cargo.toml | PASS |
| npm run doctor:json | FAIL against default `http://127.0.0.1:17373` because that port is currently a legacy daemon without Masthead protocol identity |
| MASTHEAD_BASE_URL=http://127.0.0.1:39983 npm run doctor:json | PASS against a compatible temporary daemon, with WARN for empty Logbook and missing Codex source |

## Product loop status

| Area | Status | Notes |
|---|---|---|
| Daemon protocol | PASS | Shared protocol classifier and doctor require Masthead product identity, exact API version, capabilities, runtime identity, and data identity. |
| Active daemon URL | PASS/WARN | Current compatible proof used temporary daemon `http://127.0.0.1:39983`; default `17373` is occupied by a legacy daemon and doctor rejects it. |
| Data directory identity | PASS | Tauri startup now reuses only daemons whose `data.dataDirectory` matches the app data directory. |
| Sources | WARN | Compatible empty-daemon proof reports Codex source not detected; this is non-blocking for an empty temp data directory. |
| Import jobs | PASS | `npm run smoke` passed import smoke. |
| Logbook | WARN | Compatible empty-daemon proof reports zero sessions; endpoint is healthy. |
| MCP | PASS | Agent Access test connection now verifies initialize plus `tools/list`; MCP smoke passed. |
| Settings | PASS | `/settings` endpoint responds in endpoint matrix and doctor checks. |
| Enrichment | PASS | Included in `npm run verify` test suite. |
| Legacy store transition | PASS | SQLite is canonical; legacy NDJSON is migration/compatibility input and live ingest does not append new NDJSON product records. |
| CI | PENDING | Branch CI is configured to run on every branch push. The previous branch-head run failed because GitHub Actions used Node 22.13.0, whose `node:sqlite` runtime did not provide FTS5; this report includes the Node 24.15.0 runtime floor and workflow update. Verify the exact result from GitHub Actions for the branch head containing this report. |

## Remaining work

### Blockers

- None in the code branch based on local verification.

### Non-blocking follow-ups

- The local default port `127.0.0.1:17373` is currently held by a legacy daemon. The new doctor correctly rejects it; stop or replace that process before using default-port doctor output as a healthy local product-loop signal.
- Final GitHub Actions status must be checked after this report commit is pushed.

## Decision

This branch is:

- [x] safe to continue product development on
- [ ] not safe; requires another stabilization pass
