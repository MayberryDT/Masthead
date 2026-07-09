# Artifact-first Logbook cutover

Local dogfood may wipe published Logbook/artifact state rather than migrate session-row Logbook hits.

## Wipe command

```bash
node dist/daemon/src/cli/mastheadctl.js workbench wipe-published --confirm --json
```

This deletes all `session_artifacts` and provenance rows and resets pipeline publish/resolution fields while leaving harness source session history on disk.

## Rebuild path

1. Enroll missing Workbench sessions.
2. Run the automatic kind set (session package + runbook/ADR/timeline) via disposable handoff or directed agent.
3. Publish artifacts after validate/apply.

See ADR 0011 and CONTEXT.md for product vocabulary.
