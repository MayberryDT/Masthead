# Launch Core Acceptance Evidence

Date: 2026-06-26
Branch: `codex/launch-ready-core`

## Automated Gate

```bash
npm run verify
```

Result: PASS with loopback-capable execution.

Evidence:

- `verify:no-citations`: passed.
- `check:product-contract`: passed.
- `check:surface-contract`: passed.
- `typecheck`: passed.
- Vitest: 120 files passed, 476 tests passed.
- Vite build: passed.
- Endpoint matrix smoke: passed.
- Live smoke: passed.
- Compatibility smoke: passed.
- Import smoke: passed.
- MCP smoke: passed.

The first sandboxed run failed on local loopback binding (`listen EPERM`). The rerun with loopback permissions passed.

## Rust Gate

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Result: PASS with loopback-capable execution.

Evidence:

- `masthead_lib`: 23 tests passed.
- `masthead` binary tests: 0 tests, passed.
- Doc tests: 0 tests, passed.

The first sandboxed run failed only in `http_probe::tests::get_json_http_11_decodes_chunked_response_from_server` because the test server could not bind loopback. The rerun with loopback permissions passed.

## Doctor Gate

```bash
MASTHEAD_PORT=0 MASTHEAD_DATA_DIR=/tmp/masthead-doctor-acceptance-$$ MASTHEAD_GIT_REFRESH_MS=0 node scripts/masthead-ingest-server.js
MASTHEAD_BASE_URL=http://127.0.0.1:34743 npm run doctor:json
```

Result: PASS against an isolated current-branch primary daemon.

Evidence:

- `ok`: true.
- Protocol identity: `product=masthead`, `apiVersion=1`, missing capabilities `[]`.
- Database identity: ready SQLite database under `/tmp/masthead-doctor-acceptance-3166866`.
- Product endpoints: 8 responded.
- Source discovery: Codex source connected.
- Imports endpoint: responded.
- MCP: 6 read-only tools.
- MCP stdio: initialized, listed 6 tools, and served coverage.
- Settings contract: passed with `schemaVersion=5`.
- Destructive preview safety: stale database identity rejected with 400.
- Codex hooks: installed, private file mode.

A doctor run against an existing read-only bridge failed because the upstream daemon was older and did not expose the new Settings `schemaVersion`; the isolated current-branch daemon passed.

## Dogfood Fixture Gate

```bash
npm run dogfood:fixture
```

Result: PASS.

Evidence:

- 3 sessions.
- 4 attention items.
- 1 failed-command evidence item.
- 1 exact-file conflict.
- 0 unrelated-repo hard conflicts.
- Degraded attribution present.
- Privacy suppression present.
- Retention controls present.
- Lifecycle lanes present.
- Maximum simulated attention latency: 40 ms.

## Browser Surface Gate

```text
npm run dev
```

Result: PASS for rendered responsive inspection through the Codex in-app Browser at `http://127.0.0.1:5174`.

Evidence:

- Desktop `1440x900`: Now, Logbook, Sources, Agent Access, and Settings rendered; document scroll width stayed within viewport; no `No live connection` state.
- Tablet `900x900`: Now, Logbook, Sources, Agent Access, and Settings rendered; document scroll width stayed within viewport; no `No live connection` state.
- Mobile `390x844`: Now, Logbook, Sources, Agent Access, and Settings rendered; document scroll width stayed within viewport; no `No live connection` state.
- Narrow Sources and Agent Access include intentionally wide internal tables/code blocks with panel-local horizontal scrolling.

## Remaining External Evidence

- GitHub Actions has not been run for this branch in this local acceptance pass.
- A clean-machine packaged-app install was not performed in this local acceptance pass.
- `npm run dogfood:live` was not used as final release signoff in this local acceptance pass because it depends on seeded live Codex scenarios and human review of local data.
- `LICENSE` remains intentionally absent until Tyler chooses the repository license.
