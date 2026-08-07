# Post-Merge Stabilization Baseline

## Commit

- HEAD: 83c0a419cf663fc78dc8105e73b95fb177f26ff6
- Branch: codex/post-merge-stabilization
- Date: 2026-06-26T06:59:21-06:00

## Git integrity

```text
$ git status --short
<no output>

$ git log --oneline --decorate --graph -20
* 83c0a41 (HEAD -> codex/post-merge-stabilization, origin/main, main) fix release gate harness isolation
* 178072e fix release gate regressions
* 9f8480a feat: version the Masthead daemon protocol
* ab92f44 test: reproduce Masthead daemon compatibility failures
* dc01035 Complete Masthead product reset
* 261c20f docs: add Masthead release gate
* bcc2728 test: prove Masthead's operational product loop
* bced718 refactor: make SQLite the only normal Masthead product store
* 87da47c fix: prevent noisy Board text from becoming product text
* 4b51976 feat: make Settings operate on verified runtime state
* e0a75f9 feat: verify MCP launch against the active session database
* 1cd773c feat: make Logbook operational on canonical sessions
* 535bb68 feat: complete source import controls and progress
* bbb0111 feat: make Sources diagnose supported agent runtimes
* 62810de fix: make browser dev connector protocol-aware
* b6ecfa4 fix: reject compatible daemons with the wrong Masthead data directory
* 8964c2c fix: migrate legacy Masthead development data into stable storage
* 8311b45 refactor: route all surfaces through one Masthead connection
* 7a692d6 fix: propagate the active Masthead daemon URL through the UI
* 80a696e fix: parse Masthead daemon health correctly in Tauri
```

## Conflict marker scan

```text
$ rg -n "<<<<<<<|=======|>>>>>>>" .
<no output; exit 1>
```

## Verification commands

### npm install/check

```text
$ npm ci
prepare ran scripts/setup-dev-hooks.js and hit EROFS writing .git/hooks/pre-commit in the sandbox.
The script's fallback printed "dev-hook setup skipped (no .git or permissions)".
added 66 packages in 4s
exit 0
```

### Typecheck

```text
$ npm run typecheck
> tsc --noEmit
exit 0
```

### Tests

```text
$ npm test -- --run
Initial sandbox run failed because localhost binding is blocked:
Error: listen EPERM: operation not permitted 127.0.0.1
Test Files 11 failed | 109 passed (120)
Tests 36 failed | 434 passed (470)

$ npm test -- --run
Rerun with localhost permissions:
Test Files 120 passed (120)
Tests 470 passed (470)
Duration 9.49s
exit 0
```

### Build

```text
$ npm run build
version:sync confirmed tauri.conf.json, Cargo.toml, and Cargo.lock are already at 0.1.0.
vite v8.0.16 built the client successfully.
npm run build:daemon completed.
exit 0
```

### Smoke

```text
$ npm run smoke
Initial sandbox run failed because localhost binding is blocked:
Error: listen EPERM: operation not permitted 127.0.0.1

$ npm run smoke
Rerun with localhost permissions:
Masthead live smoke passed.
Masthead compatibility smoke passed.
Masthead import smoke passed.
Masthead MCP smoke passed.
exit 0
```

### Rust

```text
$ cargo test --manifest-path src-tauri/Cargo.toml
error: Provided Image path "/home/tyler/Documents/Masthead/src-tauri/./icons/32x32.png" doesn't exists
error[E0432]: unresolved import `tauri::tray`
note: found an item that was configured out behind feature "tray-icon"
error[E0282]: type annotations needed in src/lib.rs on .on_menu_event closure
error: could not compile `masthead` due to 5 previous errors
exit 101
```

### Doctor

```text
$ npm run doctor:json
{
  "ok": false,
  "checks": [
    { "id": "node-runtime", "status": "ok", "message": "Node 24.15.0" },
    { "id": "daemon-build", "status": "ok", "message": "/home/tyler/Documents/Masthead/dist/daemon/src/daemon/main.js" },
    { "id": "sqlite-runtime", "status": "ok", "message": "node:sqlite opens WAL databases with FTS5" },
    { "id": "collector", "status": "fail", "message": "fetch failed", "healthUrl": "http://127.0.0.1:17373/health" },
    { "id": "codex-hooks", "status": "ok", "message": "installed in /home/tyler/.codex/hooks.json" }
  ]
}
exit 1
```

## Initial conclusion

- Blocking failures:
  - `cargo test --manifest-path src-tauri/Cargo.toml` does not compile because tray/icon support is not wired consistently for tests.
  - `npm run doctor:json` fails when no daemon is running and currently checks only the stale collector path instead of the full product loop.
- Non-blocking warnings:
  - Sandbox-local `npm ci` cannot install git hooks because `.git/hooks` is read-only, but package installation completed.
  - Sandbox-local test and smoke runs cannot bind `127.0.0.1`; rerunning with localhost permissions passed.
- Suspected merge artifacts:
  - Rust tray/icon setup appears incomplete for the current Tauri test build.
  - Doctor output still uses a narrow collector check and does not yet validate the current protocol/data/MCP/source product contract.
