# ADR 0004: Source Adapters Feed an Adapter-Neutral Graph

## Status

Accepted.

## Context

The first useful Masthead slice is Codex-first, but the product must remain harness-neutral. Baking Codex nouns into canonical storage would make later adapters expensive and weaken the product boundary.

## Decision

Build source adapters as ingestion and normalization layers before the canonical session graph. Codex is the first supported adapter. The graph uses neutral session, source, event, message, tool, file, checkpoint, project, model, state, and provenance terms.

## Consequences

- Codex-specific parsing belongs in the Codex adapter path.
- Logbook, MCP, settings, data lifecycle, and search should read adapter-neutral records.
- Future adapters can be added by mapping their source records into the same graph.
