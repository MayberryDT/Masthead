# Enrichment

Enrichment is derived session data stored in Masthead's canonical SQLite graph. It is not required for source import, Logbook search, or MCP access.

## Modes

- Deterministic fallback: local derivation from canonical session records. This is the default provider.
- Optional remote model: enabled only when configured with `MASTHEAD_LLM_COPY=1` and an API key. Remote enrichment must stay scoped, redacted, previewable, and auditable.
- Disabled or partial: sessions can still be imported and searched when enrichment is queued, failed, disabled, or missing.

## Coverage

Settings and doctor diagnostics report enrichment coverage using the canonical session count, current session capsules, queued rows, failed rows, and disabled rows.

Low enrichment coverage is a repair signal, not a reason to fake imported sessions. Keep the daemon running after imports, inspect Settings enrichment health, or retry failed import/enrichment work after fixing the underlying source issue.

## Privacy

Remote enrichment is off by default. Transcript approval and source exclusions remain in force before transcript-derived material can feed enrichments.
