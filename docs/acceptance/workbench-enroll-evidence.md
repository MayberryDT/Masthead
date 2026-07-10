# Workbench enrollment and toolbar density — historical acceptance record

## Status

This page records the 2026-07-09 enrollment and toolbar-density rollout. Its former direct-SQLite enrollment recipe is retired. The primary CLI now supports only daemon-owned artifact authoring plus explicit `wipe-published` maintenance.

The current enrollment contract is:

- new live and imported sessions are enrolled into Workbench when they are materialized;
- the Workbench **Enroll missing** control catches up canonical sessions that predate pipeline state;
- the writable daemon owns catch-up through `POST /workbench/enroll-missing`;
- the operation is idempotent and never demotes existing published or Not Added rows;
- read-only worktree bridges reject this write.

## Current verification

Run the repository/API/controller/UI coverage rather than the removed CLI recipe:

```bash
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/app/__tests__/daemonClient.test.ts \
  src/app/workbench \
  src/ui/workbench

npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
npm run check:endpoint-matrix
```

The API test proves the current write seam directly:

```text
POST /workbench/enroll-missing
body: { "limit": 100, "actorId": "workbench_ui" }
```

Expected behavior is `enrolled > 0` for missing rows on the first call and `enrolled = 0` on an identical second call. Exercise the endpoint only against an intentional writable test daemon; it changes Workbench pipeline state.

The Workbench surface must not expose agent command recipes:

```bash
rg -n 'mastheadctl|npm run|output\.json|schema\.json|apply\.sh' \
  src/ui/workbench/WorkbenchPanel.tsx
# expected: no matches
```

## Historical outcome

The original rollout established:

- automatic enrollment when sessions are created or imported;
- an idempotent **Enroll missing** Workbench control;
- a primary-daemon HTTP operation with bridge write rejection;
- 56px Workbench and Sources toolbars with 40px controls;
- no CLI recipes in the Workbench UI.

The recorded dogfood enrolled 78 pre-existing sessions and a second pass enrolled zero. That result is historical evidence, not a command to replay against a current developer database.

## Toolbar density contract

| Surface | Current target |
|---|---|
| Workbench | 56px operations bar, 40px buttons/facts, one row with horizontal overflow |
| Sources | same 56px / 40px density |
| Workbench control | **Enroll missing** remains a human UI action backed by the daemon endpoint |

For the current end-to-end Workbench authoring contract and release evidence, use `docs/acceptance/product-release-gate.md`, `docs/acceptance/workbench-v1-evidence.md`, and ADR 0012.
