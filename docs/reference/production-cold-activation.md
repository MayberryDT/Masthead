# Legacy production cold activation

`install --cold-activate` exists only for the one-way boundary from a legacy production bundle that predates Masthead release manifests and pinned launcher digests. It does not infer or fabricate a legacy release identity, and it never executes the legacy bundle.

Use the normal verified install path whenever the current bundle has a valid release manifest and pinned launcher digest. The cold path requires all of the following before it changes the database or `current` symlink:

Normal Electron startup has a five-minute health deadline. A staged activation prepares and validates
an existing database with the candidate's offline transition maintenance before changing `current`;
startup then verifies the receipt-bound database identity and target schema instead of spending its
health budget on backup or migration work.

Normal writable startup may clear only a proven-stale canonical V4 compatibility sentinel. The
database-writer and runtime SQLite leases must already be exclusive; the sentinel must be a regular,
single-link, current-user file with safe mode and bounded size, valid protocol/token/timestamp, and a
dead PID. Cleanup binds the bytes to an open no-follow file descriptor, atomically quarantines the
pathname, rechecks inode and PID, and preserves that quarantined inode under its unique name. A malformed, live,
symlinked, replaced, or identity-drifting sentinel is preserved and startup fails closed.

The normal install can also be driven as explicit filesystem phases. `stage --bundle <path>` writes a durable receipt without changing the active surface; after the old daemon is proved stopped, `activate --receipt <path>` prepares the database under the lifecycle and database leases, records its identity and source/target schema in the receipt, then switches the attested files. After the new daemon has published a fresh matching instance manifest, `finalize --receipt <path>` removes the receipt, staged files, and every obsolete production install artifact. Finalize fails closed before that startup proof exists, so it cannot delete the rollback bundle immediately after activation.

If an activated candidate never produces matching healthy startup proof, `abort --receipt <path>` is the only supported supersession path. It acquires the receipt's lifecycle lease, rejects a wrong or finalized receipt, rejects matching live health or any remaining production process, re-attests the candidate and prior finalized bundle, and restores a prepared database from the nonce-bound transition snapshot unless the journal already durably records and re-verifies that exact source snapshot as restored. It then restores `current` and the prior launch surfaces, completes the database transition, removes only the failed candidate and receipt-owned stages, deletes abandoned migration/recovery stages and excess backups under the database/runtime leases, and retains one active database plus at most `backup-current`. Every boundary is journaled; rerunning the same command resumes an interrupted abort or returns its receipt-hash completion result without repeating a database promotion. Ordinary `start`, `stage`, `install`, and `finalize` remain blocked while an abort journal is pending.

Headless activation proof must be supervised by `scripts/masthead-private-display.js`. It creates a
unique cookie-gated Xvfb display and private runtime, removes every real X11, Wayland, authority, and
desktop-session route from lifecycle children, and enables Electron's no-window main-process daemon
boot. The supervisor owns the complete start, health, finalize, verification, and stop interval; it
proves Electron, daemon, and Xvfb processes absent before removing the private display state. There
is no fallback to a visible Electron launch when this isolation proof fails.

- the candidate bundle and release identity verify completely;
- the current legacy path is a real, non-symlink, versioned direct child of the production root;
- production health is absent and the exact production process set is empty;
- the production port is bindable;
- exclusive daemon-equivalent database ownership succeeds.

Invoke it with explicit paths:

```bash
node scripts/masthead-production.js install \
  --cold-activate \
  --bundle /absolute/path/to/Masthead-linux-x64-VERSION \
  --bundle-digest FULL_64_HEX_DIGEST \
  --data-dir /absolute/path/to/data \
  --db-path /absolute/path/to/data/masthead.sqlite \
  --production-root /absolute/path/to/masthead-production
```

Before offline maintenance begins, Masthead atomically installs a disabled launcher and desktop entry, then repeats the complete offline/process/port/ownership proof to close the launch race at that boundary. The durable schema-v2 transition journal records `rollbackMode: offline_only`, the candidate identity, database identity and source/target schema, nonce, exact snapshot, and the legacy directory's path/device/inode identity. It never contains an `oldBundle` release identity.

Offline prepare and restore each have a twelve-hour hard deadline, separate from the five-minute startup-health deadline. The bound covers multiple full-size database passes: snapshot backup, full integrity verification, SHA-256 hashing, migration and validation, plus a possible receipt-bound restore. On timeout Masthead sends `SIGTERM` only after revalidating the exact child PID/start identity; it never sends `SIGKILL`.

The cold lifecycle parent captures the maintenance child's exact compatibility sentinel while that child is still alive. After the exact child exit is proven, it may clear only that captured stale sentinel from the canonical pathname: canonical database and runtime SQLite leases must both be held, the child PID must be absent, production must be offline, and the no-follow regular single-link sentinel must still match its exact path, device, inode, owner, size, mode, bytes, protocol, PID and token. At the cleanup boundary it atomically renames the pathname to a unique same-directory quarantine, revalidates the moved inode through a no-follow file descriptor, and preserves that inode for explicit offline cleanup. A mismatched replacement is restored or preserved without overwriting a newer canonical sentinel. It then verifies canonical absence, repeats the runtime-offline proof, releases the leases and runs the normal full ownership probe. Any missing proof, busy lease, live/reused PID or sentinel replacement leaves production disabled and preserves the replacement.

The disabled launcher rejects every mutating command and launch attempt with exit code 78. Its read-only `status` command remains available and reports whether the cold transition journal is pending without executing either bundle.

Before the commit point, Masthead keeps the launcher disabled, stops only an exact receipt-bound candidate maintenance child with SIGTERM, proves candidate processes are stopped, restores the exact receipt-bound database snapshot, revalidates the legacy filesystem identity, restores `current` to that legacy path, and proves the system offline. It then durably completes the journal. It never starts the legacy bundle automatically. If a pre-commit stop, restore, identity, or offline proof fails, the journal remains and neither bundle is launched.

Immediately before durable completion, Masthead re-attests both bundle filesystem identities and re-proves matching candidate health plus the exact one-Electron/one-daemon topology. Durable journal completion is the success commit point. Obsolete bundle deletion happens afterward and never triggers rollback: if that success-only cleanup fails, the strictly verified candidate remains running with its normal pinned launcher, the completed journal remains removed, and the legacy bundle may remain on disk for a later cleanup attempt.

An ordinary `start` or `install` refuses a pending offline-only journal. Rerun the identical `install --cold-activate` command to perform deterministic recovery. A successful cold activation requires strict candidate health and process topology before journal completion; only then are obsolete bundles cleaned up and the normal pinned launcher retained.
