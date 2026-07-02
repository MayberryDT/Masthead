# Enrichment Audit

Masthead can write enrichment audit events to local JSONL for debugging model inputs, responses, validation, persistence, and Board headline refreshes.

Audit logging is disabled by default.

```bash
MASTHEAD_ENRICHMENT_AUDIT=1
MASTHEAD_ENRICHMENT_AUDIT_FILE=/tmp/masthead-enrichment-audit.jsonl
MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_TEXT=1
MASTHEAD_ENRICHMENT_AUDIT_MAX_TEXT=1200
MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_PROVIDER_PAYLOAD=1
```

Provider payloads and long text are excluded unless explicitly enabled. The logger redacts API keys, secret-like values, home paths, URLs, and long command output.

Export a filtered trace:

```bash
node scripts/masthead-export-enrichment-audit.js \
  --file /tmp/masthead-enrichment-audit.jsonl \
  --session session:abc \
  --kind all \
  --limit 200 \
  --pretty
```

`--kind` accepts `durable`, `board`, or `all`.
