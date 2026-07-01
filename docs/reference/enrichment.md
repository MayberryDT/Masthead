# Enrichment

Enrichment is derived session data stored in Masthead's canonical SQLite graph. It is not required for source import, Logbook search, or MCP access.

## Modes

- Deterministic fallback: local derivation from canonical session records. This is the default provider.
- Optional remote model: enabled only when configured with `MASTHEAD_REMOTE_ENRICHMENT=1` and an API key. Remote enrichment must stay scoped, redacted, previewable, strict, and auditable. `MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS` controls the durable request timeout and defaults to `12000`.
- Live Now-card AI copy refresh: controlled separately with `MASTHEAD_LIVE_COPY`. The legacy `MASTHEAD_LLM_COPY=1` flag still enables both live copy and durable remote enrichment unless a specific flag overrides it.
- Disabled or partial: sessions can still be imported and searched when enrichment is queued, failed, disabled, or missing.

When remote enrichment is enabled, provider failures do not silently fall back to deterministic text. A timeout, API error, invalid JSON response, invalid model output, validation failure, or missing key writes/diagnoses a failed enrichment attempt with no current `live_summary` or `search_projection` replacement. Existing successful current rows remain current until a new successful enrichment is written.

## Coverage

Settings and doctor diagnostics report enrichment coverage using the canonical session count, current session capsules, queued rows, failed rows, disabled rows, weak current titles, sessions with messages but no file effects, repeated failed fingerprints, and git snapshot file-effect coverage gaps.

Low enrichment coverage is a repair signal, not a reason to fake imported sessions. Keep the daemon running after imports, inspect Settings enrichment health, or retry failed import/enrichment work after fixing the underlying source issue.

## Privacy

Remote enrichment is off by default. Transcript approval and source exclusions remain in force before transcript-derived material can feed enrichments.

## Audit Logging

Set `MASTHEAD_ENRICHMENT_AUDIT=1` to write JSONL audit events. Useful flags:

```bash
MASTHEAD_ENRICHMENT_AUDIT_FILE=/tmp/masthead-enrichment-audit.jsonl
MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_TEXT=1
MASTHEAD_ENRICHMENT_AUDIT_MAX_TEXT=1200
MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_PROVIDER_PAYLOAD=1
```

Export a safe trace with:

```bash
node scripts/masthead-export-enrichment-audit.js --file /tmp/masthead-enrichment-audit.jsonl --session session:abc --kind all --limit 200 --pretty
```

## Rebuild

Use the rebuild endpoint or CLI to force current sessions through the strict provider path:

```bash
node scripts/masthead-reenrich.js --recent 100
node scripts/masthead-reenrich.js --session session:abc
```

The daemon endpoint is `POST /enrichment/rebuild`. It accepts `scope` values `all`, `recent`, `session`, `project`, and `runtime`, with a default limit of 100.
