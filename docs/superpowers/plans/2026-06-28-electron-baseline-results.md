# Electron Migration Baseline Results

Date: 2026-06-28
Branch: `codex/electron-desktop-migration`

## Repository State

- Started from `main` at `1b63d5f1d73be007ba3486cb0e726f02886874c2`.
- Created implementation branch `codex/electron-desktop-migration`.
- Pre-existing local change carried forward: `docs/superpowers/plans/2026-06-28-electron-desktop-migration.md`.

## Automated Baseline

```bash
npm run verify
```

Passed.

Evidence:

- `verify:no-citations`: passed.
- `check:product-contract`: passed.
- `check:surface-contract`: passed.
- `typecheck`: passed.
- Vitest: 145 files, 635 tests passed.
- `npm run build`: passed.
- Endpoint matrix: passed against a temporary database.
- Smoke tests: `smoke:live`, `smoke:compatibility`, `smoke:import`, and `smoke:mcp` passed.

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Passed: 23 Tauri/Rust tests.

## Local Dev Runtime Baseline

```bash
npm run dev
```

The launcher printed:

- UI: `http://127.0.0.1:5173`
- Daemon: `http://127.0.0.1:17373`
- Mode: `primary`
- API: `1`
- Build SHA: `development`
- Database: `/home/tyler/.local/share/masthead-dev/masthead.sqlite`
- DB ID: `474c0b70-1091-4785-bccb-007d4928376e`

Rendered browser baseline through the in-app Browser:

- Page loaded at `http://127.0.0.1:5173/`.
- Title was `Masthead`.
- Main navigation rendered: Board, Logbook, Sources, Usage, Agent Access, Settings.
- No console errors were reported.
- The UI stayed on `Connecting to Masthead collector`.
- It did not show `No live connection` or `No live Codex sessions yet`.

Daemon health baseline:

```bash
curl --max-time 5 -sv http://127.0.0.1:17373/health
```

Result: TCP connection opened, but no bytes were returned before the five-second timeout.

Process notes:

- The daemon process was CPU-bound after startup.
- It had multiple defunct `git` child processes.
- SIGTERM did not stop the hung daemon, so the process was killed after baseline capture.

Interpretation: the checked-in automated gates are clean, but the current browser dev runtime has a pre-existing local live-daemon responsiveness issue on this machine. Electron migration verification should still require the Electron daemon path to answer `/health` and render a connected app; this baseline should not be treated as acceptable parity for the new desktop path.
