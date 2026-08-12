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

Never a bare **Publish**. Local Logbook publication remains **Publish to Logbook**.

## Daemon routes (primary only)

These routes never call the hosted service and never read Electron credentials. Secondary worktree
bridges must not forward them.

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/masthead-pages/reviews/prepare` | Eligibility + base projection + evidence candidates + findings |
| `POST` | `/masthead-pages/reviews/finalize` | Build exact `PublishPageRequestV1`, egress scan, stage ready items |
| `POST` | `/masthead-pages/selection/resolve` | Snapshot ≤500 eligible artifact IDs |
| `POST` | `/masthead-pages/operations/removal/stage` | Stage removal from private mapping (`artifactId` only) |
| `GET` | `/masthead-pages/operations/pending/:artifactId` | Exact staged JSON + digest for Electron main |
| `POST` | `/masthead-pages/publications/record` | Record hosted success into private mapping |
| `POST` | `/masthead-pages/failures/record` | Record failure (retryable keeps pending) or confirmed removal |

## Credentials

- Refresh tokens live only in Electron main, encrypted with async `safeStorage`.
- Linux backends `basic_text` and `unknown` fail closed.
- Tokens never enter renderer state, daemon settings, SQLite, logs, previews, or Page objects.
- Only allowlisted `https://masthead.page` device verification URLs may open externally.

## Selection mode

The normal Logbook table has **no permanent checkboxes**. Checkboxes appear only while temporary
Masthead Pages selection mode is active and disappear when the mode ends. Matching selection
snapshots at most 500 existing eligible IDs and never expands to future matches.

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

## Gates

```bash
npm run check:masthead-pages-contract
npm run smoke:masthead-pages
npm run smoke:masthead-pages:offline
npm test -- --run src/mastheadPages src/daemon/__tests__/mastheadPagesApi.test.ts \
  src/electron/__tests__/mastheadPagesEndToEnd.test.ts src/app/mastheadPages src/ui/masthead-pages
```
