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

## Import Transcripts

Transcript import is a separate reviewed step:

```bash
curl -X POST http://127.0.0.1:17373/sources/codex/approve-transcripts
curl -X POST http://127.0.0.1:17373/sources/codex/import-transcripts
```

Use source exclusions before transcript import when a source, project, or path should not be ingested.

## Check Jobs

```bash
curl http://127.0.0.1:17373/imports
curl http://127.0.0.1:17373/sessions?q=Logbook
```

Imported sessions should appear in Logbook and become available to read-only MCP tools according to MCP access policies.
