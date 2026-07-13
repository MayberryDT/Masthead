# Logbook and Workbench (artifact-first)

**Decisions:** [ADR 0011](../docs/adr/0011-artifact-first-logbook.md) (Logbook unit), [ADR 0012](../docs/adr/0012-daemon-owned-artifact-authoring.md) (daemon seam), [ADR 0013](../docs/adr/0013-canonical-dossier-and-candidate-authoring.md) (canonical dossier and candidate-driven V2), [ADR 0009](../docs/adr/0009-logbook-only-shows-published-sessions.md) (Workbench pipeline ownership).

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

## Clean-install history intake

The app-level first-run coordinator may start a one-time Workbench-owned history import after live
connector setup. **Everything** means every discovered supported history unit, with no hidden recent
cap; the recent option is the only bounded range. Each runtime uses one durable transcript job that
materializes canonical session identity and evidence together.

Jobs survive restart under the same id. Completed work units are not repeated, interrupted units
return to the queue, and the coordinator restores Import history / Reconcile progress until the
jobs terminate. A metadata shell is provisional: after transcript hydration, Workbench reruns the
quality decision and can return it to the publish path. Tool-only transcripts are usable evidence;
only complete duplicate or hook-only units are terminal noise.

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

## Workbench (canonical dossier + artifact candidates)

The dossier and optional-artifact paths are intentionally different:

1. **Session dossier** — the daemon publishes an immutable snapshot of the original canonical
   dossier. Agents never write or replace its body.
2. **Runbook**, **ADR**, **incident timeline** — the daemon creates an artifact candidate only when
   positive canonical evidence supports reusable knowledge. No candidate means no authoring work
   and no generated N/A prose.

Candidates may form a group only through a strong join key. A V2 authoring run owns one candidate
group, contains at most 12 provenance sessions, and produces one optional artifact.

### Daemon-owned automatic authoring

Workbench gives people a disposable, plain-language handoff. It never gives
them a CLI recipe. Whether that handoff is copied verbatim or the user directs
the agent conversationally, one daemon-owned authoring module enforces the same
quality behavior:

1. discover capabilities, the active database identity, and positive-evidence candidates;
2. open or reuse one durable V2 run for one candidate group;
3. read the canonical redacted evidence for that bounded group;
4. submit one optional artifact whose substantive claims each carry a verbatim supporting excerpt;
5. reject unsupported claims, protocol leakage, weak joins, or template duplication; and
6. atomically publish the accepted artifact and complete the candidate group.

The immutable completion report is the proof of success, and a finish retry returns the same
report. V1 runs remain audit-only and are never reused by V2.

### Locked UI vocabulary

- Columns include enrichment, canonical dossier publication, and candidate status by optional kind.
- Primary dossier control publishes the daemon-built canonical snapshot when gates pass.
- Handoff names one candidate group and one expected optional artifact. No CLI recipes appear in the handoff body.
- Apply ≠ publish.

### Code map

| Concern | Where |
|---------|--------|
| Panel / tooltips / columns | `src/ui/workbench/WorkbenchPanel.tsx` |
| Handoff text | `src/ui/workbench/workbenchHandoff.ts` |
| Controller | `src/app/workbench/useWorkbenchController.ts` |
| Pipeline | `src/workbench/` |
| Authoring module | `src/workbench/authoring/` |
| Durable runs | `src/daemon/db/workbenchAuthoringRepository.ts` |
| HTTP | `src/daemon/workbenchAuthoringApi.ts` |
| Thin CLI adapter | `src/cli/workbenchAuthoring.ts`, `src/cli/authoringClient.ts` |

## MCP (artifact-primary)

Prefer for reuse:

- `search_artifacts` — published capsules by query/kind/project.
- `get_artifact` — body + provenance + evidence refs.

Session tools (`search_sessions`, `get_session`, transcript/excerpts) remain for compile evidence, not the primary memory API. See `docs/reference/mcp-tools.md`.

MCP has no authoring mutations. Worktree bridges allow authoring capabilities,
status, and evidence reads, but block open, submit, and finish.

## Anti-patterns for agents

- Do not reintroduce Logbook bulk enrich, row checkboxes, or summary metrics strip.
- Do not treat “published session” as a Logbook search hit.
- Do not document Logbook as a session library or dual session/artifact browser.
- Do not put Workbench process tracking into Logbook.
- Plans under `docs/superpowers/plans/` are history, not the live product contract.
