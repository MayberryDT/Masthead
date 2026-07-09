# ADR 0009: Logbook Only Shows Published Sessions

## Status

Accepted.

## Context

Masthead captures many raw sessions that are incomplete, hook-only, duplicated, or missing transcript evidence. Showing those rows in Logbook makes search noisy and pushes cleanup, transcript import, and enrichment decisions into the wrong surface.

## Decision

Logbook shows only published sessions. A session becomes published after Workbench has checked transcript availability, accepted the session quality, applied agent-authored enrichment, and recorded the receipts needed to audit what happened.

## Consequences

- Workbench owns the raw-to-published pipeline for captured sessions.
- Workbench needs a first-class durable pipeline state per captured session. UI, CLI, Sources handoff points, Workbench Activity, suppression review, and Logbook publication filters should read from that state instead of inferring readiness from imports, enrichments, review dispositions, or deleted flags.
- The Workbench pipeline model should separate current state, historical activity, and active claims: a current-state row for each captured session, an append-only Workbench Activity stream, and lightweight short-lived claim records. Publication state should not be polluted by expiring agent leases or activity history.
- Publication is an explicit final Workbench transition. Applying enrichment or creating artifacts can satisfy publication gates, but those actions must not automatically make a session visible in Logbook.
- Existing Logbook-visible sessions should be migrated through an explicit one-time legacy publication backfill when they pass the cheap quality screen, recorded in Workbench Activity as `published_via: legacy_backfill`. Existing sessions that fail the cheap quality screen move to Not Added to Logbook instead of remaining silently searchable.
- The cheap quality screen should stay deterministic and transcript-import-free: require at least one meaningful user or assistant message or usable transcript coverage, reject hook-only/no-message captures and obvious duplicate/noise sessions, and require enough shallow metadata to identify source, runtime, and time. All cheap-quality failures go to Not Added to Logbook with a clear non-publication reason; they are not kept in the default Workbench queue.
- Every published session requires applied session enrichment and a current session dossier. Bug-fix trace is first-class but evidence-conditional; if no bug/fix evidence exists, Workbench records the bug-fix trace as not applicable instead of generating a useless artifact or treating it as missing.
- Workbench V1 is a compact operations surface, not an instructional page. It should use a dense table for selection, queue state, next actions, and handoff control, paired with a live Workbench Activity rail for agent progress visualization. It should not use hero panels, onboarding copy, teaching copy, visible CLI command recipes, or board lanes.
- Non-published sessions are completely hidden from normal Logbook APIs and UI.
- Suppressed sessions are reviewable in Workbench but excluded from default agent-facing queues; agents see them only when the user explicitly asks for suppressed-session review.
- Obvious junk may become a purge candidate after a retention window, while missing-transcript, tool-only, low-evidence, and user-suppressed sessions remain reviewable unless the user chooses to purge them.
- Workbench may run lightweight transcript availability checks automatically, but transcript import remains an explicit user or user-directed agent action.
- Transcript import permission is source-scoped; global or runtime-wide approval is too broad for Workbench's resource and privacy boundary.
- Workbench quality cleanup runs in two passes: a cheap capture quality precheck before transcript import, then a publication quality check after transcript readiness is known.
- The default agent-facing Workbench queue includes only publish-path sessions with actionable next steps. Suppressed sessions, purge candidates, permission-blocked sessions, published sessions, and Not Added to Logbook items are excluded unless the user explicitly asks for them.
- Default agent prompts must not include Not Added to Logbook session IDs or details. The UI may show aggregate counts or reason summaries, but agent-facing detail is available only through an explicit user request.
- Human Workbench actions and agent-facing tools operate on the same pipeline state. Every meaningful state-changing Workbench action should have an agent-facing equivalent, while the UI avoids command recipes and the default agent scope stays limited to actionable publish-path sessions.
- Active agent work is represented by lightweight Workbench claims: short-lived leases with sparse Workbench Activity state, not assignments or task records. Claims support live visualization and duplicate-work avoidance while keeping agent context clean.
- Workbench Activity is the user-facing progress record for transcript checks, transcript imports, quality decisions, enrichment, publication, suppression, and purge. It should stay compact and structured.
- Workbench is the live home for Workbench Activity. Session Dossier may show compact historical milestones, but Logbook table views do not become process tracking surfaces.
- In V1, unpublished Now sessions may use a simple shallow detail or degraded path into Workbench rather than a full Session Dossier. The product should be honest that full durable detail belongs to published sessions.
- Now V1 shows shallow state cards only: running/idle/attention state, runtime/source identity, last activity, and small counts. It is not a transcript viewer, enrichment surface, or Workbench progress dashboard.
- Logbook is pure published-session search, browse, filter, sort, and Session Dossier inspection. It does not own selection checkboxes, bulk enrichment, transcript import prompts, source import empty states, or Not Added to Logbook review.
- Sources manages harness capture configuration, source health, readable paths, and source-scoped transcript permissions. Workbench owns per-session transcript import work, Workbench queue state, enrichment, publication, and import job review as the primary workflow.
- Now can show shallow live state without implying a session is ready for Logbook retrieval.
