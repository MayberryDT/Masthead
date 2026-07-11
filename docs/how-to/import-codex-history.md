# Import Codex History

Masthead imports Codex history into the canonical local SQLite session graph while preserving
source provenance. Import creates captured session evidence for Workbench; it does not publish
Logbook rows.

## Start Masthead

```bash
npm run dev
```

For a non-default Codex home:

```bash
MASTHEAD_CODEX_HOME=/path/to/home npm run dev
```

## Inspect sources

Use Sources for Codex live-connector discovery and health. For adapter/import diagnostics, call:

```bash
curl http://127.0.0.1:17373/sources
```

The response reports observed source paths, adapter state, import state, and policy state. Sources
UI remains live-connect only; import diagnostics support the canonical capture pipeline.

## Import metadata

```bash
curl -X POST http://127.0.0.1:17373/sources/codex/import-metadata
```

Metadata import creates or updates canonical session records without importing transcript contents.

## Check import jobs

```bash
curl http://127.0.0.1:17373/imports
curl http://127.0.0.1:17373/imports/<importJobId>/units
curl http://127.0.0.1:17373/imports/<importJobId>/report
```

Use session search only to inspect captured evidence or locate Workbench candidates:

```bash
curl "http://127.0.0.1:17373/sessions?q=<project-or-session-term>"
```

## Continue in Workbench

Transcript import is a per-session Workbench action. A user-directed agent can run:

```bash
mastheadctl workbench enroll --missing --json
mastheadctl workbench transcript check --session session:abc --json
mastheadctl workbench transcript preview --session session:abc --source source:abc --json
mastheadctl workbench transcript import --session session:abc --source source:abc --json
mastheadctl workbench quality precheck --session session:abc --json
```

Transcript import requires exact source-scoped permission, and the requested source must be linked
to the session. Source, project, and path exclusions remain authoritative.

After transcript and quality prerequisites pass, use the Workbench disposable handoff to compile
the session package and evidence-conditional runbook, ADR, and incident timeline. Published
artifacts—not imported sessions—then appear in Logbook and artifact-primary MCP search.
