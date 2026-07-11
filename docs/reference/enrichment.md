# Workbench Enrichment and Artifact Authoring

Masthead V1 uses the user's coding agent to deepen captured sessions. The Workbench app is the
human coordination surface; `mastheadctl workbench` is the agent-facing write path. MCP remains
read-only.

## Ownership split

The Workbench app shows a dense publish-path table with transcript, quality, enrichment, package,
runbook, ADR, timeline, resolution, claim, next-action, and Activity state. It can generate a
disposable plain-language handoff for selected sessions. It does not expose CLI command recipes or
become an in-app artifact editor.

The coding agent uses the CLI to:

- inspect queue state and claim work,
- check/import transcript evidence under exact source-scoped permission,
- read kind-specific instructions and schemas,
- build bounded single- or multi-session evidence packets,
- validate evidence refs and provenance,
- apply derived enrichment and artifact bodies,
- publish individual artifacts,
- resolve optional kinds as N/A or contribution when appropriate,
- leave durable Workbench Activity receipts.

## Output kinds

`mastheadctl` supports:

| Kind | Role | Logbook row |
| --- | --- | --- |
| `session_enrichment` | Derived capsule, live summary, and search projection used upstream | No |
| `session_dossier` | Single-session artifact body; required session package | When published |
| `runbook` | Reproducible fix/operation recipe; multi-session-capable | When published |
| `adr` | Architecture/design decision; multi-session-capable | When published |
| `incident_timeline` | Time-ordered failure/remediation narrative; multi-session-capable | When published |

The former `bug_fix_trace` product kind has evolved into `runbook`; agents must not author both in
parallel.

## Agent loop

For each selected seed session:

1. Claim the session and inspect its next action.
2. Check transcript availability; import only with exact source-scoped permission or explicit user
   direction.
3. Complete the deterministic quality gate.
4. Fetch instructions and schema for the output kind.
5. Build the evidence packet. For runbook, ADR, or incident timeline, inspect provenance candidates
   and declare the full provenance set when more than the seed session is justified.
6. Write one schema-valid JSON output using only evidence refs in the packet.
7. Validate with the seed session and declared provenance.
8. Apply the output. Apply writes a current working artifact version; it does not publish.
9. Publish each valid artifact independently.
10. Mark unsupported optional automatic kinds N/A, or rely on contribution satisfaction when the
    session already belongs to a published multi-session artifact of that kind.
11. Release the claim and inspect Activity receipts.

The automatic path is resolved when the session package is published and runbook, ADR, and incident
timeline are each published, N/A, or satisfied by contribution.

## Core commands

Workbench UI should not ask people to run these commands. They are the agent-facing contract behind
the disposable handoff.

```bash
mastheadctl workbench status --json
mastheadctl workbench enroll --missing --json
mastheadctl workbench queue --kind session_enrichment --scope missing --json
mastheadctl workbench next --kind session_enrichment --scope missing --json
mastheadctl workbench claim --session session:abc --by codex --json

mastheadctl workbench transcript check --session session:abc --json
mastheadctl workbench transcript preview --session session:abc --source source:abc --json
mastheadctl workbench transcript import --session session:abc --source source:abc --json
mastheadctl workbench quality precheck --session session:abc --json

mastheadctl workbench instructions --kind runbook --scope candidates
mastheadctl workbench schema runbook --json
mastheadctl workbench provenance-candidates --session session:abc --json
mastheadctl workbench evidence --kind runbook --session session:abc --provenance session:abc,session:def --json
mastheadctl workbench validate --kind runbook --session session:abc --provenance session:abc,session:def --file runbook.json --json
mastheadctl workbench apply --kind runbook --session session:abc --provenance session:abc,session:def --file runbook.json --json

mastheadctl workbench artifacts --session session:abc --json
mastheadctl workbench publish --artifact artifact:abc --json
mastheadctl workbench not-applicable --kind adr --session session:abc --reason no_decision_evidence --json
mastheadctl workbench activity --session session:abc --json
```

`publish --session <id>` publishes the required session package when its gates pass. Multi-kind
artifacts use `publish --artifact <id>` after validation and apply.

For batch enrichment or artifact work:

```bash
mastheadctl workbench batch prepare --kind session_enrichment --scope missing --limit 10 --out .masthead/workbench/batch-001 --json
mastheadctl workbench batch apply .masthead/workbench/batch-001 --json
```

## Provenance rules

- A session dossier always has exactly one provenance session.
- Runbook, ADR, and incident timeline may have one or more provenance sessions.
- Multi-session apply requires a declared provenance set and a join rationale.
- Every evidence ref must resolve inside the declared provenance packet.
- Same project, topic, time window, or generic file overlap is not a sufficient automatic join by
  itself. Prefer a strong single-session artifact over a weak merge.
- A published multi-session artifact can satisfy a contributing seed session without a duplicate
  per-session artifact.

## Apply, publish, and N/A

- **Validate** checks schema, evidence refs, kind rules, and provenance.
- **Apply** stores a current artifact version and Workbench receipt.
- **Publish** admits that artifact capsule/body into Logbook and artifact-primary MCP retrieval.
- **N/A** resolves one optional kind for one seed session without creating an artifact row.
- **Contribution** resolves a seed session because a published shared artifact already includes it.

No enrichment or import action implicitly publishes a Logbook row.

## Privacy

Workbench evidence packets are bounded local database reads. No native remote model key is required
for the V1 handoff path. Agents must cite evidence refs, validate against the correct session and
provenance packet, and write only through `mastheadctl`.

Transcript contents remain governed by source-scoped permission and exclusions. Multi-session
authoring does not broaden that permission boundary.

## Legacy native hooks

Daemon endpoints such as `POST /enrichment/rebuild`,
`POST /sessions/:id/dossier/enrich`, and provider-settings endpoints are compatibility/development
hooks, not the V1 launch authoring path.
