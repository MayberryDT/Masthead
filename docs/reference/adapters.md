# Adapters

Masthead adapters scan known local agent-history locations and normalize recognized records into the canonical SQLite session graph. They do not control source tools.

## Active Import Adapters

- Codex
- Cursor
- Claude Code
- Grok Build
- OpenCode
- Aider
- OpenClaw
- Hermes
- Pi
- OMP

Gemini CLI is legacy compatibility only for existing imported records. It is not an active scan target.

## Live-Capable Release Targets

Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode are live-capable release targets. Their live connector events enter Masthead through `/ingest`, are normalized with runtime-scoped identity, and feed the same canonical session graph as imported history.

See [live-connectors.md](live-connectors.md).

## Harness Catalog

Sources also carries a broader catalog so users can see what Masthead knows about without overstating support.

- Detector-only local harnesses can be checked at conservative known paths and reported in Advanced diagnostics, but they do not import canonical sessions until schema support exists.
- Cloud-reference harnesses are listed for product clarity when the agent is cloud-first and has no local source connector in this pass.
- Legacy hidden entries remain out of default onboarding.

Detector-only examples include Crush, Cline, Roo Code, Kilo Code, Continue.dev, OpenHands, GitHub Copilot, Windsurf, Zed AI, Amazon Q Developer, Sourcegraph Amp, JetBrains AI, Qodo, Tabnine, and IBM Bob. Cloud-reference examples include Devin and Jules.

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
