# Workbench Authoring Acceptance Evidence

Masthead’s live V1 authoring path is daemon-owned. Workbench gives the user a
plain-language handoff; the installed CLI transports agent requests to the
active daemon; one durable run owns complete evidence, bundle validation,
atomic publication, and the completion report.

## Contract evidence

| Requirement | Authoritative evidence |
| --- | --- |
| CLI does not open SQLite for normal authoring | `src/cli/authoringClient.ts` implements daemon HTTP; `src/cli/workbenchAuthoring.ts` routes capabilities/open/status/evidence/submit/finish through that client. Direct database access remains only in explicit `wipe-published` maintenance. |
| Database identity is checked before work | Capabilities and open API/CLI tests reject a different identity before claims or artifact rows. The real dogfood passes the capabilities identity to open and reports `databaseIdentityMatched: true`. |
| One run and claim set | Authoring service/repository tests and the ops dogfood repeat open for the same actor/exact session set and observe one run plus one live claim. |
| Complete redacted evidence | Evidence catalog tests cover manifest counts, full text, query, ascending/descending pagination, and revision changes. The real dogfood reads 500/500 unique items in both orders and observes decisive evidence after item 480. |
| Grounded bundle validation | `src/workbench/authoring/__tests__/authoringValidation.test.ts` covers schema, provenance, claim evidence, confidence, N/A, contribution, automatic-kind resolution, secrets, and signatures. |
| Submit is non-mutating | Service/API tests and both dogfoods assert zero new `session_enrichments` and `session_artifacts` rows after submit. |
| Finish is atomic and idempotent | Authoring service tests inject invariant failures and assert full rollback; repeat finish returns the stored receipt. The dogfoods prove the same receipt after immediate retry and daemon restart. |
| Publication is artifact-first | Every receipt artifact is fetched from `GET /logbook/artifacts/:id`; the receipt contains a dossier and runbook, while ADR and incident timeline are N/A. No session row is used as a Logbook hit. |
| Full-body reuse | Both dogfoods search a phrase present only in a runbook body. The long-session dogfood also reads that artifact through real MCP stdio. |
| MCP stays read-only | MCP tool catalog tests and Doctor reject mutation tools; authoring remains daemon HTTP only. |

## Real long-session dogfood

Commands:

```bash
npm run install:electron-dev-launcher
npm run build:daemon
node scripts/dogfood-workbench-v1.js
```

The script starts a writable daemon on an ephemeral loopback port with a
temporary schema-21 database. It invokes the built thin CLI with
`MASTHEAD_DAEMON_URL`, never opens that database from the CLI, and deletes the
temporary directory unless `MASTHEAD_KEEP_DOGFOOD_DB` is set.

Observed on 2026-07-10:

```json
{
  "ok": true,
  "databaseIdentityMatched": true,
  "evidence": {
    "totalItems": 500,
    "uniqueItemsRead": 500,
    "lateOutcomeObserved": true
  },
  "submission": {
    "accepted": true,
    "artifactsBeforeFinish": 0
  },
  "finish": {
    "publishedArtifacts": 2,
    "resolvedSessions": 1,
    "runbook": "published",
    "adr": "not_applicable",
    "incidentTimeline": "not_applicable",
    "idempotentRetry": true
  },
  "reuse": {
    "logbookBodySearch": true,
    "mcpArtifactRead": true
  }
}
```

The decisive outcome is evidence item 497 and the passed verification is item
500. The dossier and runbook cite those late refs, so a regression to an early
bounded preview makes the dogfood fail.

## User surface evidence

- `src/ui/workbench/__tests__/workbenchHandoff.test.ts` proves copied handoffs
  use the capabilities-reported command metadata internally, ask for unattended
  completion, and contain neither a shell recipe nor a privacy permission gate.
- Workbench panel/controller tests prove the dense session table, selection,
  Activity rail, Not Added summary, and one plain-language copy action.
- Session Dossier and Workbench UI token guards keep CLI commands and generated
  file recipes out of rendered user copy.
- Copied handoff and directed work share the same daemon contract and bundle
  validator; there is no conservative handoff-only quality mode.

## Focused checks

The acceptance implementation includes focused tests for the authoring service,
API, thin CLI, installed launchers, automatic handoff, complete evidence,
grounded validation, artifact body search/rendering, endpoint policy, and Doctor
authoring validation. The full release-gate result is recorded in
`docs/acceptance/product-release-gate.md`.
