# Legacy production cold activation

`install --cold-activate` exists only for the one-way boundary from a legacy production bundle that predates Masthead release manifests and pinned launcher digests. It does not infer or fabricate a legacy release identity, and it never executes the legacy bundle.

Use the normal verified install path whenever the current bundle has a valid release manifest and pinned launcher digest. The cold path requires all of the following before it changes the database or `current` symlink:

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

Before offline maintenance begins, Masthead atomically installs a disabled launcher and desktop entry. The durable schema-v2 transition journal records `rollbackMode: offline_only`, the candidate identity, database identity and source/target schema, nonce, exact snapshot, and the legacy directory's path/device/inode identity. It never contains an `oldBundle` release identity.

The disabled launcher rejects every mutating command and launch attempt with exit code 78. Its read-only `status` command remains available and reports whether the cold transition journal is pending without executing either bundle.

Before the commit point, Masthead keeps the launcher disabled, stops only an exact receipt-bound candidate maintenance child with SIGTERM, proves candidate processes are stopped, restores the exact receipt-bound database snapshot, revalidates the legacy filesystem identity, restores `current` to that legacy path, and proves the system offline. It then durably completes the journal. It never starts the legacy bundle automatically. If a pre-commit stop, restore, identity, or offline proof fails, the journal remains and neither bundle is launched.

Durable journal completion is the success commit point. Obsolete bundle deletion happens afterward and never triggers rollback: if that success-only cleanup fails, the strictly verified candidate remains running with its normal pinned launcher, the completed journal remains removed, and the legacy bundle may remain on disk for a later cleanup attempt.

An ordinary `start` or `install` refuses a pending offline-only journal. Rerun the identical `install --cold-activate` command to perform deterministic recovery. A successful cold activation requires strict candidate health and process topology before journal completion; only then are obsolete bundles cleaned up and the normal pinned launcher retained.
