# Sources

Sources is Masthead's local connector surface. It discovers local coding-harness history stores, connects selected harnesses, queues imports, and feeds the canonical SQLite session graph used by Now, Logbook, dossiers, and MCP.

## Setup Flow

1. Choose the coding harnesses to import from, for example Codex, Hermes, Cursor, or OMP.
2. Choose an import age. The default is changed transcripts plus the last 30 days. Full archive import is explicit.
3. Preview the manifest before starting. The preview reports included files, skipped files, and total bytes without parsing transcripts.
4. Start import. Masthead queues one parent job per selected coding harness/runtime.
5. Watch child work units, heartbeat, current path, grouped failures, partial success, and completion report.

Local paths remain advanced diagnostics and provenance. The user-facing approval is by coding harness/runtime, not by folder. The scan checks known app data directories, known CLI home directories, supported environment overrides, and user-added custom locations. It does not perform an unbounded recursive home-directory crawl.

## Harness Catalog

The onboarding catalog separates import support from awareness:

- Active import adapters: Codex, Cursor, Claude Code, OpenCode, Aider, OpenClaw, Hermes, Pi, and OMP.
- Detector-only local harnesses: Crush, Cline, Roo Code, Kilo Code, Continue.dev, OpenHands, GitHub Copilot, Windsurf, Zed AI, Amazon Q Developer, Sourcegraph Amp, JetBrains AI, Qodo, Tabnine, and IBM Bob.
- Cloud-reference harnesses: Devin and Jules.
- Legacy hidden compatibility: Gemini CLI for existing imported records only.

Detector-only and cloud-reference entries can be shown in diagnostics or references, but they do not imply successful local transcript import. They stay diagnostic-only until a local storage schema is verified and mapped.

## Connect Selected

`Connect selected` persists selected source inventory and queues metadata import jobs for recognized local harnesses. Setup-run import jobs are visible parent jobs per runtime. Transcript child work units are isolated per transcript file or source session so one missing, locked, unreadable, or unrecognized file does not block the rest.

Detected but unrecognized schemas produce diagnostics such as:

```text
Detected, import blocked: schema not recognized.
```

They must not create fake successful transcript sessions.

## Import Transcripts

Transcript import is opt-in. Users must explicitly approve transcript import before Masthead queues transcript import jobs.

This approval boundary exists because transcripts may contain sensitive prompts, private code, secrets, customer data, or proprietary operational detail. Approval enables import work; it does not bypass exclusions or schema recognition.

Transcript jobs persist:

- import manifest summary,
- child work-unit state,
- heartbeat and current path,
- grouped failures with sample paths,
- `succeeded_with_issues` when useful data imported but some units failed,
- completion report with sessions created, sessions updated, transcript records, Logbook coverage, dossier coverage, and next actions.

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
