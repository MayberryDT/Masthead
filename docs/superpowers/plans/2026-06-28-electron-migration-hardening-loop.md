# Electron Migration Hardening Loop

Started: 2026-06-28T09:54:47-06:00

## Loop Definition

Audit `/home/tyler/Documents/Masthead` for the Electron migration across desktop shell, daemon launch, IPC/security, packaging, app-menu/service launch, docs, CI, tests, performance, and leftover Tauri artifacts. Start by recording current branch, PR, checks, running service, and migration inventory. Each round, choose the highest-risk verified gap, make one reversible improvement, run focused checks plus the relevant smoke/build/browser or desktop proof, and keep only passing changes. Record evidence and next risk after every round. Commit verified checkpoints locally; ask before merging, destructive cleanup, production changes, major dependency upgrades, or external publication. Stop on clean full inventory, blocker, or repeated no-progress.

## Initial Baseline

- Branch: `codex/electron-desktop-migration` at `2952f60`, tracking `origin/codex/electron-desktop-migration`.
- PR: `https://github.com/MayberryDT/Masthead/pull/6`, draft, base `main`, head `codex/electron-desktop-migration`.
- GitHub checks at baseline: `verify`, `electron`, and `CodeQL` passed; `Dependency review` skipped because the private repository does not expose that GitHub feature.
- Local service: `masthead-dev-electron.service` active and running Electron from `/home/tyler/Documents/Masthead/node_modules/electron/dist/electron`.
- Active Electron source: `src/electron/`, `forge.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, Electron smoke scripts, and Electron CI/release-smoke workflows.
- Active Tauri source: none tracked under `src-tauri/`; `npm ls @tauri-apps/api @tauri-apps/cli --depth=0` reports no dependency-tree entries.

## Pass 1

Finding: active contributor and agent guidance still referenced Cargo/Tauri verification, and Vite dev watchers still ignored removed `src-tauri` paths. Historical PRD, research, old plans, and dated acceptance evidence still contain Tauri references intentionally and were left untouched.

Action:
- Updated `CONTRIBUTING.md` to use Electron verification commands instead of `cargo test --manifest-path src-tauri/Cargo.toml`.
- Updated `AGENTS.md` version-system guidance so it no longer claims `version:sync` writes removed Tauri files.
- Removed stale `src-tauri` watcher ignores from `vite.config.ts` and `vite.renderer.config.ts`.

Verification:
- `npm run verify:no-citations`: pass.
- `npm run test:electron`: pass, 11 files and 35 tests.
- `npm run test:electron-security`: pass, 3 files and 7 tests plus source security check.
- `npm run build`: pass.
- Active-doc/config stale reference search over contributor docs, agent docs, README, release/config/data-path docs, Vite config, package scripts, and version sync script: no `src-tauri`, `Tauri`, `cargo`, `Cargo`, or `tauri` matches.

Next risk:
- Audit Electron daemon launch and desktop data identity end to end, especially packaged resource paths, app user-data paths, MCP launch config, and live dev-service process cleanup behavior.
