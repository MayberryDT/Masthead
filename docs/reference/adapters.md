# Adapters

Masthead adapters scan known local agent-history locations and normalize recognized records into the canonical SQLite session graph. They do not control source tools.

## Focused Import Adapters

- Cursor
- Claude Code
- OpenCode
- Grok Build
- Hermes
- Pi
- OMP

The focused support set is intentionally limited to these seven runtimes. Other local, detector-only, cloud-reference, and legacy harnesses are not exposed as supported adapters in product surfaces.

## Live-Capable Release Targets

Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP are live-capable release targets. Their live connector events enter Masthead through `/ingest`, are normalized with runtime-scoped identity, and feed the same canonical session graph as imported history.

See [live-connectors.md](live-connectors.md).

## Harness Catalog

The harness catalog is the product support contract, not a broad awareness list. Sources and Settings should expose only the focused seven-runtime set until another runtime is deliberately promoted.

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
