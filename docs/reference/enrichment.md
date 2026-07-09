# Workbench Enrichment

Masthead V1 enrichment is agent-authored. The app Workbench is the
user-facing coordination surface; the CLI Workbench is the agent-facing write
path.

The app imports and normalizes local sessions into the canonical SQLite graph. MCP
remains read-only for retrieval. Writes for enrichment and local artifacts happen
through the CLI Workbench, using evidence packets and schema-validated JSON.

## UI/CLI Split

The Workbench app surface is for people reviewing publish-path sessions before
they enter Logbook. It shows the pipeline queue as a dense table with next
action, transcript, quality, enrichment, dossier, bug-fix, claim, and latest
Activity state. A side rail shows recent Workbench Activity and aggregate Not
Added to Logbook counts. The top action bar generates disposable
plain-language handoffs for a coding agent.
It must not present command-copy instructions or expose CLI tokens in visible UI.

The CLI is for the coding agent that receives that handoff. It supplies the
repeatable loop for reading evidence, writing an output file, validating that
file, and applying the result to the local canonical store.

## Agent-Facing CLI Runbook

Workbench UI should not ask users to run these commands. The user-facing surface
generates disposable handoffs that tell a coding agent what needs enrichment.
The agent-facing CLI supplies the repeatable enrichment loop.

```bash
mastheadctl workbench status --json
mastheadctl workbench queue --kind session_enrichment --scope missing --json
mastheadctl workbench next --kind session_enrichment --scope missing --json
mastheadctl workbench claim --session session:abc --by codex --json
mastheadctl workbench transcript check --session session:abc --json
mastheadctl workbench transcript preview --session session:abc --source source:abc --json
mastheadctl workbench transcript import --session session:abc --source source:abc --json
mastheadctl workbench instructions --kind session_enrichment --scope missing
mastheadctl workbench schema session_enrichment --json
mastheadctl workbench evidence --kind session_enrichment --session session:abc --json
mastheadctl workbench validate --kind session_enrichment --session session:abc --file output.json --json
mastheadctl workbench apply --kind session_enrichment --session session:abc --file output.json --json
mastheadctl workbench publish --session session:abc --json
mastheadctl workbench activity --session session:abc --json
```

Use `next` when an agent needs one complete packet: queue item, schema,
kind-specific instructions, evidence packet, and apply command. For batch work,
prepare a directory of per-session packets:

```bash
mastheadctl workbench batch prepare --kind session_enrichment --scope missing --limit 10 --out .masthead/workbench/batch-001 --json
mastheadctl workbench batch apply .masthead/workbench/batch-001 --json
```

The same loop applies to all V1 output kinds:

```text
session_enrichment
session_dossier
bug_fix_trace
```

`mastheadctl workbench instructions --kind <kind> --scope <scope>` returns the
agent guidance contract for that kind: evidence rules, confidence rubric,
field-by-field rules, output discipline, and validation expectations.

## Agent Loop

For each selected session, the coding agent should:

1. Claim the selected session and check transcript availability.
2. Import transcripts only when exact source-scoped permission exists or the
   user explicitly directs the agent to request it.
3. Fetch the kind-specific instructions and schema for the target output kind.
4. Fetch the evidence packet for the session and use only cited evidence refs.
5. Produce one schema-valid JSON output for the chosen kind.
6. Validate the output with the session id before applying it.
7. Apply only after validation succeeds.
8. Publish only after transcript, quality, session enrichment, dossier, and
   bug-fix readiness gates are satisfied.

For `session_enrichment`, start with the current session capsule prompt version
and produce concise fields that improve Logbook, search, Now, dossier, and MCP
retrieval: title, summary, topics, technologies, search phrases, unresolved
items, missing evidence, confidence, and evidence refs.

For `session_dossier`, produce a durable local artifact about the session's
objective, outcome, important decisions, verification, unresolved items, and
lessons learned. Include only conclusions supported by evidence refs.

For `bug_fix_trace`, produce a durable local artifact that captures the observed
symptom, root cause when supported, fix, files or subsystems involved,
verification, failed hypotheses, and follow-up risk.

## Output Kinds

- `session_enrichment` writes current `session_capsule`, `live_summary`, and
  `search_projection` rows using the current session capsule prompt version, so
  Logbook, Now, dossier, search, and MCP reads can see the result.
- `session_dossier` creates a local `session_artifacts` row with
  current/superseded semantics.
- `bug_fix_trace` creates a local `session_artifacts` row for bug-fix evidence.
  When evidence does not support a bug-fix trace, Workbench records the artifact
  kind as not applicable in pipeline state instead of creating a fake artifact.

## Privacy

Workbench evidence packets are local database reads. No native remote model key
is required for V1. Agents should use only the evidence packet, cite evidence
refs, validate output with `--session`, and apply through the CLI. Session
enrichment and artifacts both validate evidence refs against the session packet
before apply.

## Legacy Native Hooks

Daemon endpoints such as `POST /enrichment/rebuild`,
`POST /sessions/:id/dossier/enrich`, and provider settings endpoints are
compatibility/dev hooks, not the V1 launch enrichment path.
