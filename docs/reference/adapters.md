# Adapters

Masthead adapters scan known local agent-history locations and normalize recognized records into the canonical SQLite session graph. They do not control source tools.

## Active Scan Targets

- Codex
- Cursor
- Claude Code
- Antigravity
- OpenCode
- Aider
- OpenClaw
- Hermes
- Pi

Gemini CLI is legacy compatibility only for existing imported records. It is not an active scan target.

## Import States

- Planned: documented only, not an active scanner.
- Detector: can find candidate local storage and report diagnostics.
- Metadata: can import session inventory when schema probes recognize local data.
- Transcript: can import transcript/message records after explicit approval.
- Full: supports metadata, transcript import, live watch where available, and MCP exposure.

## Privacy

Scanning checks known local agent-history locations and configured overrides only. It does not perform an unbounded home-directory crawl.

Full transcript import requires explicit approval because transcripts may contain secrets, customer data, private code, proprietary prompts, and local paths.

If local storage is detected but the schema is not recognized, adapters emit diagnostics and do not create successful transcript sessions from unknown data.
