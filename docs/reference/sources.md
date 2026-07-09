# Sources (legacy reference)

> **Sources V2 contract:** For current product scope, use **[sources-v2.md](sources-v2.md)** and **[ADR 0010](../adr/0010-sources-v2-live-connect-only.md)**. Sources V2 is **live-connect only** (Discover → Enable → Activate → Test → Ready). Session import jobs, transcript import, and publication belong to Workbench. Sections below retain historical import/setup detail useful for daemon adapters and Workbench handoff; do not rebuild Sources UI around them.

Sources is Masthead's local connector surface. Historically it discovered local coding-harness history stores, connected selected harnesses, queued metadata imports, managed capture health, and fed the canonical SQLite session graph used by Now, Workbench, Logbook, dossiers, and MCP.

## Setup Flow

1. Choose the coding harnesses to import from, for example OpenCode, Claude Code, Hermes, Cursor, or OMP.
2. Connect selected harnesses to persist source inventory and queue metadata imports.
3. Review source health, readable paths, live capture status, diagnostics, and import history.
4. Use Workbench for per-session transcript checks/import, cleanup, enrichment, artifacts, and publication.

Local paths remain advanced diagnostics and provenance. Transcript import permission is source-scoped and used by Workbench; it is not a runtime-wide Sources action. The scan checks known app data directories, known CLI home directories, supported environment overrides, and user-added custom locations. It does not perform an unbounded recursive home-directory crawl.

## Harness Catalog

The onboarding catalog separates import support from awareness:

- Active import adapters: Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP.
- Live-capable release targets: Codex, Claude Code, Cursor, Grok Build, Hermes, Pi, Oh My Pi, and OpenCode.
  Codex is live-capable (hooks) and history-rich via Workbench transcript paths, without a Sources bulk SessionAdapter.
- Unsupported local, cloud-reference, and legacy harnesses are not exposed as product-supported adapters in the focused release.

Unsupported entries should not appear in onboarding or connector controls until their local storage schema is verified and mapped.

## Live Capture

Sources shows live connector status for the release targets. The daemon reports whether each hook or plugin is installed, missing, or needs repair, plus the managed config path and endpoint.

Runtime-specific daemon routes operate on one connector at a time. Masthead preserves unrelated user hooks and removes only Masthead-managed entries.

Live capture does not replace transcript permission. A live hook can create session identity and runtime signal records, while full transcript/message import remains opt-in through Workbench with exact source-scoped permission.

## Connect Selected

`Connect selected` persists selected source inventory and queues metadata import jobs for recognized local harnesses. Transcript child work units are created by explicit Workbench transcript import actions, not by Sources connect or sync.

Detected but unrecognized schemas produce diagnostics such as:

```text
Detected, import blocked: schema not recognized.
```

They must not create fake successful transcript sessions.

## Transcript Permission

Transcript import is opt-in and Workbench-owned. Users or user-directed agents must explicitly request transcript work for a session. Masthead checks that the requested source is linked to the session and that exact source-scoped permission exists before import.

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
