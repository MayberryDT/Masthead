# Durable artifact acceptance gate

This gate proves that the artifact-focused Workbench produces grounded, findable, reusable knowledge from deterministic fixture sessions. It never opens, reads, or writes the production Masthead database.

Run:

```bash
npm run dogfood:durable-artifacts
```

The command builds the daemon, creates temporary SQLite databases, exercises the real candidate discovery and V2 publication paths, queries the real Logbook repository and read-only MCP protocol, prints one JSON report, removes the temporary databases, and exits nonzero if any mandatory machine threshold fails.

## Machine gate

All thresholds are mandatory:

| Measure | Passing threshold |
| --- | ---: |
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

The expected labeled candidate mix is three runbooks, two ADRs, and two incident timelines. The canary publication slice contains one accepted artifact of each optional kind plus the daemon-built canonical dossier for each provenance session.

The performance database reuses the candidate-discovery fixture shared with the Task 6 regression test: 100 sessions, 60 tool calls and 60 tool results per session, or 12,000 canonical evidence items total. The report includes those counts and fails if the fixture becomes trivial; database setup time is excluded from the two-second measurement.

`dossierFidelity` compares each published dossier with the original `canonical-session-dossier-v1` snapshot generated from the same canonical session dossier. Only `capturedAt`, which is deliberately excluded by the product fingerprint contract, may differ.

`claimSupportCoverage` checks every declared support path against the published body and requires its normalized excerpt to occur verbatim in the referenced canonical evidence item. Candidate submission still goes through the production semantic quality validator before publication.

## Artifact-only reuse tasks

Each task calls MCP `search_artifacts`, then MCP `get_artifact`, and derives an answer from that returned artifact body. The expected answer key is explicit in the report. `search_sessions`, `get_session`, `get_session_excerpt`, `get_session_transcript`, `list_project_sessions`, and `get_project_history` are forbidden in this assertion.

The five tasks are:

1. Recover the OAuth callback repair step from a runbook.
2. Explain the rejected hosted-database alternative from an ADR.
3. Reconstruct the ingestion incident sequence from an incident timeline.
4. Find `auth/callback.ts` in a canonical dossier's changed files.
5. Identify the OAuth verification failure from canonical dossier attention.

The JSON report records the exact MCP call sequence, artifact ID, expected answer, derived answer, and result for every task.

## Human usefulness gate

The fixture command does not pretend that a person reviewed generated artifacts. Its `humanReview` section is deliberately incomplete: every canary artifact has null scores, `completed: false`, and `passed: false`. A fixture machine PASS is therefore not a production human-review PASS.

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
