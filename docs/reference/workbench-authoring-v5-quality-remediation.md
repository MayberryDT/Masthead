# V5 quality remediation

The completed `authoring-v5-request:031be402-0f1a-4abc-9d61-c3ef2bf5f789` must not be repaired by direct database edits, Masthead-generated prose, or a Logbook wipe. Its dossiers are immutable audit evidence until an agent authors a replacement.

Use the request-bound re-enrichment path instead: create a new V5 request with the selected published, compile-ready session IDs and `reEnrich: true`. The usual V5 evidence snapshot, packs, save validation, and receipt still apply. A hard rejection leaves the existing published dossier untouched; a valid finished pack applies the agent-authored dossier and the existing canonical artifact publisher supersedes the former current dossier atomically, preserving lineage and provenance.

This route is intentionally opt-in and is not a bulk automatic repair. The coordinator must approve the exact selection and start a separate agent-led request; Masthead only classifies evidence and validates the authored result. It never derives replacement titles, summaries, purposes, outcomes, or keywords.

## Audited release-corpus recovery

When a completed production audit identifies whole authoring cohorts that must not remain visible for a release, use the offline V5 quality-corpus maintenance commands instead of editing SQLite. The operator supplies the exact `created_by` values to retain. `audit-v5-quality-corpus` hashes the complete current published population and both partitions; `prepare-v5-quality-corpus` acquires daemon-equivalent exclusive ownership, creates the sole `backup-current` snapshot, verifies its database identity, and reproduces the same corpus audit on the backup. `invalidate-v5-quality-corpus` requires the prepared receipt, exact audit hash, and `--confirm` before one transaction marks only the audited non-retained artifacts superseded/invalidated and removes their search rows.

This recovery preserves artifact bodies, provenance, sessions, enrichments, and authoring receipts. It does not create enrichment prose, reset sessions, or prevent a later request-bound `reEnrich` replacement. A changed current corpus fails closed because its audit hash no longer matches the prepared receipt.
