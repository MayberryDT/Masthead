# ADR 0002: MCP Is Read-Only and Local First

## Status

Accepted.

## Context

Masthead should make local session history reusable by existing agents without turning into an agent runner or approval layer.

## Decision

Launch MCP as a local stdio server with read-only tools only. The server reads from the active `MASTHEAD_DB_PATH`, returns bounded historical evidence, applies MCP access policies, and logs audit rows.

## Consequences

- MCP tools may search and retrieve sessions, project history, excerpts, and coverage counts.
- MCP tools must not mutate files, Git, shell state, source harness sessions, imports, settings, or Masthead data.
- The daemon and Agent Access surface own launch-config validation so users can see which database an agent will read.
