# Masthead Product Release Gate

This is the current release checklist for `workbench-authoring-v5`. Earlier V1–V4 acceptance and
canary worksheets are historical evidence only; they do not authorize new authoring, production
recovery, or dogfood rollout.

## Release identity

- [ ] `package.json` is the version source of truth and `npm run version:sync` passes.
- [ ] The packaged daemon, Electron shell, installed `mastheadctl`, instance manifest, health
      response, Doctor, and `workbench capabilities --json` report one build SHA, database ID,
      manifest path, base URL, instance ID, and `workbench-authoring-v5` contract.
- [ ] The capability operations are exactly `bootstrap`, `start`, `claim`, `inspect`, `scaffold`,
      `save`, `finish`, `status`, and `receipt`; pack bounds are 5–12.
- [ ] **Copy Agent Prompt** creates one V5 request from the compile-ready selection, discloses
      excluded review-needed rows, and copies only its request ID plus instance-bound start command.

## Frozen authoring boundary

- [ ] Agent owns title, description, keywords, purpose, outcome, key work, honest verification, and
      optional-artifact judgment; Masthead emits identity, evidence catalogs, blank fields, validation,
      Activity, atomic publication, and receipts, but no enrichment prose.
- [ ] Full selection is the job. The daemon fixes pack membership and the agent continues until the
      immutable request receipt exists; resume only recovers a crash under the same request ID.
- [ ] Save classifies each session independently as `publishable`, `soft_flag`, or `hard_reject`.
      Hard rejects skip publication and continue; soft flags may publish with Activity warnings.
- [ ] Knowledge opportunities are nonbinding. Every pack records grounded yes/no optional
      consideration, yes may include a draft, and no never blocks dossier publication.
- [ ] Accepted enrichment is applied before the daemon rebuilds `canonical-session-dossier-v1`;
      agents cannot submit a dossier body.
- [ ] Logbook and MCP rank agent-authored title, description, and keywords ahead of the complete
      immutable body. MCP remains read-only and artifact-primary.

## Kill list

The release fails if any live V5 path contains or requires:

- operator canary or approval;
- required knowledge-opportunity dispositions;
- a campaign-wide `needs_revision` halt;
- Masthead-written enrichment prose or keyword invention;
- mandatory runbook, ADR, or incident-timeline output per session;
- supervisor, worker, or nested-author product architecture.

Historical V4 tables, DTOs, reviews, and copy may retain those words only when clearly labeled as
audit history. They must never be advertised by current health, capabilities, CLI help, Workbench,
or release instructions.

## Legacy retirement and audit

- [ ] New request creation writes only `workbench-authoring-v5` rows.
- [ ] V1–V4 start, progress-recording inspect, submit/save, canary decision, and finish routes return
      HTTP 409 `authoring_contract_retired` before claims, enrichment, artifacts, or Activity writes.
- [ ] Historical run/request status, evidence, context, assignment review, operator review, and
      receipts remain readable with their original contract labels.
- [ ] Open V4 campaigns remain read-only or are abandoned; no row is relabeled or resumed as V5.

## Production lifecycle

- [ ] Electron allows the same five-minute startup-health budget as the production lifecycle, so a
      real large database is not killed after eight seconds while opening or migrating.
- [ ] Automatic compatibility-sentinel cleanup accepts only an exact canonical V4 sentinel owned by
      the current user, with safe mode/link/type/size, valid token and timestamp, a dead PID, exclusive
      SQLite leases, fd-bound inode proof, atomic quarantine preservation, and a final dead-PID check. Malformed,
      live, symlinked, replaced, or identity-drifting sentinels are preserved and startup fails closed.
- [ ] Launcher/lifecycle regressions, production activation rehearsal, and packaged Electron smoke
      pass against isolated paths before the live install.
- [ ] Production activation rehearsal runs only inside a cookie-gated private Xvfb display with a
      private runtime directory. Electron and daemon children inherit no real display, Wayland,
      authority, or desktop-session bus route; Electron creates no window or tray; all child and
      Xvfb identities are stopped and proved absent before the private display root is removed.
- [ ] Production installation uses the verified stage → offline proof → activate → start/health proof
      → finalize process in `docs/reference/production-cold-activation.md`.
- [ ] Finalization leaves exactly one versioned production bundle, `current` points to it, no staged
      receipt/journal/helper remains, and the database directory contains one active database plus at
      most one sibling backup.
- [ ] An activated candidate without matching healthy startup proof can be superseded only through
      receipt-bound `abort`; abort proves the candidate process set empty, restores the prior bundle
      and database identity when needed, resumes after interruption, cleans abandoned migration
      stages, and permits a newer stage without manual deletion or fabricated startup proof.

## Automated release candidate gates

- [ ] Focused Electron launcher, production lifecycle, Doctor/health, V5 API/service/CLI, handoff,
      retirement, and search tests pass.
- [ ] Full serial Vitest suite passes with zero failures.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` and `npm run build:desktop` pass.
- [ ] `npm run check:product-contract`, `npm run check:surface-contract`,
      `npm run check:endpoint-matrix`, and `npm run verify:no-citations` pass.
- [ ] `npm run smoke` and the packaged Electron smoke pass.
- [ ] An independent standards review and frozen-spec review of the full V5 branch have no unresolved
      release-blocking findings.

## Manual production smoke on the real large database

- [ ] Normal installed launch reaches healthy app and daemon without an eight-second self-kill.
- [ ] Health, manifest, process identity, installed CLI, and capabilities agree on the current build,
      database, base URL, instance path, and `workbench-authoring-v5`.
- [ ] Doctor passes the live authoring identity and operation contract.
- [ ] Workbench renders sessions from the real database without `No live connection`.
- [ ] **Copy Agent Prompt** creates a V5 request and produces the thin request-ID/start-command packet.
      Stop before claiming or enriching its first pack; S6 does not start S7 selection work.
- [ ] Logbook is not wiped or rebuilt without explicit user confirmation.

## Dogfood gates (S7 only)

These gates validate the release after S6 installation. They are not canaries or approval checkpoints;
each run is an autonomous proof that the selected request completes without operator intervention.

### 10 sessions

- [ ] All 10 attempted, at least 8 published, and any rejects appear in Activity without stopping the
      request.
- [ ] Every published dossier has a specific title, description, and at least three keywords.
- [ ] MCP keyword search finds at least three distinct published sessions.
- [ ] One paste starts the agent and no operator relay is required before the completion receipt.

### 50 sessions

- [ ] All 50 attempted and at least 45 published, with the same dossier and keyword-retrieval bar.
- [ ] Every pack records at least one grounded optional consideration, yes or no with reason.
- [ ] Wall-clock time and final receipt counts are recorded; there is no hard SLA yet.

### Full selection

- [ ] One durable request covers the complete intended selection and runs until its immutable receipt
      exists; completed packs remain published across any crash/resume.
- [ ] The receipt reports attempted, published, soft-flagged, rejected, optional published, and
      considered-no totals, and those totals reconcile with Workbench Activity and Logbook.

The 10/50/full sequence proves increasing scale, but the full selection remains the product job.
