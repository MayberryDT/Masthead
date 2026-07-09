# Masthead

Masthead is a local-first session data product for making AI-agent session history durable,
searchable, enrichable, and reusable by people and read-only agent retrieval.

## Language

**Workbench**:
A collaboration surface where the user and their coding agent turn captured sessions into
publishable session memory. Workbench owns transcript checks, transcript import, quality cleanup,
noise suppression, agent-authored enrichment, receipts, artifacts, and publication into Logbook.
_Avoid_: Command cookbook, CLI launcher, task manager

**Workbench operations surface**:
The compact, state-first Workbench UI for acting on captured sessions. It shows queue state,
readiness, claims, activity, evidence, and available actions through a dense table plus Workbench
Activity rail, without hero areas, onboarding panels, teaching copy, visible CLI recipes, or board
lanes.
_Avoid_: Instructional page, onboarding page, command guide

**Published session**:
A canonical session that has passed Workbench publication gates and is eligible for Logbook search.
Unpublished captured sessions stay out of Logbook.
_Avoid_: Imported session, captured session, raw session

**Publication transition**:
The explicit Workbench state change that moves a captured session into Logbook after its
publication gates are satisfied. Applying enrichment or creating an artifact is not publication by
itself.
_Avoid_: Auto-publish, enrichment apply, import complete

**Legacy publication backfill**:
A one-time explicit publication transition for existing sessions that were already Logbook-visible
before Workbench pipeline state existed and pass the cheap quality screen. It preserves continuity
while making legacy publication auditable.
_Avoid_: Hidden inference, automatic publication, migration default

**Logbook**:
The searchable library of published sessions. It supports search, browse, filtering, sorting, and
published Session Dossier inspection, but not raw-session cleanup, transcript import, bulk
enrichment, source setup, or Workbench process tracking.
_Avoid_: Workbench, import queue, enrichment surface

**Publication gate**:
A required Workbench condition before a captured session can become a published session. The gates
are transcript checked, quality accepted, enrichment applied, and receipt complete.
_Avoid_: Checklist, status label

**Publication memory requirement**:
The durable memory a captured session must have before publication: applied session enrichment and
a current session dossier, plus any evidence-applicable artifacts.
_Avoid_: Optional enrichment, blanket artifact requirement

**Workbench pipeline state**:
The canonical per-session Workbench state that says where a captured session sits between capture
and Logbook publication. It is the shared source for Workbench UI state, agent-facing tools,
publication filtering, suppression review, claims, next actions, and Activity.
_Avoid_: Inferred state, UI state, import status

**Transcript availability check**:
A lightweight Workbench check that determines whether a captured session appears to have an
importable transcript without importing the transcript body. This may run automatically because it
is a cheap readiness signal.
_Avoid_: Transcript import, transcript sync

**Transcript import**:
An explicit Workbench action that reads transcript content into Masthead-owned data. It requires
user intent or a user-directed agent command because it can be resource-heavy and privacy-sensitive.
_Avoid_: Transcript check, background sync

**Source-scoped transcript permission**:
Permission to import transcript content from a specific source or explicitly selected source group.
It is narrower than global or runtime-wide approval and must be respected by both user-facing
Workbench actions and agent-facing tools.
_Avoid_: Global transcript approval, runtime-wide approval

**Sources**:
The harness capture and permissions surface. Sources owns known harnesses, capture or hook
configuration, source health, readable paths, and source-scoped transcript permissions. It does not
own per-session transcript import work, Workbench queue state, enrichment, Logbook publication, or
import job review as the primary workflow.
_Avoid_: Import workflow, Workbench queue, enrichment surface

**Capture quality precheck**:
A deterministic Workbench pass over shallow captured-session metadata and evidence coverage before
transcript import. It can keep obvious junk out of the publish path without spending resources on
transcript import; failures move to Not Added to Logbook with a clear non-publication reason.
_Avoid_: Enrichment, transcript import

**Publication quality check**:
The stronger Workbench quality pass after transcript readiness is known. It decides whether a
session can proceed toward enrichment and publication or should move to suppressed-session review.
_Avoid_: Capture quality precheck, Logbook filter

**Non-publication reason**:
The Workbench explanation for why a captured session is not eligible for Logbook, such as missing
transcript, hook-only capture, no messages, duplicate noise, low evidence, or user-suppressed. The
reason must be visible to both the user and the agent-facing tools.
_Avoid_: Error, failure, hidden filter

**Unpublished session**:
A captured session that has not passed the publication gates. Unpublished sessions remain visible
in Workbench for import, cleanup, enrichment, suppression, purge review, or agent action.
_Avoid_: Logbook session, published session

**Suppressed session**:
An unpublished session that Workbench intentionally keeps out of the publish path because it is
noise or below the quality floor. Suppression is visible to the user in Workbench review surfaces,
but hidden from default agent-facing queues unless the user explicitly asks an agent to inspect it.
_Avoid_: Deleted session, failed session

**Not Added to Logbook**:
The Workbench bucket for captured sessions that failed the cheap quality screen or were otherwise
kept out of the publish path. It exists for human review, manual purge, and explicit recovery, not
as normal enrichment context for agents; default agent prompts may include only aggregate counts or
reason summaries, not session IDs or details from this bucket.
_Avoid_: Agent backlog, hidden Logbook, trash, main Workbench queue

**Purge candidate**:
A suppressed session that may be deleted by a retention policy because it is obvious junk, such as
hook-only, no-message, or duplicate-noise capture. Missing-transcript, tool-only, low-evidence, and
user-suppressed sessions are not purge candidates by default.
_Avoid_: Failed session, unpublished session

**Captured session**:
A raw session record received from live capture or source import before Workbench has decided
whether it should be suppressed, enriched, or published.
_Avoid_: Logbook session, normalized session

**Now state card**:
A shallow live-session card that shows current state, runtime/source identity, last activity, and
small counts when available. In V1 it is not a transcript viewer, enrichment surface, Workbench
dashboard, or full Dossier entry point for unpublished sessions.
_Avoid_: Live dossier, task card, enrichment card

**Post-apply audit**:
Review of enrichment, artifacts, validation results, and run history after the agent-facing
Workbench CLI has written them to the canonical database.
_Avoid_: Pending approval queue, draft editor

**Queue/evidence inspection**:
Triage of sessions that need memory work, paired with the bounded evidence packet that explains
why each session is in the queue and what the user's agent should inspect next. This is the first
useful Workbench V1 UI slice; audit history supports it at session scope but does not drive the
surface.
_Avoid_: Task board, live monitoring dashboard

**Agent work request**:
User-facing language that tells the user's coding agent what enrichment or artifact work to do in
Masthead. It may include session IDs, memory kinds, queue reasons, evidence coverage, and expected
outputs, but never terminal commands. The first V1 shape should stay lightweight and easy to
change after real use. In V1, it is a regenerated handoff from the current Workbench selection,
not a durable task, proposal, or workflow object.
_Avoid_: CLI command, script, recipe

**Disposable handoff**:
A temporary, copyable block of plain-language instructions generated from the current Workbench
selection for the user to give their coding agent. It is not saved, assigned, scheduled, or tracked
as a Masthead object in V1.
_Avoid_: Work item, request record, assignment

**Agent-facing machinery**:
The CLI, schemas, validation, and apply paths that a coding agent can use to perform Workbench
work, hidden behind the user-facing Workbench collaboration surface.
_Avoid_: User workflow, visible controls

**Workbench action parity**:
The invariant that user-facing Workbench controls and agent-facing tools operate on the same
pipeline state. Agent-facing tools may default to narrower, cleaner scopes, but they must not form
a separate enrichment workflow.
_Avoid_: Separate agent workflow, CLI-only state, UI-only state

**Default agent queue**:
The agent-facing Workbench queue shown when the user asks an agent to work on Masthead without
special instructions. It includes only publish-path sessions with actionable next steps and excludes
suppressed, purge-candidate, published, permission-blocked, and Not Added to Logbook items,
including their session IDs and details.
_Avoid_: Full Workbench queue, suppressed-session review, Logbook

**Agent guidance contract**:
The agent-facing CLI instructions, schema, evidence packet, validation, and apply behavior that
together make enrichment repeatable across sessions. This contract must be clear enough that a
coding agent can produce consistent enrichment from a disposable handoff without the user knowing
CLI details. In V1, `session_enrichment`, `session_dossier`, and `bug_fix_trace` are all
first-class guidance targets.
_Avoid_: Prompt hint, UI copy, user handoff

**Queue reason**:
The explicit reason a session appears in the Workbench queue, such as missing enrichment, stale
memory, low confidence, or artifact candidate.
_Avoid_: Priority, assignment

**Memory kind**:
The type of durable session memory being inspected or produced, such as session enrichment,
session dossier, or bug-fix trace.
_Avoid_: Command, workflow

**Evidence coverage**:
A compact summary of how much useful evidence is available for a queue item, including transcript,
file, tool, verification, timeline, and source-reference coverage.
_Avoid_: Quality score, progress percent

**Evidence inspector**:
The Workbench detail view for reviewing the bounded evidence packet behind a queue item.
_Avoid_: Transcript viewer, log dump

**Audit strip**:
A compact session-scoped summary of recent Workbench runs, validation results, and current or
superseded artifacts shown in support of queue/evidence inspection.
_Avoid_: Analytics dashboard, history page

**Agent-authored enrichment**:
Derived session memory written by an existing coding agent from bounded Masthead evidence. It is
evidence-backed local memory, not a native Masthead model run.
_Avoid_: Native enrichment, automatic summary

**Evidence packet**:
A bounded set of session facts, transcript excerpts, file effects, tool activity, verification,
timeline entries, and source references used to author or validate Workbench output.
_Avoid_: Prompt dump, full transcript, raw context

**Artifact**:
A durable record attached to a session, such as a dossier or bug-fix trace, with current and
superseded versions tracked explicitly.
_Avoid_: Note, blob, output file

**Artifact applicability**:
The Workbench decision that an artifact kind is required or not applicable for a captured session
based on available evidence. A non-applicable bug-fix trace is an intentional state, not a missing
artifact.
_Avoid_: Empty artifact, failed artifact, missing artifact

**Workbench queue item**:
A session selected for enrichment or artifact work because it is missing, stale, low-confidence, or
otherwise a candidate for agent-authored memory work.
_Avoid_: Task, ticket, job

**Workbench Activity**:
A compact session-scoped activity timeline showing what happened to a captured session inside
Workbench, such as transcript checks, transcript imports, quality decisions, enrichment, artifact
creation, publication, suppression, or purge. It is user-facing proof of progress, not a narrative
log or agent prompt dump.
_Avoid_: Receipt, run log, transcript, task history

**Workbench Activity rail**:
The live Workbench panel that visualizes active and recent Workbench Activity while the table keeps
selection, queue state, next actions, and handoff control.
_Avoid_: Board lane, task board, log console

**Workbench run**:
An auditable machine record behind Workbench Activity, such as a CLI validation or apply event. It
supports traceability but is not the main user-facing concept.
_Avoid_: Agent session, background process, Workbench Activity

**Workbench claim**:
A short-lived, lightweight lease showing that an agent has started active Workbench work on a small
set of publish-path sessions. It coordinates visibility and duplicate-work avoidance without
turning sessions into assigned tasks or adding noisy context to default agent prompts.
_Avoid_: Assignment, task ownership, project management

**Applied enrichment**:
The current agent-authored memory fields stored on a session after a Workbench CLI apply step, such
as capsule, live summary, and search projection.
_Avoid_: Draft, pending proposal

**Evidence ref**:
A stable reference from Workbench output back to an item inside the evidence packet.
_Avoid_: Citation URL, footnote

**Validation result**:
Structured feedback from checking Workbench output against schemas, evidence refs, confidence
rules, and safety constraints before or during apply.
_Avoid_: Lint, test result

**Current artifact**:
The latest active artifact for a session and artifact kind.
_Avoid_: Latest file

**Superseded artifact**:
An older artifact version that remains auditable but is no longer the active artifact for its kind.
_Avoid_: Deleted artifact
