# Transcript Detail Acceptance Evidence

## Automated

- `npm test -- src/daemon/db/__tests__/sessionTranscriptRepository.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts src/app/__tests__/daemonClient.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx`: PASS on 2026-06-27.
- `npm test -- src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/__tests__/sessionLibraryDetail.test.tsx src/app/__tests__/daemonClient.test.ts`: PASS on 2026-06-27.
- `npm test -- --run src/daemon/import/__tests__/progressiveImport.test.ts`: PASS on 2026-06-27. This includes a transcript fixture with user, assistant, tool call, tool result, token usage, checkpoint rows, and `/sessions/:id/transcript` coverage.
- `npm run typecheck`: PASS on 2026-06-27.
- `npm run verify:no-citations`: PASS on 2026-06-27.
- `npm run doctor:json`: PASS on 2026-06-27. Doctor reported logbook transcript status `ok`, 2,280 messages, and 6,030 tool calls.
- `npm run verify`: PASS on 2026-06-27. This includes product contract, surface contract, typecheck, 130 test files / 533 tests, production build, endpoint matrix, live smoke, compatibility smoke, import smoke, and MCP smoke.
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS on 2026-06-27 outside the sandbox. The sandbox blocks the Rust HTTP probe's local test server with `Operation not permitted`.

## Manual cases

| Case | Expected | Result |
|---|---|---|
| Hook-only session | Coverage warning, no fake transcript | Covered by dossier coverage tests |
| Imported transcript session | User/assistant messages visible | Covered by progressive import fixture and transcript endpoint test |
| Tool-heavy session | Unknown tool spam collapsed | Covered by unit test for repeated low-value rows |
| Missing files | Compact coverage warning | Covered by dossier coverage warnings |
| Search transcript | Matching items visible | Covered by repository and client tests |
| Filter transcript to assistant | Assistant rows only | Covered by repository test |
| Load more transcript | More rows append | Covered by repository pagination and App wiring |
| Open Sources CTA | Navigates to Sources | Covered by component wiring |

In-app browser automation was not exposed in this thread after compaction, so visual manual checks should be run against the local preview at `http://127.0.0.1:5173`.
