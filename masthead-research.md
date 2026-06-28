# Masthead Research Notes

**Created:** June 23, 2026  
**Purpose:** Running research log for the Masthead grill-me phase. This file captures decisions, assumptions, external research, and follow-up questions that emerge while stress-testing the product plan.

> Historical research log. Desktop architecture decisions that mention Tauri/Rust were superseded by the 2026-06-28 Electron migration. Current product scope lives in `prd.md`, and current visual direction lives in `design.md`.

---

## Grill Decisions

### 1. First Vertical Proof

**Question:** What is the smallest Codex-only vertical slice that proves Masthead deserves to exist?

**Recommended answer:** Masthead should prove one complete loop: detect live Codex sessions, identify the one that needs attention, independently observe Git changes, detect an exact same-file conflict across active sessions, and present evidence clearly enough that the user trusts it without opening every Codex thread.

**Why it matters:** This prevents the product from widening into generic dashboards, multi-agent orchestration, or broad adapter support before the core supervision/collision value works end to end.

**Decision:** Accepted by Tyler. This is the first proof target.

### 2. Codex Integration Depth for V0

**Question:** For the first proof, should Masthead rely only on passive Codex hooks, or should it also integrate Codex App Server from the beginning?

**Recommended answer:** Start with passive Codex hooks plus independent Git/process observation. Add App Server only after the hook path proves the full loop. This keeps V0 aligned with “observe before control” and avoids coupling the first proof to a richer managed-session integration before the attention/conflict loop is validated.

**Why it matters:** The ingestion choice shapes installation, permissions, trust, failure modes, and whether Masthead feels like a passive control tower or an agent runner.

**Decision:** Accepted by Tyler. V0 starts with passive Codex hooks plus independent Git/process observation. App Server is deferred until the hook-based vertical loop is proven.

### 3. Session Identity Boundary

**Question:** What should Masthead treat as the canonical unit of work: a Codex thread, a terminal/process, a Git worktree, or a user-declared task?

**Recommended answer:** Treat the Codex session/thread as the canonical session, then attach repository, worktree, branch, process, command, and Git observations to it as evidence. If identity is ambiguous, Masthead should show uncertainty instead of merging sessions or fabricating attribution.

**Why it matters:** Session identity drives every downstream feature: attention routing, conflict attribution, history search, outcome tracking, and opening the right Codex surface.

**Decision:** Accepted by Tyler. The Codex session/thread is canonical; repository, worktree, branch, process, command, and Git observations are attached as evidence. Ambiguous identity must be shown as uncertain rather than silently merged.

### 4. Worktree Requirement for Trustworthy Conflict Detection

**Question:** Should Masthead require separate Git worktrees for trustworthy conflict attribution, or should it support multiple sessions in the same working directory from the start?

**Recommended answer:** Masthead should strongly recommend separate worktrees for high-confidence attribution, but it should still support same-working-directory sessions in a degraded mode. In same-directory mode, Masthead can detect that the directory is being changed and can warn about shared workspace risk, but it should not claim precise per-session file attribution unless the Codex event stream gives direct evidence.

**Why it matters:** Exact conflict detection is only valuable if the user trusts the evidence. Overstating attribution in a shared working tree would create false confidence.

**Decision:** Accepted by Tyler. Masthead should strongly recommend separate worktrees for high-confidence attribution, while supporting same-working-directory sessions in degraded mode. Same-directory mode may warn about shared workspace risk but must not claim precise per-session attribution without direct provider evidence.

### 5. Attention Queue Philosophy

**Question:** Should the first Needs You queue be conservative and deterministic, or should it include broader heuristic/LLM-derived “this looks risky” judgments from the start?

**Initial recommendation:** Start conservative and deterministic. V0 should only elevate events with concrete evidence: approval requested, user question, command failed, repeated equivalent failure, exact same-file conflict, same branch/worktree collision, stalled session, and completed-without-observed-verification. Heuristic or LLM-derived risk labels can appear later, but not as the basis for top-priority alerts.

**Tyler correction:** Tyler prefers a broader LLM-delivered attention layer because it can use more context about what is going on.

**Revised answer:** Masthead should include an LLM-contextual attention layer from the start, but it must remain evidence-grounded. Deterministic rules should still create hard alerts for explicit events, while the LLM can add contextual prioritization, risk summaries, suggested next actions, and broader “this deserves review” items when it can cite the events, files, commands, diffs, or session history that support the judgment.

**Why it matters:** Masthead’s core trust loop depends on users believing the queue. A noisy or vague “AI risk” queue would make it feel like another dashboard instead of an operator aid.

**Decision:** Tyler rejected a purely deterministic V0 queue. Masthead should pursue a broader LLM-contextual Needs You experience, with deterministic evidence and visible reasoning as guardrails.

### 6. LLM Attention Boundary

**Question:** What authority should the LLM have in the Needs You queue: can it create top-priority interruptions, or should it only enrich and rank deterministic/observable items?

**Recommended answer:** Let the LLM create contextual queue items, but require a structured evidence contract. It can promote an item to Needs You when it cites concrete supporting evidence from events, Git, commands, files, approvals, or history. It should not create P0 “immediate decision” alerts without deterministic evidence, and every LLM-created item should be labeled as LLM-contextual with inspectable citations.

**Why it matters:** This preserves the richer context Tyler wants without letting the product hallucinate urgent work.

**Decision:** Accepted by Tyler. The LLM may create contextual queue items, but must cite concrete supporting evidence. P0 immediate-decision alerts require deterministic evidence. LLM-created items must be labeled and inspectable.

### 7. LLM Context and Privacy Boundary

**Question:** What content may Masthead capture, store, and send to an LLM for contextual attention routing?

**Recommended answer:** Capture rich local evidence by default, but store and transmit it in tiers. V0 should always store metadata, paths, event IDs, command names, exit codes, Git status, and compact excerpts locally. Raw prompts, agent messages, command output, and diffs should be locally stored only behind explicit settings. Remote LLM summarization should be opt-in, redacted, scoped per project, and should receive compact evidence packets rather than raw transcripts or full files by default.

**Why it matters:** The broader LLM queue is only viable if Masthead can use enough context to be useful without silently leaking source code, secrets, prompts, customer data, or private operational history.

**Decision:** Accepted by Tyler. Masthead may capture rich local evidence by default, but raw prompts, full agent messages, command output, and diffs should require explicit local-capture settings. Remote LLM summarization must be opt-in, redacted, project-scoped, and packetized by default.

### 8. Codex Hook Installation Strategy

**Question:** Should V0 install a global Codex hook, project-level hooks, or a Masthead-managed hook package?

**Recommended answer:** Use a Masthead-managed hook installed at the user/global Codex level, with explicit first-run review, backup, and one-click uninstall. The hook should be tiny and fail-open: validate stdin, redact obvious secrets, forward to `127.0.0.1` or a local socket with a short timeout, then exit `0` even when Masthead is closed. Project-level opt-in can come later for teams or stricter per-repo settings, but the first proof needs automatic coverage across Tyler's local Codex sessions without manually modifying every repo.

**Why it matters:** Hook installation is the trust boundary. Too much manual per-project setup will make the product hard to dogfood; a hidden or brittle global hook would be unacceptable for a local security-sensitive tool.

**Decision:** Accepted by Tyler. V0 should use a Masthead-managed global/user Codex hook with explicit first-run review, backup, one-click uninstall, and fail-open behavior. Project-level opt-in can come later.

### 9. Git Conflict Scope for V0

**Question:** Should V0 detect conflicts only within the same Git common directory/worktree family, or also across separate clones with the same remote URL and branch?

**Recommended answer:** V0 should make same Git common-directory/worktree-family detection reliable first. Separate clones with matching remote URL/branch should appear as a lower-confidence future/experimental warning, not part of the first proof. The first demo should avoid remote-url heuristics and prove exact-path overlap across linked worktrees where repo identity is unambiguous.

**Why it matters:** Same-common-dir conflict detection is crisp and explainable. Separate clone correlation gets messy because remote URLs differ by protocol, forks/upstreams differ, branch names can lie, and local clone history may drift.

**Decision:** Accepted by Tyler. V0 conflict detection should focus on same Git common-directory/worktree-family evidence. Separate clones with matching remote URL/branch can become lower-confidence future warnings, not part of the first proof.

### 10. Ignored Files and Shared Local Resources

**Question:** Should V0 include ignored files, env files, generated output, ports/dev servers, and local databases in conflict detection?

**Recommended answer:** Include them only in a narrow, privacy-aware way. V0 should track Git-visible files by default, plus specific high-risk tracked paths like migrations, lockfiles, schemas, workflows, auth, billing, deploy, and config. Ignored files such as `.env*`, generated output, build artifacts, local databases, screenshots, and binary files should be excluded by default. Ports/dev servers can be detected as shared-resource warnings, but not treated like file conflicts.

**Why it matters:** This prevents Masthead from becoming noisy or privacy-invasive while still surfacing the resource conflicts most likely to derail parallel agent work.

**Decision:** Accepted by Tyler. V0 should use Git-visible files and known high-risk tracked paths by default, exclude ignored/raw local artifacts by default, and treat ports/dev servers/local resources as separate shared-resource warnings.

### 11. Outcome Tracking Definition

**Question:** What should count as a credible “outcome” for a completed agent session in V0?

**Recommended answer:** A completed session should not be treated as an outcome just because the agent says it is done. V0 should define outcome as a bundle of evidence: final status, changed paths/diff stats, commands run, verification commands and results, final Git dirty/clean state, commits created, unresolved alerts/conflicts, and a user review disposition such as accepted, partially accepted, abandoned, superseded, or failed.

**Why it matters:** Outcome tracking is one of Masthead’s differentiators. It turns “agent activity happened” into “this work produced a reviewable result.”

**Decision:** Accepted by Tyler with an important flexibility requirement. The outcome model should start as an evidence bundle, but the exact definition of a “good,” “complete,” or “review-needed” outcome must be flexible and tuned through dogfooding. Masthead should expose hard evidence while letting review labels, thresholds, and policy evolve as Tyler uses the product.

### 12. Outcome Policy Flexibility

**Question:** Which parts of outcome tracking should be fixed evidence, and which should be user-adjustable policy?

**Recommended answer:** Keep evidence fixed and policy flexible. Fixed evidence includes changed paths, diff stats, command runs, test/build results, commits, dirty state, alerts, conflicts, and timestamps. User-adjustable policy includes which commands count as verification, what counts as “large diff,” which paths are high-risk, which dispositions exist, how long a session can be stale, and which incomplete states still count as acceptable for a given project.

**Why it matters:** Masthead needs to learn from real use without corrupting the audit trail. The facts should stay stable; the interpretation layer should adapt.

**Decision:** Accepted by Tyler. Outcome tracking should keep immutable observed facts separate from user-adjustable interpretation policy.

### 13. Desktop Architecture for the First Proof

**Question:** Should Masthead start as a full Tauri desktop app, or should the first proof be a local web UI plus daemon that can be wrapped later?

**Recommended answer:** Build the first proof as the real architecture, but keep it thin: Tauri shell, local Rust collector/observer, SQLite, and React UI. Avoid a throwaway local web prototype unless Tauri blocks progress. The reason is that the product’s value depends on native local permissions, file/process/Git observation, background collection, notifications, and second-monitor behavior, so the prototype should exercise those constraints early.

**Why it matters:** A pure web prototype might move faster visually but would dodge the hard local-ownership problems that make Masthead useful.

**Decision:** Accepted by Tyler. The first proof should use a thin version of the real architecture: Tauri 2, Rust collector/observer, SQLite, and React UI. A local web daemon can be a fallback or spike only if Tauri blocks progress.

### 14. First Screen and UI Priority

**Question:** Should the default first screen be a full Live Board of all sessions, or a Needs You command surface with the live board as supporting context?

**Recommended answer:** The first screen should be the Live Board, but visually dominated by the Needs You lane. Masthead is a second-monitor control tower, so it must show the whole system at a glance; however, the top-left/top-priority area should answer “what needs Tyler now?” before showing healthy activity. The board should make quiet sessions visible but visually subordinate.

**Why it matters:** If the first screen is only an inbox, Masthead loses ambient control-tower value. If it is only a grid, it becomes a generic dashboard.

**Decision:** Accepted by Tyler. The first screen should be a Live Board with a visually dominant Needs You lane; healthy sessions should remain visible but quiet.

### 15. V0 Control and Action Boundary

**Question:** What actions should Masthead be allowed to take in V0?

**Recommended answer:** V0 should be observe-first with safe navigation and review actions only. It can open the Codex thread, open a file/diff, snooze/dismiss an item, mark review disposition, pause capture, copy suggested commands, and show suggested next actions. It should not approve agent requests, stop agents, launch agents, run commands, commit, rebase, push, edit repo files, or mutate Codex settings beyond the explicit hook installer/uninstaller.

**Why it matters:** The app is reading sensitive local development state. If it controls agents too early, the trust and failure surface expands before the observation loop is proven.

**Decision:** Accepted by Tyler. V0 should be observe-first with safe navigation and local Masthead workflow actions only. Mutating Codex, Git, shell, browser, repo, remote, or config actions are out of scope except for explicit hook onboarding/uninstall.

### Grill Session Close

**Decision:** Tyler ended the grill-me session here. Next step is a simple browser prototype for visual feedback, with mocked data only and no real collection or control logic.

### Prototype 0

**Artifact:** `prototype/index.html`

**Purpose:** Static visual prototype for feedback on the Masthead app shape. It mocks the Live Board, dominant Needs You lane, conflict evidence panel, shared-resource indicators, and outcome evidence strip. It does not implement collectors, hooks, Git polling, LLM queue generation, backend state, or agent control.

### Prototype 1

**Artifact:** `prototype/index.html`

**Feedback addressed:** Tyler said the first prototype was too busy and the design direction was weak. The redesigned prototype is session-card based: each card owns its attention state, evidence, work state, outcome, and safe actions. The visual system follows the supplied “Midnight aurora console” reference: charcoal canvas, hairline borders, monochrome controls, flat surfaces, mono labels, and aurora bars used only as decorative atmosphere.

### Prototype 2

**Artifact:** `prototype/index.html`

**Feedback addressed:** Tyler rejected the top hero/headline treatment because Masthead is an app, not a landing page. Prototype 2 removes the hero and explanatory copy, uses a compact console summary, and lays out smaller square-ish session cards in a responsive two-column grid so the app surface uses more real estate.

### Prototype 3

**Artifact:** `prototype/index.html`

**Feedback addressed:** Tyler wanted the compact-card model pushed further: remove meaningless decorative bars, replace name-specific labels like “Needs Tyler” with generic “Needs attention,” support up to four compact session cards per row, and include one expanded session card with full details. Prototype 3 uses a dense responsive grid with multiple state examples plus one expanded card spanning more space.

---

## Sidecar Research Queue

### Agent Ecosystem and Adapter Strategy

**Agent:** Hilbert  
**Status:** Completed  
**Scope:** Popular coding-agent runtimes/harnesses, integration surfaces, adapter-neutral event model implications, and post-Codex adapter roadmap.

### Competitor and Adjacent Landscape

**Agent:** Aquinas  
**Status:** Completed  
**Scope:** Existing coding-agent dashboards/control rooms/observability tools, common features, remaining differentiation, and demo requirements.

### Codex/Git Vertical Proof Mechanics

**Agent:** Pauli  
**Status:** Completed  
**Scope:** Codex hook/App Server surfaces, local event ingestion, Git worktree/file-change observation, exact-path conflict detection, and first-proof risks.

### Session Identity and Attribution

**Agent:** Euler  
**Status:** Completed  
**Scope:** Session/thread identifiers, correlation to processes/repositories/worktrees, same-working-directory attribution risk, and uncertainty presentation.

### LLM-Assisted Attention Queue

**Agent:** Schrodinger  
**Status:** Completed  
**Scope:** Evidence-grounded LLM contextual attention, hallucination guardrails, deterministic/LLM split, labels, UX explainability, and privacy implications.

### LLM Context, Privacy, and Retention

**Agent:** Socrates  
**Status:** Completed  
**Scope:** Raw content capture, local storage, remote LLM data boundaries, redaction, prompt injection, audit logging, user controls, and V0 defaults.

### Codex Hook Installation and Onboarding

**Agent:** Cicero  
**Status:** Completed  
**Scope:** Global user hook vs project hook vs managed hook package, trust prompts, safety, uninstall/rollback, multi-project coverage, and first-run flow.

### Git Conflict Scope

**Agent:** Nietzsche  
**Status:** Completed  
**Scope:** Same Git common-dir/worktree family versus separate clone detection, exact path overlap, branch/worktree collision, merge dry runs, ignored/generated files, lockfiles, migrations, and dev-resource collisions.

### Ignored Files and Shared Local Resources

**Agent:** Russell  
**Status:** Completed  
**Scope:** Ignored/generated files, lockfiles, `.env`/config files, migrations, ports/dev servers, local databases, and shared local-resource conflict detection.

### Outcome Tracking

**Agent:** Wegener  
**Status:** Completed  
**Scope:** Session-to-diff/command/test/build/commit/PR/review evidence, accepted/abandoned disposition, completed-without-verification signals, and V0 outcome model.

### First Screen and UI Evidence Design

**Agent:** Pascal  
**Status:** Completed  
**Scope:** Second-monitor live board, Needs You queue, session cards, conflict evidence, outcome cards, alert hierarchy, density, keyboard navigation, native desktop conventions, and non-generic dashboard UX.

### V0 Control and Action Boundary

**Agent:** Dirac  
**Status:** Completed  
**Scope:** Observe-only versus control features, safe navigation/review actions, risky mutating actions, Codex/App Server control surfaces, trust and UX implications, and recommended V0 action set.

---

## Sidecar Research Findings

### Competitor and Adjacent Landscape

**Source agent:** Aquinas  
**Status:** Completed on June 23, 2026.

The generic coding-agent dashboard space is already crowded. Existing and adjacent products commonly cover live session inventory, transcript/tool timelines, token and context pressure, Git state, process/port visibility, status badges, approval queues, alerts, and sometimes launch/control workflows.

Relevant projects and sources:

- [AgentPulse](https://github.com/jstuart0/agentpulse): local/self-hosted command center for Claude Code and Codex sessions, timelines, templates, supervisor launches, inbox/HITL, AI watcher, alerts, digests, and OTLP metrics.
- [abtop](https://github.com/graykode/abtop) and [abtop-web-ui](https://github.com/XKHoshizora/abtop-web-ui): read-only “htop for agents” style observability for Claude/Codex/OpenCode status, tokens, context percentage, rate limits, child processes, ports, MCP servers, and Git state.
- [ClawMetry](https://github.com/vivekchand/clawmetry): OpenClaw observability with live flow diagrams, session/log/transcript views, token/cost usage, crons, memory files, and audit/security views.
- [Codex ThreadDeck](https://github.com/readysteadyscience/codex-threaddeck): Codex workflow kit for controller/worker thread routing, worker registry, safe probes, evidence relay, and local `.threaddeck` registry.
- [OpenAI Codex app features](https://developers.openai.com/codex/app/features) and [Codex worktrees](https://developers.openai.com/codex/app/worktrees): native app already includes Local/Worktree/Cloud modes, diff pane, commit/push/PR flow, integrated terminal, automations, and worktree isolation.
- [Claude Code overview](https://docs.anthropic.com/en/docs/claude-code/overview): platform-native multiple sessions, background agents, recurring tasks, Git/PR support, MCP/hooks/skills, and telemetry surfaces.
- [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent): cloud sessions initiated and tracked through GitHub, IDEs, CLI, API, MCP, and integrations.
- [AgentSight](https://github.com/eunomia-bpf/agentsight): system-level tracing via eBPF for process trees, shell commands, file/network events, LLM traffic, tokens, web UI, and OTel export.
- General agent observability tools such as [LangSmith](https://docs.langchain.com/langsmith/observability), [Langfuse](https://langfuse.com/docs/observability/overview), and [AgentOps](https://docs.agentops.ai/v2/introduction) validate the tracing category but are less focused on local coding-agent Git/worktree collisions.

Implications for Masthead:

- Masthead should not position itself as “see all agent sessions.” That is table stakes.
- Masthead should not lead with token charts, generic timelines, launch templates, or broad orchestration.
- The credible wedge is an attention and safety router for local coding-agent work: ranked “Needs You,” cross-session collision detection, outcome tracking, and evidence-first review.
- The standout demo should show multiple Codex sessions where Masthead surfaces only the sessions needing attention, detects a real file/branch/port/dev-resource collision, and closes with outcome evidence.

### Agent Ecosystem and Adapter Strategy

**Source agent:** Hilbert  
**Status:** Completed on June 23, 2026.

The adapter universe is split between protocol-rich local agents and cloud/IDE products. Masthead’s core should treat every runtime as an event-producing worker, not as a Codex-shaped thread.

Potential adapter surfaces and sources:

- OpenAI Codex: [App Server](https://developers.openai.com/codex/app-server), [SDK](https://developers.openai.com/codex/sdk), CLI, MCP, hooks, `AGENTS.md`, sandbox/approval settings.
- Claude Code: [overview](https://code.claude.com/docs/en/overview), [CLI reference](https://code.claude.com/docs/en/cli-reference), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), [hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/mcp).
- OpenCode: [docs](https://opencode.ai/docs), [CLI](https://opencode.ai/docs/cli/), [server](https://opencode.ai/docs/server/), [ACP](https://opencode.ai/docs/acp/), [MCP servers](https://opencode.ai/docs/mcp-servers/).
- Gemini CLI: [repository](https://github.com/google-gemini/gemini-cli), [headless mode](https://geminicli.com/docs/cli/headless/), [ACP mode](https://geminicli.com/docs/cli/acp-mode/), [hooks](https://geminicli.com/docs/hooks/), [MCP docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).
- Kilo Code: [docs](https://kilo.ai/docs), [GitHub](https://github.com/Kilo-Org/kilocode), [MCP overview](https://kilo.ai/docs/automate/mcp/overview), [custom modes](https://kilo.ai/docs/customize/custom-modes).
- GitHub Copilot cloud agent: [cloud agent docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent).
- Cursor: [docs](https://cursor.com/docs), with emphasis on Agent, Rules, MCP, Skills, and CLI surfaces.
- OpenClaw/KiloClaw: [OpenClaw](https://openclaw.ai/), [KiloClaw overview](https://kilo.ai/docs/kiloclaw/overview).
- Aider/OpenHands/SWE-agent class: [Aider usage](https://aider.chat/docs/usage.html), [OpenHands usage](https://docs.openhands.dev/openhands/usage/run-openhands/gui-mode).

Adapter-neutral model implications:

- Do not bake Codex nouns such as `thread`, `turn`, or `item` into the core model; use neutral concepts such as `session`, `request`, `event`, `artifact`, `tool_call`, `tool_result`, and `approval`.
- Do not assume local filesystem access. Some agents run in remote sandboxes, IDE processes, or cloud PR sessions.
- Support multiple transports: hooks, JSONL streams, JSON-RPC stdio, HTTP/OpenAPI, SSE, WebSocket, ACP, MCP, and possibly PTY parsing as a degraded fallback.
- Preserve raw provider events next to normalized fields because runtime schemas will change.
- Model approvals as a state machine rather than a boolean.
- Treat instruction files as runtime-specific: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cursor rules, Kilo/OpenCode config, and similar files.

Suggested adapter roadmap after Codex:

1. Claude Code.
2. OpenCode.
3. Gemini CLI.
4. Kilo Code.
5. GitHub Copilot cloud agent / Copilot CLI.
6. Cursor or other IDE adapters through official protocols only.
7. Aider, OpenHands, and SWE-agent-style long-tail adapters.
8. OpenClaw/KiloClaw-style orchestration agents.
9. Hermes/Pi once primary product/runtime docs are verified.

### Codex/Git First-Proof Mechanics

**Source agent:** Pauli  
**Status:** Completed on June 23, 2026.

The first proof should use passive Codex hooks plus independent Git observation. App Server is the richer integration path, but it should not be required until Masthead confirms it can observe the exact live Codex app/CLI sessions the user already runs.

Codex surfaces and sources:

- [Codex hooks](https://developers.openai.com/codex/hooks) are the best first passive ingestion surface. Useful event categories include `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PreToolUse`, `PostToolUse`, and `Stop`. Hook payloads can include session/workspace context such as `session_id`, `cwd`, hook event name, model, turn IDs, permission mode, tool names, tool inputs, and tool responses.
- Hook caveats matter: hooks require trust review, project hooks only load in trusted projects, multiple hooks for the same event may run concurrently, transcript paths are not stable APIs, and pre/post tool hooks do not cover every possible shell or tool path.
- [Codex App Server](https://developers.openai.com/codex/app-server) is the deep integration surface: JSON-RPC, thread/turn/item primitives, streamed events, approvals, history, auth, `thread/list`, loaded-thread listing, status changes, and version-matched schemas.
- The App Server is not read-only by nature; it includes control and mutation methods. For V0, any App Server usage should sit behind a strict adapter boundary and should not expose control calls in the UI.
- [Codex deep links](https://developers.openai.com/codex/app/commands#deep-links) are enough for evidence navigation, including `codex://threads/<thread-id>` and `codex://new?path=<absolute-path>`.

Git observation recommendations:

- Use Git as truth and file watchers as triggers.
- Use script-stable Git commands such as `git --no-optional-locks -C <root> status --porcelain=v2 -z --branch --untracked-files=all`.
- Use `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir` for canonical worktree/repository identity.
- Use `git worktree list --porcelain -z` to enumerate sibling worktrees.
- Use `git diff --name-status -z` or `git diff --numstat -z` for path and line-change detail.

Exact same-file conflict rule:

- Alert when two active sessions have the same canonical repo identity and the same normalized repo-relative changed path.
- Include staged, unstaged, and untracked paths.
- For renames, index both old and new paths.
- Evidence should include sessions, provider IDs if known, repo root, worktree path, branch/head, shared path, status code, last command/tool event, Git snapshot time, and links to Codex/file/diff surfaces.

File watcher options:

- Rust/Tauri: [`notify`](https://docs.rs/notify/latest/notify/) is natural and cross-platform, but editor-save behavior, network filesystems, inotify limits, and large-directory reliability must be handled.
- Node/Electron fallback: [`chokidar`](https://github.com/paulmillr/chokidar) is mature and normalizes raw `fs.watch`.
- Large repos/monorepos: [Watchman `watch-project`](https://facebook.github.io/watchman/docs/cmd/watch-project) and [Watchman `subscribe`](https://facebook.github.io/watchman/docs/cmd/subscribe) are stronger if native watchers become a bottleneck.

Local ingestion recommendations:

- Use a local collector with append-only SQLite events.
- Prefer SQLite WAL mode because it supports concurrent readers while writes proceed. Source: [SQLite WAL](https://www.sqlite.org/wal.html).
- Hook scripts should be dumb and fast: send JSON to a Unix socket or `127.0.0.1`, time out quickly, exit `0`, and avoid stdout unless intentionally adding Codex context.
- Store normalized events by default, not full transcripts.

Open implementation questions:

1. Should V0 install a global user hook, project hook, or plugin-bundled hook?
2. Is the first proof allowed to connect to a managed `codex app-server daemon`, or must it only observe externally started sessions?
3. Is conflict scope limited to the same Git common directory/worktrees, or should it also include separate clones with the same remote URL?
4. Should ignored files ever participate in conflict detection?
5. Should Masthead store prompt/tool-output snippets, or only event metadata plus links back to Codex?

### Session Identity and Attribution

**Source agent:** Euler  
**Status:** Completed on June 23, 2026.

Codex App Server is the strongest identity source. It models `Thread -> Turn -> Item`, and items can include command runs, file changes, tool calls, messages, and related events. It streams `thread/*`, `turn/*`, and `item/*` notifications. Source: [Codex App Server](https://developers.openai.com/codex/app-server).

Local Codex schema fields observed from `codex-cli 0.139.0` include:

- `thread.id`
- `thread.sessionId`
- `forkedFromId`
- `parentThreadId`
- `thread.cwd`
- `thread.source`
- `gitInfo` with sha, branch, and origin URL
- `turn.id`
- `item.id`
- command item fields such as command, cwd, process ID, status, exit code, and duration
- file-change item fields such as path, kind, and diff

Identity confidence model:

- `Direct`: provider event includes session/thread/turn/item IDs.
- `Correlated`: matched by cwd, worktree, process, and time, without provider ID.
- `Shared workspace`: observed in a cwd used by multiple sessions.
- `Unattributed`: filesystem/process event with no reliable owner.

Correlation confidence:

- High confidence: direct App Server event with provider IDs; direct file-change or command item; `codex exec --json` events for a single noninteractive process.
- Medium confidence: hook event plus unique active session in same cwd/time window; process PID/start time/parent/tty/cwd matching a known session terminal; Git worktree path uniquely bound to one active session.
- Low confidence: Git watcher sees changes in a shared cwd; process cwd matches a repo with multiple active sessions; command line contains `codex` with no provider ID.

Same-directory risks:

- Shared cwd collapses attribution across unstaged diffs, generated files, dev servers, ports, lockfiles, dependency installs, and test output.
- PID-only attribution is unsafe because PIDs can be reused. Use PID plus start time, parent chain, cwd, and tty where available.
- `/proc/<pid>/cwd` can expose working directory but may be permission-limited. Source: [proc_pid_cwd(5)](https://man7.org/linux/man-pages/man5/proc_pid_cwd.5.html).
- `/proc/<pid>/cmdline` can be altered by the process and should be advisory only. Source: [proc_pid_cmdline(5)](https://man7.org/linux/man-pages/man5/proc_pid_cmdline.5.html).
- Worktrees are the right trust boundary. Sources: [Git worktree](https://git-scm.com/docs/git-worktree), [Codex worktrees](https://developers.openai.com/codex/app/worktrees).

Recommended evidence UI pattern:

- Show source, observed time, source time, provider IDs, cwd/repo/worktree, command/file/diff hash, confidence, and confidence reason.
- Phrase uncertainty plainly: “changed in shared workspace,” “likely session X,” “directly reported by Codex item Y,” or “not attributable.”

Recommended protocol identity fields:

```text
masthead.session_id
adapter.name
adapter.version
adapter.surface
provider.session_tree_id
provider.thread_id
provider.turn_id
provider.item_id
parent_session_id
forked_from_id
workspace.cwd
workspace.repo_root
workspace.worktree_path
workspace.git_common_dir
git.origin_url
git.branch
git.head_sha
process.pid
process.start_time
process.ppid
process.tty
command.cwd
attribution.level
attribution.evidence[]
raw_event
```

OpenTelemetry is a useful shape reference, not a constraint. Relevant concepts include log timestamps, observed timestamps, trace/span IDs, resources, attributes, event names, process attributes, service attributes, session attributes, and VCS attributes. Sources: [OTel logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/), [process resource](https://opentelemetry.io/docs/specs/semconv/resource/process/), [service resource](https://opentelemetry.io/docs/specs/semconv/resource/service/), [session attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/session/), [VCS attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/).

### Deterministic Attention Routing Baseline

**Source agent:** Ramanujan  
**Status:** Completed on June 23, 2026.

The sidecar recommendation was to keep V0 Needs You deterministic. Tyler rejected a purely deterministic queue in favor of broader LLM-delivered context, but the deterministic research remains useful as the hard-evidence baseline and guardrail layer.

Relevant sources:

- [Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/) emphasizes that human-interrupting alerts should be simple, actionable, and low-noise.
- [Codex hooks](https://developers.openai.com/codex/hooks) expose concrete attention signals such as permission requests, post-tool results, stop events, session IDs, cwd, permission mode, and tool payloads.
- [Codex App Server](https://developers.openai.com/codex/app-server) models approvals with thread/turn/item identity and resolution events.
- [Claude permissions](https://code.claude.com/docs/en/permissions) and [Claude hooks](https://code.claude.com/docs/en/hooks) show that other runtimes also expose structured permission and idle/notification hooks.
- [PagerDuty severity levels](https://response.pagerduty.com/before/severity_levels/) are useful structurally: severity should drive response behavior, not just color.
- [Codex app features](https://developers.openai.com/codex/app/features), [Codex worktrees](https://developers.openai.com/codex/app/worktrees), and GitHub Copilot agent docs show how existing tools surface approvals, completion, sessions, diffs, commits, and human review.

Deterministic guardrails worth preserving even with an LLM-contextual queue:

- Do not OS-notify every Needs You item. Reserve OS notifications for high-priority items when the app is backgrounded.
- Coalesce repeated alerts by `session_id + rule_id + canonical target`.
- Do not interrupt on a single transient failure while an agent is still recovering.
- Every item needs a rule/model origin, timestamp, evidence, affected path/command/session, confidence source, and next action.
- Repeated dismissals should create suppression/snooze options.

Useful severity taxonomy:

- `P0 Immediate decision`: destructive/prod/security approval, credential exposure, non-local migration, deploy, data deletion.
- `P1 Blocking/failing`: approval pending, user question, repeated failure, unrecovered failure, exact file conflict, same branch/worktree collision, stalled session.
- `P2 Review/risk`: completed task awaiting review, completed without verification, large diff, dependency/migration/auth/billing/deploy path changed, dirty worktree after completion.
- `P3 Info`: new session, tests started, branch changed, commit created, worktree clean.

Recommended deterministic V0 rules to feed the LLM-contextual layer:

| Rule | Severity | Trigger |
|---|---:|---|
| `approval-requested` | P1/P0 | Provider approval request; P0 if destructive/prod/security/network-sensitive |
| `user-input-requested` | P1 | Explicit question or `requestUserInput` equivalent |
| `repeated-command-failure` | P1 | Same normalized command fails 3x in 10m |
| `unrecovered-stop-after-failure` | P1 | Session stops after failed command/tool without recovery |
| `exact-file-overlap` | P1 | Active sessions in same repo modify same normalized path |
| `same-worktree-or-branch-collision` | P1 | Two active sessions share same worktree or same checked-out branch |
| `stalled-session` | P1 | No meaningful progress beyond threshold, excluding known long-running commands |
| `completed-awaiting-review` | P2 | Session completed with changed files or commits |
| `completed-without-verification` | P2 | No successful test/build/lint after last code change |
| `high-risk-path-changed` | P2 | migrations, schema, lockfiles, workflows, auth, billing, deploy, env/config |
| `tests-failed-after-change` | P1/P2 | P1 if stopped/claimed complete; P2 while still actively recovering |
| `large-diff-review` | P2 | Changed files/LOC exceeds configured threshold |

Items not to let the LLM present without evidence:

- Agent confidence or sentiment.
- Semantic module-overlap alerts without file/event support.
- Token/context pressure unless it directly blocks work.
- Single transient failures while the agent is actively recovering.

### Evidence-Grounded LLM Attention Queue

**Source agent:** Schrodinger  
**Status:** Completed on June 23, 2026.

The sidecar recommendation was to build a deterministic attention queue with LLM-assisted explanation, not an LLM-owned queue. Tyler’s accepted direction is broader than that: the LLM can create contextual queue items, but it must do so through a strict evidence contract and priority boundary.

Useful split:

| Layer | Deterministic | LLM-contextual |
|---|---|---|
| Queue entry | approvals, failed tests, stale waits, conflicts, high-risk actions | broader context item if evidence-backed |
| Priority | hard severity rules, age, reversibility, blast radius | ordering hints and explanation |
| Evidence | event IDs, logs, diffs, tool calls, timestamps | cite and compress evidence |
| Actions | user-approved only | propose actions, never execute |
| Dismissal | explicit user action or resolved source signal | recommend dismissal with evidence |

Every queue card should carry:

- `Observed`: deterministic facts from events.
- `Inferred`: LLM interpretation grounded in cited events.
- `Missing`: what the system could not verify.
- `Suggested next step`: phrased as a proposal, not truth.

Suggested strict output schema:

```json
{
  "title": "...",
  "attention_reason": "...",
  "support_level": "observed|inferred|weak",
  "risk_labels": ["approval", "production", "blocked"],
  "evidence_refs": ["event:...", "run:..."],
  "unknowns": ["..."],
  "recommended_action": "..."
}
```

Validation rules:

- Reject cards with zero evidence references.
- Reject claims that mention files/actions not present in evidence.
- Down-rank summaries with weak or conflicting evidence.
- Keep raw evidence expandable beside the summary.
- Do not use model confidence as priority.

Recommended basis labels:

- `Direct evidence`
- `Likely`
- `Weak signal`
- `Needs review`
- `Blocked`
- `Waiting on user`
- `High-risk action`
- `Stale`
- `Contradiction`
- `Verification missing`

Recommended UX:

- Queue item headline should make the action/reason obvious.
- LLM summary should be visibly distinguishable from raw evidence.
- Evidence chips should always be visible.
- “Why?” should open the source timeline.
- “Wrong?” should let Tyler correct the reason.
- “Do not surface this again” should create an explicit rule/suppression, not hidden model memory.
- Include privacy state such as `Local only`, `Redacted remote`, or `Raw remote`.

Relevant sources:

- [Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/) for low-noise, actionable human interruptions.
- [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/) for prompt injection, sensitive information disclosure, improper output handling, and excessive agency risks.
- [OWASP LLM01 prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) for constrained behavior, output validation, least privilege, separating untrusted content, human approval for high-risk actions, and adversarial testing.
- [Microsoft HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/library/) for explaining system capabilities, showing why behavior occurred, supporting correction, and providing controls.
- [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) for GAI risks around confabulation, privacy leakage, integrity, and provenance.
- [OpenAI Enterprise Privacy](https://openai.com/enterprise-privacy/) as an example of provider-side privacy controls, while still treating coding-agent prompts and logs as sensitive operational data.
- [LangSmith Observability](https://docs.langchain.com/langsmith/observability) for traces, dashboards, alerts, feedback, and evaluations in LLM applications.
- [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) for agent/tool telemetry shape.

Caveats:

- Treat all agent outputs, webpages, emails, logs, and repo text as untrusted prompt-injection surfaces.
- The first version should optimize trust calibration rather than cleverness.
- False positives can turn Needs You into another inbox; false negatives are unacceptable for destructive actions, deployments, security, data loss, and user-visible failures.

### LLM Context Privacy and Retention

**Source agent:** Socrates  
**Status:** Completed on June 23, 2026.

V0 should be local-first by default. Remote LLM use should be off until the user enables it per workspace/provider.

Default capture should favor structured evidence over raw content:

- session ID, repo/worktree, branch, agent name, timestamps
- command name, exit code, duration, retry count
- relative file paths, Git status/diff stats, touched-file list
- bounded redacted excerpts around failures, approval requests, test failures, merge conflicts, permission blockers, and auth blockers

Do not capture by default:

- full transcripts
- full diffs
- full command output
- `.env*`
- private keys
- cloud credentials
- shell history
- browser state
- screenshots
- ignored/binary files

Retention recommendation:

- raw redacted snippets: 7 days
- queue history/summaries: 30 days
- pinned items: until user deletes
- prefer source pointers and hashes over duplicated raw content
- use encrypted local app storage where practical

Remote LLM payload rule:

```text
Need type, repo alias, relative paths, command summary, exit code,
redacted failure excerpt, diffstat, agent state, user-facing question.
```

Do not send full code, full prompts, full logs, raw env vars, secrets, customer data, or unredacted absolute paths unless the user explicitly approves that item. Show a payload preview before the first remote send per repo.

Provider caveats:

- [OpenAI data controls](https://platform.openai.com/docs/guides/your-data): API data is not used for training by default, with abuse logs generally retained for limited periods and Zero Data Retention available for eligible customers.
- [Anthropic organization retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) and [Anthropic model training](https://privacy.claude.com/en/articles/7996885-how-do-you-use-personal-data-in-model-training): organization/API data handling differs from consumer data and has retention/training rules.
- [Gemini API terms](https://ai.google.dev/gemini-api/terms): unpaid/free tiers may have different improvement/human-review terms; avoid unpaid tiers for private code.

Redaction strategy:

- Run redaction before persistence and again before remote send.
- Detect GitHub tokens, API keys, JWTs, OAuth tokens, private keys, SSH keys, connection strings, cookies, auth headers, cloud credentials, URLs with credentials, password fields, token/secret env vars, `.npmrc`, and kubeconfig.
- Use stable placeholders such as `[SECRET:aws_access_key:HMAC12]`, `[EMAIL:HMAC12]`, and `[ABS_PATH:HMAC12]`.
- Keep allowlists for false positives and per-repo denylist globs.
- Useful references: [GitHub secret scanning concepts](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning), [GitHub supported patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns), and [Gitleaks](https://github.com/gitleaks/gitleaks).

Prompt injection controls:

- Treat repo files, logs, transcripts, diffs, command output, markdown, HTML, and prior agent prompts as untrusted data.
- LLM may summarize/classify but cannot execute actions or mark items resolved.
- Separate trusted policy from untrusted evidence in prompts.
- Quote evidence in fenced/data blocks and never treat it as instructions.
- Validate model output against a schema.
- Add adversarial fixtures with prompt injection in logs, diffs, README files, stack traces, ANSI/control characters, markdown images, and encoded text.
- References: [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [OWASP prompt injection cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), and [NCSC caution on building with LLMs](https://www.ncsc.gov.uk/blog-post/exercise-caution-building-off-llms).

Local versus remote LLM:

- V0 default should be deterministic rules plus optional local model summarization.
- Local options include [Ollama](https://github.com/ollama/ollama), [LM Studio](https://lmstudio.ai/docs), and [llama.cpp](https://github.com/ggml-org/llama.cpp).
- Remote models can improve quality but require explicit user consent, provider-policy review, and payload minimization.

Audit logging:

- event captured
- fields redacted
- remote payload summary, provider/model, timestamp, request ID, token/byte count
- user consent action
- retention expiration
- queue item state changes

Do not audit-log raw secrets or unredacted remote payloads.

V0 user controls:

- `Local only` / `Remote allowed`
- per-repo enablement
- pause capture
- delete repo data
- retention slider
- exclude paths/globs
- capture snippets toggle
- capture diffs explicit opt-in
- show remote payload before send
- local model selection
- export/delete audit log

Core caveat: redaction is imperfect. The safest V0 posture is metadata-first, redacted snippets, remote off, user-visible evidence, and no autonomous actions.

### Codex Hook Installation and Onboarding

**Source agent:** Cicero  
**Status:** Completed on June 23, 2026.

For V0, use a global user hook in `~/.codex/hooks.json`, implemented as a tiny fail-open Masthead shim with per-project routing in Masthead’s own config. This gives the desktop control tower coverage across projects without requiring every repo to carry `.codex/` files.

Relevant sources:

- [Codex hooks](https://developers.openai.com/codex/hooks): hooks are enabled by default and can live in user config, project config, or bundled plugins. Multiple matching sources all run.
- [Codex hooks](https://developers.openai.com/codex/hooks): non-managed command hooks require review/trust before running; trust is recorded against the hook definition hash; changed/new hooks are skipped until trusted.
- [Codex advanced config](https://developers.openai.com/codex/config-advanced): project hooks only load when the project `.codex/` layer is trusted; user/global hooks load independently.
- [Build Codex plugins](https://developers.openai.com/codex/plugins/build): plugin-bundled hooks are supported but still require hook trust.
- [Codex plugins](https://developers.openai.com/codex/plugins): plugin uninstall/disable can remove or disable plugin-bundled hooks.

Option tradeoffs:

| Option | Best for | Problems |
|---|---|---|
| Global user hook | V0 desktop control tower, all projects, one install | Broad blast radius; must fail open; user must trust a global script |
| Project hook | Repo-specific policy, team-owned behavior | Per-repo install; only trusted projects; poor default for multi-project Masthead |
| Plugin-bundled hook | Later productized distribution | More packaging/install surface; still requires hook trust |

Fail-open requirements:

- Exit `0` if Masthead is closed, unreachable, misconfigured, or slow.
- Set explicit short hook timeouts; default hook timeout is too long for telemetry.
- Emit no stdout in normal telemetry paths.
- Do not return `decision: "block"`, `continue: false`, or exit `2` except in a future explicit enforcement mode.
- Use an absolute path to a stable Masthead hook shim.
- Keep the hook definition stable and move mutable behavior into Masthead config so trust prompts do not recur unnecessarily.
- If event capture matters while the app is closed, use a bounded local queue; on write failure, drop the event.

Security notes:

- Hooks receive sensitive data such as cwd, session ID, transcript path, prompt text for prompt events, tool inputs, and tool responses.
- Treat hook data as local private telemetry.
- Do not log prompts by default.
- Avoid executing repo-local scripts in V0.
- The global Masthead hook can route by cwd and ignore unenrolled projects.
- Hook enforcement is incomplete; do not position hooks as a complete security boundary.

Uninstall and rollback:

- Remove only Masthead’s hook block from `~/.codex/hooks.json`.
- Keep a pre-install backup and parse-check before writing.
- Emergency kill switch is disabling Codex hooks globally, but that affects all hooks.
- Plugin route later: uninstall plugin or disable it in plugin config.

First-run flow:

1. Detect Codex CLI/version and confirm hooks are enabled.
2. Explain the hook scope; default to “global hook, selected projects only.”
3. Install or merge a single Masthead hook entry into `~/.codex/hooks.json`; never overwrite existing hooks.
4. Ask the user to start/restart Codex and open `/hooks` to review/trust the hook.
5. Run a health check: Masthead sees `SessionStart`, and Codex still works when Masthead is closed.
6. Show enrolled projects, last event time, and one-click disable/rollback.

Open questions:

1. Does Codex hook trust hash only the hook definition or also referenced script contents?
2. Are hook subprocesses sandboxed identically to model-generated commands?
3. What minimum Codex version will Masthead support?
4. Will V0 telemetry ever block/approve `PermissionRequest` events, or is it observe-only?

### Git Conflict Scope

**Source agent:** Nietzsche  
**Status:** Completed on June 23, 2026.

Recommended V0 scope:

- Same real filesystem path, including parent/child workspace overlap.
- Same Git worktree family, detected by `git rev-parse --git-common-dir`.
- Same worktree family with known dirty tracked-file overlap, observed through `git status --porcelain=v2 -z`.
- Branch already checked out in another worktree in the same family should require user override because Git itself refuses this by default unless forced.

Treat separate clones with the same remote URL and branch as a future “remote integration risk,” not a local hard conflict. Show shared upstream/branch and require fetch/merge dry-run before publish, but do not block parallel local work only because URL and branch match.

Relevant sources:

- [git-worktree](https://git-scm.com/docs/git-worktree): linked worktrees share the common Git directory, refs, objects, and config, while `HEAD` and index are per-worktree.
- [git-rev-parse](https://git-scm.com/docs/git-rev-parse): `--git-common-dir` and related options identify repository/worktree metadata.
- [git-merge-tree](https://git-scm.com/docs/git-merge-tree): `git merge-tree --write-tree --quiet <candidate> <target>` can dry-run merge results after both sides have commits without touching the working tree or index.
- [gitignore](https://git-scm.com/docs/gitignore) and [git-status](https://git-scm.com/docs/git-status): ignore rules affect intentionally untracked files; tracked files remain Git-visible.
- [npm package-lock](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/) and [pnpm lockfiles](https://pnpm.io/git): lockfiles are high-risk tracked files; textual conflict detection is not enough to guarantee package graph correctness.
- [Prisma migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories): migration ordering/history matters.
- [Docker Compose project names](https://docs.docker.com/compose/how-tos/project-name/): compose project names isolate environments and are relevant to dev-resource conflicts.
- [git-push](https://git-scm.com/docs/git-push): future publish queue should account for fast-forward and `--force-with-lease` semantics.

V0 policy details:

- Tracked generated files are normal Git risk.
- Ignored generated files are runtime/deploy risk, not merge-tree risk.
- Lockfiles should be marked high-risk and should prompt package-manager regeneration/review.
- Same migration filename is a hard conflict; same migration directory is high-risk because order matters.
- Dev resources such as ports, local DB URLs/files, Docker Compose project names, volumes, and caches should be handled separately from Git conflicts.

Future extensions:

- Normalize remote URLs across SSH/HTTPS.
- Add remote-ref coordinator for same upstream branch.
- Add repo-specific manifests for generated assets, lockfiles, migration directories, ports, env files, and local DBs.
- Add semantic gates such as build/test, migration replay in disposable DB, and package-manager lockfile repair.
- Add publish queue: fetch, merge-tree, test, then push with explicit expected remote tip.

### Ignored Files and Shared Local Resources

**Source agent:** Russell  
**Status:** Completed on June 23, 2026.

V0 should treat conflicts as evidence-backed resource collisions, not only Git merge risks.

Include by default:

- tracked Git changes, untracked non-ignored files, branch/worktree identity, and exact path overlap
- high-risk path classifiers for migrations, dependency manifests, lockfiles, env/config templates, deploy/CI files, Docker/Compose files, auth, billing, and database code
- shared local resource signals such as listening ports, dev server commands, Docker Compose project names, published ports, named volumes, local DB fingerprints, SQLite file paths, and migration commands
- metadata for ignored/private resources when they are risk signals, but not their content

Exclude by default for privacy/noise:

- raw `.env*` contents
- private keys and cloud credentials
- shell history and browser state
- local DB contents
- raw command logs and full diffs
- screenshots
- ignored binaries
- build caches such as `node_modules`, `.next`, `dist`, `coverage`, `.venv`, `target`, `.turbo`, and `.cache`
- ignored/generated file churn unless it maps to a known shared resource or high-risk path

Path handling matrix:

| Class | V0 Handling | Default Severity |
|---|---|---:|
| Same tracked source path changed by two sessions | Conflict card | P1 |
| Untracked non-ignored same path | Conflict card, lower confidence unless direct attribution exists | P1/P2 |
| Ignored build/cache output | Suppress, count only | P3/hidden |
| Tracked generated source/schema | Include with `generated` label | P2, P1 on overlap |
| Lockfiles | Include; pair with manifest when possible | P2 single, P1 overlap |
| `.env*`, secrets, credentials | Path metadata only; never raw content | P0/P1 |
| Env examples/config templates | Include as high-risk config | P2, P1 overlap |
| DB migrations/schema dumps | Include as high-risk | P2 single, P1 overlap |
| Remote migration/deploy command | Needs You | P0/P1 |
| Fixed port collision or `EADDRINUSE` | Needs You | P1 |
| Dev server auto-shifted port | Review item: URL drift | P2 |
| Same local DB used by two write/migration sessions | Needs You | P1 |
| Same Docker Compose project/volume/host port | Shared resource warning | P1/P2 |

Relevant sources:

- [gitignore docs](https://git-scm.com/docs/gitignore) and [git-check-ignore](https://git-scm.com/docs/git-check-ignore): use Git’s ignore semantics and show the ignore source when suppressing something.
- [npm package-lock](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/), [pnpm lockfiles](https://pnpm.io/git), [Cargo.lock](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html), [Poetry lock](https://python-poetry.org/docs/basic-usage/#installing-dependencies), and [uv.lock](https://docs.astral.sh/uv/concepts/projects/layout/#the-lockfile): lockfiles are reproducibility artifacts and should be treated as high-risk coordination files.
- [dotenv FAQ](https://github.com/motdotla/dotenv/blob/master/README.md#faq), [Twelve-Factor config](https://12factor.net/config), and [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning): `.env*` and credentials should be visible as touched paths, but content should remain hidden.
- [Prisma migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories), [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations), and [Rails migrations](https://guides.rubyonrails.org/active_record_migrations.html): migrations deserve special handling because ordering and already-applied history matter.
- [Vite server options](https://vite.dev/config/server-options.html), [Next CLI port options](https://nextjs.org/docs/app/api-reference/cli/next#next-dev-options), [Node `EADDRINUSE`](https://nodejs.org/api/errors.html#eaddrinuse-address-already-in-use), and [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/): port/resource conflicts should be detected as runtime signals.
- [SQLite WAL](https://www.sqlite.org/wal.html), [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html), [Supabase local development](https://supabase.com/docs/guides/local-development/overview), [Docker Compose project name](https://docs.docker.com/compose/how-tos/project-name/), and [Docker Compose ports](https://docs.docker.com/reference/compose-file/services/#ports): local DBs and Compose resources should be fingerprinted without reading contents.

Migration rules for V0:

- Any migration path changed: P2 review.
- Same migration file/directory changed by two sessions: P1 conflict.
- Two sessions add migrations in same sequence family: P1 possible ordering conflict.
- `db push`, `migrate deploy`, `supabase db push`, or remote DSN detected: P0/P1 with redacted target.
- Editing an already-applied migration, if detectable: P0/P1.

Evidence UI should show:

- `What`: path/resource/port/db/lockfile/migration
- `Who`: sessions, branch, worktree, cwd, provider IDs when known
- `Why`: deterministic rule plus severity
- `Evidence`: Git status, command, PID/start time, socket, container, migration filename, ignore rule, redacted target
- `Confidence`: direct, correlated, shared workspace, or unattributed
- `Hidden`: explanation for suppressed content, such as “content hidden: .env file” or “ignored generated output”
- `Next action`: open session, open diff, inspect resource, rerun verification, or dismiss/snooze

Caveat: same-directory sessions must be labeled degraded. Do not claim per-session file attribution unless Codex directly reported the file or worktree/process correlation is unique.

### Flexible Outcome Tracking

**Source agent:** Wegener  
**Status:** Completed on June 23, 2026.

Outcome tracking should have two layers:

1. **Evidence layer:** immutable observed facts.
2. **Policy layer:** user-tuned rules that interpret those facts into labels, alerts, and dispositions.

This lets Masthead dogfood its way into better definitions without corrupting historical evidence.

Flexible definition recommendations:

- Store raw evidence once.
- Derive outcome status through versioned “outcome recipes.”
- Allow per-user and per-repo policy overrides.
- Recompute derived labels when policy changes.
- Preserve the original outcome snapshot for audit.
- Treat V0 defaults as starter heuristics, not doctrine.

Default disposition labels:

- `accepted`
- `partially_accepted`
- `abandoned`
- `superseded`
- `failed`
- `needs_review`
- `unknown`

Allow user-configurable additions such as:

- `shipped`
- `parked`
- `manual_followup`
- `reverted`
- `reopened`
- `duplicate`

Disposition schema:

```text
label
category
terminal: true/false
counts_as_success: true/false
requires_note: true/false
```

Tunable thresholds:

- command patterns that count as verification
- how long after the last code change verification becomes stale
- large diff thresholds
- high-risk path globs
- whether docs-only changes require verification
- whether manual/browser verification counts
- whether dirty worktree blocks `accepted`
- which findings trigger Needs You

Feedback loops:

- Every dismissal or review action should support lightweight reason codes.
- Suggested reason codes: `not_relevant`, `already_verified_elsewhere`, `expected_failure`, `docs_only`, `false_positive`, `handled_manually`, `too_noisy`, `wrong_session`.
- Use repeated feedback to suggest local policy changes, but do not silently mutate rules.
- Example: “You dismissed this warning 4 times for docs-only changes. Exclude `docs/**` from verification-required?”

Non-adjustable evidence:

- Git snapshots, changed paths, diff stats
- command runs, exit codes, durations
- test/build/check results
- commit SHAs, branch, remote, PR URL
- review comments and check status when available
- timestamps and source confidence
- user disposition history

Adjustable policy:

- outcome label names
- alert severity
- verification command classifiers
- risk path rules
- completion thresholds
- notification behavior
- repo-specific expectations

UI pattern:

```text
Observed
8 files changed, npm test passed, commit abc123 created

Policy Result
Accepted by current repo policy

User Disposition
Tyler marked: partially_accepted
```

Caveat: customization should tune interpretation, not weaken the evidence contract. Masthead still needs crisp defaults.

### First-Proof Architecture

**Source agent:** Aristotle  
**Status:** Completed on June 23, 2026.

Recommendation: use Tauri 2, Rust collector, SQLite, and React for the first credible proof. This best matches Masthead’s promise as a local-first desktop control tower that can sit in the tray, run in the background, observe local agent/repo activity, show native notifications, and own a second-monitor window.

Architecture option tradeoffs:

| Option | Best For | Main Problem |
|---|---|---|
| Tauri 2 + Rust + SQLite + React | Credible desktop proof | Rust/Tauri packaging setup cost |
| Local web daemon + React | Fast collector/dashboard spike | Weak desktop presence |
| Electron/Node | Fastest JS-only desktop iteration | Heavier runtime, security/native-module baggage |

Tauri/Rust strengths:

- Native desktop surface: tray, notifications, window state, autostart, single-instance behavior, monitor/window APIs.
- Rust is a good fit for long-running local collectors: file watching, process polling, Git shell/plumbing calls, and SQLite write queue.
- SQLite is a strong default for local app state and WAL mode improves read/write concurrency for a desktop app.
- Second-monitor UX is more credible than browser-only because Tauri exposes monitor listing and window-positioning APIs.
- Smaller footprint than Electron because it uses OS webviews rather than bundling Chromium.

Relevant Tauri/SQLite sources:

- [Tauri process model](https://v2.tauri.app/concept/process-model/)
- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri notifications](https://v2.tauri.app/plugin/notification/)
- [Tauri autostart](https://v2.tauri.app/plugin/autostart/)
- [Tauri window state](https://v2.tauri.app/plugin/window-state/)
- [Tauri window/monitor APIs](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [SQLite appropriate uses](https://www.sqlite.org/whentouse.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)

Caveats:

- Linux dev/build dependencies are real, especially WebKitGTK/AppIndicator packages. Source: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- Distribution eventually requires signing/notarization expectations. Source: [Tauri distribute](https://v2.tauri.app/distribute/).
- Do not expose raw SQL directly to React; keep SQLite writes/queries behind Rust commands.
- File watching is imperfect across editor save behavior, network filesystems, Linux watcher limits, and large trees. Source: [notify known problems](https://docs.rs/notify/latest/notify/).

Local web daemon notes:

- Useful for a one-to-two-day ingestion proof if needed.
- Weak on tray/background/autostart/native notifications and second-monitor window control.
- Browser notifications require permission and browser-mediated behavior. Sources: [MDN Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API), [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).
- Browser Window Management is experimental and constrained. Source: [MDN Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API).
- A localhost server expands local attack surface. Source: [Tauri localhost plugin warning](https://v2.tauri.app/plugin/localhost/).

Electron notes:

- Mature desktop APIs and fast JS-only iteration, but heavier and more security-sensitive.
- Sources: [Electron tray](https://www.electronjs.org/docs/latest/api/tray), [Electron notifications](https://www.electronjs.org/docs/latest/api/notification), [Electron screen](https://www.electronjs.org/docs/latest/api/screen), [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance).

Recommended first implementation shape:

1. Tauri 2 shell with React dashboard, tray icon, persisted window state, and second-monitor board window.
2. Rust collector task inside the Tauri core process, writing to SQLite through a single writer queue.
3. SQLite WAL enabled; UI reads through typed Rust commands, not raw SQL.
4. Manual repo registration: user picks a worktree; collector watches files and polls Git.
5. Hook ingestion endpoint/CLI: simple local JSON schema for agent events.
6. Native notification for one valuable event such as run finished, blocked, or needs review.

Defer for proof:

- global hook installers
- autostart by default
- deep process ancestry
- cross-agent adapters
- auto-update
- full Linux polish
- privileged OS monitoring

Note: global hook installation remains a decided product path, but it can be staged after manual hook/event ingestion proves the collector/UI loop.

### First Screen and UI Evidence Design

**Source agent:** Pascal  
**Status:** Completed on June 23, 2026.

Core direction: Masthead should feel like an operator board, not an analytics dashboard. The first screen should answer, in order:

1. what needs me
2. what may collide
3. what is still running
4. what produced an outcome

Avoid leading with token charts, model usage, generic timelines, activity graphs, heatmaps, or decorative KPI cards.

Recommended first screen:

1. **Needs You lane**
   - Fixed top/left priority area.
   - Shows only actionable queue items.
   - Each item shows title, severity, session, evidence chips, confidence, and next action.
   - Adjacent model: [Linear Triage](https://linear.app/docs/triage), especially accept/decline/snooze-style actions and queue ownership.

2. **Live Sessions board**
   - Compact row-card hybrid, not large analytics cards.
   - Healthy sessions stay visually quiet.
   - Risk, waiting, conflict, failed, and completed states dominate.
   - Each session row shows repo, branch/worktree, current state, last meaningful event, active command, changed-path count, verification status, and unresolved alerts.

Needs You severity framing:

- `P0`: destructive/prod/security approval, credential exposure, data loss, remote migration/deploy.
- `P1`: waiting on user, failed/stopped, exact file conflict, same worktree/branch collision, stale blocked session.
- `P2`: completed awaiting review, no verification, high-risk path touched, large diff.
- `P3`: passive activity.

Useful sources:

- [Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/): human interruptions should be actionable, urgent, and not just “weird.”
- [PagerDuty severity levels](https://response.pagerduty.com/before/severity_levels/): severity maps to response behavior, not just color.

Conflict evidence card shape:

```text
What: src/auth/session.ts touched by 2 active sessions
Who: session A on branch x, session B on branch y
Why: exact path overlap in same git worktree family
Confidence: direct / correlated / shared workspace / unattributed
Evidence: git status snapshot, Codex event, command, timestamp
Next: open both sessions, open diff, snooze, mark expected
```

References:

- [VS Code merge conflict UI](https://code.visualstudio.com/docs/sourcecontrol/overview#_merge-conflicts): conflict list first, detailed evidence when expanded.
- [Codex worktrees](https://developers.openai.com/codex/app/worktrees): native baseline Masthead should coordinate across, not duplicate.

Outcome card evidence should include:

- changed files / diffstat
- tests, lint, build, browser/manual verification
- dirty/clean worktree
- commits/PRs
- unresolved Needs You items
- user disposition such as accepted, partial, failed, abandoned, superseded

Keyboard and desktop UX:

- `Cmd/Ctrl+K`: command palette.
- `F6`: cycle panes.
- Arrow keys inside queue/session grids.
- `Enter`: open focused item.
- `Esc`: close panel/back out.
- `/`: search/filter.
- `1/2/3/H`: quick queue actions.
- `?`: shortcut overlay.
- Never initial-focus a destructive action.

References:

- [WAI-ARIA keyboard practices](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [Microsoft keyboard interactions](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-interactions)
- [Raycast shortcuts](https://manual.raycast.com/keyboard-shortcuts)

Native desktop conventions:

- Persist second-monitor window position with [Tauri window state](https://v2.tauri.app/plugin/window-state/).
- Use monitor APIs such as [availableMonitors](https://v2.tauri.app/reference/javascript/api/namespacewindow/#availablemonitors).
- Use tray status/open/pause through [Tauri system tray](https://v2.tauri.app/learn/system-tray/).
- Reserve native notifications for P0/P1 or backgrounded app states through [Tauri notifications](https://v2.tauri.app/plugin/notification/).

Adjacent patterns:

- [Linear Triage](https://linear.app/docs/triage): queue ownership, fast actions, snooze.
- [Raycast](https://manual.raycast.com/keyboard-shortcuts): command-first desktop ergonomics.
- [VS Code Source Control](https://code.visualstudio.com/docs/sourcecontrol/overview): diff/conflict evidence hierarchy.
- [OpenAI Codex app features](https://developers.openai.com/codex/app/features): existing baseline for diffs, terminal, commit/PR flow.
- [ThreadDeck](https://github.com/readysteadyscience/codex-threaddeck): useful dispatch-desk framing, but Masthead should be visual/native rather than conversation-centered.

Caveats:

- LLM-created queue items must always show evidence and be labeled as inferred.
- Same-directory attribution must be visibly degraded.
- OS notifications vary by platform and permission state; the in-app Needs You queue remains the source of truth.
- Density is useful only if visual hierarchy still makes one answer obvious: what needs Tyler now.

### V0 Control and Action Boundary

**Source agent:** Dirac  
**Status:** Completed on June 23, 2026.

V0 should be observe, navigate, and local disposition only. Masthead should help the user reach the right source of truth quickly, but should not become the actor that changes Codex, Git, hooks, shells, browser state, or remote state.

Safe V0 actions:

- Open/focus source surfaces:
  - Open Codex thread.
  - Open repo/worktree folder.
  - Open file.
  - Open read-only diff/diffstat.
  - Open relevant terminal/session without typing or running.
- Local Masthead-only workflow:
  - Snooze alert.
  - Mark expected, false positive, reviewed, abandoned, or superseded.
  - Add local note or disposition.
  - Pause/resume Masthead capture.
  - Delete/export Masthead-local data.
- Read-only inspection:
  - Git status, diff, diffstat, log.
  - Dry-run conflict checks that do not touch index/worktree.
  - Process/port observation.
  - Evidence cards with confidence labels.

Do not ship in V0:

- Codex control: approve/deny requests, stop/interrupt turns, start/fork/archive threads, steer active turns, launch agents/background tasks, run `thread/shellCommand` or equivalent.
- Git mutation: stage, revert, commit, push, pull, rebase, merge, branch delete, force push.
- Shell/browser/OS control: run commands, use Computer Use, drive browser automation, change app/server permissions.
- Config mutation from normal dashboard controls: edit Codex hooks, rules, permissions, MCP, network, or sandbox config. Hook install/uninstall can exist only as an explicit onboarding/admin flow.

Codex surface notes:

- [Codex App Server](https://developers.openai.com/codex/app-server) is a deep integration API for auth, history, approvals, streamed events, thread creation/resume/fork, turn steering/interruption, command runs, and file changes. Treat it as a control API, not just telemetry.
- [Codex app features](https://developers.openai.com/codex/app/features) already include Git diff, staging/revert, commit, push, PR, terminal, worktree, in-app browser, and Computer Use surfaces. V0 should link to these rather than duplicate or remote-control them.
- [Agent approvals and security](https://developers.openai.com/codex/agent-approvals-security) define the trust boundary for sandboxing and approval policy. Masthead should not collapse that boundary into one-click approvals.
- [Codex hooks](https://developers.openai.com/codex/hooks) are useful for passive lifecycle observation, but V0 hooks should be fail-open, short-timeout, no stdout, no blocking decisions, and no prompt/diff/output capture by default.

Security and trust:

- Main risk is excessive agency. [OWASP LLM06 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) recommends least privilege, narrow tools, human approval for high-impact actions, and complete mediation outside the LLM.
- Treat repo files, prompts, logs, command output, diffs, and transcripts as untrusted and sensitive.
- If Tauri is used, keep the Rust/core side as the privileged boundary and expose only narrow typed commands to the UI. Source: [Tauri security](https://v2.tauri.app/security/).

UX affordances:

- Label actions by blast radius:
  - `Open`
  - `Masthead only`
  - `Changes Codex`
  - `Changes Git`
  - `Runs command`
  - `Changes config`
- In V0, only `Open` and `Masthead only` categories should be enabled.
- Approval alerts should use `Open in Codex`, not `Approve`.
- Use triage-style local actions such as accept/mark/snooze with evidence and confidence. Source: [Linear Triage](https://linear.app/docs/triage).
- Make keyboard navigation strong, but never initial-focus risky/destructive actions. Source: [WAI-ARIA keyboard practices](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).

Recommended V0 action set:

- Open Codex.
- Open file.
- Open diff.
- Open folder.
- Copy evidence.
- Snooze.
- Mark disposition.
- Pause capture.
- Delete/export local data.

Everything else should stay behind a later explicit control mode with setup, audit log, per-action confirmation, and clear indication that Masthead is acting on Codex/Git/system state rather than observing it.
