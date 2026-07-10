# Workbench Artifact Authoring

Masthead authoring is agent-authored and daemon-owned. The Workbench app is the
human collaboration surface; the writable daemon owns evidence, validation,
claims, database identity, output writes, publication, and completion. The
installed CLI is a thin HTTP adapter and never opens SQLite for normal
authoring.

See [ADR 0012](../adr/0012-daemon-owned-artifact-authoring.md).

## Human and agent surfaces

People select compile-ready sessions and copy a disposable plain-language
handoff. The handoff says to complete the work automatically, but does not show
commands, file recipes, privacy questions, or a step-by-step approval wizard.

A user who wants to steer the work can direct an agent to Workbench and discuss
artifact shape or provenance. Copied-handoff work and directed work still use
the same authoring contract and quality rules; neither path is intentionally
more conservative.

## Discovery

The agent first reads authoring capabilities from the active daemon. The
response identifies:

- protocol `masthead.workbench.authoring/v1`;
- transport `daemon_http`;
- the installed absolute CLI command;
- the daemon’s database identity;
- bundle version `workbench-authoring-v1`;
- evidence policy `all_canonical_redacted_evidence`;
- operations `open`, `status`, `evidence`, `submit`, and `finish`.

The database identity from capabilities must be passed unchanged to open. A
different daemon is rejected before claims or artifact writes.

## Four-operation authoring flow

| Operation | Contract |
| --- | --- |
| **Open** | Open or reuse one durable authoring run for the actor and exact selected session set. Open verifies database identity, establishes one live claim per session, records the evidence revision, and returns the bundle schema plus evidence manifest. |
| **Evidence** | Page through every canonical redacted evidence item for each selected session. Ascending and descending pagination cover the same complete catalog. Status is a read-only recovery check for run, claim, and evidence-revision state. |
| **Submit** | Send one complete artifact bundle. The daemon stores the bundle and structured findings, but creates no enrichment or artifact rows. Revise deterministic findings and resubmit until accepted. |
| **Finish** | Atomically apply enrichment, create and publish every output artifact, resolve every automatic kind, verify Logbook visibility, release claims, and store the automatic completion report. Retrying finish returns the same report. |

Agents should use the capabilities-reported command rather than guessing a
binary or database path. User-facing Workbench copy remains plain language;
this protocol is agent-facing machinery.

## Evidence manifest

Open returns an evidence manifest for every selected session:

- total item count and kind counts;
- user and assistant message, tool call/result, file, checkpoint, and runtime
  signal coverage;
- first and last observation times;
- coverage warnings;
- one revision fingerprint for the selected set.

Evidence pages return stable item refs and complete redacted text. Agents must
read all pages needed to account for the manifest rather than stopping at an
early transcript preview. If canonical evidence changes, evidence and submit
fail closed until open refreshes the same durable run to the new revision.

All authoring evidence is already Masthead’s canonical redacted evidence. The
authoring loop does not ask for a privacy or additional access decision.
Source-scoped approval remains relevant to the separate act of importing new
transcript data into Masthead.

## Artifact bundle

One accepted bundle contains:

- exactly one `session_enrichment` and `session_dossier` package for every
  selected session;
- zero or more grounded `runbook`, `adr`, or `incident_timeline` artifacts;
- explicit N/A decisions where reviewed evidence does not support a kind;
- explicit contribution decisions where a selected session is already covered
  by a current published multi-session artifact.

For each selected session, every automatic kind has exactly one resolution
path: a new artifact whose provenance contains that session, N/A, or
contribution. A multi-session artifact declares its full provenance set and a
strong join rationale. All claims and N/A decisions cite evidence refs inside
their allowed provenance.

The first-class live taxonomy is:

- `session_dossier` — the required single-session artifact body;
- `runbook` — a reproducible fix or operating recipe;
- `adr` — a durable architecture or design decision;
- `incident_timeline` — an ordered failure, impact, remediation, and prevention
  narrative.

## Findings and quality

Submit returns structured authoring findings with a stable code, severity,
message, and when available an exact bundle path, session, and artifact kind.
Validation covers schema shape, selected-session completeness, provenance,
evidence refs, claim-level grounding, confidence, sparse coverage, duplicate
signatures, secret-looking output, join strength, and one resolution per
automatic kind.

Warnings can preserve honest coverage limitations. Errors require revision.
Because submit has no output side effects, the agent can iterate without
leaving partially applied artifacts in Logbook.

## Atomic finish and resolution

Finish runs inside one immediate SQLite transaction. Any failed invariant rolls
back enrichment, artifacts, search indexing, pipeline state, claims, and the
completion report together.

Every artifact created by finish is published before the transaction commits
and must be readable through Logbook detail. Optional status `applied` is only
an intermediate compile state. Automatic resolution accepts only:

- `published`;
- `not_applicable`;
- `contributed` to a current published artifact.

The automatic completion report records the run id, completion time, published
artifact ids, resolved sessions, N/A decisions, and contributions. It is
immutable and makes finish idempotent across retries and daemon restarts.

## Reuse and correction boundary

Published artifacts are searchable by capsule fields and full body in Logbook.
Read-only MCP exposes `search_artifacts` and `get_artifact` for reuse, with
session/transcript tools retained for evidence inspection. MCP has no authoring
operations.

Logbook improve, rewrite, supersede, and remove tools are future scope. They
should be added as explicit daemon-owned correction operations rather than by
weakening authoring quality or making MCP write-capable.
