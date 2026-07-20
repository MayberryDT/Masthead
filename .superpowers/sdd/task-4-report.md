# Task 4 implementation report

## Result

Implemented instance-bound authoring launchers and daemon-owned manifest lifecycle, current V3 health/capability identity, manifest-bound CLI guards, V3 Doctor identity validation, non-Electron primary launcher preparation, bridge non-publication, and filesystem-only production stage/activate receipts. No production data, process, installation, or runtime was touched.

Commit: `13f9a96a feat: bind authoring to daemon instance`

## TDD evidence

RED:

- `src/shared/__tests__/instanceIdentity.test.ts` initially failed because the canonical identity module did not exist.
- Updated Electron launcher tests initially failed because launchers still resolved through `~/.local/bin/mastheadctl` and embedded daemon URLs.
- The first escalated focused run exposed six compatibility failures in V3 fixtures and a leaked fetch stub; these were corrected without weakening the new identity validator.

GREEN:

- Exact Task 4 focused suite, escalated for loopback: 13 files, 254/254 tests passed, 63.79s final run.
- Production lifecycle suite: 129/129 tests passed, including the new stage/activate zero-runtime-side-effect proof and all existing rollback proofs.
- Bridge/UI/authoring capability fallout: 3 files, 100/100 tests passed.
- `npm run typecheck`: passed.
- `git diff --check` and cached diff check: passed.

## Main changes

- Added `src/shared/instanceIdentity.ts` as the single parser/normalizer/comparison module, with exact mismatch codes and nonce-tolerant stable request binding.
- Moved Electron, installed Electron Dev, and `npm run dev` launchers to `<instanceDir>/bin/mastheadctl`; wrappers export only `MASTHEAD_INSTANCE_MANIFEST`.
- Added complete primary identity to health and current V3 capabilities, with cross-field protocol validation and bridge identity rewriting that publishes no writable manifest identity.
- Made daemon health unavailable until the atomic manifest exists, and made graceful close remove only its own nonce after the listener closes but before the database writer lock is released.
- Made the CLI reload the manifest before every mutation, validate current capabilities, accept a safe nonce-only restart, and return structured identity mismatch errors.
- Made Doctor compare the selected URL, health, manifest, command, and V3 capabilities, then execute the wrapper without injecting identity behind its back.
- Added `stageProductionInstallation()` and `activateStagedProductionInstallation()` with immutable receipt validation, staged instance launcher, unchanged current/live state during staging, filesystem-only activation, previous-launcher rollback restoration, and preservation of the previous bundle until later transition success.

## Self-review

- No V4 mutation route or end-to-end V4 mutation proof was added; Tasks 8 and 9 still own those boundaries.
- `creationInstanceId` remains audit evidence and is deliberately excluded from safe-restart authorization.
- Offline V1 recovery remains outside daemon capability checks.
- Production activation does not open SQLite, acquire the application lifecycle lease, run maintenance, probe health, spawn Masthead, or write the live manifest.
- Existing production rollback semantics remain intact: activation retains the previous bundle, and transition cleanup removes it only after maintenance and candidate startup succeed.

## Lifecycle hardening follow-up

Review exposed lifecycle boundaries that the first commit had not proved strongly enough. The follow-up makes the staged receipt independently rehydratable across processes, persists hashes, modes, rollback snapshots, and all destination paths, and rejects staged-byte tampering, receipt path substitution, active-surface drift, and a changed `current` binding before activation. Activation now installs only the exact buffers it hashes, holds an exact PID/start-identity filesystem guard, restores `current` plus all three active surfaces on every injected failure boundary, and records activation durably. Finalization is a separate public filesystem operation and requires a fresh daemon-owned manifest newer than activation before it removes the rollback bundle, receipt, staged files, and stale production helper artifacts.

Daemon startup now uses an exclusive SQLite manifest-writer lease that is released automatically on process death, survives stale metadata safely, and remains held from publication through listener close, owned-manifest removal, and guard release. Shutdown continues database/writer-lock cleanup if publication failed. Electron cleans up and awaits its exact spawned child after health, manifest, or warmup failure; compatible fast paths re-prepare and verify the exact manifest assignment. Primary health identity is canonical and exact, bridge health exposes no writable instance identity, and the read-only bridge rejects current V3 capabilities.

Doctor now checks manifest schema, timestamp, PID, canonical instance directory, exact manifest and command paths, base URL, database/build identity, and instance nonce. Production `stage`, `activate`, and `finalize` commands are documented in `docs/reference/production-cold-activation.md`.

Fresh follow-up verification:

- Complete Task 4 plus bridge/UI fallout suite: 16 files, 376/376 tests passed, 58.39s.
- Focused standards-hardening set: 5 files, 190/190 tests passed.
- Production lifecycle suite within the complete run: 136 tests passed.
- `npm run typecheck`: passed after the final diff.
- `git diff --check`: passed after the final diff.

Follow-up commit: `fix: harden instance lifecycle boundaries`.

## Crash-recoverable activation follow-up

The second lifecycle review showed that exception rollback was insufficient: process death could leave `current` and the three active launch surfaces at different revisions. Activation now writes and durably syncs a phase journal before every filesystem mutation. A later activation or finalization holds the shared production lifecycle lease, verifies every current surface is exactly its persisted before-image or attested after-image, restores the complete before-image deterministically after an interrupted phase, and removes the journal before retrying. A completed activation discovered with a leftover journal is verified and treated idempotently.

Stage, activate, finalize, install, start, stop, and transition now use the same crash-released lifecycle lease, with unlocked internal composition to avoid nested leases. Receipts persist the resolved lease, data directory, database, port/base URL, candidate identity, and attested rollback bundle identity. Staging cleans safe unreferenced copies and staged files on pre-receipt failure. Activation re-proves the production process set, health, port, runtime ownership sentinel, and live manifest are absent before its first mutation without opening the application database.

Finalization re-verifies the pinned candidate and active launcher/desktop bytes, then requires live evidence tying the guarded daemon manifest to an unchanged PID/start identity, exact production target, primary writable health, base URL, database/build/instance identity, and canonical launcher paths. Arbitrary manifest JSON and dead PIDs fail closed. Electron now verifies the entire expected wrapper body plus executable mode, reuses shared health classification and exact target identity for compatible-daemon reuse, rejects independent instance path overrides, and escalates an exact owned child from SIGTERM to SIGKILL only after the grace period while retaining the original startup failure if cleanup also fails.

Fresh crash-pass verification:

- Complete Task 4 plus production and bridge/UI suite: 16 files, 383/383 tests passed, 66.68s.
- Focused production and Electron suite: 161/161 tests passed before the final staging-cleanup regression was added.
- `npm run typecheck` and `git diff --check`: passed.

Crash-recovery commit: `fix: make production activation crash recoverable`.

## Lifecycle gate and finalization recovery follow-up

The final lifecycle review is now implemented as a durable gate shared by install, stage, activate, finalize, transition, cold activation, start, and stop. The versioned activation journal binds the immutable receipt hash, full before-images, attested after-images, candidate and rollback identities, and every completed transition. Activation retains that journal until finalization has proved the exact live daemon identity and removed every staged or obsolete artifact.

Finalization now rechecks candidate digest and release identity, active bytes and modes, the receipt-bound health URL, guarded daemon ownership, and foreign lifecycle artifacts immediately before cleanup. Every bundle, staged-file, and receipt deletion is journaled independently, so a crash after any delete can resume in a fresh process from the embedded receipt. Activation's default offline proof also contends both the database lease and the packaged runtime ownership probe. Electron derives packaged CLI paths with platform-native Windows or POSIX semantics and installs its child exit listener before either termination signal.

Fresh final verification:

- Complete Task 4 suite with permitted isolated loopback: 16 files, 398/398 tests passed.
- Focused production lifecycle and Electron launcher suite: 173/173 tests passed.
- Production activation rehearsal: 10/10 selected tests passed, including a real SIGKILL followed by activation recovery in a fresh Node process and retry after every finalization delete boundary.
- `npm run typecheck` and `git diff --check`: passed.
- The restricted-sandbox complete run failed only because loopback binds returned `EPERM`; the identical suite passed unchanged with loopback permission.

Final follow-up commit: `fix: gate production lifecycle on crash recovery`.

## Operational activation rehearsal follow-up

The production activation rehearsal is now a bundle-driven operational gate rather than a filtered test alias. It requires a canonical absolute `--bundle`, verifies the packaged content manifest before allocating state, refuses bundles inside live production paths, constructs an isolated home/install/data/database/manifest/lease plus dynamic loopback port, and runs the supplied bundle through stop proof, stage, real activation SIGKILL, fresh-process recovery, packaged daemon startup, strict default finalization, exact stop, and cleanup. It then runs the synthetic crash/race matrix and uses `process.exitCode` only after cleanup; an unproven daemon stop preserves the temporary state and fails with its path.

Lifecycle recovery now sweeps safe unreceipted stage bundles and all three staged launcher surfaces under the shared lease while preserving current, receipt-bound, and maintenance-journal-bound bundles. Finalization rejects foreign staged files before deleting rollback state. Every finalization deletion boundary—rollback bundle, three stages, receipt, and journal—is covered by real SIGKILL and abrupt-exit children followed by recovery in a new process. A rotated completion marker outside the install root makes the terminal journal/receipt deletion idempotent while the install root remains exactly `current` plus one bundle.

The final live proof imports the candidate's shared strict health classifier before applying receipt-specific identity checks. Staged wrappers render and attest the exact receipt lifecycle lease. Electron captures PID plus process-start identity after spawn, revalidates both immediately before SIGKILL, refuses PID reuse, and has a real SIGTERM-ignoring child proof.

Fresh operational verification:

- Workspace package: `npm run package:electron` passed; generated `out/` artifacts remained ignored.
- Operational rehearsal against the absolute workspace package passed, including isolated packaged daemon startup and 18/18 crash/race matrix cases.
- Complete Task 4 regression: 17 files, 420/420 tests passed with isolated loopback permission.
- Focused lifecycle, Electron, and rehearsal acceptance: 3 files, 195/195 tests passed.
- `npm run typecheck`, JavaScript syntax checks, and `git diff --check` passed.

Operational follow-up commit: `fix: make activation rehearsal operational`.

## Production lifecycle recovery gap closeout

The remaining production recovery gaps are closed without touching the installed production runtime or its data. Staging now persists a nonce-bound ownership intent before its first filesystem mutation, and every public lifecycle command reconciles that exact intent under the shared lifecycle lease. Recovery removes only paths named and validated by the intent or its bound receipt; malformed ownership evidence fails closed, and unrelated bundles are preserved.

Activation now has an explicit durable commit window: the prospective receipt is journaled before publication, the activated receipt is persisted, and the journal is then promoted to committed. Fresh-process SIGKILL tests cover `current`, instance launcher, lifecycle launcher, desktop entry, receipt publication, and commit publication. Finalization requires the candidate's strict health classifier plus `migrationState: ready`, scans the production, launcher, and desktop staging domains for foreign artifacts before deleting anything, and preserves rollback state whenever readiness or ownership proof fails.

Custom lifecycle lease paths are preserved through install, cold activation, transition recovery, start, and generated wrappers. A real six-child race releases install, stage, activate, finalize, start, and stop simultaneously; exactly one acquires the lease while the other five receive the exact lease refusal, and the winner is stopped before mutation. The operational rehearsal now uses the real default process scan for shutdown and proves the isolated baseline is offline before cleanup.

Fresh closeout verification from review base `baf0b7de347615ce15d1c7ae55b4e3f88e41b99e`:

- Focused production lifecycle and rehearsal suite: 2 files, 186/186 tests passed, exit 0.
- Complete Task 4 regression: 17 files, 433/433 tests passed with isolated loopback permission, exit 0.
- `npm run package:electron`: passed, exit 0; the packaged `masthead-production.js` is byte-identical to the source.
- Operational rehearsal against the absolute fresh package: passed, exit 0, including 23/23 selected crash/race cases and `{ "ok": true, "isolated": true, "matrix": true }`.
- Typecheck completed inside the successful package build; JavaScript syntax checks and `git diff --check` passed.

Closeout commit: `fix: close production lifecycle recovery gaps`.

## Lifecycle terminal-boundary security closeout

The final gate now treats receipt publication itself as durable pending lifecycle state. Staging writes an exact request-bound pending record before publishing the receipt, and fresh-process retries after receipt publication or intent removal return that same validated receipt; a different request fails before any production write. Activation's `activation-committed` journal is the sole commit authority: every earlier phase restores the old generation, while a fully attested committed journal can repair a missing or stale receipt after process death.

All real CLI entrypoints now carry `MASTHEAD_LIFECYCLE_LEASE`, including stage, normal install, and cold install. Two six-child `runCli` races prove normal transition and cold activation contend on the same custom lease as stage, activate, finalize, start, and stop. Finalization markers are stored in canonical, non-symlink, production-root-namespaced directories; rotation removes only markers whose embedded ownership matches that root. Candidate and rollback bundles are revalidated as canonical non-symlink direct children immediately before activation, recovery, finalization, and deletion.

The operational rehearsal validates its canonical temporary parent before allocation, rejects any parent inside live production state, and keeps allocation inside cleanup control. It drives the supplied package through JSON subprocess commands for stage, activate, start, finalize, and identity-bound stop, then proves the process set, health, port, and ownership are offline. Strict finalization retains exact protocol classification and adds only a short bounded retry when health is temporarily unavailable.

Fresh security-closeout verification from review base `57556c48c4cede141e90ca7df4ef5a8471cccf99`:

- Focused production lifecycle and rehearsal suite: 2 files, 203/203 tests passed, exit 0.
- Complete Task 4 regression after the final health-availability change: 17 files, 450/450 tests passed, exit 0.
- `npm run typecheck`, JavaScript syntax checks, and `git diff --check`: passed.
- `npm run package:electron`: passed; the bundled production lifecycle source is byte-identical to the workspace source.
- Operational rehearsal against the absolute rebuilt package: passed, including the packaged subprocess lifecycle and 25/25 selected crash/race cases; final result `{ "ok": true, "isolated": true, "matrix": true }`.
- Installed production runtime, data, processes, and installation were not touched.

Security-closeout commit: `fix: harden lifecycle terminal boundaries`.

## Durable package-bound recovery certification closeout

The final recovery gate now proves durable state at every required crash boundary instead of crediting callback emission. A literal, independent 24-case contract checks the current target, exact journal phase, artifact presence or absence, receipt authority, and the exact zero/three/removed stage-intent reservation states. Staging reserves all three nonce-bound paths before creating the first file, creates each file exclusively, syncs file bodies and parent directories, and recovers through request-specific quarantine only when regular-file, single-link, SHA-256, and mode authority all match. Mismatches remain preserved with their durable intent.

Every rehearsal subprocess is output-bounded and runs in a transient user cgroup. The supervisor snapshots the user cgroup tree before fixture work, scans every complete launch-cgroup subtree, and audits every newly created external unit. Only Electron's exact `app-masthead-<started-pid>.scope` is accepted as an expected migration; any other sibling unit stops certification and is preserved without signaling. Cleanup signals only launch-scope processes through a pidfd opened before the expected `/proc` start-time check, so no package-controlled health PID can enroll or kill unrelated processes and there is no numeric-PID fallback. Process-set uncertainty, output overflow, body failures, and cleanup failures preserve the exact fixture root and retain all causes, while the receipt-bound stop/status proof is still attempted for known daemons. Finalization also retries only unavailable or strictly malformed startup health for a bounded five seconds; incompatible protocol identities still fail immediately.

Fresh final verification:

- Rebuilt supplied package operational rehearsal: passed with real package start, exact live health/manifest/process identity, finalize, stop, offline proof, and all independently required 24/24 fresh-process crash cases. The result reported `source: "supplied-package"` and the exact ordered case IDs.
- Complete Task 4 regression: 17 files, 488/488 tests passed with isolated loopback and transient-cgroup permission.
- `npm run package:electron`: passed; packaged `masthead-production.js` is byte-identical to the workspace source.
- `npm run typecheck`, JavaScript syntax checks, isolated Python helper compilation, and `git diff --check`: passed.
- Installed production runtime, production data, production processes, and the production installation were not touched.

## Package-bound recovery certification and exclusive stage files

The three nonce-bound staging files are now created with exclusive filesystem opens. A preallocated file or symbolic link at the instance-launcher, lifecycle-launcher, or desktop staging path fails closed, remains unchanged, and is excluded from recovery cleanup; the remaining paths owned by the failed staging request are still reconciled.

The operational recovery matrix no longer invokes workspace tests or reports a boolean result. It dynamically imports the supplied bundle's lifecycle module with the supplied packaged Node runtime and executes an independently pinned set of 24 fresh-process crash cases: five staging boundaries, seven activation boundaries, and six finalization deletions under both `SIGKILL` and abrupt exit. Certification rejects a missing, duplicated, reordered, renamed, shortened, non-crashing, or broken-package case, and reports the exact source and executed IDs.

Fresh verification from review base `6f270659`:

- Focused production lifecycle and rehearsal suite: 2 files, 211/211 tests passed, exit 0.
- Complete Task 4 regression: 17 files, 458/458 tests passed, exit 0.
- `npm run typecheck`, JavaScript syntax checks, and `git diff --check`: passed.
- `npm run package:electron`: passed; the bundled production lifecycle source is byte-identical to the workspace source.
- Operational rehearsal against the absolute rebuilt package: passed, exit 0, with `source: "supplied-package"` and all 24/24 independently required cases executed.
- Installed production runtime, data, processes, and installation were not touched.

## Final package-bound containment closeout

The package rehearsal now distinguishes fixture ownership from unrelated desktop activity. Every subprocess runs inside a unique transient scope and reports its raw wait status through a parent-secret HMAC attestation, so an ordinary exit 137 cannot impersonate SIGKILL. Persistent Electron and daemon processes are admitted only after attested start output, exact health and manifest agreement, an exact `app-masthead-<start-pid>.scope` under the current user subtree, stable PID/start-time and cgroup reads, and the daemon's inherited per-run random token. Electron may scrub its own environment, but while it remains live its exact cgroup identity must match and the token-bearing daemon must be its direct child. Claimed external processes are observable but never supervisor-signaled; only processes still in supervisor-owned scopes can receive an identity-bound pidfd signal.

The former whole-user cgroup baseline was removed because normal Codex processes entering the existing Codex scope were falsely attributed to Masthead. Inspection is now bounded to registered rehearsal scopes plus exact claimed Masthead scopes, reconciled scope registrations are retired between commands, and allowed captured helpers may exit naturally without blocking later commands. Every claim, scan, output collection, health wait, and cleanup proof retains an independent hard deadline and count limit. Failed proofs preserve their isolated roots, while known candidate daemons still receive receipt-bound stop/status cleanup.

Fresh final verification:

- Complete Task 4 regression: 17 files, 497/497 tests passed with loopback and transient user-scope access.
- `npm run package:electron`: passed; packaged `masthead-production.js` is byte-identical to the workspace source.
- Fresh rebuilt-package rehearsal: passed real isolated activation, exact start/health/manifest/process capture, finalization, stop/offline proof, and all ordered 24/24 supplied-package crash cases.
- `npm run typecheck`, JavaScript syntax checks, isolated Python helper compilation, and `git diff --check`: passed.
- Successful rehearsal cleanup left no `app-masthead-*` scope or disposable package-rehearsal root. Installed production runtime, data, processes, and installation were not touched.

## Recovery review follow-up

The independent package-bound contract now covers 27 ordered fresh-process cases. Its eight staging cases include `instance-file-created`, `lifecycle-file-created`, and `desktop-file-created`, which terminate after exclusive creation and exact ownership checks but before the file fsync, so recovery is exercised at every production hook rather than only after each surface becomes durable.

Finalization fixture cleanup is registered before packaged startup begins. A health, manifest, cgroup-claim, or companion-inspection failure therefore still enters receipt-bound stop and status proof; stop and status are both attempted, their failures are retained, and the original body failure remains the primary cause. Transient process-scan attribution is retried inside the completed start's capture callback, so the successful fresh-start result is not discarded and converted into an incompatible `alreadyRunning` retry.

Focused review verification passed without running the rebuilt-package 27-case matrix; that final operational gate remains for release closeout. Installed production runtime, data, processes, and installation were not touched.

## Final reviewed package-bound closeout

The final recovery contract contains 31 ordered supplied-package cases. Staging now covers the unattested temporary-directory crash, durable empty-candidate ownership, completed temporary copy, atomic no-replace publication, post-copy verification, all three pre-fsync surface creations, every durable surface checkpoint, receipt publication, and intent removal. Candidate cleanup and successful staging both re-attest the exact reserved device/inode; a byte-identical foreign replacement remains preserved and blocks staging retry or activation, including receipt-exists recovery.

The operational supervisor no longer retries a whole `start` after a possibly successful launch. It retries bounded attribution inside the completed runner, attempts receipt-bound status even when stop fails, preserves both cleanup errors, and gives each package worker a bounded 60 seconds for repeated bundle, health, process, and containment proof.

Fresh final verification from package source `27eefafa6ce7b811f0cf441980815e2354fd4990`:

- Combined production launcher and rehearsal suites: 271/271 passed.
- TypeScript, Node syntax, and diff checks: passed.
- Electron package build: passed with bundled release SHA `27eefafa6ce7b811f0cf441980815e2354fd4990`.
- Rebuilt supplied-package operational rehearsal: passed all 31/31 exact ordered cases with `source: "supplied-package"`, real isolated start/health/manifest/process proof, finalization, stop, offline proof, and complete cleanup.
- Final independent review: no Critical, Important, or Minor findings.

Installed production runtime, data, processes, and installation were not touched.
