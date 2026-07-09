# Masthead

Masthead is a local-first session data product that turns AI-agent session history into durable,
evidence-backed engineering knowledge artifacts people and agents can search and reuse.

## Language

**Workbench**:
A collaboration surface where the user and their coding agent turn captured sessions into
validated artifacts ready for Logbook. Workbench owns transcript checks, transcript import, quality
cleanup, noise suppression, agent-authored enrichment, receipts, artifact authoring, and the
readiness path that allows artifacts to be published into Logbook.
_Avoid_: Command cookbook, CLI launcher, task manager

**Workbench operations surface**:
The compact, state-first Workbench UI for acting on captured sessions. It shows queue state,
readiness, claims, activity, evidence, and available actions through a dense table plus Workbench
Activity rail, without hero areas, onboarding panels, teaching copy, visible CLI recipes, or board
lanes.
_Avoid_: Instructional page, onboarding page, command guide

**Published session**:
Legacy term for a session that passed older Logbook-oriented publication gates. In the artifact-first
model, prefer **compile-ready session** and **automatic work resolved**; a session is not a
Logbook search hit.
_Avoid_: Logbook row, primary searchable unit

**Compile-ready session**:
A captured session that has passed Workbench prerequisites for agent compile work: transcript
checked as needed, quality accepted, and required permissions in place. It may be included in a
disposable handoff. It is not a Logbook hit and does not require artifacts yet.
_Avoid_: Published session, automatic work resolved, Logbook-ready session

**Automatic work resolved**:
Session-level state meaning the default automatic kind set is settled for that seed session: the
session package is published, and runbook, ADR, and incident timeline are each either published or
explicitly not applicable. This is the disposable-handoff exit criterion for that session.
_Avoid_: Compile-ready only, partial apply without N/A, Logbook session row

**Publication transition**:
The explicit Workbench state change that admits one artifact into Logbook after that artifact is
ready. Applying enrichment or drafting an artifact is not publication by itself. Artifacts publish
independently; sessions only become ready to contribute provenance and evidence.
_Avoid_: Auto-publish, enrichment apply, import complete, publish session as Logbook row

**Legacy publication backfill**:
A one-time explicit publication transition for existing sessions that were already Logbook-visible
before Workbench pipeline state existed and pass the cheap quality screen. Historical compatibility
concept; not a requirement for the artifact-first Logbook cutover when local Logbook data may be
wiped and rebuilt from source harness history.
_Avoid_: Hidden inference, automatic publication, migration default, must preserve old Logbook rows

**Logbook cutover wipe**:
The acceptable V1 approach for switching to an artifact-first Logbook: delete Masthead Logbook /
published artifact state (and related pipeline publish state as needed) rather than migrating old
session-row Logbook entries. Source harness session history on disk remains; Workbench can re-import
and re-compile. Dogfood databases may be reset multiple times.
_Avoid_: Long dual-read compatibility shim, preserve legacy Logbook rows as a product requirement

**Logbook**:
The searchable library of published artifacts. It is an artifact book, not a session table: every
search hit is an artifact (including session capsules listing session dossiers, plus runbooks, ADRs,
and incident timelines). It supports search, browse, filtering, sorting, and artifact inspection
with provenance back to source sessions. It does not own raw-session cleanup, transcript import,
bulk enrichment, source setup, or Workbench process tracking.
_Avoid_: Session library, session table, Workbench, import queue, enrichment surface, dual session/artifact browser

**Artifact-primary MCP**:
The read-only agent retrieval posture where default reuse tools search and fetch published
artifacts (and their evidence/provenance). Session, excerpt, and transcript tools remain available
for compile-time evidence and deep inspection, but are not the primary “memory” API.
_Avoid_: Session-only MCP, dual equal session/artifact memory APIs, write-capable MCP

**Publication gate**:
A required per-artifact condition before that artifact becomes searchable in Logbook. Session
readiness (transcript, quality, evidence) is a prerequisite for authoring, not a Logbook row.
_Avoid_: Checklist, status label, session-as-Logbook-gate alone

**Publication memory requirement**:
Per-artifact readiness rules that must be satisfied before publish, such as schema-valid body,
valid evidence refs, confidence, and kind-specific applicability. Session readiness is upstream of
authoring, not a substitute for artifact publish.
_Avoid_: Optional enrichment, blanket artifact requirement, publish whole session

**Workbench session states (artifact-first)**:
Two user-visible session states on the Workbench path: **compile-ready** (handoff may start) and
**automatic work resolved** (default automatic kind set settled: published session package plus
runbook/ADR/timeline each published or N/A). Finer pipeline chips may exist under the hood.
_Avoid_: Published session as Logbook eligibility, single binary published flag as the only state

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
dashboard, artifact browser, or Logbook. Artifact-first Logbook does not change Now’s job.
_Avoid_: Live dossier, task card, enrichment card, artifact library

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
together make enrichment and artifact compile repeatable. This contract must be clear enough that a
coding agent can finish the automatic handoff path without the user knowing CLI details. V1
first-class guidance targets are the session package plus runbook, ADR, and incident timeline
(with applicability / N/A rules).
_Avoid_: Prompt hint, UI copy, user handoff, legacy bug_fix_trace as the product name

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
timeline entries, and source references used to author or validate Workbench output. Single-session
packets support the session package; multi-session packets cover a declared provenance set and are
the only legal evidence universe for that multi-session apply/publish.
_Avoid_: Prompt dump, full transcript, raw context, evidence outside the declared provenance set

**Provenance candidate summary**:
A compact multi-session discovery view (titles, signatures, coverage, project, timing) used to
propose a provenance set before deep evidence is fetched. Not sufficient alone for apply.
_Avoid_: Full evidence packet, Logbook hit, implicit provenance

**Declared-set evidence packet**:
The bounded evidence packet for the fully declared provenance set P used at validate/apply/publish
for a multi-session artifact. Evidence refs must resolve inside this packet.
_Avoid_: Merging ad hoc single-session packets without a declared set, unbounded export

**Artifact**:
A durable, versioned unit of engineering knowledge. Every Logbook entry is an artifact. An
artifact has a kind, a listing capsule, a full body, current/superseded history, evidence refs,
and provenance to one or more source sessions.
_Avoid_: Note, blob, output file, session row, memory layer entry, listing alone

**Artifact body**:
The full inspectable content of an artifact opened from a Logbook listing. For the session kind,
the body is the session dossier. Other kinds have their own full bodies (runbook, ADR, and so on).
_Avoid_: Capsule, listing, snippet, search row

**Artifact capsule**:
The compact listing and search projection for one published artifact. Shared fields: kind, title,
summary, optional project, confidence, publishedAt, artifactId, optional signatureKey, provenance
size or short provenance label, and optional highlight (kind-aware one-liner such as symptom or
decision). Kind-specific detail lives in the artifact body, not in extra required capsule columns.
Every published artifact has a capsule; the capsule is not the artifact body.
_Avoid_: Dossier, full artifact, session row, memory layer, fat per-kind listing schema

**Capsule highlight**:
An optional single scan line on an artifact capsule that carries the highest-signal kind-aware
phrase (for example primary symptom, decision statement, or failure headline) without expanding the
shared capsule into a fat schema.
_Avoid_: Full summary, body field dump, required for every kind

**Session capsule**:
The artifact capsule for a session dossier. It is the Logbook listing for that session-scoped
artifact, not the dossier itself and not a separate product category from other capsules.
_Avoid_: Session dossier, session row, generic enrichment blob

**Session dossier**:
The full session-scoped artifact body for exactly one session: objective, context, approach,
decisions, files, tools, outcome, verification, risks, lessons, and evidence. In Logbook, the
session capsule lists it; opening the listing shows this body. A session dossier never spans
sessions.
_Avoid_: Session capsule, session row, bug-fix trace, runbook, multi-session summary

**Session-scoped artifact**:
An artifact whose provenance is exactly one source session. The only required session-scoped kind
is the session dossier (with its session capsule listing).
_Avoid_: Multi-session artifact, generic artifact

**Multi-session artifact**:
An artifact whose provenance may be one or more source sessions. Runbooks, ADRs, incident
timelines, environment recipes, eval packs, and similar engineering knowledge kinds are
multi-session-capable even when a given instance only used one session.
_Avoid_: Session dossier, session capsule, session row

**Provenance set**:
The set of source sessions an artifact is compiled from. Session dossiers have size one.
Multi-session artifacts declare their full set and may cite evidence only from sessions in that
set. The set is chosen by the authoring agent using Masthead tools and the agent guidance
contract, not by a separate human clustering UI.
_Avoid_: Implicit related sessions, hidden parents, manual session-picker as default UX

**Disposable-handoff path**:
The default Workbench path where the user copies a disposable handoff to their coding agent and
expects the agent to complete enrichment and artifact work with Masthead tools, largely without
further human decisions about grouping, clustering, or compile scope.
_Avoid_: Manual artifact studio, human clustering workflow, step-by-step approval wizard

**Directed-agent path**:
The path where the user drives their coding agent with their own instructions (not only the
disposable handoff). The human may iterate with the agent on provenance, artifact shape, and
quality; Masthead still validates evidence and schema, but does not force a handoff-only workflow.
_Avoid_: Only supported workflow, admin mode, separate product

**Agent-led compile**:
Artifact authoring in which the coding agent selects provenance, gathers evidence, produces
capsule and body, and applies through Masthead tools under the agent guidance contract. Default
expectation on the disposable-handoff path; also available on the directed-agent path when the
human asks for it.
_Avoid_: Silent server-side clustering with no agent, human-required session multi-select, native Masthead model run

**Signature-bounded expansion**:
The V1 policy for growing a multi-session provenance set beyond the handoff seed sessions. The
agent may search across projects, but may only add sessions that share a strong join key with the
seed work, must declare the provenance set and join rationale, and on the disposable-handoff path
must prefer a strong single-session artifact over a weak multi-session merge. Weak joins do not
auto-publish as multi-session artifacts. Directed-agent work may override with explicit human
instruction. This policy is revisable after real production use.
_Avoid_: Project-only expansion, free unkeyed expansion, silent clustering, mandatory human multi-select

**Strong join key**:
Evidence-backed similarity sufficient to justify multi-session provenance on the automatic path,
such as a shared failure/error signature, near-duplicate repro and failing check, the same decision
object with comparable constraints, or a shared environment-plus-symptom fingerprint. Same project,
same topic tags, same time window, or generic file overlap are weak alone.
_Avoid_: Topic similarity alone, same project alone, same week alone, semantic summary vibes

**Join rationale**:
The declared explanation, stored with a multi-session artifact, of why its provenance set belongs
together, citing the strong join key(s) used. Required for multi-session apply/publish validation.
_Avoid_: Implicit relatedness, undocumented cluster, search ranking as proof

**Automatic handoff completion**:
On the disposable-handoff path, the coding agent is expected to finish the full loop for in-scope
work: claim, evidence, provenance selection, apply capsule and body, validate, and publish
artifacts that pass kind rules. The human is not asked to cluster sessions or click publish.
Directed-agent work may stop earlier or change scope when the human instructs it to.
_Avoid_: Human publish click as default, partial handoff that only drafts, silent backend publish without agent tools

**Default automatic kind set**:
The kinds the disposable-handoff path always attempts: session capsule plus session dossier
(required session package), and when evidence supports them, runbook, ADR, and incident timeline
(each publish or mark not applicable). Environment recipes and eval packs are out of the default
automatic set until a later phase.
_Avoid_: Attempt every research kind, session package only, settings-only kind sets as V1 default

**Runbook**:
A multi-session-capable artifact body that captures a reproducible fix recipe. V1 body shape is the
merged schema: Masthead envelope (title, confidence, evidenceRefs, missingEvidence,
provenanceSessionIds, joinRationale when multi-session, optional signatureKey), research-shaped
core (problemSignature, preconditions, reproSteps, deadEnds, fixSteps, commands, changedFiles,
validationChecks, environmentRequirements), plus rootCause, preventionNotes, and risksOrGaps.
It replaces and evolves the former bug-fix trace kind.
_Avoid_: Bug-fix trace (product name), raw debug log, session dossier, fixSummary-only blob

**ADR artifact**:
A multi-session-capable artifact body for a material architecture or design decision: context,
decision, alternatives, consequences, and evidence. Distinct from incidental notes inside a
session dossier.
_Avoid_: Key decisions bullet list alone, session dossier, runbook

**Incident timeline**:
A multi-session-capable artifact body for a failure or debug narrative ordered by time: symptom,
timeline events, root cause when supported, remediation, prevention, and evidence.
_Avoid_: Session dossier timeline section alone, runbook, raw event dump

**Kind taxonomy (V1 automatic)**:
The first-class artifact kinds for the automatic path: session dossier (with session capsule
listing), runbook, ADR artifact, and incident timeline. Legacy bug-fix trace is migrated into
runbook rather than kept as a parallel product kind.
_Avoid_: Parallel deprecated kinds in the agent contract, single generic engineering_artifact type

**Session package**:
The required session-scoped Logbook spine for a ready session: session capsule (listing) and
session dossier (body). Other artifact kinds hang off evidence and may use a wider provenance set.
_Avoid_: Full artifact catalog, enrichment-only row, optional dossier

**Published artifact**:
An artifact that has passed its publication gate and is eligible for Logbook search and read-only
agent retrieval. Its capsule is the search hit; its body is what opens on select. Drafts, rejected
outputs, and unpublished applied working copies stay out of Logbook.
_Avoid_: Applied enrichment, Workbench draft, session publish alone

**Artifact provenance**:
The explicit link from an artifact back to its provenance set and evidence refs. Every claim in the
artifact body must be supportable from that set.
_Avoid_: Implicit attachment, hidden parent session, evidence from outside the provenance set

**Artifact applicability**:
The Workbench decision that an artifact kind is required, optional, or not applicable for a given
seed session based on available evidence. Not applicable is a session-relative pipeline fact and
does not create a Logbook row.
_Avoid_: Empty artifact, failed artifact, missing artifact, N/A stub in Logbook

**Not applicable (N/A)**:
Session-relative pipeline state meaning the default automatic path will not produce a given kind
from this seed session. It is intentional, auditable in Workbench Activity, and never a published
Logbook artifact.
_Avoid_: Published stub, failed artifact, missing artifact treated as error

**Satisfied via contribution**:
Session-relative pipeline state meaning the seed session is in the provenance set of a published
multi-session artifact of that kind, so the kind is resolved for automatic work without a second
session-local copy.
_Avoid_: Duplicate per-session publish, N/A when a real shared artifact exists

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
The Workbench apply path that writes agent-authored memory. For the session kind this updates the
session capsule (listing) and/or session dossier (body) according to the output kind; it does not
by itself publish into Logbook.
_Avoid_: Draft, pending proposal, Logbook hit, publish

**Current artifact**:
The latest active version of an artifact for its identity and kind.
_Avoid_: Latest file, session row

**Artifact id**:
The opaque stable identifier for an artifact lineage. Apply/publish/supersede and MCP get use this
id; it is not derived only from a seed session.
_Avoid_: Session id as artifact id, content hash as the only public id

**Signature key**:
An optional normalized key for a knowledge object (for example a problem or decision signature,
optionally scoped) used to detect that a new publish should supersede an existing current artifact
of the same kind. Weak or missing keys create a new lineage rather than forcing a bad merge.
_Avoid_: Session id, free-text title alone, mandatory global unique title

**Artifact lineage**:
The version chain of an artifact id (or signature-linked chain) through current and superseded
bodies. Revisions preserve history; they do not silently overwrite.
_Avoid_: In-place mute edit, delete-and-replace without history

**Evidence ref**:
A stable reference from Workbench output back to an item inside the evidence packet.
_Avoid_: Citation URL, footnote

**Validation result**:
Structured feedback from checking Workbench output against schemas, evidence refs, confidence
rules, and safety constraints before or during apply.
_Avoid_: Lint, test result

**Superseded artifact**:
An older artifact version that remains auditable but is no longer the active artifact for its kind.
_Avoid_: Deleted artifact
