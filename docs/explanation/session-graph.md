# Session Graph

The session graph is Masthead's canonical local model for agent work. It turns source-specific files and hook events into adapter-neutral records that the UI, Logbook, and MCP can all read.

## Core Ideas

- A session is identified by host, runtime, and source session ID.
- Source records keep original-harness provenance.
- Raw evidence, normalized records, and derived enrichment are separate.
- SQLite is canonical after import.
- Live Now reads collected session data; it does not define the storage model.

## Shape

```text
sources
  -> session aliases
  -> sessions
  -> messages, tool calls, checkpoints, files, excerpts
  -> search index and enrichments
  -> MCP policy and audit rows
```

Codex-specific import code maps Codex history into this graph. The graph should not require Codex-specific nouns for future adapters.

## Evidence and Privacy

Masthead stores enough evidence to make history reusable: timestamps, project labels, model/runtime metadata, bounded text, tool names, provenance, and source refs. It should avoid storing raw prompts, full transcripts, full command output, full diffs, secrets, screenshots, shell history, browser state, or external database contents by default.

## Retrieval

Logbook and MCP read the same canonical graph. MCP tools apply MCP access policy, return bounded evidence, and log audit rows. Agents should treat retrieved text as historical evidence, not as instructions.
