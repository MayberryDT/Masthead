# Runaway import repair design

## Problem

An overnight Codex history import left Masthead at 78 of 1,708 work units while consuming most of a CPU core and growing `masthead.sqlite` to roughly 138 GB. The production process is stopped. Inspection identified four coupled defects:

1. `GET /sources/setup` builds and persists a fresh, multi-megabyte setup snapshot. The application polls that route every 1.5 seconds while an import is active, producing 14,164 historical rows and nearly all of the database growth.
2. Every imported adapter record runs the artifact-candidate quality gate. That gate recounts all transcript evidence for the session, making large single-session transcript imports effectively quadratic.
3. Import progress is durable only at whole-file completion. The UI shows completed files rather than records within the active file, and a restart replays the active file because its byte cursor is only written at EOF.
4. Workbench and sidebar counters discard or retain useful values during refresh, showing `...` or stale totals even when the daemon has authoritative counts.

## Design

### Source setup state is bounded and reads are pure

`GET /sources/setup` and `GET /sources/advanced` will build the current response without saving it. Mutation routes may save setup state, but `saveSourceSetupState` will retain one current snapshot rather than an unbounded timestamp history. Active-import polling will request import status only; it will refresh source inventory once when a job transitions to a terminal state.

Invariants:

- Repeated source setup reads do not modify the database.
- Repeated setup saves leave exactly one `source_setup_state` row.
- An active import poll does not scan sources or request the large setup payload.

### Candidate evaluation happens at hydration boundaries

Adapter record materialization will remain a narrow persistence operation. It will not execute the artifact-candidate gate per record. The import runner already collects touched session IDs and invokes `onSessionHydrated` after a work unit; that boundary will perform candidate reconciliation once per touched session. Live event ingestion retains its existing event-boundary admission behavior.

Invariants:

- A transcript file with N records does not run N transcript-wide evidence counts.
- Candidate sessions enter Workbench and noise enters Not Added after the file has been hydrated.
- Search indexing, import impact recording, and final reconciliation remain intact.

### Progress and cursors are checkpointed in bounded batches

The import runner will report a checkpoint after a bounded number of processed records rather than writing work-unit progress after every record. A checkpoint contains current processed/imported/failed counts and the latest adapter record cursor. The server will use it to:

- update the active work unit,
- update public import-job record counts and heartbeat,
- persist a source cursor that can resume inside the active file.

Final completion performs the same operations synchronously. Checkpoints must be monotonic and restart-safe. The batching interval should limit write amplification while keeping visible progress fresh; 250 records is the initial bound, with a final flush at EOF or failure.

### UI retains authoritative values during refresh

Workbench will retain the latest known package-path total while a background refresh is running. It will use an ellipsis only before the first total is available. The knowledge-flow hook will likewise retain its last successful summary during background refreshes and transient errors. Active import polling will update the existing progress presentation from record-level daemon counts without forcing source discovery.

### Production recovery

The stopped 138 GB database is the source of truth until recovery is proven. After code verification and before launching Masthead:

1. Copy the database through SQLite into a new compact database while retaining all rows except obsolete `source_setup_state` snapshots.
2. Run `PRAGMA quick_check` and compare table counts and key Workbench/import aggregates between old and new databases.
3. Atomically place the compact database at the production path, start the verified bundle, and verify health, counts, bounded setup state, CPU/write stability, import checkpoint movement, and restart resumption.
4. Remove the bloated original only after those checks pass, leaving one active database and no retained 138 GB bloat.

The production install directory will contain only the newly verified versioned bundle plus the `current` symlink, per repository disk-hygiene rules.

## Non-goals

- Changing the artifact-candidate policy thresholds.
- Reworking the Workbench layout or animation.
- Replacing the import ledger or adapter formats.
- Wiping user sessions, Workbench state, or published artifacts.

## Verification

- Focused repository, server API, import runner, source controller, Workbench, and sidebar tests reproduce each regression and pass after the fix.
- Full `npm run verify` passes.
- A packaged Electron production build passes packaged smoke checks.
- The recovered production database passes integrity/count comparisons.
- Runtime observation shows stable database size, bounded source setup rows, visible record-level progress, and a cursor that advances within the large active transcript.
