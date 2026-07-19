# Artifact-first Logbook cutover

Local dogfood may wipe published Logbook/artifact state rather than migrate session-row Logbook hits.

## Wipe command

```bash
node dist/daemon/src/cli/mastheadctl.js workbench wipe-published --confirm --json
```

This deletes all `session_artifacts` and provenance rows and resets pipeline publish/resolution fields while leaving harness source session history on disk.

## Accepted V4 rebuild path — pending implementation

The installed runtime still exposes V3 authoring compatibility, but it does not provide the guided
evidence, canary, identity, and quality guarantees below. Do not use V3 for a new bulk or production
rebuild during the cutover. Execute this rebuild path only after the V4 service, API, CLI, launcher,
Workbench review, and legacy-route retirement have landed and passed their release gates.

1. Enroll missing Workbench sessions.
2. Create a durable guided authoring request for the compile-ready selection and give the agent its
   request ID plus instance-bound start command.
3. Let Masthead group assignments, record complete evidence traversal, review grounded enrichment and
   knowledge-opportunity dispositions, and stage the three-session canary.
4. After operator approval, atomically finish accepted assignments to rebuild dossiers and publish any
   useful runbooks, ADRs, or incident timelines.

Masthead never splits a larger strong opportunity group to manufacture the canary. It chooses a
complete group of at most three sessions or diverse dossier-only sessions; otherwise request creation
returns `guided_canary_not_constructible` and persists nothing.

See ADR 0011 and CONTEXT.md for product vocabulary.
