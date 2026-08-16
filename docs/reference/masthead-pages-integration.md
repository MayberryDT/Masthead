# Masthead Pages integration

Local **Publish to Masthead Pages** turns a current enriched `session_dossier` Logbook Page into a
hosted public Page. Masthead stays fully useful without a Masthead Pages account, network, or
service availability.

## Trust boundary

| Side | Owns |
| --- | --- |
| Local daemon | Eligibility, public projection, evidence resolution, egress preflight, private release mappings, staged request bytes |
| Renderer | Selection, review UI, confirmation — never long-lived credentials or raw staged envelopes |
| Electron main | OS-backed credentials (`safeStorage`), allowlisted device URL open, authenticated hosted HTTP, staged-ref IPC only |
| Hosted Masthead Pages | Public Logbooks, immutable Page revisions, device tokens, withdrawal |

Never upload local artifact `content_json` unchanged. The projector builds an explicit allowlist
`PageRevisionV1` (`session-dossier-public-v1`). Raw transcripts, local/source IDs, fingerprints,
paths, files, tools, usage, provider details, and unselected evidence are excluded.

## Vocabulary

Use qualified actions only:

- **Publish to Masthead Pages**
- **Publish new revision**
- **Remove from Masthead Pages**

Local Logbook publication remains **Publish to Logbook**. The Logbook toolbar may use the compact visible label **Publish** only for the always-visible Masthead Pages selection flow; its accessible name names the hosted destination.

## Daemon routes (primary only)

These routes never call the hosted service and never read Electron credentials. Secondary worktree
bridges must not forward them.

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/masthead-pages/reviews/prepare` | Eligibility + base projection + evidence candidates + findings |
| `POST` | `/masthead-pages/reviews/finalize` | Build exact `PublishPageRequestV1`, egress scan, stage ready items |
| `POST` | `/masthead-pages/selection/resolve` | Legacy authoritative ≤500-ID snapshot until Local 19 cutover |
| `POST` | `/masthead-pages/selection/materialized/resolve` | Dormant complete/incomplete zero-partial-ID shadow resolver for Local 19 |
| `POST` | `/masthead-pages/operations/removal/stage` | Stage removal from private mapping (`artifactId` only) |
| `GET` | `/masthead-pages/operations/pending/:artifactId` | Exact staged JSON + digest for Electron main |
| `POST` | `/masthead-pages/publications/record` | Record hosted success into private mapping |
| `POST` | `/masthead-pages/failures/record` | Record failure (retryable keeps pending) or confirmed removal |

## Credentials

- Refresh tokens live only in Electron main, encrypted with async `safeStorage`.
- Linux backends `basic_text` and `unknown` fail closed.
- Tokens never enter renderer state, daemon settings, SQLite, logs, previews, or Page objects.
- Only allowlisted `https://masthead.page` device verification URLs may open externally.

## Page selection

The Logbook table keeps Page checkboxes visible. Its header **Select all** affects only eligible Pages
on the current page; selections on other pages remain unchanged and total selection stays capped at 500.
Individual eligible Pages remain directly selectable. The compact **Publish** button is disabled until the selection is non-empty and
opens batch review directly; no temporary selection mode or auxiliary selection actions exist. The additive
materialized resolver defines an explicit retryable or non-retryable incomplete result with zero IDs;
Local 19 will wire that result to the production route only after shadow parity and cutover proof.

## Transport

Electron loads staged bytes by `{ artifactId, requestDigest }` only. Batches chunk to ≤25 items /
8 MiB and preserve per-item idempotency keys and itemized outcomes.

## Failure behavior

Hosted offline, timeout, rate limit, parent conflict, revoked refresh, expired device flow, insecure
storage, and browser-only mode fail closed. Local Logbook artifacts remain readable and unchanged.
Retryable failures keep the staged pending operation for a later confirmed retry.

## Public Logbook creation

Create Public Logbook requires title, visibility, and license. There is **no repository requirement**.
Cover upload runs only after explicit confirm and never accepts local paths over IPC.

## Contract bundle

Imported under `schemas/masthead-pages/v1/` and verified by `npm run check:masthead-pages-contract`.
Object IDs must match hosted vectors (`npm run smoke:masthead-pages`).

## Local data-foundation probe

`npm run probe:local-data-foundation -- --db <sqlite-copy> --output <report.json>` measures the
legacy and materialized matching paths over no-filter, search, project, date, and combined scenarios
at limits 1, 10, 50, 100, and 500. It calls the shipped legacy, materialized, and capsule
repository functions through read-only instrumentation, records per-scenario population/selectivity,
and marks whether generated scenarios and required corpus outliers are representative. Selection
comparisons share one SQLite read snapshot. Each capsule cold sample uses a new read-only connection
and read transaction to clear SQLite's connection-local page cache; the report explicitly notes that it
does not evict the operating-system page cache. Capsule plans come from the exact SQL and bound shape
executed by the shipped repository. Replacement comparisons are reported only when current-policy
eligibility is fully materialized; missing or error rows produce `not_comparable`, not a production
completeness claim. Probe-only readiness counts are outside timed repository calls. Resolver errors are
reported independently, never as successful parity. Allocation evidence uses the Node inspector's
sampled-allocation profiler. Reports omit filter values, local paths, and reusable identifier digests.
Use a private database snapshot when stable timing must be isolated from concurrent local writes.

## Gates

```bash
npm run check:masthead-pages-contract
npm run smoke:masthead-pages
npm run smoke:masthead-pages:offline
npm test -- --run src/mastheadPages src/daemon/__tests__/mastheadPagesApi.test.ts \
  src/electron/__tests__/mastheadPagesEndToEnd.test.ts src/app/mastheadPages src/ui/masthead-pages
```
