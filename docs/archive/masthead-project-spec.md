# Masthead Project Spec

> Historical document. Current product scope is defined by `prd.md`; current visual direction is
> defined by `design.md`.

## Local Coding-Agent Control Tower Product Requirements and Technical Design Specification

**Status:** Draft v0.1  
**Date:** June 22, 2026  
**Project name:** Masthead  
**Initial license intent:** MIT  
**Initial platform:** One developer, one local computer, Codex-first  
**Document purpose:** Serve as the primary product, UX, architecture, implementation, and scope document for starting the repository.

---

## 1. Executive Summary

Masthead is a local-first desktop control tower for developers who run several AI coding-agent sessions at the same time. It gives the developer one second-screen view of what every agent is doing, which project and branch it is touching, what files and commands are active, what has failed, what needs human attention, and whether parallel sessions are likely to conflict.

The basic monitoring category already exists. Several open-source tools can display Codex or Claude Code sessions, event timelines, token usage, approvals, and basic health status. Therefore, this project should not compete primarily as “a dashboard for agent sessions.” Its distinctive product should be:

1. **Attention routing:** identify which session needs the developer now.
2. **Git-aware collision detection:** identify when simultaneous agents may interfere with one another.
3. **Outcome tracking:** connect agent activity to concrete changes, tests, commits, and completed work.
4. **A native second-monitor experience:** dense, readable, real-time, and designed for continuous passive observation.
5. **Local ownership:** no cloud account, no mandatory telemetry, and no silent upload of code, prompts, or transcripts.

The first release is deliberately limited to Codex sessions on one local machine. It observes before it controls. It does not rank employees, compare developers, manage teams, or attempt to become a general multi-agent platform.

### Developer summary

Masthead is a local desktop observability and coordination layer for developers running multiple AI coding agents in parallel. It normalizes Codex lifecycle events, independently watches Git and process state, prioritizes sessions that need human attention, and detects cross-session file, branch, worktree, and shared-resource conflicts. It stores all event history locally and links sessions to tangible outcomes such as diffs, command results, commits, and completed tasks.

### One-line pitch

> **See every coding agent, catch collisions early, and know where your attention is needed.**

### Positioning statement

> Masthead is the local control tower for parallel AI-assisted development: not a token dashboard, not an employee tracker, and not another chat client.

---

## 2. Problem

AI coding agents can now work for extended periods, edit many files, execute commands, run tests, and operate across multiple repositories. A developer can reasonably have three or more tasks running at once.

That creates a new bottleneck: **human attention**.

The developer repeatedly has to determine:

- Which agents are still working?
- Which session is waiting for permission or clarification?
- What task is each session actually attempting?
- Which command is currently running?
- What files have changed?
- Did the tests pass?
- Is a session stuck in a loop?
- Did an agent stop after an error?
- Did two agents edit the same file or shared module?
- Did one agent modify a schema or dependency another task relies on?
- Which completed task needs review first?
- What happened while the developer was focused on another project?
- Which work became a commit or a usable result, and which work was abandoned?

The individual agent applications expose pieces of this information, but they generally organize work around separate threads or terminals. That still forces the developer to visit each session to reconstruct overall state.

A generic monitoring dashboard helps, but monitoring alone is insufficient. Activity is not the same as progress, and a list of events is not the same as knowing what requires intervention.

---

## 3. Product Thesis

The product thesis is:

> As coding agents become more autonomous and developers run more tasks in parallel, the scarce resource shifts from code generation to supervision, coordination, and attention.

Masthead should convert scattered agent activity into three useful answers:

1. **What is happening?**
2. **What needs me?**
3. **What may collide?**

A fourth answer becomes important after the first three work:

4. **What did this activity actually produce?**

The application should make abnormal, risky, blocked, conflicting, and completed states more visible than healthy background activity.

---

## 4. Product Decisions

These decisions are fixed for the first release unless evidence strongly contradicts them.

### 4.1 Codex-first

The first adapter supports Codex. Other coding-agent runtimes and harnesses are future integrations.

The long-term product should support the popular coding-agent ecosystem, including Claude Code, Hermes, OpenClaw, Pi, Kilo Code, Cursor/OpenCode-style adapters, and other emerging harnesses as the category stabilizes. That direction should shape the adapter boundary, event protocol, and UI vocabulary, but it should not widen the first release.

Reasons:

- Codex matches the initial user’s current workflow.
- Masthead is being designed and dogfooded inside a Codex workflow.
- It reduces adapter and state-normalization complexity.
- Codex exposes official lifecycle hooks and a structured App Server interface.
- A complete vertical slice for one runtime is more valuable than shallow support for many runtimes.
- The core state model should be adapter-neutral, but it should be proven through one high-quality adapter first.

### 4.2 Local-only

The initial system runs entirely on one computer.

- No user account.
- No organization.
- No team dashboard.
- No cloud database.
- No remote access by default.
- No manager analytics.
- No uploaded transcripts.
- No employee productivity rankings.

### 4.3 Observe before control

Version 0.1 is primarily read-only.

It may:

- Observe sessions.
- Show status.
- Display commands and file changes.
- Notify the user.
- Open or focus the original Codex session.
- Link to files, diffs, or terminals.

It should not initially:

- Approve dangerous operations automatically.
- Stop or redirect agents.
- Launch large agent fleets.
- Execute arbitrary commands from the dashboard.
- Rewrite prompts on the user’s behalf.

Control features can follow after observation is reliable.

### 4.4 Git is an independent source of truth

Masthead should not rely exclusively on what an agent says it changed.

It should independently observe:

- Repository root.
- Branch.
- Worktree.
- Head commit.
- Dirty state.
- Changed paths.
- Diff statistics.
- Conflicting paths.
- Commits made during a session.

Agent events are useful context. Git and process observations provide independent evidence.

### 4.5 Deterministic alerts first

The first attention and conflict rules should be deterministic.

Examples:

- Approval requested.
- User response requested.
- Command failed.
- Same command failed repeatedly.
- No activity for a configured interval.
- Exact file overlap across active sessions.
- Database migration modified.
- Dependency manifest modified.
- Port collision detected.
- Agent completed without recorded tests.

An LLM may later summarize or classify ambiguous activity, but it should not be required for core status or conflict detection.

### 4.6 MIT-licensed core

The repository should use a standard MIT license unless a dependency or commercial strategy creates a specific reason not to.

The open-source core should include:

- Event protocol.
- Codex adapter.
- Local collector.
- Git observer.
- Conflict engine.
- Desktop UI.
- SQLite schema.
- Tests and fixtures.

Future hosted synchronization or enterprise policy services could be separate, but they are not part of the current plan.

---

## 5. Primary User

### 5.1 Initial user

A solo developer who:

- Uses Codex frequently.
- Runs two to six coding sessions in parallel.
- Works across several repositories.
- Uses worktrees, branches, or multiple project folders.
- Wants a dedicated second-monitor view.
- Needs to know which session requires attention without opening every thread.
- Values local privacy.
- Wants a polished tool that is also technically credible.

### 5.2 Jobs to be done

#### While agents are working

- “Show me all live sessions at a glance.”
- “Tell me which session needs me.”
- “Show me what each agent is doing without making me read the entire transcript.”
- “Warn me before two agents interfere with each other.”
- “Tell me when an agent becomes stuck or repeatedly fails.”

#### When an agent finishes

- “Show me what changed.”
- “Show me whether tests or builds ran.”
- “Show me whether the working tree is clean.”
- “Show me which commit came from the session.”
- “Let me open the correct terminal, diff, or project immediately.”

#### Later

- “Show me what happened today.”
- “Find the session where I changed authentication.”
- “Show me abandoned work.”
- “Show me repeated failure patterns in this repository.”

---

## 6. Non-Goals

The first product is not:

- A general-purpose coding agent.
- A replacement for Codex.
- A model provider.
- A code editor.
- An AI code reviewer.
- A full CI platform.
- A hosted observability service.
- An employee-surveillance product.
- A developer leaderboard.
- A token-spend optimization dashboard.
- A multi-machine fleet manager.
- A general project-management suite.
- A GitHub pull-request manager.
- An automatic merge system.
- A fully autonomous orchestration layer.

The product may eventually touch some of these areas, but they should not distort the first release.

---

## 7. Product Principles

### 7.1 Attention over activity

The default view should answer “what needs me?” rather than “how many events occurred?”

### 7.2 Evidence over claims

When possible, use:

- Process state.
- Exit codes.
- File-system state.
- Git state.
- Commit state.
- Structured lifecycle events.

Do not treat a confident agent message as proof that work succeeded.

### 7.3 Explain every alert

Every warning should include evidence.

Bad:

> Conflict risk: 82%

Better:

> Both sessions modified `src/lib/auth/session.ts`. One also changed `src/middleware.ts`. Neither change is committed.

### 7.4 Local by default

The user should be able to install and use the application without an account or API key.

### 7.5 Quiet when healthy

Healthy background work should be visible but not noisy. The interface should become visually assertive only when something changes state or needs action.

### 7.6 Fast glanceability

A developer should understand the overall system in several seconds from a second monitor.

### 7.7 Progressive disclosure

The board shows status. Session detail shows evidence. Raw events remain available but are not the primary interface.

### 7.8 Adapter boundaries

Agent-specific event formats should terminate at an adapter. The rest of the product should use a stable internal event model.

---

## 8. Core Product Loop

1. Codex starts a session.
2. Masthead detects it through hooks, App Server events, or both.
3. The collector normalizes events into a local event stream.
4. Git and process observers independently inspect the project.
5. A state reducer derives the session’s current state.
6. The attention engine determines whether the session needs intervention.
7. The conflict engine compares active work across sessions.
8. The desktop board updates in real time.
9. The developer opens the session only when intervention or review is needed.
10. When the task ends, Masthead links the session to its diff, commands, tests, and commits.
11. History remains searchable locally.

---

## 9. Information Architecture

The first release should contain five primary surfaces.

### 9.1 Live Board

The default second-monitor view.

Shows:

- All active and recently completed sessions.
- Project.
- Task title or inferred objective.
- Agent status.
- Current action.
- Duration.
- Changed-file count.
- Diff statistics.
- Last command and result.
- Branch and worktree.
- Alert indicators.
- Conflict indicators.
- Verification indicators.

### 9.2 Needs You

A prioritized global attention inbox.

Contains:

- Approval requests.
- Questions awaiting the user.
- Failed commands.
- Repeated failures.
- Stalled sessions.
- High-risk changes.
- Cross-session conflicts.
- Completed tasks awaiting review.
- Sessions that claim completion but have an uncommitted or unverified state.

### 9.3 Session Detail

A complete view of one task.

Contains:

- Objective.
- Current status.
- Plan/progress.
- Event timeline.
- Current and recent commands.
- Changed files.
- Unified diff.
- Test/build outcomes.
- Git history.
- Alerts and evidence.
- Session metadata.
- Button to focus or open the original Codex session.

### 9.4 Conflict Radar

A cross-session view.

Contains:

- Exact path overlaps.
- Module/directory overlaps.
- Shared manifests and schemas.
- Worktree/branch relationships.
- Predicted Git merge conflicts.
- Shared local-resource collisions such as ports.
- Evidence and recommended review order.

### 9.5 History

A searchable local archive.

Search by:

- Project.
- Branch.
- File.
- Command.
- Task text.
- Status.
- Date.
- Commit.
- Alert type.
- Outcome.

---

## 10. Primary Screen: Live Board

### 10.1 Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ MASTHEAD   3 ACTIVE   2 NEED YOU   1 CONFLICT   4 COMPLETED TODAY      │
├──────────────────────────────────────┬───────────────────────────────────┤
│ NEEDS YOU                            │ SYSTEM                            │
│ 1. Pip: approval requested           │ Codex adapter: connected          │
│ 2. API: repeated test failure        │ Git observer: healthy             │
│ 3. Landing: file collision           │ Local database: healthy           │
├──────────────────────────────────────┴───────────────────────────────────┤
│ Pip / auth-fix                                         RUNNING TESTS     │
│ Fix Google OAuth callback                                             12m │
│ $ npm run test:e2e -- auth                    8 files   +326 / -81        │
│ branch: agent/auth-fix    worktree: Pip-auth-2    no conflicts           │
├──────────────────────────────────────────────────────────────────────────┤
│ Internal Tools / imports                              NEEDS APPROVAL      │
│ Rebuild customer import pipeline                                      7m │
│ Requests: prisma migrate deploy                 DB MIGRATION              │
│ [Inspect] [Open Codex]                                                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Landing / pricing                                 POSSIBLE COLLISION      │
│ Updating pricing components                                            5m │
│ Shared path with Pip session: packages/ui/PricingCard.tsx                 │
│ [View overlap]                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Card priority

Cards are ordered by:

1. Blocking approval or question.
2. Confirmed conflict.
3. Repeated failure or stalled state.
4. Completed and awaiting review.
5. Active work.
6. Recently completed and reviewed.

### 10.3 Card density

The user should be able to see at least six sessions on a typical 1440p secondary monitor without scrolling.

### 10.4 Visual language

Avoid a generic analytics-dashboard appearance.

Prefer:

- Strong typography.
- Dense but calm cards.
- Compact event indicators.
- A command-line and Git visual vocabulary.
- Subtle motion only for live state transitions.
- Clear warning hierarchy.
- No decorative charts without an operational purpose.
- No arbitrary “AI confidence score.”

---

## 11. Session State Model

The application should maintain a deterministic primary status and optional secondary flags.

### 11.1 Primary statuses

| Status | Meaning |
|---|---|
| `starting` | Session detected; context not fully known |
| `planning` | Agent is preparing or revising a plan |
| `reading` | Agent is inspecting files or context |
| `editing` | Agent is changing files |
| `running_command` | A command is active |
| `testing` | A recognized test, lint, type-check, or build command is active |
| `waiting_for_approval` | Agent requests tool or command permission |
| `waiting_for_user` | Agent asks for information or a decision |
| `blocked` | Agent cannot proceed because of a known condition |
| `stalled` | No meaningful progress for a configured interval |
| `possibly_looping` | Repeated equivalent operations or failures detected |
| `failed` | Session ended or stopped after an unrecovered failure |
| `completed_unreviewed` | Agent completed; user has not reviewed outcome |
| `completed_reviewed` | User marked outcome reviewed |
| `abandoned` | User or system marked the task abandoned |
| `unknown` | Evidence is insufficient |

### 11.2 Secondary flags

- `dirty_worktree`
- `uncommitted_changes`
- `tests_passed`
- `tests_failed`
- `no_tests_observed`
- `build_passed`
- `build_failed`
- `high_risk_change`
- `exact_file_overlap`
- `module_overlap`
- `merge_conflict_likely`
- `shared_resource_collision`
- `agent_claims_complete`
- `approval_pending`
- `question_pending`
- `adapter_degraded`

### 11.3 State derivation

State is derived from evidence in priority order:

1. Explicit lifecycle event.
2. Active command classification.
3. Recent tool event.
4. Process state.
5. File-system activity.
6. Agent message.
7. Timeout heuristic.

Agent message text may contribute context but should not override stronger evidence.

---

## 12. Attention Engine

### 12.1 Objective

Reduce the cost of supervising parallel sessions by producing one prioritized queue.

### 12.2 Priority levels

#### P0 — Immediate decision

- Destructive command approval.
- Credential or secret exposure risk.
- Data deletion.
- Production deployment.
- Migration against a non-local database.
- Security-sensitive permission change.

#### P1 — Blocking or failing

- Agent question.
- Standard approval request.
- Command failure.
- Repeated failure.
- Confirmed cross-session file overlap.
- Likely merge conflict.
- Port or process collision.
- Session stalled beyond threshold.

#### P2 — Review needed

- Task completed.
- Large diff.
- Authentication, billing, database, deployment, or dependency change.
- Completed without observed tests.
- Tests passed but working tree changed afterward.
- Uncommitted changes remain.

#### P3 — Informational

- New session.
- Branch changed.
- Commit created.
- Test suite started.
- Worktree became clean.
- Session resumed.

### 12.3 Alert contract

Every attention item must include:

- Session ID.
- Project.
- Type.
- Severity.
- Timestamp.
- Short human-readable title.
- Evidence.
- Related paths, command, or event IDs.
- Suggested next action.
- Dismiss/snooze state.
- Resolution state.

### 12.4 Initial deterministic rules

Examples:

```yaml
rules:
  - id: approval-requested
    when: event.type == "approval.requested"
    severity: P1

  - id: repeated-command-failure
    when: equivalent_command_failures >= 3 within 10m
    severity: P1

  - id: completed-without-verification
    when:
      session.status == "completed_unreviewed"
      and no_successful_test_or_build_after_last_code_change
    severity: P2

  - id: exact-file-overlap
    when: active_sessions_same_repo_changed_path_overlap > 0
    severity: P1

  - id: migration-change
    when: changed_path matches migration_patterns
    severity: P2
```

### 12.5 Loop detection

The first loop detector should look for:

- Same command with same normalized arguments failing repeatedly.
- Alternation between the same two file edits.
- Repeated test runs with unchanged Git state and equivalent failure output.
- Repeated requests for the same missing input.
- High event volume with no file, command-result, plan, or commit progress.

The UI must call this “possible loop” rather than asserting certainty.

---

## 13. Git-Aware Conflict Engine

This is the strongest initial differentiator.

### 13.1 Objective

Warn the developer before parallel agents create expensive merge or logical conflicts.

### 13.2 Sources

- Repository root.
- Worktree path.
- Branch.
- Merge base.
- Head commit.
- Staged paths.
- Unstaged paths.
- Untracked paths.
- Recent commits during the session.
- Active commands.
- Agent-reported intended paths when available.
- Package manifests.
- Database migration directories.
- API schemas.
- Generated-code directories.
- Local ports and service processes.

### 13.3 Conflict categories

#### Exact file overlap

Two active sessions modify the same path.

```text
Session A: src/lib/auth/session.ts
Session B: src/lib/auth/session.ts
```

Highest-confidence early warning.

#### Directory or module overlap

Two sessions change files within the same bounded module.

```text
Session A: src/lib/auth/session.ts
Session B: src/lib/auth/tokens.ts
```

Lower confidence than exact overlap but still useful.

#### Shared contract overlap

One session changes a shared contract while another changes a consumer.

Examples:

- Type definitions.
- API schemas.
- Database schema.
- Generated clients.
- Package exports.
- Environment configuration.
- Dependency manifests.
- Shared UI component interfaces.

#### Migration overlap

Multiple sessions add or edit migrations in the same database sequence.

#### Branch/worktree collision

Sessions use:

- The same working directory.
- The same branch.
- A worktree with an unexpected branch.
- Branches with diverging changes likely to conflict.

#### Merge simulation conflict

Masthead performs a safe, read-only merge-tree or equivalent dry-run using temporary refs or Git’s merge analysis.

It must not modify the user’s working tree.

#### Runtime-resource collision

Examples:

- Same local port.
- Same development database.
- Same generated output directory.
- Same lock file.
- Same emulator or service resource.

### 13.4 Conflict severity

| Severity | Example |
|---|---|
| Info | Same repository, disjoint modules |
| Low | Same module, no exact path overlap |
| Medium | Shared manifest or schema touched |
| High | Same file modified |
| Critical | Dry-run merge conflict or same branch/worktree mutation |

### 13.5 Evidence presentation

```text
HIGH CONFLICT RISK

Pip / auth-fix
  modified src/lib/auth/session.ts
  modified src/app/api/auth/callback.ts

Pip / middleware-cleanup
  modified src/lib/auth/session.ts
  modified src/middleware.ts

Shared path
  src/lib/auth/session.ts

Git state
  both sessions have uncommitted changes

Recommended action
  pause one task or commit and rebase before both continue
```

### 13.6 No opaque score

A numeric risk score may exist internally for sorting, but the UI should lead with concrete evidence and category.

---

## 14. Outcome Tracking

Monitoring becomes substantially more useful when activity is connected to results.

### 14.1 Outcome graph

```text
Session
  ├── objective
  ├── events
  ├── changed files
  ├── command runs
  ├── test/build results
  ├── commits
  ├── final Git state
  └── review disposition
```

Future optional links:

```text
Commit
  └── pull request
      └── CI result
          └── merge or rejection
```

### 14.2 First-release outcomes

Track:

- Session started and ended.
- Initial and final Git head.
- Files changed.
- Lines added/removed.
- Commands executed.
- Test/lint/type-check/build commands.
- Exit codes.
- Commits created during session.
- Final dirty/clean state.
- User review status.
- User result label:
  - accepted
  - partially accepted
  - abandoned
  - superseded
  - failed

### 14.3 Completed-state checks

When an agent reports completion, Masthead should check:

- Is a command still running?
- Is the working tree dirty?
- Did tests run after the final code modification?
- Did the last test/build pass?
- Was a commit created?
- Did another session modify overlapping files afterward?
- Is an approval still pending?

It should not block completion, but it should display any inconsistency.

---

## 15. Session Detail Design

### 15.1 Header

- Project name.
- Repository path.
- Branch.
- Worktree.
- Objective.
- Current status.
- Started time.
- Duration.
- Model/runtime metadata when available.
- “Open Codex” or “Focus terminal” action.

### 15.2 Current activity

- Current tool.
- Current command.
- Current plan step.
- Active process.
- Latest meaningful agent message.

### 15.3 Progress timeline

Use normalized events:

```text
10:42 Session started
10:43 Read src/lib/auth/session.ts
10:46 Modified src/lib/auth/session.ts
10:48 Ran npm test -- auth
10:49 Test failed: 2 failures
10:51 Modified src/lib/auth/callback.ts
10:55 Ran npm test -- auth
10:56 18 tests passed
10:57 Agent reported completion
```

### 15.4 File changes

- Changed path.
- Status: added/modified/deleted/renamed.
- First-seen and last-seen time.
- Diff stats.
- Session attribution confidence.
- Overlap indicators.
- Open in editor.
- Open diff.

### 15.5 Commands

- Command and arguments.
- Working directory.
- Start/end.
- Exit code.
- Truncated output.
- Output hash.
- Classification:
  - test
  - build
  - lint
  - type-check
  - package install
  - migration
  - deployment
  - destructive
  - other

### 15.6 Raw events

Raw payloads remain accessible for debugging but are hidden behind an advanced panel.

---

## 16. Notifications

### 16.1 Desktop notifications

Notify only for configured attention events:

- Approval requested.
- User question.
- Session failure.
- Repeated failure.
- High/critical conflict.
- Task completed.
- Session stalled.

### 16.2 Notification behavior

A notification should:

- Name the project and task.
- State the reason.
- Open the correct Masthead session.
- Avoid exposing sensitive prompt contents by default.
- Respect do-not-disturb settings.
- Coalesce repeated events.

### 16.3 Second-monitor mode

When the application is visible on a second monitor:

- Prefer in-app visual alerts.
- Optionally suppress redundant OS notifications.
- Keep critical alerts visible until acknowledged.

---

## 17. Onboarding

### 17.1 First run

1. Explain local-only data behavior.
2. Detect Codex installation.
3. Detect Git.
4. Offer to install the Masthead Codex hook configuration.
5. Show the exact configuration change before applying it.
6. Generate a local ingestion token.
7. Run a test event.
8. Show connection status.
9. Offer to scan known project folders.
10. Open the Live Board.

### 17.2 Installation safety

- Back up existing Codex hook configuration.
- Merge rather than overwrite.
- Provide an uninstall command.
- Never store provider API keys.
- Bind ingestion server to `127.0.0.1`.
- Require a local bearer token.
- Reject oversized payloads.
- Redact known secret patterns before persistence.

### 17.3 Degraded mode

If hooks are unavailable:

- Show Git/process observations.
- Clearly mark agent-specific fields unavailable.
- Do not invent session status.
- Offer diagnostics and repair instructions.

---

## 18. Codex Integration Strategy

Masthead should use layered integration rather than depend on one fragile source.

### 18.1 Layer A: Codex lifecycle hooks

Use official hooks for passive observation.

Useful lifecycle categories include:

- Session start/end.
- User prompt submission.
- Tool use before/after.
- Approval or permission request.
- Subagent lifecycle.
- Turn completion.

Benefits:

- Works while the user continues using Codex normally.
- Good fit for observe-only mode.
- Simple event forwarding to localhost.
- Does not require Masthead to own the agent session.

Limitations:

- Hook payload coverage may change.
- Some internal detail may not be exposed.
- Transcript files should not be treated as a permanent stable API.
- Event delivery can fail if the app is closed.

### 18.2 Layer B: Codex App Server

Use the official App Server interface for richer or managed mode.

Potential benefits:

- Structured JSON-RPC events.
- Thread, turn, and item lifecycle.
- Command execution updates.
- File-change events.
- Plans and diffs.
- Approval requests.
- Token usage.
- More reliable session state.

This layer should be added after passive observation works.

### 18.3 Layer C: Independent Git observer

Always active for known repositories.

Provides:

- Changed paths.
- Diff stats.
- Branch/worktree state.
- Commits.
- Merge analysis.
- Overlap detection.

### 18.4 Layer D: Process and file observer

Provides:

- Active process.
- Child commands.
- Port use.
- File-system activity.
- Process exit.
- Stalled-process hints.

### 18.5 Adapter rule

No agent-specific payload should be consumed directly by UI code.

```text
Codex hook/App Server payload
        ↓
Codex adapter
        ↓
Normalized Masthead event
        ↓
Event store and reducer
        ↓
UI
```

---

## 19. Normalized Event Protocol

### 19.1 Event envelope

```ts
type AgentEvent = {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  source: "codex_hook" | "codex_app_server" | "git" | "process" | "filesystem" | "user";
  sourceEventId?: string;
  occurredAt: string;
  receivedAt: string;
  projectId?: string;
  repoId?: string;
  worktreeId?: string;
  type: AgentEventType;
  summary?: string;
  payload: Record<string, unknown>;
  sensitivity: "metadata" | "content" | "secret_candidate";
};
```

### 19.2 Initial event types

```text
session.discovered
session.started
session.resumed
session.ended
session.status_changed

turn.started
turn.completed
turn.failed

plan.created
plan.updated
plan.step_started
plan.step_completed

message.user
message.agent

tool.started
tool.completed
tool.failed

command.started
command.output
command.completed

approval.requested
approval.resolved
question.requested
question.resolved

file.observed_changed
file.agent_reported_changed

git.snapshot
git.commit_created
git.branch_changed
git.worktree_changed

test.started
test.completed
build.started
build.completed

alert.created
alert.resolved
conflict.detected
conflict.resolved

review.marked
outcome.recorded
```

### 19.3 Event storage

Use an append-only event table.

Derived session state is materialized separately and can be rebuilt from events.

Benefits:

- Debuggability.
- Schema evolution.
- Reprocessing.
- Replaying fixtures.
- Auditable alerts.
- Adapter testing.

### 19.4 Deduplication

Deduplicate using:

- Source event ID when available.
- Session ID.
- Event type.
- Normalized payload hash.
- Small time window.

---

## 20. Data Model

### 20.1 Core tables

#### `projects`

- `id`
- `name`
- `root_path`
- `created_at`
- `last_seen_at`
- `archived_at`

#### `repositories`

- `id`
- `project_id`
- `root_path`
- `remote_url_hash`
- `default_branch`
- `created_at`
- `last_seen_at`

#### `worktrees`

- `id`
- `repository_id`
- `path`
- `branch`
- `head_commit`
- `last_seen_at`

#### `sessions`

- `id`
- `adapter`
- `external_session_id`
- `project_id`
- `repository_id`
- `worktree_id`
- `title`
- `objective`
- `status`
- `started_at`
- `ended_at`
- `last_activity_at`
- `review_state`
- `outcome`
- `metadata_json`

#### `events`

- `id`
- `session_id`
- `source`
- `source_event_id`
- `type`
- `occurred_at`
- `received_at`
- `summary`
- `payload_json`
- `sensitivity`
- `payload_hash`

#### `command_runs`

- `id`
- `session_id`
- `event_id`
- `command`
- `normalized_command`
- `cwd`
- `category`
- `started_at`
- `ended_at`
- `exit_code`
- `output_excerpt`
- `output_hash`

#### `file_changes`

- `id`
- `session_id`
- `repository_id`
- `worktree_id`
- `path`
- `change_type`
- `first_seen_at`
- `last_seen_at`
- `added_lines`
- `deleted_lines`
- `attribution_confidence`

#### `git_snapshots`

- `id`
- `session_id`
- `worktree_id`
- `captured_at`
- `head_commit`
- `branch`
- `staged_paths_json`
- `unstaged_paths_json`
- `untracked_paths_json`
- `diff_hash`

#### `commits`

- `id`
- `repository_id`
- `session_id`
- `sha`
- `parent_sha`
- `message`
- `author_time`
- `detected_at`

#### `alerts`

- `id`
- `session_id`
- `type`
- `severity`
- `title`
- `evidence_json`
- `created_at`
- `acknowledged_at`
- `resolved_at`
- `snoozed_until`

#### `conflicts`

- `id`
- `repository_id`
- `session_a_id`
- `session_b_id`
- `type`
- `severity`
- `paths_json`
- `evidence_json`
- `detected_at`
- `resolved_at`

#### `settings`

- `key`
- `value_json`
- `updated_at`

### 20.2 Retention

Defaults:

- Metadata and normalized events: retained until user deletes them.
- Command output excerpts: bounded and configurable.
- Raw prompt/response content: off by default or explicitly configurable.
- Secret candidates: never persisted without redaction.
- Full diffs: generated on demand from Git where possible rather than permanently duplicated.

---

## 21. Recommended Architecture

### 21.1 High-level architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Codex                                                      │
│ hooks / App Server                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Local ingestion                                            │
│ authenticated localhost endpoint / hook helper             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Adapter + normalizer                                       │
│ Codex payload → Masthead events                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌───────────────────────────┐  ┌──────────────────────────────┐
│ Git/process/file observers │  │ Event append-only store      │
└──────────────┬────────────┘  └──────────────┬───────────────┘
               └──────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Reducers and engines                                       │
│ session state | attention | conflict | outcome             │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Tauri desktop UI                                           │
│ Live Board | Needs You | Session | Conflict | History       │
└─────────────────────────────────────────────────────────────┘
```

### 21.2 Recommended stack

#### Desktop shell

- Tauri 2.
- React.
- TypeScript.
- Vite.

#### Native/core layer

- Rust.
- Tokio for async work.
- Axum or a minimal local HTTP listener for hook ingestion.
- SQLx or rusqlite for SQLite.
- `notify` for file-system events.
- `sysinfo` for process inspection.
- Git CLI initially; libgit2 later if justified.

#### Frontend

- React.
- TypeScript strict mode.
- Zustand or a small reducer-based state store.
- TanStack Virtual for long timelines.
- A restrained component system.
- CSS variables and a custom desktop-oriented design.
- No dependency on a hosted backend.

#### Protocol

- Versioned JSON Schema.
- Rust types and TypeScript types generated or checked against the same schema.
- Zod validation in TypeScript boundaries where useful.

#### Testing

- Rust unit and integration tests.
- Vitest for frontend/domain tests.
- Playwright for desktop/webview flows where practical.
- Fixture-based event replay.
- Temporary Git repositories for conflict tests.

### 21.3 Why Tauri

Advantages:

- Native desktop packaging.
- Strong local file/process access.
- Smaller distribution than Electron.
- Cross-platform.
- Good portfolio signal when the native layer has real responsibilities.
- Natural separation between privileged local operations and UI.

Risk:

- Rust and Tauri increase build complexity.

Mitigation:

- Keep domain protocol simple.
- Build adapter and state logic with fixtures first.
- Do not introduce a separate Node service unless required.
- Shell out to stable system tools before replacing them with complex libraries.

### 21.4 Alternative

If Tauri blocks progress, the fallback is:

- Node/Bun local daemon.
- React/Vite local web UI.
- SQLite.
- WebSocket updates.
- Desktop packaging later.

The product’s value depends more on attention and conflict intelligence than the shell technology.

---

## 22. Suggested Repository Structure

```text
masthead/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── masthead-project-spec.md
├── CHANGELOG.md
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml
│
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   ├── hooks/
│       │   ├── state/
│       │   └── styles/
│       └── src-tauri/
│
├── crates/
│   ├── core/
│   │   ├── events/
│   │   ├── sessions/
│   │   ├── attention/
│   │   ├── conflicts/
│   │   └── outcomes/
│   ├── collector/
│   ├── codex-adapter/
│   ├── git-observer/
│   ├── process-observer/
│   ├── storage/
│   └── hook-helper/
│
├── packages/
│   ├── protocol/
│   ├── fixtures/
│   └── ui/
│
├── schemas/
│   ├── event.schema.json
│   ├── alert.schema.json
│   └── conflict.schema.json
│
├── fixtures/
│   ├── codex/
│   ├── git/
│   └── sessions/
│
├── docs/
│   ├── architecture.md
│   ├── adapter-contract.md
│   ├── privacy.md
│   ├── threat-model.md
│   └── competitive-research.md
│
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── PULL_REQUEST_TEMPLATE.md
```

A simpler single-crate structure is acceptable for the first spike. Split only when boundaries become real.

---

## 23. Security and Privacy

### 23.1 Threat model

Masthead may observe:

- Source-code paths.
- Commands.
- Prompt text.
- Agent output.
- Environment references.
- Local processes.
- Diffs.
- Repository metadata.

This data can contain:

- API keys.
- Credentials.
- Customer information.
- Proprietary code.
- Internal URLs.
- Personal information.

### 23.2 Required safeguards

- Bind all ingestion endpoints to loopback.
- Generate a random local ingestion token.
- Validate all payloads.
- Limit request size.
- Escape all displayed content.
- Never execute event content as shell code.
- Redact common secret formats.
- Mark possible secrets and avoid persistence.
- Store SQLite in the user application-data directory.
- Provide complete local data deletion.
- Provide per-field capture settings.
- Keep raw transcript capture disabled by default.
- Do not start network listeners on public interfaces.
- Do not require an OpenAI API key.
- Sign release artifacts when the release pipeline is established.

### 23.3 Hook security

The hook helper should:

- Accept JSON on stdin.
- Validate schema.
- Redact.
- Forward to `127.0.0.1`.
- Time out quickly.
- Never block the coding agent for an extended period.
- Spool a small bounded queue when the app is temporarily unavailable.
- Drop old events safely when the queue limit is reached.
- Never write unbounded logs.

### 23.4 Data controls

Settings should include:

- Capture prompt text: off/on.
- Capture agent messages: off/on.
- Capture command output excerpts: off/on.
- Retention duration.
- Clear all data.
- Export sanitized data.
- Open database folder.
- Redaction rules.

---

## 24. Reliability Requirements

### 24.1 Event ingestion

- At-least-once delivery is acceptable.
- Events must be idempotently deduplicated.
- UI updates should normally appear within one second.
- The hook should not cause Codex failures if Masthead is closed.
- Out-of-order events must be tolerated.

### 24.2 Crash recovery

On restart:

- Reopen SQLite.
- Rebuild current session state from recent events and Git/process observations.
- Mark uncertain sessions as `unknown` or `stalled`, not completed.
- Restore unresolved alerts.
- Reconnect adapters.

### 24.3 Adapter degradation

If Codex changes its payload:

- Invalid events go to a bounded diagnostic store.
- UI shows adapter degradation.
- Git and process monitoring continue.
- No fabricated state.

### 24.4 Performance targets

Initial targets:

- Six concurrent sessions without noticeable UI lag.
- Ten thousand events per day without degraded search.
- Long timelines virtualized.
- Git polling or watching designed to avoid excessive CPU.
- Bounded command-output retention.
- Conflict recalculation incremental rather than full-scan on every event.

---

## 25. Testing Strategy

### 25.1 Core state tests

Given an ordered or disordered event stream, verify:

- Session state.
- Attention alerts.
- Resolution behavior.
- Deduplication.
- Crash recovery.
- Time-based transitions.

### 25.2 Codex adapter contract tests

Store sanitized official payload fixtures.

For each fixture:

- Validate.
- Normalize.
- Preserve source identifiers.
- Generate expected internal events.
- Reject malformed or oversized payloads.

### 25.3 Git observer tests

Use temporary repositories to test:

- Dirty state.
- Staged/unstaged/untracked files.
- Worktrees.
- Branch changes.
- Commits.
- Renames.
- Exact path overlap.
- Merge conflict dry-run.
- Migration ordering.

### 25.4 Conflict engine tests

Test:

- Same file.
- Same module.
- Shared manifest.
- Independent modules.
- Same branch.
- Different worktrees.
- Non-conflicting branches.
- Merge-conflicting branches.
- Port collisions.
- False-positive suppression.

### 25.5 UI tests

Test:

- Priority ordering.
- Live card updates.
- Needs You queue.
- Conflict evidence.
- Session timeline.
- Empty/degraded states.
- Keyboard navigation.
- High-density monitor layout.

### 25.6 End-to-end dogfood

Run three real Codex sessions:

1. Two sessions in unrelated repositories.
2. Two sessions in separate worktrees of the same repository.
3. Two sessions intentionally changing the same file.
4. One session repeatedly failing a test.
5. One session waiting for approval.
6. One session completing without tests.

The product should correctly distinguish all six conditions.

---

## 26. First Release Scope

### 26.1 Required

- Tauri desktop application.
- Codex hook installation and diagnostics.
- Automatic session discovery.
- Live session board.
- Session status derivation.
- Current/recent command display.
- Changed files and diff stats.
- Branch/worktree display.
- Needs You queue.
- Approval/question alerts.
- Failure and repeated-failure alerts.
- Stalled-session detection.
- Exact file-overlap detection.
- Same-branch/worktree warnings.
- Session detail timeline.
- Local SQLite history.
- Search by project/session/file.
- Open/focus original session where technically possible.
- Complete local data deletion.
- MIT license.
- Automated tests and fixture replay.

### 26.2 Strong stretch features

- Module/shared-contract overlap.
- Safe merge-conflict dry-run.
- Port collision detection.
- Commit attribution.
- Test-after-final-change verification.
- Native notifications.
- Keyboard-first control.
- Git diff viewer.
- Session outcome labels.

### 26.3 Explicitly deferred

- Additional coding-agent adapters, including Claude Code, Hermes, OpenClaw, Pi, Kilo Code, Cursor/OpenCode-style adapters, and other harnesses.
- Remote machines.
- Cloud sync.
- Team analytics.
- Employee comparisons.
- Hosted service.
- Mobile app.
- Automatic approvals.
- Agent launching/orchestration.
- LLM health classification.
- GitHub pull-request integration.
- Cost analytics.
- Model comparisons.

---

## 27. Acceptance Criteria

The first release is successful when:

1. Three simultaneous Codex sessions appear automatically.
2. Each card shows the correct project, repository, branch, worktree, duration, and current state.
3. Hook events appear in the UI within one second under normal conditions.
4. File changes are independently detected from Git.
5. An approval request creates a top-priority Needs You item.
6. A failed command is visible with its exit code and evidence.
7. Three equivalent failures trigger a possible-loop warning.
8. Two sessions editing the same file trigger a high-severity conflict.
9. Two sessions in unrelated repositories do not trigger a false conflict.
10. Restarting the application preserves history and unresolved alerts.
11. The app can operate without internet access after installation.
12. No code, prompt, transcript, or command data leaves the computer.
13. The user can remove the hook configuration and delete all Masthead data.
14. A new contributor can run fixture replay and tests without a private API key.
15. The README contains a short demonstration that makes the product’s distinction obvious.

---

## 28. Milestone Sequence

### Milestone 0: Integration proof

- Capture real Codex lifecycle events.
- Normalize them.
- Display a raw local event stream.
- Document payload coverage and gaps.

Exit condition:

> A real session can be observed without reading unstable transcript files.

### Milestone 1: Session board

- Session discovery.
- State reducer.
- Project/repository resolution.
- Live cards.
- SQLite persistence.

Exit condition:

> Three live sessions can be distinguished from one screen.

### Milestone 2: Attention queue

- Approval/question detection.
- Failure detection.
- Stalled and repeated-failure rules.
- Native notifications.

Exit condition:

> The user no longer has to inspect every session to find the one needing intervention.

### Milestone 3: Git observer

- Changed paths.
- Branch/worktree state.
- Diff stats.
- Commit detection.
- Session attribution.

Exit condition:

> The app independently shows what code changed.

### Milestone 4: Conflict radar

- Exact file overlap.
- Same branch/worktree warnings.
- Shared-contract rules.
- Safe merge analysis.

Exit condition:

> An intentional cross-session collision is detected before manual merge.

### Milestone 5: Outcome tracking

- Tests/build classification.
- Final-state checks.
- Commit linkage.
- Review labels.
- History search.

Exit condition:

> A completed session has a credible, inspectable result record.

### Milestone 6: Public release

- Installer.
- Signed artifacts where practical.
- MIT license.
- Security documentation.
- Contribution guide.
- Demo video/GIF.
- Sample fixture mode.
- Tagged release.

---

## 29. Key Risks

### 29.1 The basic dashboard is not unique

Risk:

Several open-source tools already display live coding-agent sessions.

Mitigation:

- Lead with Git conflict intelligence.
- Lead with attention routing.
- Lead with outcome tracking.
- Demonstrate a collision that competing dashboards do not catch.
- Avoid centering marketing on token charts or session lists.

### 29.2 Codex integration changes

Risk:

Hooks or App Server schemas change.

Mitigation:

- Versioned adapter.
- Contract fixtures.
- Strict normalization boundary.
- Graceful degradation.
- Independent Git/process sources.
- Avoid treating transcript files as the primary stable interface.

### 29.3 Incorrect session-to-file attribution

Risk:

Git observes a file change but cannot know which agent made it when multiple sessions share a working directory.

Mitigation:

- Strongly encourage separate worktrees.
- Use event timestamps and tool payloads.
- Store attribution confidence.
- Mark ambiguous changes.
- Never present low-confidence attribution as fact.

### 29.4 False conflict alerts

Risk:

Excess warnings make the product unusable.

Mitigation:

- Exact overlap first.
- Evidence-first alert display.
- Suppression rules.
- User feedback on false positives.
- Avoid vague AI-generated warnings.
- Separate confirmed from possible conflicts.

### 29.5 Privacy failure

Risk:

Prompt, source, or credentials are captured unintentionally.

Mitigation:

- Local-only.
- Minimal default capture.
- Redaction.
- Loopback-only listener.
- Threat model.
- Security tests.
- Clear settings and deletion.

### 29.6 Building orchestration too early

Risk:

The project expands into launching, controlling, and coordinating agents before observation is reliable.

Mitigation:

- Read-only first release.
- No automatic approval.
- No agent scheduler.
- Keep controls limited to navigation/focus.

### 29.7 Over-engineering the desktop stack

Risk:

Tauri/Rust complexity delays product proof.

Mitigation:

- Prove event capture and conflict detection before polishing.
- Use stable shell commands initially.
- Keep one local database.
- Use fixture replay.
- Fall back to a local web daemon if packaging becomes the blocker.

---

## 30. Competitive Research

### 30.1 Conclusion

The assumption that no open-source MIT-licensed tools exist in this category is incorrect.

There are multiple open-source projects with meaningful overlap. The closest direct competitor found is AgentPulse. Therefore, a generic “monitor all my Codex sessions” product would not be sufficiently distinct.

The opportunity is still credible if Masthead focuses on the underdeveloped coordination layer:

- Cross-session Git collision detection.
- Evidence-based attention routing.
- Worktree and branch awareness.
- Session-to-outcome linkage.
- A polished native second-monitor mode.
- Local-first privacy with no required AI model.

### 30.2 Closest projects

#### AgentPulse

Repository: https://github.com/jstuart0/agentpulse  
License: MIT

Current overlap:

- Codex and Claude Code monitoring.
- Live dashboard.
- Session timelines.
- Local SQLite installation.
- WebSocket updates.
- Projects and search.
- Operator inbox.
- Stuck/risky classification.
- Approval workflow.
- Local orchestration and session launching.
- Optional AI watcher and summaries.

Assessment:

> This is the closest direct competitor. Masthead should not attempt to win by having a prettier grid, basic inbox, session history, or generic health badges. The meaningful distinction must be Git-aware coordination and conflict intelligence.

#### abtop-web-ui

Repository: https://github.com/XKHoshizora/abtop-web-ui  
License: MIT

Current overlap:

- Local-first web interface.
- Claude Code, Codex, and OpenCode visibility.
- Session state.
- Token use.
- Processes and ports.
- MCP state.
- Git state.
- Search/filtering.

Assessment:

> Strong evidence that local multi-agent visibility is already an active open-source category. Its process, port, and Git views are relevant prior art.

#### Claude Agent Dashboard

Repository: https://github.com/mukul975/claude-team-dashboard  
License: MIT

Current overlap:

- Claude-focused dashboard.
- Agent teams.
- Tasks.
- Messages.
- System metrics.
- Local visibility.

Assessment:

> Narrower runtime focus but reinforces that dashboard-only functionality is not unique.

#### ClawMetry

Repository: https://github.com/vivekchand/clawmetry  
Repository license: MIT

Current overlap:

- Session monitoring.
- Logs.
- Tool activity.
- Token/cost visibility.
- Approval and alert surfaces.
- Multiple agent runtimes.

Important qualification:

The repository is MIT-licensed, but its README describes an open-core model in which broader runtimes such as Claude Code and Codex may require its cloud service or self-hosted Pro features, while the fully free path is narrower.

Assessment:

> Useful design and market validation, but not a simple “everything is freely available under MIT” comparison.

#### Vibe Cockpit

Repository: https://github.com/Dicklesworthstone/vibe_cockpit  
License: Modified MIT-style license with an additional restriction.

Current overlap:

- Agent fleet monitoring.
- Real-time status.
- Coding-agent control-room concept.

Assessment:

> Not standard MIT. Treat as source-available prior art rather than a clean MIT base. Do not copy code without carefully reviewing the rider.

#### Codex ThreadDeck

Repository: https://github.com/readysteadyscience/codex-threaddeck  
License: MIT

Current overlap:

- Codex coordination.
- Worktree-oriented workflows.
- Dispatch/coordination ideas.

Assessment:

> Adjacent rather than identical. Relevant to worktree and coordination design.

#### OpenTrace

Repository: https://github.com/adham90/opentrace  
License: MIT

Current overlap:

- Observability and agent-accessible telemetry.

Assessment:

> Adjacent category. It focuses more on production observability data for agents than observing coding agents themselves.

### 30.3 Feature differentiation matrix

| Capability | Existing tools commonly offer | Masthead emphasis |
|---|---:|---:|
| Live session list | Yes | Required, not differentiating |
| Token/cost charts | Yes | Secondary or deferred |
| Prompt/response timeline | Yes | Required, not differentiating |
| Approval inbox | Some | Required, not differentiating alone |
| Health/stuck labels | Some | Deterministic and evidence-based |
| Session launching | Some | Deferred |
| Multi-runtime support | Some | Deferred |
| Exact cross-session file overlap | Limited | Core |
| Worktree/branch collision warnings | Limited | Core |
| Shared schema/manifest conflict analysis | Rare | Core |
| Safe merge-conflict simulation | Rare | Core |
| Session-to-commit outcome graph | Limited | Core |
| Test-after-final-change verification | Rare | Core |
| Native second-screen UX | Limited | Core |
| Fully local, no account | Some | Required |
| No model required for core value | Not universal | Core |

### 30.4 Build-versus-fork decision

AgentPulse is MIT-licensed, so forking is legally possible under the license terms. That does not automatically make it the right strategic choice.

Build independently when:

- The central architecture is a Git/worktree conflict engine.
- The UI is a native second-screen product.
- The event and outcome model differ substantially.
- Portfolio originality matters.
- The project will stay intentionally narrow.

Consider contributing to or extending AgentPulse when:

- The desired product becomes mostly a generic observability dashboard.
- The unique conflict features can be implemented as a clean upstream module.
- Maintaining hooks, auth, search, and orchestration independently stops being worthwhile.

Current recommendation:

> Build an independent, narrow product. Use competitors as research. Do not reproduce their generic feature lists. Demonstrate the conflict and outcome features first.

---

## 31. Open-Source Strategy

### 31.1 License

Use a standard MIT `LICENSE`.

Do not add field-of-use restrictions while calling it MIT.

### 31.2 Repository credibility

Include from the start:

- Clear README.
- Architecture diagram.
- One-command development setup.
- Sanitized demo fixtures.
- Screenshots or a short recording.
- CONTRIBUTING.md.
- SECURITY.md.
- Issue templates.
- Pull-request template.
- Changelog.
- Tagged releases.
- Automated tests.
- Adapter contract documentation.

### 31.3 Contributor opportunities

Good early contribution surfaces:

- Additional deterministic attention rules.
- Git conflict detectors.
- Command classifiers.
- Operating-system focus/open adapters.
- New coding-agent adapters after Codex.
- Theme and accessibility improvements.
- Sanitized event fixtures.
- Platform packaging.

### 31.4 Demo mode

Provide a fixture-powered demo that simulates:

- Healthy editing.
- Active tests.
- Approval required.
- Repeated failure.
- Exact file conflict.
- Completed task.

This lets reviewers understand the app without running several real agents.

---

## 32. Initial README Opening

```markdown
# Masthead

**The local control tower for coding agents.**

Masthead gives developers one live view of every Codex task running on their computer. It shows what each agent is doing, what files and commands are active, which sessions need attention, and whether parallel work is likely to collide in Git.

Unlike a generic session dashboard, Masthead is built around three operational questions:

1. What needs me now?
2. What code is changing?
3. Which agents may interfere with each other?

Masthead runs locally, stores its history in SQLite, and does not require a cloud account or AI API key.
```

---

## 33. First Public Demonstration

The first demo should tell one clear story.

### Scenario

- Open three Codex sessions.
- Session A edits authentication in a Pip worktree.
- Session B edits a landing page in another repository.
- Session C edits a shared authentication file in a second Pip worktree.
- Session B completes normally.
- Session A requests approval.
- Session C changes the same file as Session A.

### Demo sequence

1. Live Board shows all three.
2. Session A moves to Needs You.
3. Session C triggers exact-file conflict with Session A.
4. Conflict Radar shows both paths and Git state.
5. Session B finishes, with tests and commit attached.
6. User opens the correct Codex thread directly from Masthead.

This demonstrates the differentiator more clearly than token charts or generic event logs.

---

## 34. Immediate Implementation Order

Start with these tasks in order:

1. Create the repository and MIT license.
2. Add this document as `masthead-project-spec.md`.
3. Create a sanitized Codex hook-event capture spike.
4. Define the versioned normalized event schema.
5. Build event replay before building the full collector.
6. Implement the session-state reducer.
7. Render a fixture-powered Live Board.
8. Add SQLite persistence.
9. Connect real hook events.
10. Implement Git snapshots.
11. Implement exact file-overlap detection.
12. Build the Needs You queue.
13. Add session detail and evidence.
14. Dogfood with three concurrent Codex sessions.
15. Publish a demonstration only after the conflict scenario works.

Do not begin with:

- Authentication.
- Cloud sync.
- Billing.
- Teams.
- Generic charts.
- Multi-agent support.
- LLM summaries.
- Automated orchestration.

---

## 35. Open Questions

These should be answered through implementation spikes rather than speculation.

1. Which Codex hook events are available and stable enough for passive mode?
2. Can the original Codex thread or terminal be reliably focused across operating systems?
3. How accurately can file changes be attributed when sessions share one working directory?
4. Should Masthead require separate worktrees for high-confidence conflict attribution?
5. Which test/build commands can be classified reliably without repository configuration?
6. Can a safe Git merge-conflict simulation run without touching user refs or working trees?
7. How should events be buffered when the desktop app is closed?
8. What raw content should be captured by default?
9. Which conflict alerts are genuinely useful after several days of dogfooding?
10. Does Tauri simplify the product enough to justify Rust, or does it delay the core proof?
11. Does AgentPulse add comparable Git conflict features before this project launches?

---

## 36. Final Product Standard

Masthead should not be judged by how many features or lines of AI-generated code it contains.

It should be judged by whether:

- The developer can run several agents without constantly checking each one.
- Important requests are surfaced immediately.
- Real code conflicts are detected early.
- Alerts contain concrete evidence.
- Completed sessions are connected to tangible outcomes.
- The application remains private and useful without a cloud service.
- Another developer can install, understand, and extend it.
- The demonstration makes its distinction from existing open-source dashboards obvious.

The central product promise is:

> **Masthead turns parallel coding agents from scattered background processes into a visible, coordinated development system.**

---

## 37. Research Sources

Research checked on June 22, 2026.

### Direct and adjacent projects

- AgentPulse: https://github.com/jstuart0/agentpulse
- AgentPulse license: https://github.com/jstuart0/agentpulse/blob/main/LICENSE
- abtop-web-ui: https://github.com/XKHoshizora/abtop-web-ui
- abtop-web-ui license: https://github.com/XKHoshizora/abtop-web-ui/blob/main/LICENSE
- Claude Agent Dashboard: https://github.com/mukul975/claude-team-dashboard
- Claude Agent Dashboard license: https://github.com/mukul975/claude-team-dashboard/blob/main/LICENSE
- ClawMetry: https://github.com/vivekchand/clawmetry
- ClawMetry license: https://github.com/vivekchand/clawmetry/blob/main/LICENSE
- Vibe Cockpit: https://github.com/Dicklesworthstone/vibe_cockpit
- Vibe Cockpit license: https://github.com/Dicklesworthstone/vibe_cockpit/blob/main/LICENSE
- Codex ThreadDeck: https://github.com/readysteadyscience/codex-threaddeck
- Codex ThreadDeck license: https://github.com/readysteadyscience/codex-threaddeck/blob/main/LICENSE
- OpenTrace: https://github.com/adham90/opentrace
- OpenTrace license: https://github.com/adham90/opentrace/blob/main/LICENSE

### Codex integration

- Codex hooks: https://developers.openai.com/codex/hooks
- Codex App Server: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Codex TypeScript SDK: https://github.com/openai/codex/tree/main/sdk/typescript

---

**End of specification**
