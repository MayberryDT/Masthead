# Multi-Adapter Sources Acceptance Evidence

## Automated

- `npm run typecheck`: passed on 2026-06-27.
- `npm run verify`: passed on 2026-06-27.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed on 2026-06-27 with loopback bind allowed.
- `npm run doctor:json`: passed on 2026-06-27 against `http://127.0.0.1:17373/` after restarting the local dev server.
- `npm test -- --run src/adapters`: passed on 2026-06-27.
- `npm test -- --run src/adapters/__tests__/registry.test.ts src/daemon/sources/__tests__/sourceScanService.test.ts src/daemon/sources/__tests__/sourceConnectService.test.ts src/daemon/sources/__tests__/sourceDiscoveryService.test.ts src/daemon/sources/__tests__/supportedAdapters.test.ts`: passed on 2026-06-27.
- `npm test -- --run src/daemon/import/__tests__/multiAdapterImport.test.ts src/daemon/db/__tests__/sessionRepository.test.ts`: passed on 2026-06-27.
- `npm test -- --run src/ui/sources src/ui/__tests__/sourcesPanel.test.tsx`: passed on 2026-06-27.
- `npm test -- --run src/core/__tests__/worktreeConnector.test.ts`: passed on 2026-06-27 with loopback bind allowed.

## Manual

Local dev server was restarted from this branch and is serving `http://127.0.0.1:5173` with daemon `http://127.0.0.1:17373`.

| Adapter | Scan visible | Detected | Metadata import | Transcript import | Logbook result | Notes |
|---|---:|---:|---:|---:|---:|---|
| Codex | Yes | Local-dependent | Tested | Approval-gated | Tested | Full adapter |
| Cursor | Yes | Local-dependent | Tested | Approval-gated | Tested | SQLite schema-recognition only |
| Claude Code | Yes | Local-dependent | Tested | Approval-gated | Tested | JSONL/JSON schema-recognition only |
| Antigravity | Yes | Local-dependent | Tested | Approval-gated | Tested | Metadata/transcript when schema recognized |
| OpenCode | Yes | Local-dependent | Tested | Approval-gated | Tested | JSONL/JSON schema-recognition only |
| Aider | Yes | Local-dependent | Tested | Approval-gated | Tested | Markdown role-block import |
| OpenClaw | Yes | Local-dependent | Tested | Approval-gated | Tested | JSONL/JSON schema-recognition only |
| Hermes | Yes | Local-dependent | Tested | Approval-gated | Tested | SQLite/JSONL schema-recognition only |
| Pi | Yes | Local-dependent | Tested | Approval-gated | Tested | Metadata/transcript when schema recognized |
