# V5 quality remediation

The completed `authoring-v5-request:031be402-0f1a-4abc-9d61-c3ef2bf5f789` must not be repaired by direct database edits, Masthead-generated prose, or a Logbook wipe. Its dossiers are immutable audit evidence until an agent authors a replacement.

Use the request-bound re-enrichment path instead: create a new V5 request with the selected published, compile-ready session IDs and `reEnrich: true`. The usual V5 evidence snapshot, packs, save validation, and receipt still apply. A hard rejection leaves the existing published dossier untouched; a valid finished pack applies the agent-authored dossier and the existing canonical artifact publisher supersedes the former current dossier atomically, preserving lineage and provenance.

This route is intentionally opt-in and is not a bulk automatic repair. The coordinator must approve the exact selection and start a separate agent-led request; Masthead only classifies evidence and validates the authored result. It never derives replacement titles, summaries, purposes, outcomes, or keywords.
