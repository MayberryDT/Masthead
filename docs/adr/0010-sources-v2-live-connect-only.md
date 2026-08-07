# ADR 0010: Sources V2 Is Live-Connect Only

## Status

Accepted.

## Context

Sources grew into a hybrid of harness discovery, history inventory, metadata import jobs, transcript permission ceremony, and live-hook install. That overloads one surface and conflicts with Workbench ownership of the raw→publish session pipeline (ADR 0009).

Live capture dogfood also showed that “hook file written” is not the same as “actually capturing.” Host-specific activation (Codex hook trust, Hermes plugin enablement) must be first-class product state.

## Decision

**Sources V2 is the harness connection control plane for live capture only.**

Sources answers:

1. Which supported harnesses are present on this machine?
2. Is Masthead wired to capture them live?
3. What human activation step remains?
4. Did a synthetic or real test prove the wire works?

Sources does **not** own:

- session import queues or job tables,
- per-session transcript import,
- token/model deep enrichment,
- Workbench quality, publication, or Logbook visibility,
- bulk history “connect selected sources” as the primary product action.

Workbench owns deepening captured sessions (metadata/transcripts when permitted, enrichment, multi-kind publication). Now owns shallow live presence. Logbook owns **published artifacts only** (ADR 0011), not session rows.

The authoritative product contract is `docs/reference/sources-v2.md`.

## Consequences

- Sources UI is rebuilt around Discover → Enable → Activate → Test → Ready.
- Import-centric Sources UI and first-run copy are retired or moved to Workbench.
- Daemon history adapters and import APIs may remain for Workbench; they are not Sources V2 UX.
- Live connector install status must distinguish installed vs ready vs needs host action.
- `docs/internal/design.md` Sources archetype becomes connector rows + enablement, not import jobs.
- ADR 0008 remains valid for bounded local scan and harness catalog awareness; its import-onboarding framing is superseded for Sources UI by this ADR and Sources V2.
- ADR 0009 remains valid for Workbench/Logbook; Sources no longer presents import progress as its primary job.
