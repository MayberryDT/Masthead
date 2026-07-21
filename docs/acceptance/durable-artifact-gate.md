# Durable artifact acceptance gate

This gate proves that guided V4 Workbench authoring produces grounded, findable, reusable knowledge from deterministic fixture sessions. It never opens, reads, copies, or writes the production Masthead database or production instance manifest.

Run:

```bash
npm run dogfood:durable-artifacts
```

The command builds the daemon, allocates a non-production loopback port, creates a temporary SQLite database and instance manifest, and exercises request creation, evidence traversal, revision, canary approval, finish, and Logbook reuse through daemon HTTP. Cleanup terminates the daemon and recursively removes the temporary database, sidecars, manifest, launcher, and workspace after success or failure.

## Machine gate

All thresholds are mandatory:

| Measure | Passing threshold |
| --- | ---: |
| Failed V3 template rejected | `true` |
| Complete evidence coverage | `1.0` |
| Session claim-support coverage | `1.0` |
| Optional-artifact claim-support coverage | `1.0`, with at least one persisted optional artifact |
| Opportunity disposition coverage | `1.0`, with at least one discovered opportunity |
| Duplicate session templates | `0` |
| Guided protocol leaks | `0` |
| Unsupported completion claims | `0` |
| Artifact-only reuse pass rate | `1.0` |
| Canary publications before approval | `0` |
| Mutations after identity mismatch | `0` |
| Canonical dossier snapshot fidelity | `1.0` |
| Exact claim-support coverage | `1.0` |
| Labeled candidate recall | `1.0` |
| Labeled candidate precision | `1.0` |
| Logbook recall at five | `1.0` |
| MCP recall at five | `1.0` |
| Artifact-only reuse-task pass rate | `1.0` |
| Protocol-language leaks | `0` |
| Duplicate substantive fingerprints | `0` |
| Unexpected or missing kinds | `0` |
| Maximum provenance sessions in a candidate run | `12` |
| One 100-session, tool-heavy discovery page after fixture setup | at most `2,000 ms` |

The expected labeled candidate mix is three runbooks, two ADRs, and two incident timelines. The canary publication slice contains one accepted artifact of each optional kind plus the daemon-built canonical dossier for each provenance session. Optional-artifact and opportunity coverage are non-vacuous: a `1.0` ratio with a zero denominator does not pass either measure.

Every metric is hard. `guidedAuthoringGateFailures` emits one stable code for each degraded metric, including `failed_v3_template_not_rejected`, `session_claim_support_below_1`, `opportunity_disposition_below_1`, `duplicate_session_template_detected`, `canary_bypassed`, and `identity_mismatch_mutated`. The focused corpus test degrades each metric independently so a new field can’t silently become advisory.

## Fresh-agent canary

Run `npm run canary:guided-agent -- --agent-command /absolute/path/to/fresh-agent-wrapper --report /new/absolute/path/to/unsigned-report.json`. The wrapper receives only `MASTHEAD_GUIDED_LAUNCH_PACKAGE`, containing one opaque request ID and the isolated instance’s absolute start command. It does not receive fixture session IDs, fixture answers, authored JSON, a database path, service internals, the implementation plan, batching instructions, or the operator’s review. The harness gives it a clean temporary home, an allowlisted environment, and an audited instance launcher; a hard timeout terminates a stuck agent.

The unsigned run writes its sanitized report, reviewable artifact bodies, reuse tasks, and human-review challenge with mode `0600`, then exits nonzero until a human signs. Copy the challenge fields unchanged into a review receipt, add the human scores, signer, and a post-challenge timestamp, then run `npm run canary:guided-agent -- --verify-review --report /absolute/path/to/unsigned-report.json --human-review-file /absolute/path/to/operator-review.json`. This second phase does not rerun the agent; it recomputes the trusted report hash and rejects stale, altered, or differently bound reviews.

The nine-session fixture covers artifact signals, tool-heavy work, ordinary work, sparse evidence, and two deliberately tempting template cases. Its rich synthetic sessions must contain enough canonical evidence to support a concrete repair procedure, a decision with rationale and alternatives, and an ordered incident sequence. A fresh-agent pass requires the persisted Logbook packet to contain at least one runbook, one ADR, and one incident timeline authored from those rich sessions. Publishing only canonical dossiers, dismissing every opportunity, or reporting perfect optional-artifact or disposition coverage over an empty denominator fails the canary.

A passing report records revision count, finding codes, accepted artifact IDs, non-vacuous opportunity and optional-artifact coverage, semantic artifact-only reuse results, duplicate/protocol/unsupported-completion counts, and a signed human review of specificity and independent reuse. Deterministic dogfood cannot satisfy this fresh-agent gate because it supplies authored content itself, and its optional-kind mix cannot substitute for the separately persisted fresh-agent outputs.

The performance database reuses the candidate-discovery fixture shared with the Task 6 regression test: 100 sessions, 60 tool calls and 60 tool results per session, or 12,000 canonical evidence items total. The report includes those counts and fails if the fixture becomes trivial; database setup time is excluded from the two-second measurement.

`dossierFidelity` is independent of the product snapshot builder and fingerprint. Immediately after each publication transaction, the harness deep-clones the post-publication canonical `SessionDossierDto` produced by that transaction, removes only its recursive `artifacts` field, adds the expected `canonical-session-dossier-v1` marker, normalizes `capturedAt`, and then deep-compares every persisted Logbook body field. A golden list also requires identity, coverage, narrative, files, tools, verification, attention, timeline, excerpts, durable enrichment, enrichment state, reuse, and usage.

`claimSupportCoverage` reads `claimSupport` back from each persisted Logbook optional-artifact body. It independently requires the exact canary path/support-kind matrix, requires at least one valid support for every required path, resolves each supported path in the persisted body, and requires a normalized excerpt of at least 20 characters to occur verbatim in canonical evidence. The gate also deep-compares persisted optional bodies with their accepted submissions. Candidate submission still goes through the production semantic quality validator before publication.

## Artifact-only reuse tasks

Each task acts as an independent consumer: it calls MCP `search_artifacts`, then MCP `get_artifact`, and derives an answer from that returned artifact body. The expected answer key is explicit in the report. `search_sessions`, `get_session`, `get_session_excerpt`, `get_session_transcript`, `list_project_sessions`, and `get_project_history` are forbidden in this assertion.

Reuse scoring is semantic, not keyword-based. The runbook task must recover an actionable repair step and its verification check, the ADR task must explain the selected option's rationale and a rejected alternative, and the incident task must reconstruct the ordered failure and recovery sequence. Repeating two words from a fixture title and a word such as `passed`, `verified`, or `confirmed` does not satisfy any task. The gate includes a negative control proving that a title echo plus generic verification prose fails, and every required assertion must come from the persisted artifact body without fixture metadata or raw-session access.

The five tasks are:

1. Recover the OAuth callback repair step from a runbook.
2. Explain the rejected hosted-database alternative from an ADR.
3. Reconstruct the ingestion incident sequence from an incident timeline.
4. Find `auth/callback.ts` in a canonical dossier's changed files.
5. Identify the OAuth verification failure from canonical dossier attention.

The JSON report records the exact MCP call sequence, artifact ID, expected answer, derived answer, and result for every task.

## Human usefulness gate

The fixture command does not pretend that a person reviewed generated artifacts. A fixture machine PASS is therefore not a fresh-agent or production human-review PASS.

Before a production canary may pass, a person must score every canary artifact from 1 to 5 on:

| Field | Question |
| --- | --- |
| Findability | Do the title and capsule identify the real work? |
| Grounding | Are claims directly supported and uncertainty explicit? |
| Reusability | Can another person act without reopening the raw transcript? |
| Specificity | Do concrete files, commands, decisions, symptoms, and checks replace generic prose? |
| Readability | Is the body pleasant, concise, and organized for its artifact kind? |

Production human-review passing criteria are all of:

- 100% of canary artifacts reviewed;
- median overall score at least `4.0`;
- no artifact overall score below `3.0`.

The worksheet in the JSON report supplies artifact identity, kind, title, five score fields, completion, and notes. Scores must be entered by a human during the separately authorized production canary; the deterministic fixture harness never fills them in.
