# ADR 0014: Agent-Led Enriched Artifact Authoring

## Status

Accepted.

## Context

ADR 0013 restored Masthead's original dossier presentation and established important safeguards:
complete canonical evidence, verbatim claim support, strong provenance joins, deterministic
duplicate prevention, and atomic publication. Its candidate-driven V2 workflow still separated
canonical dossier publication from agent work and treated detector output as the gate to optional
authoring. That boundary prevented a selected session's durable enrichment from being the source
of its published dossier and prevented the agent from judging which artifacts were useful across
the full selected evidence.

Workbench instead needs one selection-scoped collaboration. The user's coding agent should enrich
the selected sessions, exercise judgment about reusable artifacts, and return grounded results.
Masthead should retain deterministic validation and its established canonical dossier structure,
without promoting detector output into authoring obligations.

## Decision

1. Users select sessions and copy one disposable agent prompt for every compile-ready session in
   that selection; review-needed sessions stay selected but are disclosed and excluded from the
   request rather than blocking ready work.
2. The agent must enrich each session included in the request before its dossier can publish.
3. The daemon rebuilds the original canonical dossier after enrichment; agents do not replace its presentation.
4. The agent may create zero or more runbooks, ADRs, or incident timelines from the selected evidence.
5. Deterministic analysis may offer nonbinding suggestions, including canonical-rendering cues, but cannot require or prohibit an artifact kind.
6. V3 finish validates and publishes enrichment-derived dossiers and optional artifacts atomically.
7. V1 and V2 runs remain audit-only and are never reused by V3.

The selection-scoped protocol is `workbench-authoring-v3`. **Copy Agent Prompt** copies a disposable
request for the compile-ready subset of the selected sessions and truthfully reports any excluded
review-needed sessions. **Artifact suggestion** means a nonbinding detector hint supplied
privately to the agent. **Agent-led authoring** means the agent enriches selected sessions and
chooses useful artifacts. **Enriched dossier** means the original canonical dossier structure
rendered after current durable enrichment. **Publication** means atomic admission of validated
enriched artifacts into Logbook. In operational terms, suggestions are nonbinding and nothing
enters Logbook until enrichment is current.

This ADR supersedes ADR 0013's independent canonical-dossier publication and candidate-required V2
authoring. It preserves ADR 0013's complete-evidence requirement, typed verbatim claim support,
strong-join provenance checks, duplicate-prevention validation, and original canonical rendering.
The daemon remains the writable boundary, `mastheadctl` remains a thin HTTP adapter, and MCP remains
artifact-primary and read-only.

## Consequences

- A Workbench selection produces one disposable agent request, not one detector-chosen job.
- Every selected session receives current durable enrichment before its rebuilt dossier can publish.
- Agents can omit unsupported or low-value optional kinds without manufacturing N/A output.
- Deterministic detectors improve agent context without taking artifact judgment away from the agent.
- Finish admits the complete validated result atomically, preventing a partially updated Logbook.
- Historical V1 and V2 records remain available for audit but cannot seed or resume V3 work.
