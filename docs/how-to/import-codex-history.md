# Import Codex History

Codex is the first supported source adapter. Masthead imports Codex history into the canonical local SQLite session graph while preserving source provenance.

## Start the Daemon

```bash
npm run dev
```

For a non-default Codex home:

```bash
MASTHEAD_CODEX_HOME=/path/to/home npm run dev
```

## Discover Sources

Use the Sources surface or call:

```bash
curl http://127.0.0.1:17373/sources
```

The response lists discovered Codex sources, adapter state, source paths, import state, and policy state.

## Import Metadata

```bash
curl -X POST http://127.0.0.1:17373/sources/codex/import-metadata
```

Metadata import is the normal first pass. It creates canonical session records without requiring transcript approval.

## Transcript Work

Transcript import is no longer a broad Sources step. Use Workbench to review
captured sessions, run lightweight transcript checks, and hand selected sessions
to an agent. The agent can use the Workbench CLI:

```bash
mastheadctl workbench transcript check --session session:abc --json
mastheadctl workbench transcript preview --session session:abc --source source:abc --json
mastheadctl workbench transcript import --session session:abc --source source:abc --json
```

Transcript import requires exact source-scoped permission and the requested
source must be linked to the session. Use source exclusions before transcript
import when a source, project, or path should not be ingested.

## Check Jobs

```bash
curl http://127.0.0.1:17373/imports
curl http://127.0.0.1:17373/imports/<importJobId>/units
curl http://127.0.0.1:17373/imports/<importJobId>/report
curl http://127.0.0.1:17373/sessions?q=Logbook
```

Imported sessions should appear in Logbook and become available to read-only MCP tools according to MCP access policies.
