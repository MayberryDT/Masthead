# Masthead Product Release Gate

This is the single current release checklist. Dated neighboring files are verification receipts,
not competing product contracts.

## Product identity

- [ ] README, PRD, OpenWiki, design, and product language describe Masthead as a local-first,
      harness-neutral session data layer for evidence-backed engineering knowledge.
- [ ] Sessions are described as capture, Workbench, evidence, and provenance units—not Logbook rows.
- [ ] Logbook and MCP reuse are artifact-primary.
- [ ] Now is presented as shallow live presence, not the product category.
- [ ] `npm run check:product-contract` passes.

## Fresh launch and compatibility

- [ ] No daemon running: `npm run dev` starts a compatible writable daemon and renderer.
- [ ] Healthy compatible primary daemon running: a secondary worktree uses a visibly read-only
      bridge rather than opening the primary database for writes.
- [ ] Legacy or incompatible daemon running: Masthead isolates or rejects it without showing a false
      connected state.
- [ ] The rendered page shows live/canonical data and does not show `No live connection` when the
      selected connector is healthy.
- [ ] `GET /health` reports compatible API, schema, build, capability, and database identity.

## Sources V2

- [ ] Sources shows the focused live connector set from `docs/reference/sources-v2.md`.
- [ ] Each connector truthfully reports discovery, enablement, activation, test, and readiness state.
- [ ] Install/repair preserves unrelated user hooks or plugins; uninstall removes only
      Masthead-managed entries.
- [ ] Codex activation explains and verifies hook trust.
- [ ] Source scans remain bounded to known paths and explicit overrides.
- [ ] Unsupported or unrecognized schemas stay visible as diagnostics and do not create fake
      transcript sessions.
- [ ] Sources does not present transcript import, import jobs, or artifact publication as its primary
      workflow.
- [ ] `npm run smoke:live` passes for the focused runtime set.

## Canonical session database

- [ ] Live events and supported history imports create runtime-scoped canonical session identities.
- [ ] Duplicate provider events and repeated imports do not duplicate canonical sessions.
- [ ] Source harness files remain externally owned and unchanged.
- [ ] Metadata import does not implicitly import transcript contents.
- [ ] Transcript import requires exact source-scoped permission and a linked session/source.
- [ ] SQLite is the canonical Masthead product store; legacy NDJSON is compatibility/migration input
      only.

## Now

- [ ] Now cards show truthful shallow state, runtime/source identity, last activity, and bounded
      counts without claiming artifact readiness.
- [ ] Fresh explicit live-state reports outrank historical inference.
- [ ] Quiet/completed-turn sessions become idle without Masthead claiming ownership of terminal state.
- [ ] Attention, blocked, stale, and inferred states expose evidence and uncertainty.
- [ ] Now does not become a transcript viewer, Workbench progress dashboard, or artifact browser.

## Workbench

- [ ] Captured sessions can be enrolled on the publish path without becoming Logbook rows.
- [ ] The UI is a dense operations table plus Activity rail with selection-driven actions.
- [ ] Transcript check is lightweight; transcript import remains explicit and permission-gated.
- [ ] Quality precheck/pass/fail, claim/release, disposable handoff, package publish, and Not Added
      review use the same canonical pipeline state as `mastheadctl`.
- [ ] User-facing handoffs contain plain-language agent work requests, not CLI recipes or tokens.
- [ ] Agent instructions and schemas exist for `session_enrichment`, `session_dossier`, `runbook`,
      `adr`, and `incident_timeline`.
- [ ] Single- and multi-session evidence packets validate all evidence refs against declared
      provenance.
- [ ] Apply does not publish.
- [ ] Session package publication creates the published session-dossier artifact capsule/body.
- [ ] Runbook, ADR, and incident timeline can each publish, resolve N/A without a row, or resolve by
      contribution to a published multi-session artifact.
- [ ] Automatic work resolved means package published plus every optional automatic kind published,
      N/A, or contribution-satisfied.
- [ ] Workbench Activity records claims, transcript/quality actions, validation, apply, publication,
      N/A, contribution, suppression, and failures with useful receipts.

## Logbook

- [ ] Every row returned by `GET /logbook/artifacts` is a published artifact capsule.
- [ ] Supported kinds are `session_dossier`, `runbook`, `adr`, and `incident_timeline`.
- [ ] Table columns are Kind, Title/Highlight, Project, Confidence, Provenance, and Published.
- [ ] Filters cover kind, project, date, and text search.
- [ ] Selecting a row opens its artifact body through `GET /logbook/artifacts/:artifactId`.
- [ ] Body detail always exposes provenance; multi-session artifacts expose join rationale and
      evidence refs.
- [ ] Logbook contains no session-row fallback, bulk selection, bulk enrich controls, Workbench
      process tracking, or session-era summary strip.
- [ ] An empty Logbook after artifact-state cutover explains that Workbench must publish artifacts.
- [ ] Restart does not duplicate or republish artifacts.

## Session evidence and dossier artifacts

- [ ] `GET /sessions/:sessionId/dossier` returns bounded canonical session evidence for Now,
      Workbench, and compile inspection.
- [ ] `GET /sessions/:sessionId/transcript` is paginated and reports coverage honestly.
- [ ] Hook-only and metadata-only sessions show coverage warnings rather than invented conversation.
- [ ] A published `session_dossier` artifact has exactly one provenance session and opens as an
      artifact body, not a session row.
- [ ] Missing canonical evidence never causes Logbook to fabricate an artifact.

## Read-only MCP

- [ ] Agent access config points `MASTHEAD_DB_PATH` at the active `masthead.sqlite`.
- [ ] `search_artifacts` and `get_artifact` are the preferred knowledge-reuse tools.
- [ ] Artifact results include kind, identity, body/capsule data, provenance, confidence, and bounded
      evidence references.
- [ ] Session, excerpt, transcript, project-history, and coverage tools remain available for
      evidence and compile.
- [ ] MCP cannot apply/publish artifacts, import sources/transcripts, change settings, mutate Git or
      files, execute shell commands, or delete Masthead data.
- [ ] Tool calls write MCP audit rows without mutating retrieved source evidence.
- [ ] `npm run smoke:mcp` passes.

## Settings and data ownership

- [ ] Settings uses the compact current surface and exposes Agent access as an inline category.
- [ ] Data export, retention, reset, and deletion identify the exact Masthead database and blast
      radius.
- [ ] Complete local deletion removes Masthead-owned data without touching harness history, Git,
      source files, shells, browsers, or external services.
- [ ] Optional remote model features remain off by default, scoped, redacted, previewable, and
      auditable.
- [ ] Packaged and development apps use distinct data directories and current version identity.

## Surface contract

- [ ] `design.md` remains the visual source of truth.
- [ ] Now uses live cards; Workbench uses an ops table/Activity rail; Logbook uses artifact
      table/inspector; Sources uses connector rows/detail; Settings uses one compact card.
- [ ] Affected surfaces have been inspected with the in-app Browser at desktop, tablet, and narrow
      mobile widths.
- [ ] No horizontal overflow, clipped controls, inaccessible focus states, or leftover development
      citations are present.
- [ ] `npm run check:surface-contract` and `npm run verify:no-citations` pass.

## Automated verification

- [ ] `npm run doctor`
- [ ] `npm run verify`
- [ ] `npm run test:electron`
- [ ] `npm run test:electron-security`
- [ ] `npm run smoke:electron`
- [ ] `npm run smoke:electron:packaged`
- [ ] GitHub Actions passes for the release commit.
- [ ] Any environment-dependent skipped or failed gate is recorded with exact command, failure, and
      follow-up owner; release status does not silently treat it as passed.

## Release hygiene

- [ ] `package.json` is the version source of truth and `npm run version:sync` passes.
- [ ] The changelog describes the artifact-first product and current release behavior.
- [ ] GitHub About text, topics, README, and linked website metadata use the current positioning.
- [ ] Production installation keeps only the current bundle.
- [ ] The development data directory keeps one active database and at most one backup snapshot.
- [ ] Merged/abandoned worktrees are removed according to `AGENTS.md`.
