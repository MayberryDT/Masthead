# ADR 0012: Documentation Authority and History Policy

## Status

Accepted.

## Context

Masthead changed from a live-session control-tower concept into a local-first session data layer
whose product wedge is reusable, evidence-backed engineering knowledge. Sessions are capture,
Workbench, evidence, and provenance units. Logbook entries are published artifacts: session
dossiers, runbooks, ADRs, and incident timelines. Read-only MCP is artifact-primary.

The repository accumulated implementation plans, prototypes, acceptance snapshots, duplicate
release checklists, and genesis research while that direction evolved. Historical files remained
searchable beside current references, so an accurate README or ADR could coexist with an obsolete
user journey such as “import a session and find it in Logbook.” Git already preserves deleted
history; the default tree should optimize for current product comprehension.

## Decision

Masthead uses one documentation authority spine:

1. `README.md` is the public repository entrypoint.
2. `openwiki/quickstart.md` is the agent and contributor map.
3. `prd.md` defines current product scope.
4. `design.md` defines current visual direction.
5. `CONTEXT.md` defines current product language.
6. `docs/adr/` records durable decisions and supersession.
7. `docs/reference/`, `docs/how-to/`, and `docs/tutorials/` describe current behavior only.
8. `docs/acceptance/product-release-gate.md` is the single current release checklist.
9. Other files under `docs/acceptance/` may remain as concise, dated verification receipts.

Completed execution plans, disposable prototypes, generated design comparisons, obsolete baseline
snapshots, and duplicate current-state documents do not remain in the default tree after their
durable decisions or evidence have been promoted. Git and merged pull requests retain that history.
Historical ADRs remain because their status and supersession are part of the decision record.

Current documentation must describe the product flow consistently:

```text
Sources / imports / live capture
  -> canonical session database
  -> Workbench evidence and compile pipeline
  -> per-artifact apply and publication
  -> Logbook artifact search and body/provenance inspection
  -> artifact-primary read-only MCP reuse
```

The default automatic artifact set is the session package plus evidence-conditional runbook, ADR,
and incident timeline. Unsupported kinds are marked N/A; sessions never become Logbook rows.

## Consequences

- `docs/superpowers/` implementation history is removed after current decisions are promoted.
- Genesis product research may be removed from the default tree once its durable decisions are
  represented by the PRD and ADRs.
- The legacy Sources reference and duplicate release-gate document are consolidated into their
  current successors.
- README links point directly to current contracts rather than compatibility references.
- Product-contract verification scans active documentation for obsolete Logbook and artifact-kind
  language while excluding ADR context and dated acceptance receipts where historical wording is
  legitimate.
- Documentation cleanup should be a separate, reviewable commit from product behavior changes.

