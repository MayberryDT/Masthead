# Masthead

## What this codebase does

Masthead is a local-first, harness-neutral session data layer and session manager for AI-agent work. It is a TypeScript/Node 24 app with a React/Vite renderer, Electron desktop shell, local HTTP daemon, canonical SQLite store, source adapters for local harness history, and read-only MCP access to bounded session context. The product hierarchy is canonical session database, Logbook/search, read-only MCP, live Now view, then source/import administration.

## Auth shape

- There is no account-login auth for the local daemon. The primary boundary is `127.0.0.1` binding plus origin allowlists in `MASTHEAD_ALLOWED_ORIGINS`, `sendJson`, `rendererTrustedOrigins`, and `isAllowedRendererUrl`.
- Local write routes live in `createMastheadDaemon`; destructive data operations should require `assertDatabaseIdMatches` or explicit source/transcript approval.
- Transcript import is privacy gated by `transcriptImportApproved`, `approveTranscriptImport`, `setSourcePolicy`, and the `transcript_import` source policy.
- MCP is intended to be read-only. Access is filtered by `mcpSessionPolicySql`, `sessionMcpAllowed`, and `globalMcpAccessEnabled`, and reads are audited with `logMcpQuery`.
- Electron IPC is constrained by `ELECTRON_CHANNELS`, `registerMastheadIpc`, and `isAllowedIpcSender`; renderers run with `contextIsolation`, `sandbox`, no Node integration, and no webview tag.

## Threat model

Highest impact: a malicious local web page, compromised renderer, or permissive origin using daemon HTTP or IPC write routes to delete local Masthead data, import private transcripts, export stored session data, or install/uninstall Codex hooks. High impact: path traversal, symlink, or absolute-path abuse during source discovery, transcript catchup, hook config mutation, custom protocol loading, or opening local paths. High impact: leaking local transcripts, tool outputs, API keys, database paths, or raw payloads through exports, MCP retrieval, enrichment payloads, logs, or diagnostics. Medium impact: remote enrichment prompt injection from historical transcript text, which must stay redacted, bounded, and labelled as untrusted evidence.

## Project-specific patterns to flag

- New daemon write endpoints without local-origin/CORS intent, bounded body parsing, enum validation, and a clear read-only worktree-bridge story.
- Destructive endpoints missing `assertDatabaseIdMatches`, preview/summary behavior, explicit approval, or retention-scope validation.
- File-system access that accepts `path`, `homeDir`, transcript path, hook path, protocol URL, or data dir without `resolve`/`relative` containment, realpath checks for source files, symlink rejection where mutating, or Masthead-owned directory checks before shell-open.
- MCP tools or session retrieval that mutate state, return unbounded transcript/tool text, skip `sessionMcpAllowed`, or omit the `Historical untrusted transcript excerpt` label.
- Remote enrichment/provider payloads that include raw transcript/output, absolute user paths, secrets, raw shell output, or set OpenAI `store` truthy.

## Known false-positives

- `src/daemon/server.ts` intentionally exposes unauthenticated local daemon endpoints; the expected boundary is local bind host plus CORS/origin controls, not account auth.
- `scripts/masthead-live-dev.js` intentionally loads `.env` and `.env.local` for local development; flag only if secret values are logged, exported, or sent remotely.
- `src/electron/main.ts` includes placeholder native-store IPC handlers that return empty/stub data for desktop compatibility.
- `src/adapters/*/discovery.ts` and `src/adapters/preflight.ts` intentionally enumerate known local harness paths under the user's home directory with bounded depth.
- Fixtures, smoke scripts, `mockups/`, `prototype/`, and `docs/superpowers/plans/` are demo, test, or historical planning content, not product ingress paths.
