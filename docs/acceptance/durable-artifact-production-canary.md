# Focused V3 durable-artifact canary

Status: **current fixture-only release acceptance**

This canary proves the complete `workbench-authoring-v3` user flow on a small isolated database. It
does not authorize a production write, migration, invalidation, or production-scale rehearsal. The
stopped 6.6 GB V2 rehearsal is historical and must not be resumed as part of this gate.

## User flow

**Select sessions → Copy Agent Prompt → give it to the coding agent → agent enriches and authors →
Masthead validates and atomically publishes → inspect/reuse in Logbook and MCP.**

Workbench exposes one normal authoring action: **Copy Agent Prompt**. The copied disposable prompt
contains every selected session ID and the `workbench-authoring-v3` machine request. It contains no
candidate dropdown, detector verdict, or standalone canonical-dossier publication action.

The coding agent must submit current durable enrichment for every selected session. It may also
author zero or more useful runbooks, ADRs, or incident timelines. Detector suggestions are private,
nonbinding context; an evidence-supported artifact can publish when a suggestion is absent or wrong.
The daemon rejects unsupported claims and atomically publishes the daemon-rebuilt enriched dossiers
with the accepted optional artifacts.

## Isolated corpus

The machine acceptance test creates a fresh temporary SQLite database and seeds four representative
sessions:

1. a completed implementation needing enrichment and only its rebuilt dossier;
2. a verified repeatable database recovery supporting a runbook;
3. a material local-first decision with a rejected hosted alternative supporting an ADR;
4. an ingestion failure, triage, remediation, and verification sequence supporting an incident timeline.

A second isolated case contains evidence for an ADR phrased so deterministic discovery returns no
suggestion. The agent-authored, verbatim-supported ADR must still publish.

The fixture source is
`src/workbench/authoring/__fixtures__/durableArtifactCorpus.ts`; the acceptance seam is
`src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts`.

## Machine gate

Run:

```bash
npx vitest run src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts
```

The gate passes only when:

- one V3 receipt contains four dossier artifact IDs;
- the optional kinds are exactly one runbook, one ADR, and one incident timeline;
- Logbook returns four enriched dossiers followed by those three optional artifacts;
- every dossier contains current `session-capsule-v4` durable enrichment;
- every optional claim excerpt occurs verbatim in its cited canonical fixture evidence;
- MCP `search_artifacts` finds every optional artifact and `get_artifact` returns its body and provenance;
- the absent-suggestion ADR publishes; and
- all database files are created below the operating system temporary directory and removed after the test.

Then run the focused authoring suite and release checks from the task brief:

```bash
npx vitest run \
  src/workbench/authoring/__tests__/agentLedAuthoringAcceptance.test.ts \
  src/workbench/authoring/__tests__/authoringService.test.ts \
  src/workbench/authoring/__tests__/authoringValidation.test.ts \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx \
  src/app/logbook/__tests__/useLogbookController.test.tsx \
  src/mcp/__tests__/retrieval.test.ts
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm run build
```

The ordinary Vite chunk-size warning is non-blocking. Any test failure, validation finding, missing
artifact, missing provenance, non-verbatim claim excerpt, or production-data access fails the gate.

## Optional UI inspection

When a rendered inspection is required, launch only against a new isolated data directory through
the repository-supported launcher. Verify the Workbench prompt and the resulting Logbook artifacts
at desktop, tablet, and narrow-mobile widths using the in-app Browser. Do not point the launcher at
the production database and do not run the historical production rehearsal.
