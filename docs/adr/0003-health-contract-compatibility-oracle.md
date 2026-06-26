# ADR 0003: `/health` Is the Compatibility Oracle

## Status

Accepted.

## Context

Multiple Masthead worktrees and stale local daemons can exist on the same machine. A raw HTTP 200 is not enough to prove that the UI, doctor, MCP launch config, and bridge are talking to the right process.

## Decision

Treat `GET /health` as the compatibility oracle. It must identify the Masthead product, daemon API version, schema version, capabilities, runtime identity, runtime mode, writable/read-only state, data directory, database path, database ID, and migration state.

## Consequences

- Clients should classify health payloads before reusing a daemon.
- Read-only bridges should preserve upstream identity while exposing bridge mode.
- Release gates should verify rendered behavior or doctor output against the same health/database identity.
