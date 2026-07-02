# ADR 0007: Multi-Adapter Source Connector

## Status

Accepted.

## Context

Sources was originally Codex-first. That proved the canonical SQLite session graph, Logbook, Board, and MCP reuse path, but left the Sources surface behaving like a Codex-only import tool.

Masthead needs a real local connector that can scan multiple agent-history stores without weakening local-first privacy boundaries.

## Decision

Masthead will use an adapter registry for active source scanning. The active scan targets are Codex, Cursor, Claude Code, OpenCode, Aider, OpenClaw, Hermes, Pi, and OMP. Gemini CLI remains legacy planned compatibility only.

Each adapter declares candidate locations, capability maturity, and import behavior. Scans are read-only and bounded to known local locations plus configured overrides. Metadata import can be queued from selected connected sources. Transcript import requires explicit approval.

Adapters must not fake support. If a candidate path exists but schema probes do not recognize importable data, the adapter records diagnostics and does not create canonical transcript sessions.

## Consequences

- Source discovery is registry-driven instead of Codex-hardcoded.
- Worktree bridges may forward read-only source scans, but source connect/import writes stay blocked.
- Unknown schemas remain visible as diagnostics instead of disappearing or becoming fake Logbook sessions.
- Future adapter improvements can raise maturity without changing the Sources user flow.
