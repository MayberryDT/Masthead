# Workbench Authoring Operations — Acceptance Evidence

This evidence covers the durable operations behind automatic artifact
authoring. The dogfood uses a real daemon and temporary SQLite database only;
it never mutates the developer store.

## Run

```bash
npm run build:daemon
node scripts/dogfood-workbench-ops.js
```

Observed on 2026-07-10: `ok: true`.

| Step | Observed invariant |
| --- | --- |
| `open` | Capabilities identity opened one durable run. |
| `open_idempotent` | Repeat open preserved `runs: 1` and `activeClaims: 1`. |
| `submit_is_non_mutating` | Accepted submit left `artifacts: 0` and `enrichments: 0`. |
| `applied_optional_not_resolved` | A published session package with ADR/timeline N/A and runbook `applied` remained `resolutionStatus: compile_ready`; applied did not count as resolved. |
| `finish_publishes_every_created_artifact` | Finish created exactly the two artifacts in its receipt and both were published. |
| `receipt_artifacts_visible` | Both receipt ids loaded through `GET /logbook/artifacts/:id` with published status and provenance. |
| `logbook_body_search` | Logbook found the runbook from `cobalt-orbit durable authoring sentinel`, a phrase present only in its body. |
| `mcp_search_artifacts_body_only` | The real MCP `search_artifacts` tool found the same published runbook from that body-only phrase. |
| `restart_persistence` | Before and after daemon restart: one completed run receipt, two lineages, one current artifact in each lineage, and two published artifacts. Finish retry after restart returned the identical receipt. |

Representative persisted counts:

```json
{
  "completedRuns": 1,
  "currentLineages": 2,
  "lineages": 2,
  "publishedArtifacts": 2
}
```

## Atomicity coverage

`src/workbench/authoring/__tests__/authoringService.test.ts` complements the
real operations run with injected failure cases. Finish rolls back the complete
transaction when evidence changes, a claim conflicts, contribution state is no
longer current, signature validation changes, publication gates fail, or a
published artifact is not visible. The same tests prove that a successful retry
returns the immutable automatic completion report without duplicate rows.

## Endpoint and ownership boundary

- The primary daemon allows authoring open, submit, and finish.
- The read-only worktree bridge allows capabilities, run status, and evidence
  reads, and blocks all three mutations before they reach the upstream daemon.
- Doctor checks `artifact_authoring`, the complete operation list, executable
  installed command, CLI/daemon database identity equality, and the read-only
  MCP catalog.
- Cross-daemon writer exclusion remains the canonical ownership contract:
  `src/core/__tests__/daemonOwnership.test.ts` covers dangling final symlinks,
  and `src/daemon/__tests__/canonicalOwnership.test.ts` covers canonical path
  aliases and data-directory guards. This operations dogfood verifies clean
  release and reacquisition of that ownership across one restart.

The full product, surface, endpoint, type, test, build, development Electron,
and packaged Electron gates are recorded in
`docs/acceptance/product-release-gate.md`.
