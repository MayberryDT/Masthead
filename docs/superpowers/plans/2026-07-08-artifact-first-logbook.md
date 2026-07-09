# Artifact-First Logbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Logbook an artifact book (session capsules, runbooks, ADRs, incident timelines) with multi-session provenance, per-artifact publish, and artifact-primary MCP — implementing GitHub issue #13 / ADR 0011.

**Architecture:** Evolve `session_artifacts` into multi-session knowledge artifacts with provenance rows, publication status, and signature/lineage. Workbench pipeline tracks compile-ready vs automatic-work-resolved via per-kind statuses (session package + runbook/ADR/timeline). Logbook and MCP read only published artifacts. Cutover wipes published/Logbook state rather than migrating session-row hits.

**Tech Stack:** TypeScript, SQLite migrations, vitest, mastheadctl CLI, React Logbook UI, MCP tools.

**Spec sources:** GitHub issue #13, `docs/adr/0011-artifact-first-logbook.md`, `CONTEXT.md`.

---

## File map (primary)

| Area | Files |
|------|--------|
| Migration | `src/daemon/db/migrations/018_artifact_first_logbook.sql`, `schema.ts` |
| Artifact store | `src/daemon/db/sessionArtifactRepository.ts` (+ tests) |
| Pipeline | `src/daemon/db/workbenchPipelineRepository.ts`, `workbenchPublicationSql.ts` |
| Workbench kinds | `src/workbench/types.ts`, `schemas.ts`, `validation.ts`, `instructions.ts`, `applyArtifact.ts`, `evidencePacket.ts` |
| CLI | `src/cli/workbench.ts`, `src/cli/__tests__/mastheadctl.test.ts` |
| Logbook API | new `logbookArtifactRepository.ts`, `server.ts`, `daemonClient.ts` |
| Logbook UI | `src/ui/logbook/*`, `src/app/logbook/*` |
| MCP | `src/mcp/tools.ts`, `server.ts` (tool list), tests |
| Cutover | CLI/data lifecycle wipe for published artifacts + pipeline publish state |
| Docs | OpenWiki + enrichment reference as needed |

---

## Task 1: Schema migration 018

**Files:**
- Create: `src/daemon/db/migrations/018_artifact_first_logbook.sql`
- Modify: `src/daemon/db/schema.ts`, `src/daemon/db/__tests__/schema.test.ts`

- [ ] Add migration that:
  1. Extends `session_artifacts` with: `publication_status` (`applied`|`published`), `signature_key`, `lineage_id`, `summary`, `highlight`, `confidence`, `project_label`, `join_rationale`, `published_at`
  2. Creates `session_artifact_provenance(artifact_id, session_id)` PK
  3. Backfills provenance from existing `session_id`
  4. Sets `lineage_id = artifact_id` where null
  5. Renames kind data `bug_fix_trace` → `runbook`
  6. Adds pipeline columns: `runbook_status`, `adr_status`, `incident_timeline_status`, `session_package_published_status`, `resolution_status`
  7. Maps `bug_fix_trace_status` → `runbook_status`
- [ ] Register migration version 18; update schema tests + criticalTables if needed
- [ ] Commit

## Task 2: Artifact repository multi-session + publish + lineage

**Files:**
- Modify: `sessionArtifactRepository.ts` + tests

- [ ] Kinds: `session_dossier` | `runbook` | `adr` | `incident_timeline`
- [ ] Apply accepts `provenanceSessionIds[]`, optional `signatureKey`, `joinRationale`, capsule fields
- [ ] Session dossier: provenance size must be 1
- [ ] Multi-session: require joinRationale when size > 1
- [ ] Signature supersede: same kind + signature_key → supersede current lineage
- [ ] `publishArtifact(artifactId)` sets publication_status published + published_at
- [ ] List/search published capsules; get body+provenance
- [ ] Tests: fingerprint idempotency, supersede, multi-session provenance, signature supersede, publish gate
- [ ] Commit

## Task 3: Workbench schemas, types, validation, instructions

**Files:** `types.ts`, `schemas.ts`, `validation.ts`, `instructions.ts` + tests

- [ ] Replace `bug_fix_trace` with `runbook`; add `adr`, `incident_timeline`
- [ ] Runbook body schema per issue #13 (envelope + core)
- [ ] ADR + incident timeline bodies per issue
- [ ] Validation: evidence refs in packet; joinRationale when multi; weak join fail-closed hooks
- [ ] Instructions: automatic handoff loop, signature-bounded expansion, N/A, contribution
- [ ] Commit

## Task 4: Evidence packets (single + multi-session)

**Files:** `evidencePacket.ts`, `types.ts` + tests

- [ ] Single-session packet unchanged for session package
- [ ] Multi-session packet from declared provenance set with size bounds
- [ ] Provenance candidate summaries for discovery (compact)
- [ ] Commit

## Task 5: Apply + pipeline resolution

**Files:** `applyArtifact.ts`, `workbenchPipelineRepository.ts`, queue, handoff + tests

- [ ] Apply multi-session kinds with provenance set
- [ ] Apply ≠ publish
- [ ] N/A for runbook/adr/timeline (session-relative only)
- [ ] Contribution satisfaction when seed in published multi-session provenance
- [ ] User-visible: compile-ready vs automatic work resolved
- [ ] Session package publish publishes session capsule/dossier
- [ ] Remove session-as-Logbook-row as primary publish eligibility
- [ ] Commit

## Task 6: CLI

**Files:** `src/cli/workbench.ts` + tests

- [ ] schema/validate/apply for new kinds
- [ ] `--provenance` / multi session for evidence/validate/apply
- [ ] `publish --artifact` and N/A / contribution status ops
- [ ] Keep disposable handoff plain language
- [ ] Commit

## Task 7: Logbook read model + API

**Files:** new repository, `server.ts`, `daemonClient.ts`, summary

- [ ] `/logbook/search` → published artifact capsules
- [ ] `/logbook/artifacts/:id` → body + provenance
- [ ] Kind filter + project/time facets
- [ ] Summary counts artifacts not sessions
- [ ] Commit

## Task 8: Logbook UI

**Files:** `src/ui/logbook/*`, `src/app/logbook/*`

- [ ] Table columns: kind, title/summary, project, confidence, published, provenance label
- [ ] Inspector shows artifact body
- [ ] Kind filter
- [ ] Surface contract: dense table + inspector (not live cards)
- [ ] Commit

## Task 9: MCP artifact-primary

**Files:** `src/mcp/*`

- [ ] `search_artifacts`, `get_artifact` (body + provenance)
- [ ] Keep session/transcript tools for evidence
- [ ] No write tools
- [ ] Commit

## Task 10: Cutover wipe + docs

- [ ] Wipe path for published artifacts + pipeline publish/resolution state
- [ ] Document in OpenWiki / reference
- [ ] Commit

## Task 11: Integration verification

- [ ] Full agent loop tests: apply → publish → Logbook/MCP read
- [ ] Fail-closed cases
- [ ] `npm test` green
- [ ] Finish branch (PR or merge options)

---

## Out of scope (do not implement)

Environment recipes, eval packs, dual Logbook mode, session-row migration, Now changes, write MCP, human clustering UI.
