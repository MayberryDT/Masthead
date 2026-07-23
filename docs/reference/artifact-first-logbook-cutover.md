# Artifact-first Logbook cutover

Local dogfood may wipe published Logbook/artifact state rather than migrate session-row Logbook hits.

## Wipe command

```bash
node dist/daemon/src/cli/mastheadctl.js workbench wipe-published --confirm --json
```

This deletes all `session_artifacts` and provenance rows and resets pipeline publish/resolution fields while leaving harness source session history on disk.

## V5 rebuild path

The current runtime provides the V5 evidence, identity, flag-and-continue, and atomic publication
guarantees below. V1–V4 remain audit-only and cannot run or resume a production rebuild. Production
work still requires the release evidence in `docs/acceptance/product-release-gate.md`.

1. Enroll missing Workbench sessions.
2. Create a durable guided authoring request for the compile-ready selection and give the agent its
   request ID plus instance-bound start command.
3. Let Masthead group the complete selection into fixed packs of 5–12 sessions, return blank
   evidence-catalog scaffolds, and classify each agent-authored session independently.
4. Atomically finish every pack to rebuild passing dossiers, record soft flags and hard rejects, and
   publish any useful runbooks, ADRs, or incident timelines until the request receipt is complete.

There is no V5 canary, operator approval, required opportunity disposition, or campaign-wide
`needs_revision` stop.

See ADR 0011 and CONTEXT.md for product vocabulary.
