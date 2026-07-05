# Live Multi-Harness Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Masthead show live sessions, live status, and transcript-backed Board headlines for Codex, Claude Code, Cursor Agent, Grok Build, OpenCode, and OMP.

**Architecture:** Keep Codex as the compatibility baseline, then extract its hook ingest path into runtime-scoped live capture primitives. Use hooks or plugins for low-latency lifecycle/status events, and use local transcript or SQLite tailers for headline evidence and fallback live cards when a harness hook is partial. Store all live data in Masthead's existing canonical session graph with runtime-scoped identity so sessions from different harnesses cannot collide.

**Tech Stack:** TypeScript, Node HTTP daemon, SQLite via `node:sqlite`, existing Masthead adapters, CLI hook commands, OpenCode JavaScript plugin, OMP extension hooks, Vitest, existing smoke and doctor scripts.

---

## Plan Optimizer Hardening

This plan was optimized against a release-readiness rubric after the first draft:

- Goal fit and scope control: live capture for exactly the requested local harnesses, with Gemini and other adapters explicitly out of scope.
- Correct architecture: runtime-scoped canonical identity, hooks/plugins for lifecycle, and local tailers for transcript/headline evidence.
- Sequencing: Codex compatibility and shared primitives land before new harnesses; Grok runtime type support lands before shared profiles reference it.
- Safety: no hook/plugin installer may overwrite user config without a backup, no source harness may fail because Masthead capture fails, and daemon-side disable flags are available for rollback.
- Privacy: hook metadata can flow immediately, but prompt/assistant transcript text from tailers remains behind transcript import policy.
- Verification: each task has a focused failing test, targeted verification, and release acceptance checks on this machine.

## Execution Mode

Use `superpowers:subagent-driven-development` for execution.

Run tasks sequentially. These tasks touch overlapping daemon, adapter, and projection code, so parallel implementation would create merge conflicts and duplicate abstractions.

After each task:

1. Run the task's verification command.
2. Commit only the files listed in that task.
3. Dispatch a spec-compliance reviewer.
4. Dispatch a code-quality reviewer after spec compliance passes.
5. Continue only after both reviews pass.

## Scope

Release target runtimes:

- `codex`, existing live hook path, must continue working unchanged from the user's perspective.
- `claude_code`, Claude Code CLI, local hook config plus `~/.claude/projects/**/*.jsonl` transcript tailing.
- `cursor`, Cursor Agent, local hook config plus Cursor DB/log fallback because Cursor CLI hook coverage may be partial.
- `grok`, new runtime for Grok Build, local hook config plus `~/.grok/sessions/**` transcript tailing.
- `opencode`, OpenCode CLI, global plugin plus `opencode.db` tailing.
- `omp`, Oh My Pi, extension hook plus OMP workspace/session evidence.

Out of scope for this release:

- Gemini CLI. It is installed locally but not requested and is marked legacy in `src/adapters/harnessCatalog.ts`.
- Aider, OpenClaw, Hermes, Pi, and detector-only harnesses. Keep their existing import behavior.
- Remote cloud-only harnesses.
- Bitwarden or API key work. These connectors read local hook events and local stores. Model credentials are only needed for manual smoke sessions if the harness itself prompts for them.

Assumption:

- Tyler's "Build" target means Grok Build because the local binary is `grok`, the user also mentioned Grok, and local docs live under `~/.grok/docs`. Use runtime id `grok` and label `Grok Build`. If Tyler later means a different local binary named Build, add that as a separate catalog/runtime entry using the same live capture primitives.

## Evidence From Investigation

Current Masthead state:

- `src/adapters/types.ts` already models runtime-aware adapters and canonical sessions.
- `src/adapters/registry.ts` already registers Codex, Cursor, Claude Code, OpenCode, and other import adapters.
- `src/daemon/db/sessionRepository.ts` already stores canonical sessions by `host_id`, `runtime_id`, and `source_session_id`.
- `src/daemon/server.ts` still hard-codes live hook ingest to Codex:
  - imports only `adapterRecordFromCodexHook` and `codexHookSource`,
  - creates one Codex raw journal,
  - creates one Codex `sessions` repository,
  - replays only `codex-hook-local`,
  - computes canonical card ids with `runtimeKind: "codex"`,
  - accepts `/ingest` as Codex-only.
- `src/core/sessionReducer.ts` groups live events by raw `event.sessionId` and falls back to `${project} Codex session`.
- `src/core/replay.ts` renders every live card with `harness: "Codex"`.
- `src/ui/toolbarOptions.ts` only has `HarnessFilter = "all" | "codex"`.

Local harness facts:

- Codex is installed as `/home/tyler/.npm-global/bin/codex`, version `codex-cli 0.142.5`.
- Claude Code is installed as `/home/tyler/.local/bin/claude`, version `2.1.201`.
- Cursor Agent is installed through `/usr/bin/cursor`, version `3.9.16`.
- OpenCode is installed as `/home/tyler/.opencode/bin/opencode`, version `1.17.13`.
- Grok Build is installed as `/home/tyler/.local/bin/grok`, version `0.2.82`.
- OMP is installed as `/home/tyler/.bun/bin/omp`.

Harness capture facts:

- Claude Code supports hook lifecycle output in stream JSON and has local JSONL transcripts under `~/.claude/projects`.
- Cursor has `~/.cursor/hooks.json` and local hook documentation in `~/.cursor/skills-cursor/create-hook/SKILL.md`. Current CLI hook parity may be incomplete, so a fallback DB/log watcher is required.
- Grok Build local docs show hooks under `~/.grok/hooks/*.json` and sessions under `~/.grok/sessions/<encoded-cwd>/<session-id>/`.
- OpenCode official plugin docs show global plugins in `~/.config/opencode/plugins/`, and the local install already has a Bridgespace notification plugin using OpenCode's plugin event API.
- OpenCode session data is in `/home/tyler/.local/share/opencode/opencode.db` with useful `session`, `message`, `part`, `event`, and `permission` tables.
- OMP loads agent extensions from `~/.omp/agent/extensions`, which can emit Masthead live lifecycle events without mutating source sessions.

References for implementers:

- Claude Code hooks: `https://code.claude.com/docs/en/hooks`
- Cursor local hook skill: `~/.cursor/skills-cursor/create-hook/SKILL.md`
- Cursor CLI hook parity risk: `https://forum.cursor.com/t/cursor-cli-doesnt-send-all-events-defined-in-hooks/148316`
- Grok Build overview: `https://docs.x.ai/build/overview`
- Grok local hooks: `~/.grok/docs/user-guide/10-hooks.md`
- Grok local sessions: `~/.grok/docs/user-guide/17-sessions.md`
- OpenCode plugins: `https://opencode.ai/docs/plugins/`

## Success Criteria

- Existing Codex live capture still works through the same hook helper and same `/settings/hooks/codex` compatibility endpoints.
- `/ingest` accepts hook or plugin events for all target runtimes without blocking the source harness.
- Two sessions with the same source session id from different runtimes produce two different canonical sessions and two different Board cards.
- Board cards display the correct runtime label: Codex, Claude Code, Cursor, Grok Build, OpenCode, or Oh My Pi.
- Live cards appear within 2 seconds when hooks or plugins fire.
- Transcript-backed headline facts appear within 5 seconds for harnesses with local JSONL or SQLite writes.
- Cursor Agent still produces a live card through the DB/log fallback when CLI hooks only emit shell events.
- OpenCode live status works through the plugin, and transcript/headline facts are backed by `opencode.db`.
- Grok Build live status works through `~/.grok/hooks`, and transcript/headline facts are backed by `~/.grok/sessions`.
- OMP live status works through its installed extension, and headline facts use available OMP session evidence.
- Source setup and Settings can install, uninstall, verify, and test live capture for the release target runtimes.
- Read-only MCP session access can retrieve canonical sessions from all six target runtimes after live capture.
- Transcript import privacy remains explicit. Live capture can store hook metadata immediately, but prompt or assistant text from local transcript tailers is only stored when transcript import policy is enabled for the runtime.
- Emergency rollback is available through uninstall actions and daemon-side live capture disable flags.
- `npm run verify`, `npm run smoke:live`, `npm run smoke:import`, and `npm run doctor` pass.

## Design Decisions

1. Do not make every harness pretend to be Codex.

   Live ingest must preserve the runtime. Use runtime-scoped identity everywhere a session id is used for live projection, enrichment lookup, transcript lookup, and canonical id attachment.

2. Keep hook events and transcript evidence separate.

   Hooks/plugins provide lifecycle, status, tool start/finish, approvals, and "session ended" signals. Transcript/SQLite tailers provide user/assistant text for Logbook, search, dossier, and Board headline evidence.

3. Preserve fail-open behavior.

   `scripts/masthead-hook.js` must continue to exit `0` even if Masthead is down. Harness sessions must never fail because Masthead capture fails.

4. Install without overwriting user hooks.

   Hook admin must preserve existing user hook entries, back up files before edits, reject symlinked configs, and remove only Masthead-managed entries on uninstall.

5. Use local source adapters for durable transcript parsing.

   Do not store raw transcript blobs in hook payloads. Tail files or SQLite rows and ingest normalized records through the existing session graph.

6. Separate the user's home directory from Codex home.

   `config.codexHomeDir` may be overridden by `MASTHEAD_CODEX_HOME`, so non-Codex settings must not use it as a proxy for the user's home. Add `config.homeDir` and use that for Claude, Cursor, Grok Build, OpenCode, and OMP config paths.

7. Add daemon-side kill switches.

   Installed hooks are fail-open but can keep sending events. The daemon must support `MASTHEAD_LIVE_CAPTURE=0` to disable all live ingest and `MASTHEAD_LIVE_CAPTURE_<RUNTIME>=0` to disable one runtime without editing hook files during an incident.

## Rollback And Recovery Requirements

- Every hook/plugin install creates a timestamped backup before mutating an existing file.
- Every uninstall removes only Masthead-managed entries for the selected runtime.
- Installer code rejects symlinked hook config paths and non-regular files.
- A failed install leaves the prior config in place or restores from the temporary file path before returning an error.
- A failed test event never marks a connector installed; it only updates `lastTest`.
- `MASTHEAD_LIVE_CAPTURE=0` makes `/ingest` return `202` with `status: "disabled"` and prevents tailer polling.
- `MASTHEAD_LIVE_CAPTURE_CURSOR=0`, `MASTHEAD_LIVE_CAPTURE_GROK=0`, and equivalent per-runtime flags disable only that runtime.
- Doctor output must show disabled-by-env separately from broken install state.

## File Structure

Create:

- `src/core/liveIdentity.ts`: runtime-scoped live session key helpers.
- `src/core/__tests__/liveIdentity.test.ts`: tests for source id collisions, canonical id mapping, projection ids, and selection ids.
- `src/core/liveHookAdapter.ts`: generic hook/plugin payload normalizer used by Codex, Claude Code, Cursor, Grok Build, OpenCode, and OMP.
- `src/core/__tests__/liveHookAdapter.test.ts`: normalizer tests for all runtime fixture payloads.
- `src/adapters/live/hookAdapter.ts`: runtime-specific live hook source definitions and `AdapterRecord` wrapper.
- `src/adapters/live/__fixtures__/codex-session-start.json`
- `src/adapters/live/__fixtures__/claude-user-prompt-submit.json`
- `src/adapters/live/__fixtures__/cursor-before-submit-prompt.json`
- `src/adapters/live/__fixtures__/grok-pre-tool-use.json`
- `src/adapters/live/__fixtures__/opencode-chat-message.json`
- `src/adapters/live/runtimeProfiles.ts`: event-name mapping, session id keys, workspace keys, and runtime labels.
- `src/daemon/liveSources.ts`: live source registry, raw journal creation, and runtime repository lookup helpers.
- `src/daemon/liveCaptureSupervisor.ts`: background supervisor for transcript and SQLite tailers.
- `src/daemon/__tests__/multiRuntimeLiveIngest.test.ts`: daemon integration tests for mixed live runtimes.
- `src/daemon/__tests__/liveCaptureSupervisor.test.ts`: polling and fallback synthesis tests.
- `src/daemon/liveCaptureSettings.ts`: generalized settings DTOs and install/test/uninstall orchestration.
- `src/daemon/__tests__/liveCaptureSettings.test.ts`: settings service tests for all target runtimes.
- `src/adapters/claudeCode/live.ts`: Claude Code hook config and JSONL live tailer helpers.
- `src/adapters/claudeCode/__tests__/live.test.ts`
- `src/adapters/cursor/live.ts`: Cursor hook config and DB/log fallback helpers.
- `src/adapters/cursor/__tests__/live.test.ts`
- `src/adapters/grok/adapter.ts`: Grok Build source adapter.
- `src/adapters/grok/discovery.ts`: Grok Build source discovery.
- `src/adapters/grok/live.ts`: Grok Build hook config and session tailer helpers.
- `src/adapters/grok/parser.ts`: Grok Build transcript parser.
- `src/adapters/grok/__tests__/live.test.ts`
- `src/adapters/grok/__tests__/parser.test.ts`
- `src/adapters/opencode/live.ts`: OpenCode plugin template and DB watcher helpers.
- `src/adapters/opencode/sqliteLive.ts`: OpenCode-specific read-only SQLite row parser.
- `src/adapters/opencode/__tests__/live.test.ts`
- `src/adapters/opencode/__tests__/sqliteLive.test.ts`
- `docs/reference/live-connectors.md`: release-target live connector behavior.

Modify:

- `scripts/masthead-hook.js`: add runtime/source metadata support while preserving Codex defaults.
- `scripts/masthead-doctor-hook-capture.js`: check every release target runtime.
- `scripts/masthead-live-smoke.js`: add synthetic multi-runtime live smoke.
- `scripts/masthead-doctor.js`: include live connector health in doctor output.
- `src/daemon/config.ts`: add a true `homeDir` field for non-Codex harness config paths.
- `src/daemon/__tests__/config.test.ts`: verify `homeDir` and `codexHomeDir` can diverge.
- `src/adapters/types.ts`: add `grok` runtime and allow live source surfaces that are not Codex hooks.
- `src/adapters/harnessCatalog.ts`: add Grok Build and mark target runtimes as live-capable after implementation.
- `src/adapters/registry.ts`: register Grok Build adapter.
- `src/adapters/capabilities.ts`: expose `supportsLiveWatch` for release target runtimes.
- `src/adapters/claudeCode/adapter.ts`: use Claude-specific JSONL parsing and live `watch`.
- `src/adapters/cursor/adapter.ts`: use Cursor-specific DB/log parsing and live `watch`.
- `src/adapters/opencode/adapter.ts`: use OpenCode SQLite parsing and live `watch`.
- `src/core/codexAdapter.ts`: keep compatibility exports, delegate generic live hook parsing.
- `src/core/sessionReducer.ts`: group by runtime-scoped live session id and remove Codex-specific title fallback.
- `src/core/replay.ts`: set runtime/harness/source session id from scoped live metadata.
- `src/core/liveProjection.ts`: accept runtime-scoped enrichment and transcript fact maps.
- `src/ui/toolbarOptions.ts`: add release target harness filter options.
- `src/ui/filterBoard.ts`: filter by runtime or harness label, not by Codex-only string matching.
- `src/app/daemonClient.ts`: add generalized live capture settings client methods and DTOs.
- `src/daemon/server.ts`: replace Codex-only ingest/projection/settings paths with multi-runtime live paths while keeping Codex aliases.
- `src/daemon/db/enrichmentViewRepository.ts`: add canonical-session-scoped live projection enrichment lookup.
- `src/daemon/db/liveTranscriptFactsRepository.ts`: add canonical-session-scoped live projection transcript lookup.
- `src/daemon/db/boardHeadlineFrameRepository.ts`: allow live headline frame lookup keyed by projection session id plus canonical session id.
- `src/ui/sources/HarnessLiveCaptureSection.tsx`: show target runtime live capture state and actions.
- `src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx`
- `src/ui/settings/SettingsSurface.test.tsx` or existing settings tests for generalized live capture state.
- `openwiki/sources.md`
- `openwiki/data-and-integrations.md`
- `docs/reference/adapters.md`
- `docs/reference/sources.md`
- `docs/reference/board.md`

## Core Contracts

Add these exact public contracts first so every connector uses one shape.

```ts
// src/core/liveIdentity.ts
import { RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";
import { canonicalSessionId, runtimeIdFor } from "../daemon/db/sessionRepository.ts";
import type { GitSnapshot, NormalizedEvent } from "./types.ts";

export type LiveSessionKey = {
  runtime: RuntimeKind;
  sourceSessionId: string;
};

export type LiveProjectionSessionScope = LiveSessionKey & {
  projectionSessionId: string;
  canonicalSessionId: string;
};

export function runtimeFromAdapter(value: string | undefined): RuntimeKind | undefined {
  return RUNTIME_KINDS.find((runtime) => runtime === value);
}

export function liveSessionKeyFromEvent(event: NormalizedEvent): LiveSessionKey | undefined {
  const runtime = runtimeFromAdapter(event.source.adapter);
  if (!runtime || !event.sessionId) return undefined;
  return { runtime, sourceSessionId: event.sessionId };
}

export function liveSessionKeyId(key: LiveSessionKey): string {
  return `${key.runtime}:${encodeURIComponent(key.sourceSessionId)}`;
}

export function projectionScopeForKey(hostId: string, key: LiveSessionKey): LiveProjectionSessionScope {
  return {
    ...key,
    projectionSessionId: liveSessionKeyId(key),
    canonicalSessionId: canonicalSessionId(hostId, runtimeIdFor(key.runtime, undefined), key.sourceSessionId)
  };
}

export function scopeEventForProjection(event: NormalizedEvent): NormalizedEvent | undefined {
  const key = liveSessionKeyFromEvent(event);
  if (!key) return undefined;
  return {
    ...event,
    sessionId: liveSessionKeyId(key),
    payload: {
      ...event.payload,
      runtime: key.runtime,
      sourceSessionId: key.sourceSessionId
    }
  };
}

export function scopeGitSnapshotForProjection(snapshot: GitSnapshot, key: LiveSessionKey): GitSnapshot {
  return {
    ...snapshot,
    sessionId: liveSessionKeyId(key)
  };
}
```

The implementation may avoid importing daemon code from `src/core/liveIdentity.ts` by moving `runtimeIdFor` and `canonicalSessionId` to a shared module. If that split is needed, make `src/daemon/db/sessionRepository.ts` re-export from the shared module so existing imports keep working.

## Task 0: Baseline And Local Safety Preflight

**Files:**

- No product code changes.
- Optional evidence output: `/tmp/masthead-live-doctor-before.json`

- [ ] **Step 1: Confirm branch and worktree state**

Run:

```bash
git status --short
git branch --show-current
```

Expected:

- Worktree does not contain unrelated user edits in files this plan will touch.
- Implementation is on a feature branch or isolated worktree, not directly on `main`.

- [ ] **Step 2: Capture baseline test health**

Run:

```bash
npm run build
npm test -- --run src/daemon/__tests__/server.test.ts src/daemon/__tests__/settingsApi.test.ts src/core/__tests__/liveProjection.test.ts src/core/__tests__/sessionReducer.test.ts
npm run smoke:live
```

Expected: all commands pass before implementation. If any command fails, stop and record the failure before changing product code.

- [ ] **Step 3: Capture current local connector state**

Run:

```bash
npm run doctor:json > /tmp/masthead-live-doctor-before.json
node -e 'for (const cmd of ["codex","claude","cursor","grok","opencode"]) console.log(cmd)'
```

Expected:

- Doctor JSON is written.
- The implementation owner can compare connector health before and after hook/plugin installation.

- [ ] **Step 4: Inspect existing user hook/plugin files without editing**

Run:

```bash
for path in \
  "$HOME/.codex/hooks.json" \
  "$HOME/.claude/settings.json" \
  "$HOME/.cursor/hooks.json" \
  "$HOME/.grok/hooks/masthead.json" \
  "$HOME/.config/opencode/plugins/masthead-live.js"
do
  if [ -e "$path" ]; then
    printf '%s\n' "exists: $path"
    ls -l "$path"
  else
    printf '%s\n' "missing: $path"
  fi
done
```

Expected:

- Existing files are noted before installers run.
- No file content containing credentials is printed.

- [ ] **Step 5: Commit**

No commit for this task. It is a preflight gate only.

## Task 1: Runtime-Scoped Live Identity

**Files:**

- Create: `src/core/liveIdentity.ts`
- Create: `src/core/__tests__/liveIdentity.test.ts`
- Modify: `src/adapters/types.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/sessionReducer.ts`
- Modify: `src/core/replay.ts`
- Test: `src/core/__tests__/sessionReducer.test.ts`

- [ ] **Step 1: Write failing identity tests**

Create `src/core/__tests__/liveIdentity.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  liveSessionKeyFromEvent,
  liveSessionKeyId,
  projectionScopeForKey,
  scopeEventForProjection
} from "../liveIdentity.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live identity", () => {
  test("keeps identical source session ids separate across runtimes", () => {
    const codex = event("codex", "shared-session");
    const claude = event("claude_code", "shared-session");

    expect(liveSessionKeyId(liveSessionKeyFromEvent(codex)!)).toBe("codex:shared-session");
    expect(liveSessionKeyId(liveSessionKeyFromEvent(claude)!)).toBe("claude_code:shared-session");
    expect(projectionScopeForKey("host:dev", liveSessionKeyFromEvent(codex)!).canonicalSessionId).not.toBe(
      projectionScopeForKey("host:dev", liveSessionKeyFromEvent(claude)!).canonicalSessionId
    );
  });

  test("preserves source session id while changing projection session id", () => {
    const scoped = scopeEventForProjection(event("grok", "abc/123"));

    expect(scoped?.sessionId).toBe("grok:abc%2F123");
    expect(scoped?.payload.sourceSessionId).toBe("abc/123");
    expect(scoped?.payload.runtime).toBe("grok");
  });
});

function event(adapter: string, sessionId: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `${adapter}:${sessionId}:start`,
    sessionId,
    source: { adapter, surface: "hook", sourceEventId: `${sessionId}:start` },
    occurredAt: "2026-07-05T12:00:00.000Z",
    receivedAt: "2026-07-05T12:00:00.000Z",
    type: "session.started",
    summary: "Started",
    payload: { title: "Started" },
    sensitivity: "metadata",
    payloadHash: `${adapter}:${sessionId}:hash`,
    evidence: [{ id: `${adapter}:${sessionId}:start`, kind: "event", observedAt: "2026-07-05T12:00:00.000Z", source: `${adapter}.hook` }]
  };
}
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- --run src/core/__tests__/liveIdentity.test.ts`

Expected: fail because `src/core/liveIdentity.ts` does not exist.

- [ ] **Step 3: Implement `src/core/liveIdentity.ts`**

Add the public contract from **Core Contracts**. If a core-to-daemon import cycle appears, create `src/shared/sessionIdentity.ts` with `runtimeIdFor` and `canonicalSessionId`, then import that module from both `src/core/liveIdentity.ts` and `src/daemon/db/sessionRepository.ts`.

- [ ] **Step 4: Extend live card types and reducer metadata**

Modify `src/adapters/types.ts` so runtime profiles and daemon live source lists can reference Grok Build before the full Grok adapter lands:

```ts
export const RUNTIME_KINDS = [
  "codex",
  "cursor",
  "claude_code",
  "opencode",
  "grok",
  "aider",
  "openclaw",
  "hermes",
  "pi",
  "omp",
  "cline",
  "roo_code",
  "kilo_code",
  "continue_dev",
  "openhands",
  "github_copilot",
  "windsurf",
  "zed_ai",
  "amazon_q",
  "sourcegraph_amp",
  "jetbrains_ai",
  "qodo",
  "tabnine",
  "ibm_bob",
  "devin",
  "jules",
  "gemini_cli",
  "crush"
] as const;
```

Modify `src/core/types.ts`:

```ts
export type NormalizedEvent = {
  schemaVersion: 1;
  eventId: string;
  sessionId?: string;
  source: {
    adapter: string;
    surface: "hook" | "plugin" | "tailer" | "fixture" | "observer" | "user";
    sourceEventId?: string;
  };
  occurredAt: string;
  receivedAt: string;
  type: EventType;
  workspace?: WorkspaceRef;
  summary: string;
  payload: Record<string, unknown>;
  sensitivity: "metadata" | "redacted" | "sensitive_path_only";
  payloadHash: string;
  evidence: EvidenceRef[];
};
```

Modify `DerivedSession` in `src/core/types.ts`:

```ts
export type DerivedSession = {
  sessionId: string;
  sourceSessionId?: string;
  runtime?: string;
  harness?: string;
  project: string;
  title: string;
  objective?: string;
  primaryStatus: SessionStatus;
  lifecycle: SessionLifecycle;
  outcomeLabel?: SessionOutcomeLabel;
  endReason?: SessionEndReason;
  endedAt?: string;
  lastEventType?: EventType;
  flags: SessionFlag[];
  lastMeaningfulActivityAt: string;
  attribution: AttributionLevel;
  workspace?: WorkspaceRef;
  changedFileCount: number;
  evidence: EvidenceRef[];
};
```

Modify `src/core/sessionReducer.ts` to derive metadata from scoped events:

```ts
const sourceSessionId = stringPayload(metadataEvent, "sourceSessionId") ?? stringPayload(start, "sourceSessionId") ?? sessionId;
const runtime = stringPayload(metadataEvent, "runtime") ?? stringPayload(start, "runtime") ?? latest?.source.adapter;
const harness = stringPayload(metadataEvent, "harness") ?? stringPayload(start, "harness") ?? harnessLabel(runtime);
const title =
  stringPayload(start, "title") ??
  stringPayload(start, "objective") ??
  stringPayload(metadataEvent, "title") ??
  stringPayload(metadataEvent, "objective") ??
  `${project} session`;
```

Add this helper near the bottom of `src/core/sessionReducer.ts`:

```ts
function harnessLabel(runtime: string | undefined): string | undefined {
  switch (runtime) {
    case "codex":
      return "Codex";
    case "claude_code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "grok":
      return "Grok Build";
    case "opencode":
      return "OpenCode";
    default:
      return undefined;
  }
}
```

Modify the returned `DerivedSession` object to include `sourceSessionId`, `runtime`, and `harness`.

- [ ] **Step 5: Make replay use runtime metadata**

In `src/core/replay.ts`, replace the hard-coded harness field inside `toCard`:

```ts
harness: session.harness ?? "Session",
runtime: session.runtime,
sourceSessionId: session.sourceSessionId ?? session.sessionId,
```

Keep `sessionId: session.sessionId` as the projection id.

- [ ] **Step 6: Add regression tests for neutral title and harness label**

Modify `src/core/__tests__/sessionReducer.test.ts` to include:

```ts
test("uses runtime-scoped metadata without Codex fallback title", () => {
  const sessions = deriveSessions([
    {
      schemaVersion: 1,
      eventId: "claude:start",
      sessionId: "claude_code:raw-1",
      source: { adapter: "claude_code", surface: "hook", sourceEventId: "raw-1:start" },
      occurredAt: "2026-07-05T12:00:00.000Z",
      receivedAt: "2026-07-05T12:00:00.000Z",
      type: "session.started",
      summary: "Started",
      payload: { runtime: "claude_code", sourceSessionId: "raw-1", project: "Masthead" },
      sensitivity: "metadata",
      payloadHash: "hash",
      evidence: [{ id: "claude:start", kind: "event", observedAt: "2026-07-05T12:00:00.000Z", source: "claude_code.hook" }]
    }
  ]);

  expect(sessions[0]).toMatchObject({
    harness: "Claude Code",
    runtime: "claude_code",
    sourceSessionId: "raw-1",
    title: "Masthead session"
  });
});
```

- [ ] **Step 7: Verify task**

Run:

```bash
npm test -- --run src/core/__tests__/liveIdentity.test.ts src/core/__tests__/sessionReducer.test.ts
npm run build
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/liveIdentity.ts src/core/__tests__/liveIdentity.test.ts src/adapters/types.ts src/core/types.ts src/core/sessionReducer.ts src/core/replay.ts src/core/__tests__/sessionReducer.test.ts
git commit -m "feat: add runtime-scoped live identity"
```

## Task 2: Generic Live Hook Normalizer

**Files:**

- Create: `src/core/liveHookAdapter.ts`
- Create: `src/core/__tests__/liveHookAdapter.test.ts`
- Create: `src/adapters/live/runtimeProfiles.ts`
- Create: `src/adapters/live/hookAdapter.ts`
- Create: fixture files in `src/adapters/live/__fixtures__/`
- Modify: `src/core/codexAdapter.ts`
- Modify: `src/adapters/codex/hookAdapter.ts`
- Test: `src/adapters/codex/__tests__/hookAdapter.test.ts`

- [ ] **Step 1: Add runtime fixture payloads**

Create synthetic fixture files. Do not copy local user transcripts.

`src/adapters/live/__fixtures__/claude-user-prompt-submit.json`:

```json
{
  "hookEventName": "UserPromptSubmit",
  "sessionId": "claude-session-1",
  "cwd": "/tmp/masthead-live-fixture",
  "gitBranch": "feature/live-connectors",
  "prompt": "Inspect Masthead sources",
  "timestamp": "2026-07-05T12:00:00.000Z"
}
```

`src/adapters/live/__fixtures__/cursor-before-submit-prompt.json`:

```json
{
  "hookEventName": "beforeSubmitPrompt",
  "sessionId": "cursor-session-1",
  "cwd": "/tmp/masthead-live-fixture",
  "prompt": "Fix the failing tests",
  "timestamp": "2026-07-05T12:00:01.000Z"
}
```

`src/adapters/live/__fixtures__/grok-pre-tool-use.json`:

```json
{
  "hookEventName": "PreToolUse",
  "sessionId": "grok-session-1",
  "cwd": "/tmp/masthead-live-fixture",
  "workspaceRoot": "/tmp/masthead-live-fixture",
  "toolName": "run_terminal_command",
  "toolInput": { "command": "npm test" },
  "timestamp": "2026-07-05T12:00:02.000Z"
}
```

`src/adapters/live/__fixtures__/opencode-chat-message.json`:

```json
{
  "type": "chat.message",
  "sessionID": "opencode-session-1",
  "directory": "/tmp/masthead-live-fixture",
  "message": {
    "role": "assistant",
    "parts": [{ "type": "text", "text": "I am checking the live connector." }]
  },
  "time": "2026-07-05T12:00:03.000Z"
}
```

`src/adapters/live/__fixtures__/codex-session-start.json`:

```json
{
  "event": "session_started",
  "session_id": "codex-session-1",
  "cwd": "/tmp/masthead-live-fixture",
  "timestamp": "2026-07-05T12:00:04.000Z",
  "provider_event_id": "codex-session-1:start"
}
```

- [ ] **Step 2: Write failing normalizer tests**

Create `src/core/__tests__/liveHookAdapter.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseLiveHookPayload } from "../liveHookAdapter.ts";

const fixtureDir = join(process.cwd(), "src/adapters/live/__fixtures__");

describe("live hook adapter", () => {
  test.each([
    ["codex", "codex-session-start.json", "session.started", "codex-session-1"],
    ["claude_code", "claude-user-prompt-submit.json", "user.question", "claude-session-1"],
    ["cursor", "cursor-before-submit-prompt.json", "user.question", "cursor-session-1"],
    ["grok", "grok-pre-tool-use.json", "command.started", "grok-session-1"],
    ["opencode", "opencode-chat-message.json", "session.started", "opencode-session-1"]
  ])("normalizes %s fixture", (runtime, fixture, type, sourceSessionId) => {
    const raw = readFileSync(join(fixtureDir, fixture), "utf8");
    const parsed = parseLiveHookPayload(raw, { receivedAt: "2026-07-05T12:00:10.000Z", runtime });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({
      sessionId: sourceSessionId,
      source: { adapter: runtime, surface: runtime === "opencode" ? "plugin" : "hook" },
      type
    });
    expect(parsed.event.evidence[0]?.source).toBe(`${runtime}.${runtime === "opencode" ? "plugin" : "hook"}`);
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Inspect Masthead sources");
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Fix the failing tests");
  });

  test("defaults to Codex for compatibility when runtime is omitted", () => {
    const raw = readFileSync(join(fixtureDir, "codex-session-start.json"), "utf8");
    const parsed = parseLiveHookPayload(raw, { receivedAt: "2026-07-05T12:00:10.000Z" });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.source.adapter).toBe("codex");
  });
});
```

- [ ] **Step 3: Run failing normalizer test**

Run: `npm test -- --run src/core/__tests__/liveHookAdapter.test.ts`

Expected: fail because generic normalizer does not exist.

- [ ] **Step 4: Create runtime profiles**

Create `src/adapters/live/runtimeProfiles.ts`:

```ts
import type { RuntimeKind } from "../types.ts";

export type LiveRuntimeProfile = {
  runtime: RuntimeKind;
  label: string;
  surface: "hook" | "plugin";
  sourceName: string;
  sessionIdKeys: string[];
  eventNameKeys: string[];
  timestampKeys: string[];
  workspaceKeys: {
    cwd: string[];
    repoRoot: string[];
    branch: string[];
  };
  eventMap: Record<string, "session.started" | "approval.requested" | "user.question" | "command.started" | "command.finished" | "file.changed" | "session.completed">;
};

export const LIVE_RUNTIME_PROFILES: Record<string, LiveRuntimeProfile> = {
  codex: {
    runtime: "codex",
    label: "Codex",
    surface: "hook",
    sourceName: "codex.hook",
    sessionIdKeys: ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"],
    eventNameKeys: ["event", "type", "hook_event_name", "hookEventName", "event_name", "eventName"],
    timestampKeys: ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"],
    workspaceKeys: { cwd: ["cwd", "working_directory", "workingDirectory"], repoRoot: ["repo_root", "repoRoot"], branch: ["branch"] },
    eventMap: {}
  },
  claude_code: {
    runtime: "claude_code",
    label: "Claude Code",
    surface: "hook",
    sourceName: "claude_code.hook",
    sessionIdKeys: ["sessionId", "session_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: { cwd: ["cwd"], repoRoot: ["workspaceRoot", "repoRoot"], branch: ["gitBranch", "branch"] },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.question",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "session.completed",
      sessionend: "session.completed"
    }
  },
  cursor: {
    runtime: "cursor",
    label: "Cursor",
    surface: "hook",
    sourceName: "cursor.hook",
    sessionIdKeys: ["sessionId", "session_id", "chatId", "chat_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: { cwd: ["cwd", "workspace"], repoRoot: ["workspaceRoot", "repoRoot"], branch: ["branch"] },
    eventMap: {
      sessionstart: "session.started",
      beforesubmitprompt: "user.question",
      beforeshellexecution: "command.started",
      aftershellexecution: "command.finished",
      afterfileedit: "file.changed",
      afteragentresponse: "session.started",
      stop: "session.completed",
      sessionend: "session.completed"
    }
  },
  grok: {
    runtime: "grok",
    label: "Grok Build",
    surface: "hook",
    sourceName: "grok.hook",
    sessionIdKeys: ["sessionId", "session_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: { cwd: ["cwd"], repoRoot: ["workspaceRoot", "repoRoot"], branch: ["branch"] },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.question",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "session.completed",
      stopfailure: "session.completed",
      sessionend: "session.completed"
    }
  },
  opencode: {
    runtime: "opencode",
    label: "OpenCode",
    surface: "plugin",
    sourceName: "opencode.plugin",
    sessionIdKeys: ["sessionID", "sessionId", "session_id"],
    eventNameKeys: ["type", "event", "name"],
    timestampKeys: ["time", "timestamp", "createdAt"],
    workspaceKeys: { cwd: ["directory", "cwd"], repoRoot: ["workspaceRoot", "repoRoot"], branch: ["branch"] },
    eventMap: {
      sessioncreated: "session.started",
      sessionstatus: "session.started",
      sessionidle: "session.completed",
      messageupdated: "session.started",
      chatmessage: "session.started",
      sessionmessage: "session.started",
      permissionasked: "approval.requested",
      toolexecutebefore: "command.started",
      toolexecuteafter: "command.finished"
    }
  }
};
```

Normalize event names by lowercasing and removing separators before map lookup so `beforeShellExecution` and `before_shell_execution` both work.

- [ ] **Step 5: Implement `src/core/liveHookAdapter.ts`**

Move the reusable logic from `src/core/codexAdapter.ts` into `src/core/liveHookAdapter.ts`. Keep these exports:

```ts
export type LiveHookDiagnostic = {
  code: "malformed_json" | "invalid_payload" | "unsupported_runtime";
  message: string;
  receivedAt: string;
  details?: string;
};

export type LiveHookParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; diagnostic: LiveHookDiagnostic };

export type LiveHookNormalizeOptions = {
  receivedAt?: string;
  runtime?: string;
};

export function parseLiveHookPayload(raw: string, options: LiveHookNormalizeOptions = {}): LiveHookParseResult;
export function normalizeLiveHookPayload(input: unknown, options: LiveHookNormalizeOptions = {}): NormalizedEvent;
```

Implementation requirements:

- Default `runtime` to `codex`.
- Use `LIVE_RUNTIME_PROFILES`.
- Preserve the existing redaction behavior from `src/core/codexAdapter.ts`.
- Suppress raw prompt, raw transcript, full diffs, command output, screenshots, tool responses, and `lastAssistantMessage`.
- Add `payload.runtime`, `payload.harness`, and `payload.sourceSessionId`.
- Extract tool command metadata from `toolInput.command` when present, but redact patch commands.
- Set `eventId` to `${runtime}:${stableSourceEventId}`.
- Set evidence source to the profile `sourceName`.
- Return `unsupported_runtime` for runtimes not in profiles.

- [ ] **Step 6: Keep Codex compatibility exports**

Modify `src/core/codexAdapter.ts` to delegate:

```ts
import { normalizeLiveHookPayload, parseLiveHookPayload, type LiveHookDiagnostic } from "./liveHookAdapter.ts";
import type { NormalizedEvent } from "./types.ts";

export type CodexHookDiagnostic = Extract<LiveHookDiagnostic, { code: "malformed_json" | "invalid_payload" }> | LiveHookDiagnostic;
export type CodexHookParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; diagnostic: CodexHookDiagnostic };

export function parseCodexHookPayload(raw: string, options: { receivedAt?: string } = {}): CodexHookParseResult {
  return parseLiveHookPayload(raw, { ...options, runtime: "codex" }) as CodexHookParseResult;
}

export function normalizeCodexHookPayload(input: unknown, options: { receivedAt?: string } = {}): NormalizedEvent {
  return normalizeLiveHookPayload(input, { ...options, runtime: "codex" });
}
```

If tests import private helpers from `codexAdapter.ts`, keep those helpers in the file until tests are migrated.

- [ ] **Step 7: Create generic AdapterRecord wrapper**

Create `src/adapters/live/hookAdapter.ts`:

```ts
import { createHash } from "node:crypto";
import { parseLiveHookPayload } from "../../core/liveHookAdapter.ts";
import type { AdapterRecord, DiscoveredSource, RuntimeKind } from "../types.ts";
import { LIVE_RUNTIME_PROFILES } from "./runtimeProfiles.ts";

const LIVE_SOURCE_IDS: Record<string, string> = {
  codex: "codex-hook-local",
  claude_code: "claude-code-hook-local",
  cursor: "cursor-hook-local",
  grok: "grok-hook-local",
  opencode: "opencode-plugin-local"
};

export function liveHookSourceForRuntime(runtime: RuntimeKind): DiscoveredSource {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  if (!profile) throw new Error(`Unsupported live runtime: ${runtime}`);
  return {
    sourceId: LIVE_SOURCE_IDS[runtime] ?? `${runtime}-live-local`,
    runtime,
    sourceKind: "hook",
    endpoint: "http://127.0.0.1:17373/ingest",
    schemaVersion: "masthead.normalized-event.v1",
    runtimeVersion: profile.surface === "plugin" ? "plugin-v1" : "hook-v1",
    confidence: "authoritative"
  };
}

export function adapterRecordFromLiveHook(raw: string, receivedAt: string, runtime: RuntimeKind): AdapterRecord {
  const source = liveHookSourceForRuntime(runtime);
  const parsed = parseLiveHookPayload(raw, { receivedAt, runtime });
  if (!parsed.ok) {
    return {
      source,
      sourceRecordKey: `malformed:${hash(raw)}`,
      observedAt: receivedAt,
      payloadHash: hash(raw),
      payload: raw,
      normalized: {
        kind: "event",
        confidence: "heuristic",
        sourceRef: sourceRef(source),
        value: undefined
      },
      diagnostics: [{ code: parsed.diagnostic.code, details: parsed.diagnostic.details, message: parsed.diagnostic.message, observedAt: parsed.diagnostic.receivedAt, severity: "error" }]
    };
  }

  return {
    source,
    sourceRecordKey: parsed.event.eventId,
    observedAt: parsed.event.occurredAt,
    payloadHash: parsed.event.payloadHash,
    payload: parsed.event,
    normalized: {
      kind: "event",
      confidence: "authoritative",
      sourceRef: sourceRef(source),
      value: parsed.event
    },
    diagnostics: []
  };
}

function sourceRef(source: DiscoveredSource): AdapterRecord["normalized"]["sourceRef"] {
  return {
    endpoint: source.endpoint,
    runtimeVersion: source.runtimeVersion,
    schemaVersion: source.schemaVersion,
    sourceKind: source.sourceKind
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
```

Modify `src/adapters/codex/hookAdapter.ts` to re-export Codex compatibility:

```ts
import { adapterRecordFromLiveHook, liveHookSourceForRuntime } from "../live/hookAdapter.ts";

export const codexHookSource = liveHookSourceForRuntime("codex");

export function adapterRecordFromCodexHook(raw: string, receivedAt: string) {
  return adapterRecordFromLiveHook(raw, receivedAt, "codex");
}
```

- [ ] **Step 8: Verify task**

Run:

```bash
npm test -- --run src/core/__tests__/liveHookAdapter.test.ts src/adapters/codex/__tests__/hookAdapter.test.ts src/core/__tests__/hookAdmin.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/liveHookAdapter.ts src/core/__tests__/liveHookAdapter.test.ts src/adapters/live src/core/codexAdapter.ts src/adapters/codex/hookAdapter.ts src/adapters/codex/__tests__/hookAdapter.test.ts
git commit -m "feat: generalize live hook normalization"
```

## Task 3: Multi-Runtime Daemon Ingest

**Files:**

- Create: `src/daemon/liveSources.ts`
- Create: `src/daemon/__tests__/multiRuntimeLiveIngest.test.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/db/rawEventRepository.ts` only if the existing API cannot create runtime-specific journals from the new helper.
- Test: `src/daemon/__tests__/server.test.ts`
- Test: `src/daemon/__tests__/liveBoardRawRecords.test.ts`

- [ ] **Step 1: Write failing daemon ingest test**

Create `src/daemon/__tests__/multiRuntimeLiveIngest.test.ts` with an integration test that starts a daemon on an ephemeral port, posts two events with the same source session id but different runtime query params, and checks `/projection` plus `/sessions`.

Required assertions:

```ts
expect(codexCard).toMatchObject({ harness: "Codex", runtime: "codex", sourceSessionId: "same-session" });
expect(claudeCard).toMatchObject({ harness: "Claude Code", runtime: "claude_code", sourceSessionId: "same-session" });
expect(codexCard.canonicalSessionId).not.toBe(claudeCard.canonicalSessionId);
expect(sessions.runtimes).toContain("codex");
expect(sessions.runtimes).toContain("claude_code");
```

Use synthetic payloads. Do not invoke real harness CLIs in this test.

Add a second test that starts the daemon with `MASTHEAD_LIVE_CAPTURE_CLAUDE_CODE=0`, posts a Claude Code event, and asserts `/ingest` returns:

```ts
expect(body).toMatchObject({ ok: true, status: "disabled", runtime: "claude_code" });
```

Then fetch `/projection` and assert no Claude Code card was added.

- [ ] **Step 2: Run failing daemon ingest test**

Run: `npm test -- --run src/daemon/__tests__/multiRuntimeLiveIngest.test.ts`

Expected: fail because `/ingest` treats both events as Codex.

- [ ] **Step 3: Create live source helper**

Create `src/daemon/liveSources.ts`:

```ts
import type { RuntimeKind } from "../adapters/types.ts";
import { liveHookSourceForRuntime } from "../adapters/live/hookAdapter.ts";
import { RUNTIME_KINDS } from "../adapters/types.ts";
import { createRawEventRepository } from "./db/rawEventRepository.ts";
import { createSessionRepository } from "./db/sessionRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

export const LIVE_CAPTURE_RUNTIMES: RuntimeKind[] = ["codex", "claude_code", "cursor", "grok", "opencode"];

export function runtimeFromIngestRequest(input: { queryRuntime?: string | null; headerRuntime?: string | string[] | undefined; payloadRuntime?: string | undefined }): RuntimeKind {
  const candidate = firstString(input.queryRuntime, input.headerRuntime, input.payloadRuntime) ?? "codex";
  const runtime = RUNTIME_KINDS.find((item) => item === candidate);
  if (!runtime || !LIVE_CAPTURE_RUNTIMES.includes(runtime)) return "codex";
  return runtime;
}

export function liveCaptureRuntimeEnabled(runtime: RuntimeKind, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MASTHEAD_LIVE_CAPTURE === "0") return false;
  const runtimeKey = `MASTHEAD_LIVE_CAPTURE_${runtime.toUpperCase()}`;
  return env[runtimeKey] !== "0";
}

export function createLiveRawJournals(db: MastheadDatabase) {
  return new Map(
    LIVE_CAPTURE_RUNTIMES.map((runtime) => {
      const source = liveHookSourceForRuntime(runtime);
      return [
        runtime,
        createRawEventRepository(db, {
          adapter: source.runtime,
          confidence: source.confidence,
          endpoint: source.endpoint,
          runtimeVersion: source.runtimeVersion,
          schemaVersion: source.schemaVersion,
          sourceId: source.sourceId,
          sourceKind: source.sourceKind
        })
      ] as const;
    })
  );
}

export function createLiveSessionRepositories(db: MastheadDatabase, context: { hostId: string; hostname: string }) {
  return new Map(
    LIVE_CAPTURE_RUNTIMES.map((runtime) => [
      runtime,
      createSessionRepository(db, {
        hostId: context.hostId,
        hostname: context.hostname,
        runtimeKind: runtime
      })
    ])
  );
}

function firstString(...values: Array<string | string[] | null | undefined>): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
```

- [ ] **Step 4: Refactor server initialization**

Modify `src/daemon/server.ts`:

- Replace Codex-only hook journal with `const liveRawJournals = createLiveRawJournals(database);`.
- Replace Codex-only `sessions` with `const liveSessionRepositories = createLiveSessionRepositories(database, { hostId: \`host:${config.host}\`, hostname: config.host });`.
- Keep `observerRawJournal`.
- Keep Codex-specific variables only for transcript catch-up until Task 8 generalizes catch-up.

Add a local helper:

```ts
function sessionRepositoryForRuntime(runtime: RuntimeKind) {
  const repository = liveSessionRepositories.get(runtime);
  if (!repository) throw new Error(`Live session repository missing for ${runtime}`);
  return repository;
}

function rawJournalForRuntime(runtime: RuntimeKind) {
  const journal = liveRawJournals.get(runtime);
  if (!journal) throw new Error(`Live raw journal missing for ${runtime}`);
  return journal;
}
```

- [ ] **Step 5: Refactor `/ingest`**

In `/ingest`:

- Read `runtime` from `url.searchParams.get("runtime")`.
- Read `x-masthead-runtime` header.
- Parse payload only enough to read `runtime` if present.
- Default to Codex when nothing identifies a runtime.
- Before normalizing, call `liveCaptureRuntimeEnabled(runtime)` and return `202` with `{ ok: true, status: "disabled", runtime }` when disabled.
- Call `adapterRecordFromLiveHook(body, receivedAt, runtime)`.
- Persist accepted live events through the runtime-specific repository.
- Append raw events to the runtime-specific journal.

Required body parsing helper:

```ts
function runtimeFromPayloadJson(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    return typeof record.runtime === "string" ? record.runtime : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 6: Refactor live replay source ids**

Replace:

```ts
canonicalStoreRecords(database, [codexHookSource.sourceId], CANONICAL_LIVE_REPLAY_LIMIT)
```

with:

```ts
canonicalStoreRecords(
  database,
  LIVE_CAPTURE_RUNTIMES.map((runtime) => liveHookSourceForRuntime(runtime).sourceId),
  CANONICAL_LIVE_REPLAY_LIMIT
)
```

- [ ] **Step 7: Verify task**

Run:

```bash
npm test -- --run src/daemon/__tests__/multiRuntimeLiveIngest.test.ts src/daemon/__tests__/server.test.ts src/daemon/__tests__/liveBoardRawRecords.test.ts
npm run smoke:live
npm run build
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/liveSources.ts src/daemon/__tests__/multiRuntimeLiveIngest.test.ts src/daemon/server.ts src/daemon/db/rawEventRepository.ts
git commit -m "feat: accept multi-runtime live ingest"
```

## Task 4: Runtime-Scoped Projection And Headline Lookups

**Files:**

- Modify: `src/daemon/server.ts`
- Modify: `src/core/liveProjection.ts`
- Modify: `src/daemon/db/enrichmentViewRepository.ts`
- Modify: `src/daemon/db/liveTranscriptFactsRepository.ts`
- Modify: `src/daemon/db/boardHeadlineFrameRepository.ts`
- Test: `src/core/__tests__/liveProjection.test.ts`
- Test: `src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts`
- Test: `src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts`

- [ ] **Step 1: Write failing projection collision test**

Add a test to `src/core/__tests__/liveProjection.test.ts`:

```ts
test("projects same source session id from different runtimes as separate cards", () => {
  const envelope = projectLiveEvents([
    scopedEvent("codex:same", "codex", "same", "Codex session"),
    scopedEvent("claude_code:same", "claude_code", "same", "Claude session")
  ]);

  expect(envelope.projection.cards).toHaveLength(2);
  expect(envelope.projection.cards.map((card) => card.runtime).toSorted()).toEqual(["claude_code", "codex"]);
  expect(envelope.projection.cards.map((card) => card.sourceSessionId)).toEqual(["same", "same"]);
});
```

The `scopedEvent` helper must set `event.sessionId` to the projection id and `payload.sourceSessionId` to the raw id.

- [ ] **Step 2: Run failing projection test**

Run: `npm test -- --run src/core/__tests__/liveProjection.test.ts`

Expected: fail because card runtime/source session metadata is not preserved consistently.

- [ ] **Step 3: Add canonical-scoped enrichment lookup**

In `src/daemon/db/enrichmentViewRepository.ts`, add:

```ts
export type LiveProjectionSessionLookup = {
  projectionSessionId: string;
  canonicalSessionId: string;
  sourceSessionId: string;
};

export function liveProjectionEnrichmentsForScopes(
  db: MastheadDatabase,
  scopes: Iterable<LiveProjectionSessionLookup>
): Map<string, LiveProjectionEnrichment> {
  const scoped = [...scopes];
  if (scoped.length === 0) return new Map();
  const byCanonical = new Map(scoped.map((scope) => [scope.canonicalSessionId, scope]));
  const rows = currentSessionEnrichmentViews(db, [...byCanonical.keys()]);
  const output = new Map<string, LiveProjectionEnrichment>();
  for (const [canonicalSessionId, view] of rows) {
    const scope = byCanonical.get(canonicalSessionId);
    if (!scope) continue;
    output.set(scope.projectionSessionId, {
      action: view.action,
      commandsSummary: view.commandsSummary,
      filesChangedSummary: view.filesChangedSummary,
      liveSummary: view.liveSummary,
      model: view.model,
      object: view.object,
      outcome: view.outcome,
      provider: view.provider,
      sourceSessionId: scope.sourceSessionId,
      status: view.status,
      sessionDossier: view.sessionDossier,
      sessionSummary: view.sessionSummary,
      sessionTitle: view.sessionTitle,
      subject: view.subject,
      technologies: view.technologies,
      title: view.title,
      topics: view.topics,
      verificationSummary: view.verificationSummary
    });
  }
  return output;
}
```

- [ ] **Step 4: Add canonical-scoped transcript fact lookup**

In `src/daemon/db/liveTranscriptFactsRepository.ts`, add:

```ts
export type LiveTranscriptFactScope = {
  projectionSessionId: string;
  canonicalSessionId: string;
};

export function liveProjectionTranscriptFactsForScopes(
  db: MastheadDatabase,
  scopes: Iterable<LiveTranscriptFactScope>,
  options: LiveProjectionTranscriptFactsOptions = {}
): Map<string, LiveSessionTranscriptFacts> {
  const scoped = [...scopes];
  if (scoped.length === 0) return new Map();
  const projectionByCanonical = new Map(scoped.map((scope) => [scope.canonicalSessionId, scope.projectionSessionId]));
  const maxMessagesPerSession = Math.max(1, Math.min(options.maxMessagesPerSession ?? 24, 48));
  const rows = db
    .prepare(
      `WITH ranked_messages AS (
        SELECT
          messages.session_id AS sessionId,
          messages.role AS role,
          messages.text_redacted AS text,
          messages.observed_at AS observedAt,
          messages.message_id AS messageId,
          ROW_NUMBER() OVER (
            PARTITION BY messages.session_id
            ORDER BY COALESCE(messages.observed_at, '') DESC, messages.message_id DESC
          ) AS rowNumber
        FROM messages
        WHERE messages.session_id IN (${scoped.map(() => "?").join(", ")})
          AND messages.role IN ('user', 'assistant')
          AND trim(COALESCE(messages.text_redacted, '')) <> ''
      )
      SELECT sessionId, role, text, observedAt
      FROM ranked_messages
      WHERE rowNumber <= ?
      ORDER BY sessionId ASC, COALESCE(observedAt, '') DESC, messageId DESC`
    )
    .all(...scoped.map((scope) => scope.canonicalSessionId), maxMessagesPerSession) as Array<{
      sessionId: string;
      role: string | null;
      text: string | null;
      observedAt: string | null;
    }>;

  const output = new Map<string, LiveSessionTranscriptFacts>();
  for (const row of rows) {
    const projectionSessionId = projectionByCanonical.get(row.sessionId);
    const role = normalizeRole(row.role);
    const text = row.text?.replace(/\s+/g, " ").trim();
    if (!projectionSessionId || !role || !text || isLowValueLiveTranscriptText(text, role)) continue;
    const facts = output.get(projectionSessionId) ?? { recentMessages: [] };
    facts.recentMessages.push({ observedAt: row.observedAt ?? "", role, text });
    output.set(projectionSessionId, facts);
  }
  return output;
}
```

Keep the existing source-session-id function for old callers.

- [ ] **Step 5: Add projection scope builder in server**

In `src/daemon/server.ts`, replace `latestProjectionSessionIds` with runtime-scoped helpers:

```ts
function latestProjectionScopes(events: NormalizedEvent[], selectedProjectionSessionId: string | undefined, hostId: string): LiveProjectionSessionScope[] {
  const scopes = new Map<string, LiveProjectionSessionScope>();
  for (let index = events.length - 1; index >= 0 && scopes.size < LIVE_PROJECTION_SESSION_LIMIT; index -= 1) {
    const key = liveSessionKeyFromEvent(events[index]);
    if (!key) continue;
    const scope = projectionScopeForKey(hostId, key);
    scopes.set(scope.projectionSessionId, scope);
  }
  if (selectedProjectionSessionId && !scopes.has(selectedProjectionSessionId)) {
    const found = events.map(liveSessionKeyFromEvent).filter(Boolean).map((key) => projectionScopeForKey(hostId, key)).find((scope) => scope.projectionSessionId === selectedProjectionSessionId);
    if (found) scopes.set(found.projectionSessionId, found);
  }
  return [...scopes.values()];
}
```

Use `scopeEventForProjection` before calling `projectLiveEvents`.

- [ ] **Step 6: Refactor `/projection`**

In `/projection`:

- Build `projectionScopes`.
- Filter raw events by `liveSessionKeyId(key)`.
- Convert raw events to scoped projection events.
- Convert Git snapshots to scoped snapshots using the event runtime key that caused the snapshot.
- Use `liveProjectionEnrichmentsForScopes(database, projectionScopes)`.
- Use `liveProjectionTranscriptFactsForScopes(database, projectionScopes)`.
- Use `currentBoardHeadlineFrames` with canonical ids and return the map keyed by projection session id.
- Replace `attachCanonicalCardIds(... runtimeKind: "codex")` with a new helper that uses `projectionScopes`.

New helper:

```ts
function attachScopedCanonicalCardIds(
  projection: LiveBoardProjection,
  scopes: LiveProjectionSessionScope[],
  hostId: string
): LiveBoardProjection {
  const byProjectionId = new Map(scopes.map((scope) => [scope.projectionSessionId, scope]));
  const withIdentity = <T extends SessionCardView | undefined>(session: T): T => {
    if (!session) return session;
    const scope = byProjectionId.get(session.sessionId);
    if (!scope) return session;
    return {
      ...session,
      canonicalSessionId: session.canonicalSessionId ?? scope.canonicalSessionId,
      hostId: session.hostId ?? hostId,
      runtime: session.runtime ?? scope.runtime,
      sourceSessionId: session.sourceSessionId ?? scope.sourceSessionId
    };
  };
  return {
    ...projection,
    cards: projection.cards.map((card) => withIdentity(card)),
    expandedSession: withIdentity(projection.expandedSession),
    selectedSession: withIdentity(projection.selectedSession)
  };
}
```

- [ ] **Step 7: Verify task**

Run:

```bash
npm test -- --run src/core/__tests__/liveProjection.test.ts src/daemon/__tests__/multiRuntimeLiveIngest.test.ts src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
npm run smoke:live
npm run build
```

Expected: all commands pass, and the multi-runtime ingest test sees separate canonical sessions.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/server.ts src/core/liveProjection.ts src/daemon/db/enrichmentViewRepository.ts src/daemon/db/liveTranscriptFactsRepository.ts src/daemon/db/boardHeadlineFrameRepository.ts src/core/__tests__/liveProjection.test.ts src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
git commit -m "feat: scope live projection by runtime"
```

## Task 5: Shared Hook Helper And Hook Admin

**Files:**

- Modify: `scripts/masthead-hook.js`
- Modify: `src/core/hookAdmin.ts`
- Create: `src/core/harnessHookAdmin.ts`
- Create: `src/core/__tests__/harnessHookAdmin.test.ts`
- Modify: `src/core/__tests__/hookAdmin.test.ts`
- Modify: `src/core/__tests__/hookAdminCli.test.ts`
- Modify: `src/daemon/settingsService.ts`

- [ ] **Step 1: Write failing hook helper tests**

Add tests that execute `scripts/masthead-hook.js` with environment:

```bash
MASTHEAD_HOOK_RUNTIME=claude_code
MASTHEAD_SOURCE_ID=claude-code-hook-local
MASTHEAD_INGEST_URL=http://127.0.0.1:<test-port>/ingest
```

Assert the received request has:

- `POST /ingest?runtime=claude_code` if the URL had no runtime query.
- `x-masthead-runtime: claude_code`.
- Redacted prompt and secret strings.
- Exit code `0` when the server rejects the request.

- [ ] **Step 2: Update hook helper**

Modify `scripts/masthead-hook.js`:

```js
const runtime = process.env.MASTHEAD_HOOK_RUNTIME || "";
const sourceId = process.env.MASTHEAD_SOURCE_ID || "";
const url = withRuntime(process.env.MASTHEAD_INGEST_URL || DEFAULT_URL, runtime);
```

Add:

```js
function withRuntime(target, runtime) {
  if (!runtime) return target;
  const parsed = new URL(target);
  if (!parsed.searchParams.has("runtime")) parsed.searchParams.set("runtime", runtime);
  return parsed.toString();
}
```

Add headers:

```js
headers: {
  "content-type": "application/json",
  "content-length": Buffer.byteLength(body),
  ...(runtime ? { "x-masthead-runtime": runtime } : {}),
  ...(sourceId ? { "x-masthead-source-id": sourceId } : {})
}
```

- [ ] **Step 3: Introduce harness hook admin contracts**

Create `src/core/harnessHookAdmin.ts` with runtime-neutral config transforms:

```ts
export type HarnessHookConfigShape = "codex_claude_grok" | "cursor";

export type HarnessHookSpec = {
  runtime: "codex" | "claude_code" | "cursor" | "grok";
  configPath: string;
  shape: HarnessHookConfigShape;
  requiredEvents: string[];
  command: string;
  timeoutSeconds: number;
};

export type HarnessHookVerifyResult = {
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
};

export function installHarnessHookConfig(config: Record<string, unknown>, spec: HarnessHookSpec): Record<string, unknown>;
export function uninstallHarnessHookConfig(config: Record<string, unknown>, spec: HarnessHookSpec): Record<string, unknown>;
export function verifyHarnessHookConfig(config: Record<string, unknown>, spec: HarnessHookSpec): HarnessHookVerifyResult;
```

Implementation requirements:

- For `codex_claude_grok`, use `hooks[eventName] = [{ matcher: "*", hooks: [{ type: "command", command, timeout }] }]`, preserving existing groups.
- For `cursor`, use `hooks[eventName] = [{ command }]`, preserving existing commands.
- `isMastheadHook` must match commands containing `masthead-hook.js` and `MASTHEAD_HOOK_RUNTIME=<runtime>`.
- Uninstall only removes entries matching the target runtime.
- Do not remove existing Bridgespace or user hooks.

- [ ] **Step 4: Keep Codex hook admin compatibility**

Modify `src/core/hookAdmin.ts` so existing exports call the new neutral functions with Codex spec. Existing tests should still pass.

- [ ] **Step 5: Update settings command builder**

In `src/daemon/settingsService.ts`, replace Codex-only command construction with:

```ts
function hookCommand(config: DaemonConfig, runtime: RuntimeKind): string {
  const scriptPath = resolve(process.env.MASTHEAD_HOOK_SCRIPT || "scripts/masthead-hook.js");
  return `MASTHEAD_INGEST_URL=${ingestEndpoint(config)} MASTHEAD_HOOK_RUNTIME=${runtime} MASTHEAD_HOOK_TIMEOUT_MS=750 ${quoteShell(process.execPath)} ${quoteShell(scriptPath)}`;
}
```

Keep the old `hookCommand(config)` wrapper returning Codex for old code until Task 6 updates the DTOs.

- [ ] **Step 6: Verify task**

Run:

```bash
npm test -- --run src/core/__tests__/harnessHookAdmin.test.ts src/core/__tests__/hookAdmin.test.ts src/core/__tests__/hookAdminCli.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/masthead-hook.js src/core/harnessHookAdmin.ts src/core/__tests__/harnessHookAdmin.test.ts src/core/hookAdmin.ts src/core/__tests__/hookAdmin.test.ts src/core/__tests__/hookAdminCli.test.ts src/daemon/settingsService.ts
git commit -m "feat: add harness-neutral live hook admin"
```

## Task 6: Generalized Live Capture Settings API

**Files:**

- Create: `src/daemon/liveCaptureSettings.ts`
- Create: `src/daemon/__tests__/liveCaptureSettings.test.ts`
- Modify: `src/daemon/config.ts`
- Modify: `src/daemon/__tests__/config.test.ts`
- Modify: `src/daemon/settingsService.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Modify: `src/ui/sources/HarnessLiveCaptureSection.tsx`
- Modify: `src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx`

- [ ] **Step 1: Add home directory config**

Modify `src/daemon/config.ts`:

```ts
export type DaemonConfig = {
  host: string;
  port: number;
  dataDirectory?: string;
  homeDir: string;
  codexHomeDir: string;
  backgroundHydrationEnabled?: boolean;
  gitRefreshMs: number;
  allowedOrigins: string[];
  fixturePath: string;
  storePath: string;
  databasePath: string;
  legacyDataDirectory?: string;
  llmCopyEnabled: boolean;
  liveCopyEnabled?: boolean;
  remoteEnrichmentEnabled?: boolean;
  remoteEnrichmentTimeoutMs?: number;
  liveCopyCacheMs?: number;
  liveCopyTimeoutMs?: number;
  liveCopyProjectionBudgetMs?: number;
  liveCopyMaxConcurrent?: number;
  hookTranscriptCatchupEnabled: boolean;
  openaiApiKey?: string;
  openaiModel?: string;
  skipMigrationQuickCheck?: boolean;
};
```

Set it in `daemonConfigFromEnv`:

```ts
homeDir: resolve(env.MASTHEAD_HOME_DIR || homedir()),
codexHomeDir: resolve(env.MASTHEAD_CODEX_HOME || homedir()),
```

Add a config test:

```ts
test("allows user home and Codex home to diverge", () => {
  const config = daemonConfigFromEnv({
    ...process.env,
    MASTHEAD_HOME_DIR: "/tmp/masthead-home",
    MASTHEAD_CODEX_HOME: "/tmp/masthead-codex-home"
  });

  expect(config.homeDir).toBe("/tmp/masthead-home");
  expect(config.codexHomeDir).toBe("/tmp/masthead-codex-home");
});
```

- [ ] **Step 2: Define DTOs**

Create `src/daemon/liveCaptureSettings.ts`:

```ts
import type { RuntimeKind } from "../adapters/types.ts";

export type LiveCaptureMode = "hook" | "plugin" | "tailer" | "hook_plus_tailer" | "plugin_plus_tailer";
export type LiveCaptureStatus = "installed" | "needs_repair" | "not_installed" | "unsupported";

export type LiveCaptureSettingsDto = {
  runtime: RuntimeKind;
  label: string;
  mode: LiveCaptureMode;
  status: LiveCaptureStatus;
  supportsInstall: boolean;
  supportsTest: boolean;
  configPath?: string;
  command?: string;
  endpoint: string;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  latestBackupPath?: string;
  lastEventAt?: string;
  lastTest?: {
    testedAt: string;
    status: "passed" | "failed";
    message: string;
  };
  error?: string;
};

export type LiveCaptureSettingsStateDto = {
  runtimes: LiveCaptureSettingsDto[];
};
```

- [ ] **Step 3: Write settings tests**

Tests must assert:

- `GET /settings/hooks` returns all release targets.
- `GET /settings/hooks/codex` still returns the old Codex shape.
- `POST /settings/hooks/claude_code/install` writes a Claude hook config in a temp home.
- `POST /settings/hooks/cursor/install` preserves an existing non-Masthead command.
- `POST /settings/hooks/opencode/install` writes a plugin file, not a JSON hook file.
- `POST /settings/hooks/grok/test` posts to `/ingest?runtime=grok`.
- A test config with `homeDir` and `codexHomeDir` set to different temp directories writes Claude, Cursor, Grok, OpenCode, and OMP files under `homeDir`, and Codex under `codexHomeDir`.

- [ ] **Step 4: Implement settings orchestration**

In `src/daemon/liveCaptureSettings.ts`, implement:

```ts
export async function getLiveCaptureSettingsState(db: MastheadDatabase, config: DaemonConfig): Promise<LiveCaptureSettingsStateDto>;
export async function getLiveCaptureSettings(db: MastheadDatabase, config: DaemonConfig, runtime: RuntimeKind): Promise<LiveCaptureSettingsDto>;
export async function installLiveCapture(db: MastheadDatabase, config: DaemonConfig, runtime: RuntimeKind): Promise<LiveCaptureSettingsDto>;
export async function uninstallLiveCapture(db: MastheadDatabase, config: DaemonConfig, runtime: RuntimeKind): Promise<LiveCaptureSettingsDto>;
export async function testLiveCapture(db: MastheadDatabase, config: DaemonConfig, runtime: RuntimeKind, options?: { endpoint?: string }): Promise<LiveCaptureSettingsDto>;
```

Runtime config paths:

- Codex: `MASTHEAD_CODEX_HOOKS` or `${config.codexHomeDir}/.codex/hooks.json`.
- Claude Code: `MASTHEAD_CLAUDE_HOOKS` or `${config.homeDir}/.claude/settings.json`.
- Cursor: `MASTHEAD_CURSOR_HOOKS` or `${config.homeDir}/.cursor/hooks.json`.
- Grok Build: `MASTHEAD_GROK_HOOKS` or `${config.homeDir}/.grok/hooks/masthead.json`.
- OpenCode: `MASTHEAD_OPENCODE_PLUGIN` or `${config.homeDir}/.config/opencode/plugins/masthead-live.js`.

Do not use `config.codexHomeDir` for non-Codex harnesses.

- [ ] **Step 5: Add server routes**

Add these routes:

- `GET /settings/hooks`
- `GET /settings/hooks/:runtime`
- `POST /settings/hooks/:runtime/install`
- `POST /settings/hooks/:runtime/uninstall`
- `POST /settings/hooks/:runtime/test`

Keep existing `/settings/hooks/codex` responses compatible by returning the Codex DTO shape expected by current UI. Add the generalized state under `settings.liveCapture` in `getSettingsState`.

- [ ] **Step 6: Update app client**

In `src/app/daemonClient.ts`, add:

```ts
export type LiveCaptureSettings = {
  runtime: string;
  label: string;
  mode: "hook" | "plugin" | "tailer" | "hook_plus_tailer" | "plugin_plus_tailer";
  status: "installed" | "needs_repair" | "not_installed" | "unsupported";
  supportsInstall: boolean;
  supportsTest: boolean;
  configPath?: string;
  command?: string;
  endpoint: string;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  latestBackupPath?: string;
  lastEventAt?: string;
  lastTest?: HookLastTest;
  error?: string;
};

export async function getLiveCaptureSettings(baseUrl = defaultLiveProjectionUrl()): Promise<LiveCaptureSettings[]>;
export async function installLiveCapture(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<LiveCaptureSettings>;
export async function uninstallLiveCapture(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<LiveCaptureSettings>;
export async function testLiveCapture(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<LiveCaptureSettings>;
```

- [ ] **Step 7: Update Sources live capture UI**

Update `src/ui/sources/HarnessLiveCaptureSection.tsx`:

- Show each release target runtime row.
- Show status from generalized DTO.
- Offer install, uninstall, and test actions when supported.
- For OpenCode, label the action as plugin install.
- For Cursor, show a warning note in the existing status/details region when CLI hook coverage is partial. Do not add a large explanatory page.

- [ ] **Step 8: Verify task**

Run:

```bash
npm test -- --run src/daemon/__tests__/config.test.ts src/daemon/__tests__/liveCaptureSettings.test.ts src/daemon/__tests__/settingsApi.test.ts src/app/__tests__/daemonClient.test.ts src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx
npm run build
```

Expected: all commands pass.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/liveCaptureSettings.ts src/daemon/__tests__/liveCaptureSettings.test.ts src/daemon/config.ts src/daemon/__tests__/config.test.ts src/daemon/settingsService.ts src/daemon/server.ts src/app/daemonClient.ts src/app/__tests__/daemonClient.test.ts src/ui/sources/HarnessLiveCaptureSection.tsx src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx
git commit -m "feat: add live capture settings for target harnesses"
```

## Task 7: Claude Code Live Connector

**Files:**

- Create: `src/adapters/claudeCode/live.ts`
- Create: `src/adapters/claudeCode/__tests__/live.test.ts`
- Modify: `src/adapters/claudeCode/adapter.ts`
- Modify: `src/adapters/claudeCode/discovery.ts`
- Modify: `src/adapters/claudeCode/parser.ts`
- Test: existing Claude adapter tests.

- [ ] **Step 1: Write Claude live tests**

Tests must cover:

- Hook spec required events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `Stop`, `SessionEnd`.
- Settings file merge preserves `availableModels`, `env`, `model`, and unrelated hook entries.
- JSONL transcript lines with `type`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, and `message` normalize to message/tool/usage records.
- Tailer reads only bytes after cursor offset and updates cursor context with `sourceSessionId`, `cwd`, and `model`.

- [ ] **Step 2: Implement Claude hook spec**

Create `src/adapters/claudeCode/live.ts`:

```ts
export const CLAUDE_CODE_LIVE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "Stop",
  "SessionEnd"
] as const;

export function claudeCodeHookSpec(input: { configPath: string; command: string }) {
  return {
    runtime: "claude_code" as const,
    configPath: input.configPath,
    shape: "codex_claude_grok" as const,
    requiredEvents: [...CLAUDE_CODE_LIVE_EVENTS],
    command: input.command,
    timeoutSeconds: 1
  };
}
```

- [ ] **Step 3: Implement Claude JSONL parser**

In `src/adapters/claudeCode/parser.ts`, export a parser used by both backfill and watch:

```ts
export type ClaudeCodeJsonlRecord = {
  sessionId?: string;
  observedAt?: string;
  cwd?: string;
  gitBranch?: string;
  role?: "user" | "assistant" | "system" | "tool";
  text?: string;
  model?: string;
  toolName?: string;
  toolInput?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export function parseClaudeCodeJsonlLine(line: string): ClaudeCodeJsonlRecord | undefined;
export function claudeCodeAdapterRecordsFromLine(source: DiscoveredSource, line: string, lineNumber: number): AdapterRecord[];
```

Parsing rules:

- Session id from `sessionId`, `session_id`, or nested `message.sessionId`.
- Timestamp from `timestamp`, `createdAt`, or nested `message.timestamp`.
- Role/text from nested `message.role`, `message.content`, and content parts.
- Tool call from content parts with `type` containing `tool_use`.
- Tool result from content parts with `type` containing `tool_result`.
- Usage from nested `message.usage`.
- Never emit raw hidden chain-of-thought or tool output beyond redacted text already handled by `ingestAdapterRecord`.

- [ ] **Step 4: Implement Claude `watch`**

Modify `src/adapters/claudeCode/adapter.ts` so `watch(source, cursor)` tails JSONL files:

- Start at `cursor.byteOffset` when valid.
- Reset to `0` when the file shrank.
- Yield records with source record keys ending in byte offsets.
- Stop when current file has been read. The daemon supervisor will call `watch` repeatedly.

- [ ] **Step 5: Verify task**

Run:

```bash
npm test -- --run src/adapters/claudeCode/__tests__/live.test.ts src/adapters/__tests__/generic.test.ts src/daemon/import/__tests__/multiAdapterImport.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claudeCode/live.ts src/adapters/claudeCode/__tests__/live.test.ts src/adapters/claudeCode/adapter.ts src/adapters/claudeCode/discovery.ts src/adapters/claudeCode/parser.ts
git commit -m "feat: add Claude Code live connector"
```

## Task 8: Cursor Agent Live Connector

**Files:**

- Create: `src/adapters/cursor/live.ts`
- Create: `src/adapters/cursor/__tests__/live.test.ts`
- Modify: `src/adapters/cursor/adapter.ts`
- Modify: `src/adapters/cursor/parser.ts`
- Modify: `src/adapters/cursor/schemaProbe.ts`
- Test: existing Cursor adapter tests.

- [ ] **Step 1: Write Cursor tests**

Tests must cover:

- `~/.cursor/hooks.json` install preserves existing hooks.
- Hook format uses Cursor's event shape, not Codex matcher groups.
- Required events include `sessionStart`, `beforeSubmitPrompt`, `beforeShellExecution`, `afterShellExecution`, `afterFileEdit`, `afterAgentResponse`, and `stop`.
- SQLite fallback reads synthetic Cursor DB rows and emits message/session records.
- Fallback synthesizes one `NormalizedEvent` for a new session when no hook event has been observed.

- [ ] **Step 2: Implement Cursor hook spec**

Create `src/adapters/cursor/live.ts`:

```ts
export const CURSOR_LIVE_EVENTS = [
  "sessionStart",
  "beforeSubmitPrompt",
  "beforeShellExecution",
  "afterShellExecution",
  "afterFileEdit",
  "afterAgentResponse",
  "stop"
] as const;

export function cursorHookSpec(input: { configPath: string; command: string }) {
  return {
    runtime: "cursor" as const,
    configPath: input.configPath,
    shape: "cursor" as const,
    requiredEvents: [...CURSOR_LIVE_EVENTS],
    command: input.command,
    timeoutSeconds: 1
  };
}
```

- [ ] **Step 3: Implement Cursor DB/log fallback**

In `src/adapters/cursor/parser.ts`, add Cursor-specific SQLite parsing:

```ts
export type CursorLiveRow = {
  sessionId: string;
  role?: string;
  text?: string;
  observedAt: string;
  cwd?: string;
  model?: string;
};

export function cursorLiveRowsFromSqlite(db: DatabaseSync, source: DiscoveredSource, cursor?: IngestCursor): AdapterRecord[];
export function cursorLiveEventFromRecord(record: AdapterRecord): NormalizedEvent | undefined;
```

Rules:

- Prefer known tables/columns from `schemaProbe.ts`.
- Fall back to key/value JSON rows if schema varies.
- Use the row id or timestamp in `sourceRecordKey` so repeated polling dedupes.
- Emit message records for user and assistant text.
- Emit a synthetic `session.started` event for the first row in a source session when no live hook event exists.

- [ ] **Step 4: Implement Cursor `watch`**

Modify `src/adapters/cursor/adapter.ts`:

- For SQLite sources, use `withReadonlySqliteCopy`.
- Read rows newer than cursor fingerprint or row id encoded in `byteOffset`.
- Yield adapter records and synthetic live event records.
- Keep polling bounded to 500 new rows per pass.

- [ ] **Step 5: Verify task**

Run:

```bash
npm test -- --run src/adapters/cursor/__tests__/live.test.ts src/adapters/__tests__/pathPreflight.test.ts src/adapters/__tests__/generic.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/cursor/live.ts src/adapters/cursor/__tests__/live.test.ts src/adapters/cursor/adapter.ts src/adapters/cursor/parser.ts src/adapters/cursor/schemaProbe.ts
git commit -m "feat: add Cursor live connector"
```

## Task 9: Grok Build Adapter And Live Connector

**Files:**

- Create: `src/adapters/grok/adapter.ts`
- Create: `src/adapters/grok/discovery.ts`
- Create: `src/adapters/grok/live.ts`
- Create: `src/adapters/grok/parser.ts`
- Create: `src/adapters/grok/__tests__/live.test.ts`
- Create: `src/adapters/grok/__tests__/parser.test.ts`
- Modify: `src/adapters/harnessCatalog.ts`
- Modify: `src/adapters/registry.ts`
- Modify: `src/adapters/capabilities.ts`
- Test: catalog and registry tests.

- [ ] **Step 1: Add Grok runtime tests**

Update tests to require:

- `RUNTIME_KINDS` still includes `"grok"` from Task 1.
- `HARNESS_CATALOG` includes runtime `"grok"`, label `"Grok Build"`, source kinds `["hook", "jsonl"]`, and `supportsLiveWatch: true`.
- `adapterForRuntime("grok")` returns an adapter.

- [ ] **Step 2: Add catalog entry**

Add the entry near Claude/Cursor/OpenCode in `src/adapters/harnessCatalog.ts`:

```ts
active("grok", "Grok Build", ["Grok", "xAI Grok Build"], "Grok Build local hooks and session transcripts.", "active_full", ["hook", "jsonl"], [
  "~/.grok/hooks",
  "~/.grok/sessions"
], ["MASTHEAD_GROK_HOME", "GROK_HOME"], { live: true, tokens: true, files: true }),
```

- [ ] **Step 3: Implement Grok discovery**

Create `src/adapters/grok/discovery.ts`:

```ts
import { join } from "node:path";
import type { AdapterPathCandidate } from "../pathTypes.ts";
import type { DiscoveryContext } from "../types.ts";

export function grokCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_GROK_HOME ?? process.env.GROK_HOME ?? join(context.homeDir, ".grok");
  return [
    { path: join(root, "sessions"), contentKind: "jsonl", maxDepth: 6 },
    { path: join(root, "hooks"), contentKind: "json", maxDepth: 1 }
  ];
}
```

- [ ] **Step 4: Implement Grok parser**

Create `src/adapters/grok/parser.ts`:

```ts
export function parseGrokUpdatesJsonlLine(line: string, source: DiscoveredSource, lineNumber: number): AdapterRecord[];
export function parseGrokChatHistoryJsonlLine(line: string, source: DiscoveredSource, lineNumber: number): AdapterRecord[];
export function grokSessionIdFromPath(path: string): string | undefined;
```

Rules from local docs:

- `summary.json` contains title, model, branch, and token counts.
- `updates.jsonl` is authoritative conversation log with `method`, `params`, and `timestamp`.
- `chat_history.jsonl` contains role/content fallback data.
- `summary.json.generated_title` can update session title.
- Use path session id when a line does not include one.

- [ ] **Step 5: Implement Grok hook spec**

Create `src/adapters/grok/live.ts`:

```ts
export const GROK_LIVE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "Stop",
  "StopFailure",
  "SessionEnd"
] as const;

export function grokHookSpec(input: { configPath: string; command: string }) {
  return {
    runtime: "grok" as const,
    configPath: input.configPath,
    shape: "codex_claude_grok" as const,
    requiredEvents: [...GROK_LIVE_EVENTS],
    command: input.command,
    timeoutSeconds: 1
  };
}
```

- [ ] **Step 6: Implement adapter**

Create `src/adapters/grok/adapter.ts`:

```ts
import type { SessionAdapter } from "../types.ts";
import { grokCandidatePaths } from "./discovery.ts";

export const grokAdapter: SessionAdapter = {
  runtime: "grok",
  discover: async (context) => discoverGrokSources(context),
  inspect: async (source) => inspectGrokSource(source),
  backfill: async function* (source, cursor) {
    yield* backfillGrokSource(source, cursor);
  },
  watch: async function* (source, cursor) {
    yield* watchGrokSource(source, cursor);
  }
};
```

Use the existing local adapter patterns for discovery and cursor handling. Keep Grok-specific parsing in `parser.ts`.

- [ ] **Step 7: Register adapter**

Modify `src/adapters/registry.ts`:

```ts
import { grokAdapter } from "./grok/adapter.ts";
```

Add `grokAdapter` to `sessionAdapters`.

- [ ] **Step 8: Verify task**

Run:

```bash
npm test -- --run src/adapters/grok/__tests__/live.test.ts src/adapters/grok/__tests__/parser.test.ts src/adapters/__tests__/harnessCatalog.test.ts src/adapters/__tests__/registry.test.ts src/adapters/__tests__/capabilities.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/grok src/adapters/harnessCatalog.ts src/adapters/registry.ts src/adapters/capabilities.ts src/adapters/__tests__/harnessCatalog.test.ts src/adapters/__tests__/registry.test.ts src/adapters/__tests__/capabilities.test.ts
git commit -m "feat: add Grok Build live adapter"
```

## Task 10: OpenCode Live Connector

**Files:**

- Create: `src/adapters/opencode/live.ts`
- Create: `src/adapters/opencode/sqliteLive.ts`
- Create: `src/adapters/opencode/__tests__/live.test.ts`
- Create: `src/adapters/opencode/__tests__/sqliteLive.test.ts`
- Modify: `src/adapters/opencode/adapter.ts`
- Modify: `src/adapters/opencode/discovery.ts`
- Modify: `src/adapters/opencode/parser.ts`
- Modify: `src/daemon/liveCaptureSettings.ts`

- [ ] **Step 1: Write OpenCode tests**

Tests must cover:

- Plugin template posts to `/ingest?runtime=opencode`.
- Plugin template includes runtime and source metadata.
- Install writes `~/.config/opencode/plugins/masthead-live.js`.
- Uninstall removes only the Masthead plugin file.
- SQLite parser reads synthetic `session`, `message`, `part`, and `event` tables.
- SQLite parser extracts assistant/user text from `part.data` JSON.

- [ ] **Step 2: Implement plugin template**

Create `src/adapters/opencode/live.ts`:

```ts
export function opencodeLivePluginSource(input: { endpoint: string }): string {
  return `
export const MastheadLivePlugin = async ({ app }) => {
  const endpoint = ${JSON.stringify(input.endpoint)};
  async function post(event) {
    try {
      await fetch(endpoint.includes("?") ? endpoint + "&runtime=opencode" : endpoint + "?runtime=opencode", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-masthead-runtime": "opencode",
          "x-masthead-source-id": "opencode-plugin-local"
        },
        body: JSON.stringify({
          runtime: "opencode",
          type: event?.type || event?.name || "opencode.event",
          sessionID: event?.sessionID || event?.sessionId || event?.session?.id,
          directory: event?.directory || event?.session?.directory || app?.cwd,
          message: event?.message,
          tool: event?.tool,
          permission: event?.permission,
          time: new Date().toISOString()
        })
      });
    } catch {
    }
  }
  return {
    event: async ({ event }) => {
      await post(event);
    }
  };
};
export default MastheadLivePlugin;
`.trimStart();
}
```

The empty catch is intentional fail-open behavior inside OpenCode's plugin process.

- [ ] **Step 3: Implement OpenCode SQLite parser**

Create `src/adapters/opencode/sqliteLive.ts`:

```ts
export type OpenCodeLiveRow = {
  sessionId: string;
  observedAt: string;
  directory?: string;
  agent?: string;
  model?: string;
  role?: string;
  text?: string;
  partType?: string;
};

export function opencodeLiveRowsFromSqlite(db: DatabaseSync): OpenCodeLiveRow[];
export function opencodeAdapterRecordsFromRows(source: DiscoveredSource, rows: OpenCodeLiveRow[]): AdapterRecord[];
```

Rules:

- `session.id` is session id.
- `session.directory` is cwd/project.
- `session.title` is title metadata.
- `session.model` JSON contains provider/model data.
- `message.session_id` links messages.
- `message.data` and `part.data` are JSON payloads.
- `part.data.type === "text"` with text content becomes a message record.
- Tool and permission rows become runtime signal records when they cannot become tool call/result records.

- [ ] **Step 4: Wire OpenCode adapter**

Modify `src/adapters/opencode/adapter.ts` so:

- Backfill uses OpenCode-specific SQLite parser when source path ends with `opencode.db`.
- Watch polls `opencode.db` with `withReadonlySqliteCopy`.
- Generic JSONL fallback remains for older OpenCode layouts.

- [ ] **Step 5: Wire OpenCode settings install**

Modify `src/daemon/liveCaptureSettings.ts`:

- `installLiveCapture("opencode")` writes plugin source from `opencodeLivePluginSource`.
- Backup existing `masthead-live.js` before overwrite.
- `uninstallLiveCapture("opencode")` removes only that plugin file.
- `testLiveCapture("opencode")` posts synthetic `type: "chat.message"` payload to `/ingest?runtime=opencode`.

- [ ] **Step 6: Verify task**

Run:

```bash
npm test -- --run src/adapters/opencode/__tests__/live.test.ts src/adapters/opencode/__tests__/sqliteLive.test.ts src/daemon/__tests__/liveCaptureSettings.test.ts
npm run build
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/opencode/live.ts src/adapters/opencode/sqliteLive.ts src/adapters/opencode/__tests__/live.test.ts src/adapters/opencode/__tests__/sqliteLive.test.ts src/adapters/opencode/adapter.ts src/adapters/opencode/discovery.ts src/adapters/opencode/parser.ts src/daemon/liveCaptureSettings.ts
git commit -m "feat: add OpenCode live connector"
```

## Task 11: Live Capture Supervisor For Tailers

**Files:**

- Create: `src/daemon/liveCaptureSupervisor.ts`
- Create: `src/daemon/__tests__/liveCaptureSupervisor.test.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/db/cursorRepository.ts` if source metadata needs adapter/source kind accuracy.
- Test: import worker tests that use cursors.

- [ ] **Step 1: Write supervisor tests**

Tests must cover:

- Supervisor calls `watch` for enabled release target adapters.
- JSONL watcher resumes from cursor offset.
- SQLite watcher does not mutate source DB and updates Masthead cursor after ingest.
- Adapter records with `normalized.kind === "message"` update transcript facts.
- Adapter records with synthetic `normalized.kind === "event"` update live projection state.
- Failures record runtime diagnostics and do not stop other runtimes.
- With transcript import policy disabled, hook/plugin `NormalizedEvent` records still enter live projection but tailer `message` records are not ingested into `messages`.
- With `MASTHEAD_LIVE_CAPTURE_GROK=0`, Grok sources are skipped and other runtime sources continue polling.

- [ ] **Step 2: Implement supervisor contract**

Create `src/daemon/liveCaptureSupervisor.ts`:

```ts
export type LiveCaptureSupervisor = {
  start(): void;
  stop(): Promise<void>;
  pollNow(): Promise<void>;
};

export function createLiveCaptureSupervisor(input: {
  database: MastheadDatabase;
  config: DaemonConfig;
  state: ReturnType<typeof createIngestionState>;
  queueSessionEnrichment: (sessionId: string | undefined) => void;
  queueSessionSearchIndex: (sessionId: string | undefined) => void;
  ingestLiveEvent: (event: NormalizedEvent) => string | undefined;
  ingestAdapterRecordForRuntime: (record: AdapterRecord, runtime: RuntimeKind) => string | undefined;
  intervalMs?: number;
}): LiveCaptureSupervisor;
```

- [ ] **Step 3: Implement polling**

Supervisor behavior:

- Default interval: 1500 ms.
- Discover sources with `scanAdapters` for `claude_code`, `cursor`, `grok`, and `opencode`.
- Skip a runtime when `liveCaptureRuntimeEnabled(runtime)` returns false.
- Skip transcript tailing when transcript import policy is disabled.
- For each source, read cursor with `readCursor`.
- Run `adapter.watch(source, cursor)`.
- Ingest each record through `ingestAdapterRecordForRuntime`.
- If record normalized value is a `NormalizedEvent`, also call `ingestLiveEvent`.
- Update cursor after each source using the highest offset from `sourceRecordKey`.
- Limit each poll to 1000 records per runtime.
- Record diagnostics and continue when one runtime fails.

- [ ] **Step 4: Start and stop supervisor from daemon**

Modify `src/daemon/server.ts`:

- Create supervisor after DB migration and state initialization.
- Start it inside `startBackgroundHydration` or daemon startup path after source discovery is safe.
- Stop it in `close`.
- Expose `pollNow` only to tests through returned daemon internals if existing test pattern allows it; otherwise test through real interval with short interval.

- [ ] **Step 5: Verify task**

Run:

```bash
npm test -- --run src/daemon/__tests__/liveCaptureSupervisor.test.ts src/daemon/__tests__/multiRuntimeLiveIngest.test.ts src/daemon/db/__tests__/cursorRepository.test.ts
npm run smoke:live
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/liveCaptureSupervisor.ts src/daemon/__tests__/liveCaptureSupervisor.test.ts src/daemon/server.ts src/daemon/db/cursorRepository.ts
git commit -m "feat: tail live transcript sources"
```

## Task 12: UI Harness Filters And Runtime Labels

**Files:**

- Modify: `src/ui/toolbarOptions.ts`
- Modify: `src/ui/filterBoard.ts`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`
- Modify: `src/ui/__tests__/observabilityToolbar.test.tsx`
- Modify: `src/app/App.tsx` if filter state persistence assumes Codex-only values.

- [ ] **Step 1: Expand harness options**

Modify `src/ui/toolbarOptions.ts`:

```ts
export type HarnessFilter = "all" | "codex" | "claude_code" | "cursor" | "grok" | "opencode";

export const HARNESS_OPTIONS = [
  { value: "all", label: "All Harnesses" },
  { value: "codex", label: "Codex" },
  { value: "claude_code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "grok", label: "Grok Build" },
  { value: "opencode", label: "OpenCode" }
] satisfies SelectOption<HarnessFilter>[];
```

- [ ] **Step 2: Filter by runtime first**

Modify `src/ui/filterBoard.ts`:

```ts
function matchesHarness(card: SessionCardView, harness: HarnessFilter): boolean {
  if (harness === "all") return true;
  return card.runtime === harness || normalizedHarness(card) === normalize(harness);
}
```

Replace the Codex-only filter condition with `if (!matchesHarness(card, harness)) return false;`.

- [ ] **Step 3: Add UI tests**

Add tests that verify:

- Toolbar renders all release target harnesses.
- Filtering by `claude_code` shows Claude Code cards only.
- Filtering by `grok` shows Grok Build cards only.
- Existing Codex cards still pass the Codex filter.

- [ ] **Step 4: Verify task**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/observabilityToolbar.test.tsx
npm run check:surface-contract
npm run build
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/toolbarOptions.ts src/ui/filterBoard.ts src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/observabilityToolbar.test.tsx src/app/App.tsx
git commit -m "feat: expose live harness filters"
```

## Task 13: Doctor And Smoke Coverage

**Files:**

- Modify: `scripts/masthead-doctor-hook-capture.js`
- Modify: `scripts/masthead-doctor.js`
- Modify: `scripts/masthead-live-smoke.js`
- Create: `scripts/fixtures/live-connectors/claude.json`
- Create: `scripts/fixtures/live-connectors/cursor.json`
- Create: `scripts/fixtures/live-connectors/grok.json`
- Create: `scripts/fixtures/live-connectors/opencode.json`
- Test: existing smoke-related tests if present.

- [ ] **Step 1: Add synthetic multi-runtime smoke fixtures**

Create fixture payloads matching the Task 2 fixture structure under `scripts/fixtures/live-connectors/`.

- [ ] **Step 2: Extend live smoke**

Modify `scripts/masthead-live-smoke.js`:

- Start daemon as today.
- Post one event each for Codex, Claude Code, Cursor, Grok Build, OpenCode, and OMP.
- Fetch `/projection`.
- Assert five cards exist.
- Assert each card has `runtime`, `harness`, `sourceSessionId`, and `canonicalSessionId`.
- Assert canonical ids are unique.

- [ ] **Step 3: Extend doctor**

Modify `scripts/masthead-doctor-hook-capture.js`:

- Report installed/version for `codex`, `claude`, `cursor`, `grok`, and `opencode`.
- Report hook/plugin config path.
- Report installed/missing/needs_repair live capture status from `/settings/hooks`.
- Report `disabled_by_env` separately when `MASTHEAD_LIVE_CAPTURE=0` or a per-runtime disable flag is set.
- Report transcript store path existence for each runtime.
- Do not print secrets or raw hook payloads.

Modify `scripts/masthead-doctor.js` to include this in normal doctor output and JSON output.

- [ ] **Step 4: Verify task**

Run:

```bash
npm run smoke:live
npm run doctor
npm run doctor:json
npm run build
```

Expected: smoke passes, doctor prints target runtime capture health, doctor JSON parses successfully.

- [ ] **Step 5: Commit**

```bash
git add scripts/masthead-doctor-hook-capture.js scripts/masthead-doctor.js scripts/masthead-live-smoke.js scripts/fixtures/live-connectors
git commit -m "test: cover multi-harness live capture smoke"
```

## Task 14: Manual Release Acceptance On This Machine

**Files:**

- No product files required.
- Update `docs/acceptance/product-release-gate.md` only if the current release checklist lacks live connector coverage.

- [ ] **Step 1: Start Masthead**

Run:

```bash
npm run dev
```

Expected: daemon starts on `127.0.0.1:17373`, UI starts on an available UI port, and no "No live connection" state appears.

- [ ] **Step 2: Install live capture for all target runtimes**

Use the UI or run API calls:

```bash
curl -s -X POST http://127.0.0.1:17373/settings/hooks/codex/install
curl -s -X POST http://127.0.0.1:17373/settings/hooks/claude_code/install
curl -s -X POST http://127.0.0.1:17373/settings/hooks/cursor/install
curl -s -X POST http://127.0.0.1:17373/settings/hooks/grok/install
curl -s -X POST http://127.0.0.1:17373/settings/hooks/opencode/install
```

Expected: all return `ok: true` and status `installed` or `needs_repair` with a concrete missing event/config reason.

- [ ] **Step 3: Verify install backups and ownership**

Run:

```bash
find "$HOME/.codex" "$HOME/.claude" "$HOME/.cursor" "$HOME/.grok" "$HOME/.config/opencode" \
  -maxdepth 3 \
  \( -name '*masthead-backup*' -o -name 'masthead-live.js' -o -name 'masthead.json' \) \
  -print 2>/dev/null
```

Expected:

- Existing files that were overwritten have timestamped Masthead backups.
- New Masthead files are clearly named `masthead-live.js` or `masthead.json`.
- No unrelated hook/plugin files were renamed or removed.

- [ ] **Step 4: Test live capture round trips**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/settings/hooks/codex/test
curl -s -X POST http://127.0.0.1:17373/settings/hooks/claude_code/test
curl -s -X POST http://127.0.0.1:17373/settings/hooks/cursor/test
curl -s -X POST http://127.0.0.1:17373/settings/hooks/grok/test
curl -s -X POST http://127.0.0.1:17373/settings/hooks/opencode/test
```

Expected: all return `lastTest.status: "passed"` when Masthead is running.

- [ ] **Step 5: Run low-cost harness smoke sessions in a scratch directory**

Create scratch workspace:

```bash
mkdir -p /tmp/masthead-live-smoke
cd /tmp/masthead-live-smoke
git init
printf 'masthead live smoke\n' > README.md
git add README.md
git -c user.name="Masthead Smoke" -c user.email="masthead-smoke@example.invalid" commit -m "seed masthead live smoke"
```

Run one session per harness:

```bash
codex exec --cd /tmp/masthead-live-smoke --sandbox read-only --ask-for-approval never "Reply with exactly: masthead codex live smoke"
claude -p "Reply with exactly: masthead claude live smoke" --output-format stream-json --include-hook-events
cursor agent -p --output-format stream-json --workspace /tmp/masthead-live-smoke "Reply with exactly: masthead cursor live smoke"
grok -p "Reply with exactly: masthead grok live smoke" --output-format streaming-json --cwd /tmp/masthead-live-smoke
opencode run --dir /tmp/masthead-live-smoke --format json "Reply with exactly: masthead opencode live smoke"
```

If a command prompts for approval or auth, use the harness's normal local auth flow. Do not add secrets to Masthead config.

- [ ] **Step 6: Verify projection**

Run:

```bash
curl -s http://127.0.0.1:17373/projection | node -e '
let body="";
process.stdin.on("data", c => body += c);
process.stdin.on("end", () => {
  const projection = JSON.parse(body).projection;
  const rows = projection.cards.map(card => ({
    runtime: card.runtime,
    harness: card.harness,
    sourceSessionId: card.sourceSessionId,
    canonicalSessionId: card.canonicalSessionId,
    title: card.title,
    headline: card.headline?.headline
  }));
  console.table(rows);
  for (const runtime of ["codex", "claude_code", "cursor", "grok", "opencode"]) {
    if (!rows.some(row => row.runtime === runtime)) {
      console.error(`missing runtime ${runtime}`);
      process.exitCode = 1;
    }
  }
});
'
```

Expected: table contains one or more rows for each target runtime and each row has a canonical id.

- [ ] **Step 7: Verify Logbook/search data**

Run:

```bash
curl -s 'http://127.0.0.1:17373/sessions?runtime=codex&limit=5' | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>console.log(JSON.parse(b).sessions?.length ?? 0))'
curl -s 'http://127.0.0.1:17373/sessions?runtime=claude_code&limit=5' | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>console.log(JSON.parse(b).sessions?.length ?? 0))'
curl -s 'http://127.0.0.1:17373/sessions?runtime=cursor&limit=5' | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>console.log(JSON.parse(b).sessions?.length ?? 0))'
curl -s 'http://127.0.0.1:17373/sessions?runtime=grok&limit=5' | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>console.log(JSON.parse(b).sessions?.length ?? 0))'
curl -s 'http://127.0.0.1:17373/sessions?runtime=opencode&limit=5' | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>console.log(JSON.parse(b).sessions?.length ?? 0))'
```

Expected: each command prints a number greater than `0` after smoke sessions.

- [ ] **Step 8: Verify no cross-runtime collisions**

Run a synthetic collision check:

```bash
curl -s -X POST 'http://127.0.0.1:17373/ingest?runtime=claude_code' -H 'content-type: application/json' -d '{"hookEventName":"SessionStart","sessionId":"collision-release-check","timestamp":"2026-07-05T12:00:00.000Z","cwd":"/tmp/masthead-live-smoke"}'
curl -s -X POST 'http://127.0.0.1:17373/ingest?runtime=grok' -H 'content-type: application/json' -d '{"hookEventName":"SessionStart","sessionId":"collision-release-check","timestamp":"2026-07-05T12:00:01.000Z","cwd":"/tmp/masthead-live-smoke"}'
curl -s http://127.0.0.1:17373/projection | node -e '
let b="";
process.stdin.on("data", c => b += c);
process.stdin.on("end", () => {
  const cards = JSON.parse(b).projection.cards.filter(card => card.sourceSessionId === "collision-release-check");
  console.log(cards.map(card => `${card.runtime}:${card.canonicalSessionId}`).join("\n"));
  if (new Set(cards.map(card => card.canonicalSessionId)).size !== cards.length) process.exit(1);
});
'
```

Expected: two rows, one `claude_code`, one `grok`, with different canonical session ids.

## Task 15: Documentation And OpenWiki

**Files:**

- Create: `docs/reference/live-connectors.md`
- Modify: `docs/reference/adapters.md`
- Modify: `docs/reference/sources.md`
- Modify: `docs/reference/board.md`
- Modify: `openwiki/sources.md`
- Modify: `openwiki/data-and-integrations.md`
- Modify: `docs/acceptance/product-release-gate.md`

- [ ] **Step 1: Document release target connectors**

Create `docs/reference/live-connectors.md` with sections:

- Product framing: live connectors feed the canonical session database, Logbook, search, MCP, and Now.
- Runtime identity: canonical ids include host, runtime, and source session id.
- Codex: command hook.
- Claude Code: command hooks plus JSONL tailing.
- Cursor Agent: hooks plus DB/log fallback.
- Grok Build: hooks plus session file tailing.
- OpenCode: plugin plus SQLite tailing.
- Privacy: transcript text ingestion remains controlled by transcript import policy.
- Troubleshooting: settings paths, doctor checks, and how to uninstall Masthead-managed hooks/plugins.

- [ ] **Step 2: Update adapter docs**

Update `docs/reference/adapters.md`:

- Mark Codex, Claude Code, Cursor, Grok Build, OpenCode, and OMP as live-capable.
- Add Grok Build to the active adapter table.
- Note Cursor CLI hook parity fallback.

- [ ] **Step 3: Update Sources and Board docs**

Update:

- `docs/reference/sources.md` to describe live capture install/test state.
- `docs/reference/board.md` to describe multi-harness Now cards and runtime-scoped identity.
- `docs/acceptance/product-release-gate.md` to include the six target live connector acceptance checks.

- [ ] **Step 4: Update OpenWiki**

Run:

```bash
openwiki --update
```

Review generated wiki changes. Keep changes that accurately describe the live connector architecture. Do not include credentials, `.env` content, raw transcripts, auth state, or local user prompt text.

- [ ] **Step 5: Verify docs**

Run:

```bash
rg -n "monitoring console|supervision tower|raw transcript|API key|SECRET|TOKEN|sk-" docs openwiki
npm run check:product-contract
```

Expected:

- No product framing violations.
- No secrets.
- Product contract check passes.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/live-connectors.md docs/reference/adapters.md docs/reference/sources.md docs/reference/board.md openwiki/sources.md openwiki/data-and-integrations.md docs/acceptance/product-release-gate.md
git commit -m "docs: document live connector release targets"
```

## Task 16: Full Verification And Release Closeout

**Files:**

- No planned product file changes. Fix only failures found by verification.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run verify
```

Expected: passes.

- [ ] **Step 2: Run targeted connector verification**

Run:

```bash
npm test -- --run src/core/__tests__/liveIdentity.test.ts src/core/__tests__/liveHookAdapter.test.ts src/daemon/__tests__/multiRuntimeLiveIngest.test.ts src/daemon/__tests__/liveCaptureSupervisor.test.ts src/daemon/__tests__/liveCaptureSettings.test.ts
npm test -- --run src/adapters/claudeCode/__tests__/live.test.ts src/adapters/cursor/__tests__/live.test.ts src/adapters/grok/__tests__/live.test.ts src/adapters/opencode/__tests__/live.test.ts
npm run smoke:live
npm run smoke:import
npm run smoke:mcp
npm run doctor
```

Expected: all commands pass.

- [ ] **Step 3: Run manual acceptance from Task 14**

Expected:

- Projection shows all six target runtimes.
- Logbook has canonical sessions for all six target runtimes.
- MCP smoke can read canonical session data for sessions captured from the target runtimes.
- Board headlines have transcript-backed facts where transcript policy is enabled.
- Cursor fallback works when only partial CLI hooks are observed.

- [ ] **Step 4: Review changed hook files on this machine**

Inspect:

```bash
sed -n '1,220p' ~/.codex/hooks.json
sed -n '1,220p' ~/.claude/settings.json
sed -n '1,220p' ~/.cursor/hooks.json
sed -n '1,220p' ~/.grok/hooks/masthead.json
sed -n '1,220p' ~/.config/opencode/plugins/masthead-live.js
```

Expected:

- Masthead entries are present for installed runtimes.
- Existing non-Masthead hooks remain present.
- No secrets are printed or stored in these files.
- Each Masthead command uses `MASTHEAD_HOOK_RUNTIME=<runtime>`.

- [ ] **Step 5: Final product check**

Run:

```bash
git status --short
git log --oneline --decorate -10
```

Expected:

- Only intentional commits are present.
- Working tree is clean.

## Risk Register

- Cursor CLI hook parity may be partial. Mitigation: Cursor DB/log watcher is part of release scope, and doctor should report hook coverage separately from fallback capture.
- Claude Code settings may be admin-managed or invalid. Mitigation: installer must back up, validate JSON object shape, and surface `needs_repair` with a concrete error.
- OpenCode plugin API event names may vary by version. Mitigation: plugin posts the raw event envelope with `type/name`, and SQLite watcher provides transcript/status fallback.
- Grok Build local hook docs are installed locally but official web docs are less detailed on hooks. Mitigation: target the installed version's local docs and verify manually on this machine.
- Runtime-scoped projection can break selected/expanded session ids. Mitigation: `sessionId` becomes the projection id, `sourceSessionId` remains raw, and tests cover selected cards.
- Transcript privacy can be accidentally weakened by live tailers. Mitigation: tailers only store prompt/assistant text when transcript import policy is enabled. Hook metadata remains redacted and fail-open.
- Raw event replay can grow noisy with five runtimes. Mitigation: keep `CANONICAL_LIVE_REPLAY_LIMIT`, source id filtering, and per-runtime dedupe.

## Final Acceptance Checklist

- [ ] Codex live card appears and existing Codex hook install/test still passes.
- [ ] Claude Code live card appears from hook events.
- [ ] Claude Code headlines use recent transcript facts after transcript policy approval.
- [ ] Cursor live card appears from hooks or fallback DB/log tailer.
- [ ] Cursor headlines use recent transcript facts after transcript policy approval.
- [ ] Grok Build live card appears from `~/.grok/hooks`.
- [ ] Grok Build headlines use `~/.grok/sessions` facts after transcript policy approval.
- [ ] OpenCode live card appears from plugin events.
- [ ] OpenCode headlines use `opencode.db` facts after transcript policy approval.
- [ ] Same raw session id across two runtimes produces two canonical sessions.
- [ ] Read-only MCP access can list or retrieve canonical sessions from all six target runtimes.
- [ ] Settings/Sources can install, uninstall, verify, and test all live capture integrations.
- [ ] `npm run verify` passes.
- [ ] `npm run smoke:live` passes.
- [ ] `npm run smoke:import` passes.
- [ ] `npm run doctor` reports live connector health without printing secrets.
- [ ] `openwiki --update` has been run and reviewed.
