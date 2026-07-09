# ADR 0011: Logbook Is an Artifact Book

## Status

Accepted.

## Context

Masthead’s wedge is reusable engineering knowledge from local AI sessions, not a generic memory layer or a session transcript vault. Workbench already turns captured sessions into evidence-backed memory (`session_enrichment`, `session_dossier`, `bug_fix_trace`) with apply ≠ publish. Logbook, however, still treats **published sessions** as the primary searchable unit, which under-sells the product and blocks multi-session knowledge objects (runbooks, ADRs, incident timelines).

We considered keeping sessions as Logbook rows with nested artifacts, or a dual session/artifact browser. Both keep the wrong primary object for search and agent reuse.

## Decision

**Logbook is a searchable library of published artifacts only.** Every hit is an artifact capsule; opening a hit shows the artifact body. Sessions remain the unit of capture, Workbench pipeline, and provenance — not Logbook rows.

Core rules:

1. **Publish is per-artifact.** Apply is not publish. Disposable-handoff agents may apply and publish automatically when validation and kind rules pass; directed-agent work may stop or steer earlier.
2. **Capsule / body structure.** Every artifact has a listing capsule and a full body. The session capsule lists the session dossier (body). Other kinds follow the same pattern with a shared minimal capsule plus optional highlight.
3. **Scope by kind.** Session dossier is exactly one session. Runbook, ADR, and incident timeline are multi-session-capable via an explicit provenance set.
4. **Default automatic kind set.** Session package (capsule + dossier) always; runbook, ADR, and incident timeline when evidence supports them, else session-relative N/A. Environment recipes and eval packs are later.
5. **Agent-led compile.** Provenance is chosen by the agent with Masthead tools (no human clustering UI on the handoff path). Expansion beyond the handoff seed set uses **signature-bounded** join keys, with declared join rationale; weak joins stay single-session.
6. **Workbench session states.** User-visible: compile-ready vs automatic work resolved (package published + runbook/ADR/timeline each published or N/A). Contribution to a published multi-session artifact can satisfy a seed session without a duplicate local copy. N/A never creates a Logbook row.
7. **Identity.** Opaque artifact id plus optional signature key for supersede; full current/superseded lineage.
8. **MCP is artifact-primary** for reuse; session/transcript tools remain for evidence and compile.
9. **Now is unchanged** (shallow live cards). Workbench stays the raw→publish collaboration surface.
10. **Kind taxonomy.** Evolve `bug_fix_trace` into `runbook`; add `adr` and `incident_timeline` as first-class kinds (no long parallel dual vocabulary).
11. **Cutover.** Local Logbook/published state may be wiped and rebuilt; no requirement to migrate old session-row Logbook data. Source harness history on disk remains.

This partially supersedes the Logbook definition in ADR 0009 (“Logbook shows only published sessions”) while preserving Workbench ownership of the raw→ready pipeline, explicit publish transitions, and evidence-before-claims.

## Consequences

- Logbook UI, search APIs, and MCP default tools revolve around artifacts, not session tables.
- Workbench CLI gains multi-session evidence packets, provenance declaration, join rationale, and per-kind publish/N/A/contribution states.
- Session dossier remains the session-scoped spine; multi-session kinds carry the research-validated engineering knowledge wedge.
- ADR 0009’s “published session” Logbook eligibility language should be read as historical; prefer compile-ready / automatic work resolved / published artifact from `CONTEXT.md`.
- Signature-bounded expansion is V1 policy and may be revised after production dogfood.
