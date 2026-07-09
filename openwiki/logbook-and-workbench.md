# Logbook and Workbench (artifact-first)

**Decisions:** [ADR 0011](../docs/adr/0011-artifact-first-logbook.md) (Logbook unit), [ADR 0009](../docs/adr/0009-logbook-only-shows-published-sessions.md) (Workbench pipeline ownership).  
**Language:** `CONTEXT.md`.  
**Cutover:** [artifact-first-logbook-cutover.md](../docs/reference/artifact-first-logbook-cutover.md).  
**UI plan (history):** `docs/superpowers/plans/2026-07-09-logbook-workbench-artifact-ui.md`.

## One-line split

| Surface | Unit | Job |
|---------|------|-----|
| **Now** | Live session card | Shallow running/idle/attention |
| **Workbench** | Captured **session** on package path | Transcript, quality, compile handoff, multi-kind resolution |
| **Logbook** | Published **artifact** | Search/browse/open knowledge capsules |

Sessions never become Logbook rows. Provenance points back to sessions.

## Logbook (locked UI)

- **Row** = published artifact only (`session_dossier`, `runbook`, `adr`, `incident_timeline`).
- **Columns:** Kind · Title/Highlight · Project · Conf · Provenance · Published.
- **Layout:** left capsule table, right inspector = **body + always-visible provenance** (join rationale when multi-session).
- **Filters:** kind · project · date · search (no runtime/model primary, no bulk enrich, no checkboxes, no summary strip).
- **Empty after wipe:** normal until Workbench republishes.

### Code map

| Concern | Where |
|---------|--------|
| Columns / row / table / toolbar / inspector | `src/ui/logbook/` |
| Controller (search + `getLogbookArtifact` detail) | `src/app/logbook/useLogbookController.ts` |
| Client search/detail | `src/app/daemonClient.ts` (`searchLogbook` → `/logbook/artifacts`) |
| Store | `src/daemon/db/sessionArtifactRepository.ts`, `logbookArtifactRepository.ts` |
| HTTP | `GET /logbook/artifacts`, `GET /logbook/artifacts/:artifactId` |

## Workbench (package + multi-kind)

Default automatic kind set for a seed session:

1. **Session package** (dossier capsule) — always on the package path.
2. **Runbook**, **ADR**, **incident timeline** — when evidence supports them; else **N/A** (no Logbook row).

User-visible session states: **compile-ready** vs **automatic work resolved** (package published + kinds published or N/A).

### Locked UI vocabulary

- Columns include enrichment, dossier, **package**, runbook, adr, timeline, **resolution**.
- Primary publish control: **Publish package** (dossier capsule when gates pass). Automatic kinds still need apply/publish or N/A for full resolution.
- Handoff opens with multi-kind framing (session package always; runbook/ADR/timeline when evidence supports them). No CLI recipes in handoff body.
- Apply ≠ publish.

### Code map

| Concern | Where |
|---------|--------|
| Panel / tooltips / columns | `src/ui/workbench/WorkbenchPanel.tsx` |
| Handoff text | `src/ui/workbench/workbenchHandoff.ts` |
| Controller | `src/app/workbench/useWorkbenchController.ts` |
| Pipeline | `src/workbench/` |
| CLI | `src/cli/` (`mastheadctl` workbench commands) |

## MCP (artifact-primary)

Prefer for reuse:

- `search_artifacts` — published capsules by query/kind/project.
- `get_artifact` — body + provenance + evidence refs.

Session tools (`search_sessions`, `get_session`, transcript/excerpts) remain for compile evidence, not the primary memory API. See `docs/reference/mcp-tools.md`.

## Anti-patterns for agents

- Do not reintroduce Logbook bulk enrich, row checkboxes, or summary metrics strip.
- Do not treat “published session” as a Logbook search hit.
- Do not document Logbook as a session library or dual session/artifact browser.
- Do not put Workbench process tracking into Logbook.
- Plans under `docs/superpowers/plans/` are history, not the live product contract.
