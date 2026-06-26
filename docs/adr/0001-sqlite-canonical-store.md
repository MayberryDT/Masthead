# ADR 0001: SQLite Is the Canonical Store

## Status

Accepted.

## Context

Masthead imports local AI-agent session history from source harnesses. The product needs durable search, Logbook records, source/import state, settings, data deletion, and MCP auditability without requiring a hosted database.

## Decision

Use a local SQLite database as the canonical store for Masthead-owned product data. Source harness files remain external inputs. Legacy NDJSON journals may exist for migration or compatibility, but runtime product surfaces should read canonical SQLite state after import.

## Consequences

- `/health` and MCP launch config must expose the active database identity.
- Only one writable daemon may own a data directory at a time.
- Secondary worktrees should use a read-only bridge instead of opening the primary database for writes.
- Data deletion and retention APIs operate on Masthead-owned local data, not external source files.
