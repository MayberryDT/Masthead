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

## Pass 2

Finding: Electron dev startup was repeatedly making the daemon unresponsive on the live 1.2 GB dev database. Verified symptoms included `/health` timing out with 0 bytes, queued listener backlog on `127.0.0.1:17373`, daemon main thread in `folio_wait_bit_common`, repeated slow `/projection` logs up to 31 seconds, orphaned Electron parents after forced service stops, and a recurring `git diff --numstat` child against unrelated worktrees. The root causes were stacked: every-launch background hydration repeated no-op legacy migration checks, scheduled Git refreshes ran every 5 seconds over too much live state, `/projection` did read-path writes/enrichment scheduling, and Electron handed the renderer a cold projection endpoint.

Action:
- Made scheduled/manual Git refresh single-flight and status-only, leaving rich diff stats on direct ingest snapshots.
- Bounded periodic Git refresh to a small recent-session window and changed the default `MASTHEAD_GIT_REFRESH_MS` from 5 seconds to 60 seconds.
- Deferred background hydration, removed startup `PRAGMA optimize`, batched any legacy-import search indexing, and recorded the empty legacy migration marker so missing legacy files do not repeat startup reconciliation forever.
- Bounded live board projection to the recent session set while preserving full live event/snapshot totals in the envelope.
- Removed `/projection` read-path side effects: no enrichment scheduling and no `board_sessions` writes on board reads.
- Added Electron connector warmup for `/projection` before returning the live connector URL to the renderer.
- Updated configuration docs and focused tests for the new refresh default, empty migration marker, status-only refresh, and read-only projection contract.

Verification:
- `npm run build:daemon`: pass.
- `npm run test:electron`: pass, 11 files and 35 tests.
- `npx vitest --run src/daemon/__tests__/legacyDataMigration.test.ts src/daemon/__tests__/gitSnapshots.test.ts src/daemon/__tests__/healthApi.test.ts src/core/__tests__/ingestServer.test.ts`: pass, 4 files and 23 tests.
- `git diff --check`: pass.
- Live service restart through `masthead-dev-electron.service`: active after restart with Electron running.
- Live cold connector warmup request logged once as `/projection` in 10523 ms, then subsequent measured `/projection` returned in 0.418 s with a 491100 byte response.
- Post-refresh proof after waiting past the 60000 ms refresh interval: `/health` returned in 0.002823 s and `/projection` returned in 0.332508 s with a 491100 byte response; no accumulating `git -C` children were present.
- The live dev database now has the `legacy-events-ndjson-v1` marker with `reason: "empty"` for `/home/tyler/.local/share/masthead-dev/legacy/events.ndjson`.

Next risk:
- Continue Electron migration inventory with IPC/security and packaging/package-smoke review, especially renderer bridge exposure, preload surface, app protocol policy, packaged daemon resource paths, and remaining local app-menu cleanup behavior for orphaned Electron processes.

## Pass 3

Finding: packaged-mode Electron trust policy still treated the Vite dev origins (`http://localhost:5173` and `http://127.0.0.1:5173`) as trusted renderer origins for navigation, window opens, IPC sender validation, and daemon CORS origins. That is acceptable only for local development. In packaged mode, the trusted renderer should be the app protocol (`masthead://app`) so a local dev server cannot become a privileged renderer sender by default.

Action:
- Added an explicit renderer URL policy and trusted-origin helper.
- Made packaged/default mode trust only `masthead://app`.
- Allowed Vite localhost origins only when Electron dev mode opts in.
- Applied the same policy to window navigation, window-open handling, IPC sender validation, and `startLiveConnector` allowed origins.
- Updated Electron IPC/window security tests for packaged-default denial and dev-mode opt-in.

Verification:
- `npm run test:electron-security`: pass, 3 files and 8 tests plus source security check.
- `npm run verify:no-citations`: pass.
- `git diff --check`: pass.
- `npm run test:electron`: pass, 11 files and 36 tests.
- `npm run build`: pass.
- `npm run smoke:electron`: pass after stopping the existing app-menu service to release Electron's single-instance lock.
- `npm run smoke:electron:packaged`: pass; Forge produced Linux zip/deb artifacts and the packaged binary smoke passed at `out/Masthead-linux-x64/masthead`.
- App-menu service restored after smoke: live `/health` returned in 0.001924 s from daemon instance `99f35e35-6721-4fa5-aa0f-0ace89cc9ce7`.

Next risk:
- The packaged smoke exposed a separate app-menu/service launch race: after stopping and quickly restarting the service, the wrapper can see the old daemon as healthy while it is still shutting down, leave an orphaned Electron parent holding the single-instance lock, and then run Electron without a live connector. Audit and harden the tracked app-menu launcher/install path next.

## Pass 4

Finding: the app-menu launcher was only installed in local user config, not reproducible from the repo, and its daemon startup path could reuse a connector that was still shutting down. The reproduced failure left Electron running without a connector on `127.0.0.1:17373`, and an orphaned Electron parent could keep the single-instance lock outside the active service cgroup.

Action:
- Added `scripts/install-electron-dev-launcher.js`.
- Added `npm run install:electron-dev-launcher`.
- The installer writes the launcher wrapper, user systemd unit, and desktop entry.
- The wrapper now performs targeted cleanup of stale Masthead Electron, Forge, and daemon processes from this checkout before checking or starting the daemon.
- The wrapper waits for port `17373` to close before starting a new daemon, avoiding the old-daemon health-check race.
- Installed the updated launcher locally at `/home/tyler/.local/bin/masthead-dev-desktop`, `/home/tyler/.config/systemd/user/masthead-dev-electron.service`, and `/home/tyler/.local/share/applications/ai.animas.masthead-dev.desktop`.

Verification:
- `node --check scripts/install-electron-dev-launcher.js`: pass.
- `package.json` parse check: pass.
- `npm run install:electron-dev-launcher`: pass.
- `systemctl --user restart masthead-dev-electron.service`: pass; `/health` returned in 0.001252 s from daemon instance `70e7eae1-9e02-4eb6-afe6-b6a83bf13dbb`.
- Rapid second `systemctl --user restart masthead-dev-electron.service`: pass; `/health` returned in 0.001352 s from daemon instance `49ccd336-0022-4a52-a561-5261aec3fa3d`.
- Settled service process tree includes the daemon, Electron Forge, Electron main, GPU, network, renderer, and broker processes inside `masthead-dev-electron.service`.
- Live `/projection` returned in 0.333621 s with a 492209 byte response after the rapid restart.
- `npm run verify:no-citations`: pass.
- `git diff --check`: pass.

Next risk:
- Continue CI/security/package inventory: check GitHub workflow coverage, dependency-review skip behavior, packaging artifacts/fuses, and any remaining tracked or untracked Tauri-era assumptions before deciding whether the Electron migration inventory is clean.

## Pass 5

Finding: the PR's `Dependency review` check was skipped because `.github/workflows/security.yml` skipped the whole job for private repositories. That leaves the GitHub check non-green even when there is a useful local fallback available. A full `npm audit --audit-level=high` currently fails on Electron Forge build-tool transitive dev dependencies (`tar` and `tmp`) with no available fix, while the runtime dependency audit is clean.

Action:
- Added `npm run audit:runtime` as `npm audit --omit=dev --audit-level=high`.
- Changed the `Dependency review` job so it always runs.
- Public pull requests still use `actions/dependency-review-action@v4`.
- Private pull requests and `main` pushes run the runtime dependency audit fallback instead of skipping the job.
- Updated `docs/release-gates.md` to document the private-repo fallback and the current dev-dependency audit caveat.

Verification:
- `npm run audit:runtime`: pass, 0 vulnerabilities.
- Full `npm audit --audit-level=high`: fails on Electron Forge build-tool transitive dev dependencies with no available fix; not changed because that would require upstream or major build-tool dependency work.
- `.github/workflows/security.yml` parsed successfully with PyYAML.
- `npm run test:electron-security`: pass, 3 files and 8 tests plus source security check.
- `npm run verify:no-citations`: pass.
- `git diff --check`: pass.
- `gh pr view` before this local commit showed PR #6 open/draft with `verify`, `electron`, and `CodeQL` successful, and `Dependency review` skipped.

Next risk:
- Continue packaging/security inventory: verify Electron fuse coverage and packaged artifact assumptions, then scan tracked active docs/config for any remaining Tauri-era operational instructions.

## Pass 6

Finding: packaged Electron was already using `asar`, but the packaged binary still allowed fallback app-code loading outside `app.asar`, did not enable embedded ASAR integrity validation, and still granted Electron's extra `file://` privileges even though Masthead serves the renderer from the `masthead://` custom protocol. The existing packaged smoke also did not prove fuse state, and a smoke run showed the temporary packaged-smoke daemon could remain alive long enough for the dev service restart to see the wrong connector.

Action:
- Enabled Electron fuses for `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`.
- Disabled `GrantFileProtocolExtraPrivileges`.
- Extended `scripts/masthead-electron-packaged-smoke.js` to read the packaged binary fuse wire and fail if hardening fuses drift.
- Changed Electron smoke-mode shutdown to explicitly stop and wait for owned daemon children before exiting.
- Extended packaged smoke to fail if its temporary connector is still serving after the packaged app exits.
- Tightened the app-menu launcher's stale-process classifier so it only stops exact Masthead daemon, Forge, and Electron command shapes instead of arbitrary shell commands that merely mention Electron paths.
- Reinstalled the updated launcher locally.

Verification:
- Official Electron fuse documentation reviewed for `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, and `GrantFileProtocolExtraPrivileges`.
- `node --check scripts/masthead-electron-packaged-smoke.js`: pass.
- `npm run test:electron-security`: pass, 3 files and 8 tests plus source security check.
- `npm run build`: pass.
- `npm run smoke:electron:packaged`: pass after rebuilding `out/Masthead-linux-x64/masthead`.
- Rebuilt packaged fuse wire: `RunAsNode=0`, `EnableNodeOptionsEnvironmentVariable=0`, `EnableNodeCliInspectArguments=0`, `EnableEmbeddedAsarIntegrityValidation=1`, `OnlyLoadAppFromAsar=1`, `GrantFileProtocolExtraPrivileges=0`.
- `node --check scripts/install-electron-dev-launcher.js`: pass.
- `npm run install:electron-dev-launcher`: pass.
- `systemctl --user restart masthead-dev-electron.service`: pass after launcher classifier tightening; `/health` returned in 0.002202 s from `/home/tyler/.local/share/masthead-dev` with daemon instance `ad60fdfa-b630-4ff8-8775-a5a0695bb039`.
- Live `/projection` returned in 0.372444 s with a 491229 byte response.
- `npm run verify:no-citations`: pass.
- `git diff --check`: pass.

Next risk:
- Final active-source cleanup pass: scan tracked active docs/config/scripts plus ignored working artifacts for Tauri leftovers, classify intentional history versus actionable residue, and decide whether the migration inventory is clean or requires approval for destructive local cleanup.
