# Sources

Sources is Masthead's local connector surface. It discovers local agent-history stores, connects selected sources, queues imports, and feeds the canonical SQLite session graph used by Board, Logbook, and MCP.

## Setup Flow

1. `Scan this computer` runs a bounded read-only scan.
2. Review found sources and Advanced diagnostics.
3. `Connect selected` persists selected source inventory and queues metadata imports.
4. Approve transcript import only for trusted sources.
5. Run transcript import or `Sync connected` when more history is needed.

The scan checks known app data directories, known CLI home directories, supported environment overrides, and user-added custom locations. It does not perform an unbounded recursive home-directory crawl, and Masthead does not guarantee discovery of every possible file under the home directory.

## Harness Catalog

The onboarding catalog separates import support from awareness:

- Active import adapters: Codex, Cursor, Claude Code, Antigravity, OpenCode, Aider, OpenClaw, Hermes, and Pi.
- Detector-only local harnesses: OMP, Crush, Cline, Roo Code, Kilo Code, Continue.dev, OpenHands, GitHub Copilot, Windsurf, Zed AI, Amazon Q Developer, Sourcegraph Amp, JetBrains AI, Qodo, Tabnine, and IBM Bob.
- Cloud-reference harnesses: Devin and Jules.
- Legacy hidden compatibility: Gemini CLI for existing imported records only.

Detector-only and cloud-reference entries can be shown in diagnostics or references, but they do not imply successful local transcript import. They stay diagnostic-only until a local storage schema is verified and mapped.

## Connect Selected

`Connect selected` persists selected source inventory and queues metadata import jobs for recognized local sources. Import jobs are isolated per source so one missing, locked, unreadable, or unrecognized source does not block the rest.

Detected but unrecognized schemas produce diagnostics such as:

```text
Detected, import blocked: schema not recognized.
```

They must not create fake successful transcript sessions.

## Import Transcripts

Transcript import is opt-in. Users must explicitly approve transcript import before Masthead queues transcript import jobs.

This approval boundary exists because transcripts may contain sensitive prompts, private code, secrets, customer data, or proprietary operational detail. Approval enables import work; it does not bypass exclusions or schema recognition.

## Enrichment

After metadata or transcript import, Masthead can derive local session capsules and search projections from the canonical graph. Optional remote enrichment is off by default and must remain scoped, redacted, previewable, and auditable when enabled.

See [enrichment.md](enrichment.md).

## Advanced Diagnostics

Advanced diagnostics should expose checked paths, detector-only harnesses, import job failures, unrecognized schemas, scan freshness, transcript coverage, enrichment coverage, and repair recommendations. Diagnostics report observed local state only; they must not invent live data or imply whole-home scans.

Useful commands:

```bash
npm run doctor
npm run doctor:json
```
