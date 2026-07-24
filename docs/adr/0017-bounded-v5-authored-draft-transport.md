# ADR 0017: Bounded V5 authored-draft transport

## Status

Accepted and implemented.

This decision refines the V5 scaffold and save boundary in ADR 0016. It does not change pack
membership, evidence inspection, quality classification, publication, or receipt semantics.

## Context

A V5 scaffold is a useful local authoring artifact because it combines blank authored fields with
the complete immutable evidence catalog. Real dogfood exposed a session whose catalog made the
compact scaffold larger than the draft endpoint's 5 MiB request limit. The CLI then posted the
scaffold unchanged, duplicating evidence that Masthead already owned in the immutable request
snapshot and making transport size grow with transcript size instead of authored work.

## Decision

1. The scaffold remains evidence-rich and local so an agent can inspect and author one file.
2. `mastheadctl workbench author save` projects that file to a `WorkbenchAuthoringV5AuthoredDraft`.
   The projection carries bundle, pack, and evidence-revision identity; session IDs and authored
   fields; evidence-reference IDs; and optional considerations and artifact drafts. It never carries
   `evidenceCatalog`.
3. The public V5 draft route has a 1 MiB request-body limit for a maximum 12-session pack. Save size
   therefore scales with authored fields and reference IDs, not immutable evidence text.
4. Save validates request and instance identity, reconstructs each session catalog from the
   immutable request evidence snapshot, validates optional artifacts against canonical ownership,
   and classifies unknown core references as hard rejects.
5. The repository stores the authored projection rather than another evidence copy. Atomic finish
   rehydrates the catalog again inside its transaction before enrichment and publication.
6. Snapshot-less legacy V5 rows keep their existing guarded fallback: rehydration may use live
   canonical evidence only while the stored evidence revision still matches.

## Consequences

- Existing evidence-rich scaffold files remain resumable through the updated CLI when the request's
  stable build/database/manifest binding is unchanged because projection happens at save time. An
  installation that changes the build SHA still requires a new V5 request.
- An oversized immutable catalog no longer blocks authoring, while oversized authored content still
  fails closed at a documented transport bound.
- Canonical evidence text and ownership never come from the agent, so modified local catalog content
  cannot replace request-frozen evidence.
- No schema migration is required. Previously stored full-draft JSON remains structurally readable;
  finish ignores any embedded catalog and rehydrates from Masthead-owned evidence.
