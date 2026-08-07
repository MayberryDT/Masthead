# Sources Onboarding Acceptance Evidence

Generated for the Sources onboarding completion slice.

## Automated

| Check | Result | Evidence |
| --- | --- | --- |
| `node --check scripts/masthead-doctor.js` | PASS | Ran on 2026-06-28; syntax check exited 0. |
| `npm run check:product-contract` | PASS | Ran on 2026-06-28; `Masthead product contract passed.` |
| `npm run doctor:json` | PASS WITH WARNINGS | Ran on 2026-06-28 against `http://127.0.0.1:17373/`; overall `ok: true`. `sources-pipeline` reported `warn` for cached-only scan state and existing import failures, with 1,288 connected sources, 352 imported sessions, transcript rows present, enrichment complete, 1,814 failed import jobs in the failed-job page total, and repair recommendations. Latest observed counts: 324 Logbook sessions, 3,878 messages, 11,658 tool calls, 76,314 enrichments. |

## Manual

| Case | Result | Evidence |
| --- | --- | --- |
| Sources setup flow | Not run by this worker | Record scan, connect-selected, transcript approval, and sync-connected observations. |
| Import history modal | Not run by this worker | Verify harness selection, age selection, preview counts, and visible start action in the Sources tab. |
| Visible import progress | Not run by this worker | Start a Codex transcript import and record parent job stage, heartbeat, current path, child work units, grouped failures, cancel/retry, and completion report. |
| Advanced diagnostics | Not run by this worker | Record scan freshness, checked paths, detector-only entries, failures, unrecognized schemas, and repair recommendations. |
| Harness catalog copy | Docs updated | Active import, detector-only, cloud-reference, and legacy categories are documented in `docs/reference/sources.md` and `docs/reference/adapters.md`. |
| No whole-home scan guarantee | Docs updated | Sources docs state bounded known-location scanning and no unbounded recursive home-directory crawl. |

## Notes

Do not mark manual UI cases passing unless they were verified in the Codex in-app Browser with the `iab` backend.
