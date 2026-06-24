# Calm Ops Briefing Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Masthead's main screen into a calm, system-neutral operations brief that explains what each agent is doing at a high level, while keeping deterministic state, evidence, and technical details in the inspector.

**Architecture:** Keep the local machine and deterministic event model as the source of truth. Add a safe work-context layer and redacted latest-feedback snapshots, then let GPT-5 nano translate bounded state, safe work-area labels, and feedback claim flags into calm natural-language copy when LLM copy is explicitly enabled. The board renders intervention-first briefing language; the inspector renders deterministic state, latest feedback, evidence, timeline, and artifacts as separate technical sections.

**Tech Stack:** TypeScript core, React UI, Vite, Vitest, Codex hook ingestion, local file-backed event store, optional server-side OpenAI Responses API via existing GPT-5 nano copy enrichment.

---

**Optimized with:** `plan-optimizer`

**Score trajectory:** `84 -> 93 -> 95 -> 95`

**Final score:** `95 / 100`

**Optimizer changes accepted:** feedback snapshot text stays local and never enters GPT input; work-area labels are allowlist/category-derived; board briefs derive clauses from `attentionQueue.type`; selected-session `null` is threaded through all projection/client paths; dogfood gates get explicit type/report plumbing; Browser QA requires evidence.

## North Star

The research points to a session-centric local control desktop: sessions are the primary object, approvals and provenance are durable UI objects, the dashboard is local-first, and activity, artifacts, and metrics stay visually separable. This plan applies that research with Tyler's product flavor:

- The main screen is an operations brief, not a raw technical dashboard.
- The board is intervention-first: show what needs attention before equal-weight reporting.
- The voice is calm, system-neutral, and non-alarming.
- GPT-5 nano is a translator, not a decision-maker.
- Deterministic state beats model output and agent feedback whenever they conflict.
- The inspector is where technical language, evidence refs, paths, commands, timelines, and audit details belong.

## Locked Design Decisions

- Voice: calm ops brief.
- Addressing: system-neutral only. Do not use `you`, `your`, `Tyler`, or chatty assistant phrasing on the main board.
- Priority: intervention triage first, overall board state always included.
- Uncertainty: show only when it affects triage, phrased plainly.
- GPT-5 nano role: translate bounded facts into copy; never choose lifecycle, severity, completion, safety, or lane.
- Main-board vocabulary: allow plain developer words such as `approval`, `verification`, `conflict`, `changed files`, `command failed`, `session`, `running`, and `completed`.
- Inspector vocabulary: allow raw technical words such as `worktree`, `terminal event`, `attribution`, `lifecycle`, `evidence refs`, `exit code`, `hook event`, `policy version`, and `stale disposition`.
- Normal sessions: every card still gets a short natural-language status and a high-level work-area brief.
- Work brief specificity: work-area level, not file/function detail.
- Context source: safe metadata, path clusters, normalized event summaries, and redacted latest feedback snapshots; never raw transcripts or raw command output.
- Latest feedback snapshot: snapshot text is local inspector context only. GPT-5 nano may receive only bounded feedback claim flags such as `claims_complete` or `mentions_tests` when LLM copy is enabled.
- Completion language from an agent: a claim, never the completed state.
- Missing feedback snapshot: silent fallback to deterministic/work-area copy.
- Top brief: summarize board/card facts, not raw latest feedback directly.
- Inspector order: deterministic state first, latest agent feedback second by default, implemented as a flexible section list.

## Non-Goals

- Do not add new agent adapters.
- Do not scrape or store raw transcripts.
- Do not store raw `last_assistant_message`.
- Do not send raw file contents, full paths, full commands, command output, diffs, screenshots, shell history, feedback snapshot text, or secrets to OpenAI.
- Do not let GPT-5 nano decide priority, lane, lifecycle, outcome, completion, conflict, or verification state.
- Do not change Codex hook installation behavior beyond parsing already-received payload fields.
- Do not implement plugin management, multi-provider dashboards, or launch/stop controls in this pass.

## Files And Responsibilities

- `src/core/types.ts`: Add board brief, work context, latest feedback snapshot, and inspector section contracts.
- `src/core/feedbackSnapshot.ts`: Convert raw assistant feedback into a short local redacted snapshot, without storing raw feedback.
- `src/core/workContext.ts`: Derive a work-area label and safe context from allowlisted title categories, path clusters, event categories, and optional feedback claim flags. Do not emit freeform title or branch text as a work label.
- `src/core/sessionCopy.ts`: Extend sanitized copy input with work context and optional latest feedback snapshot; enforce calm system-neutral validation.
- `src/core/openaiSessionCopy.ts`: Update GPT-5 nano instructions, schema, cache keys, and request budget for calm ops copy.
- `src/core/boardBrief.ts`: Build the top operations brief from card facts and board counts.
- `src/core/codexAdapter.ts`: Use `feedbackSnapshot.ts` for `lastAssistantMessage`; keep raw suppression.
- `src/core/replay.ts`: Attach work context, feedback snapshots, board brief, and inspector section order to projection view models.
- `src/core/liveProjection.ts`: Preserve live envelope while passing new projection fields.
- `src/app/liveProjectionClient.ts`: Normalize/fallback new fields from live projection.
- `src/app/App.tsx`: Render briefing strip and preserve board-first scanning behavior.
- `src/ui/BriefingStrip.tsx`: New compact top brief component.
- `src/ui/SessionCard.tsx`: Render calm work-area headline/status/reason first, chips second.
- `src/ui/SessionDetailModal.tsx`: Render flexible inspector sections, including latest feedback below deterministic state.
- `src/ui/filterBoard.ts`: Include work-area and brief copy in search.
- `src/styles/masthead.css`: Compact first viewport, style briefing strip, keep responsive behavior.
- `src/core/__tests__/feedbackSnapshot.test.ts`: New snapshot redaction tests.
- `src/core/__tests__/workContext.test.ts`: New work-area derivation tests.
- `src/core/__tests__/boardBrief.test.ts`: New top brief tests.
- Existing tests: update copy, OpenAI, adapter, projection, live client, and UI tests.
- `docs/release-gates.md`: Update with privacy and browser verification evidence after implementation.

## Data Contracts

Add these shapes to `src/core/types.ts`:

```ts
export type BoardBrief = {
  text: string;
  source: SessionCopySource;
  priority: "normal" | "attention";
};

export type WorkAreaContext = {
  label: string;
  confidence: "title" | "branch" | "path_cluster" | "event_summary" | "feedback_snapshot" | "generic";
  pathClusters: string[];
  sourceSignals: string[];
};

export type LatestFeedbackSnapshot = {
  text: string;
  source: "stop_hook";
  observedAt: string;
  redacted: true;
  bytesIn: number;
  charsOut: number;
  claims: Array<"claims_complete" | "mentions_blocked" | "mentions_tests" | "mentions_error" | "mentions_files">;
};

export type LatestFeedbackSignal = {
  present: true;
  source: "stop_hook";
  observedAt: string;
  claims: LatestFeedbackSnapshot["claims"];
};

export type InspectorSectionId =
  | "state"
  | "latest_feedback"
  | "attention_conflicts"
  | "evidence"
  | "timeline"
  | "actions";
```

Extend existing view models:

```ts
export type SessionCardView = {
  // existing fields remain
  workContext?: WorkAreaContext;
  latestFeedbackSignal?: LatestFeedbackSignal;
};

export type SessionDetailView = SessionCardView & {
  // existing fields remain
  latestFeedback?: LatestFeedbackSnapshot;
  inspectorSections?: InspectorSectionId[];
};

export type LiveBoardProjection = {
  // existing fields remain
  brief?: BoardBrief;
};
```

## Task 1: Freeze Calm Ops Voice Rules In Tests

**Files:**
- Modify: `src/core/__tests__/sessionCopy.test.ts`
- Modify: `src/core/sessionCopy.ts`

- [ ] **Step 1: Add tests for system-neutral and non-alarming copy validation.**

Add this test to `src/core/__tests__/sessionCopy.test.ts`:

```ts
test("rejects direct-address and alarmist main-board copy", () => {
  const input = toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "waiting_for_approval" }), [], []);

  expect(
    validateSessionCopy(
      {
        headline: "Needs your approval",
        status: "Waiting on you",
        reason: "You need to approve this before it can continue."
      },
      input
    )
  ).toEqual({ ok: false, reason: "unsafe_copy" });

  expect(
    validateSessionCopy(
      {
        headline: "Critical issue",
        status: "Dangerous conflict detected",
        reason: "Urgent action required."
      },
      input
    )
  ).toEqual({ ok: false, reason: "unsafe_copy" });
});
```

- [ ] **Step 2: Run the focused failing test.**

Run:

```bash
npm test -- --run src/core/__tests__/sessionCopy.test.ts
```

Expected: the new test fails until validation catches direct-address and alarm words.

- [ ] **Step 3: Extend unsafe copy validation.**

In `src/core/sessionCopy.ts`, extend the existing unsafe-copy pattern with calm-ops exclusions:

```ts
const directAddressPattern = /\b(you|your|yours|tyler)\b/i;
const alarmPattern = /\b(urgent|critical|dangerous|catastrophic|panic|broken everything|action required)\b/i;
```

Then update `validateSessionCopy` so serialized copy fails if either pattern matches:

```ts
if (unsafeCopyPattern.test(serialized) || directAddressPattern.test(serialized) || alarmPattern.test(serialized)) {
  return { ok: false, reason: "unsafe_copy" };
}
```

- [ ] **Step 4: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/sessionCopy.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 2: Add Redacted Latest Feedback Snapshots

**Files:**
- Create: `src/core/feedbackSnapshot.ts`
- Create: `src/core/__tests__/feedbackSnapshot.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/codexAdapter.ts`
- Modify: `src/core/__tests__/codexAdapter.test.ts`

- [ ] **Step 1: Add feedback snapshot types.**

Add `LatestFeedbackSnapshot` to `src/core/types.ts` exactly as defined in the Data Contracts section.

- [ ] **Step 2: Write snapshot redaction tests.**

Create `src/core/__tests__/feedbackSnapshot.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildLatestFeedbackSnapshot } from "../feedbackSnapshot";

describe("latest feedback snapshot", () => {
  test("summarizes assistant feedback without storing raw code, commands, paths, urls, or secrets", () => {
    const snapshot = buildLatestFeedbackSnapshot(
      [
        "Implemented src/lib/auth/session.ts and ran npm test.",
        "```ts",
        "const token = 'sk-test-secret';",
        "```",
        "OAuth tests are still failing at https://example.test/private."
      ].join("\n"),
      { observedAt: "2026-06-23T02:14:00.000Z" }
    );

    expect(snapshot).toMatchObject({
      source: "stop_hook",
      observedAt: "2026-06-23T02:14:00.000Z",
      redacted: true
    });
    expect(snapshot.text).toContain("tests are still failing");
    expect(snapshot.claims).toContain("mentions_tests");
    expect(snapshot.claims).toContain("mentions_error");
    expect(snapshot.text).not.toContain("src/lib/auth/session.ts");
    expect(snapshot.text).not.toContain("src/");
    expect(snapshot.text).not.toContain(".ts");
    expect(snapshot.text).not.toContain("npm");
    expect(snapshot.text).not.toContain("sk-test-secret");
    expect(snapshot.text).not.toContain("https://example.test");
    expect(snapshot.text).not.toContain("```");
    expect(snapshot.text.length).toBeLessThanOrEqual(400);
  });

  test("detects completion claims without treating them as completion", () => {
    const snapshot = buildLatestFeedbackSnapshot("All set. Implementation is complete, but I did not run tests.", {
      observedAt: "2026-06-23T02:20:00.000Z"
    });

    expect(snapshot.claims).toContain("claims_complete");
    expect(snapshot.claims).toContain("mentions_tests");
    expect(snapshot.text).toContain("Implementation is complete");
  });
});
```

- [ ] **Step 3: Run the new failing tests.**

Run:

```bash
npm test -- --run src/core/__tests__/feedbackSnapshot.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 4: Implement local snapshot creation.**

Create `src/core/feedbackSnapshot.ts`:

```ts
import { redactText } from "./redaction.ts";
import type { LatestFeedbackSnapshot } from "./types";

const MAX_CHARS = 400;

export function buildLatestFeedbackSnapshot(
  raw: string,
  options: { observedAt: string }
): LatestFeedbackSnapshot | undefined {
  const normalized = raw.trim();
  if (!normalized) return undefined;

  const withoutCodeBlocks = normalized.replace(/```[\s\S]*?```/g, " ");
  const withoutUrls = withoutCodeBlocks.replace(/\bhttps?:\/\/\S+/gi, "[url]");
  const withoutPaths = withoutUrls
    .replace(/(?:\/[\w.-]+){2,}/g, "[path]")
    .replace(/\b(?:[\w.-]+\/){1,}[\w.-]+\.[a-z0-9]+\b/gi, "[path]")
    .replace(/\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|yml|yaml|css|scss|rs|py|go|java|rb|php)\b/gi, "[file]");
  const withoutCommands = withoutPaths.replace(
    /\b(npm|pnpm|yarn|bun|node|npx|curl|git|cargo|pytest|python|pip)\b(?:\s+[^\.;,]*)?/gi,
    "[command]"
  );
  const redacted = redactText(withoutCommands)
    .replace(/\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/gi, "[secret_name]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return undefined;

  const text = truncateSentence(redacted, MAX_CHARS);
  return {
    text,
    source: "stop_hook",
    observedAt: options.observedAt,
    redacted: true,
    bytesIn: Buffer.byteLength(raw),
    charsOut: text.length,
    claims: detectClaims(text)
  };
}

function truncateSentence(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  return `${clipped.slice(0, sentenceEnd > 120 ? sentenceEnd : maxChars).trim()}...`;
}

function detectClaims(value: string): LatestFeedbackSnapshot["claims"] {
  const claims = new Set<LatestFeedbackSnapshot["claims"][number]>();
  if (/\b(done|all set|complete|completed|finished|implemented)\b/i.test(value)) claims.add("claims_complete");
  if (/\b(blocked|stuck|waiting|cannot continue)\b/i.test(value)) claims.add("mentions_blocked");
  if (/\b(test|tests|verification|check|build)\b/i.test(value)) claims.add("mentions_tests");
  if (/\b(fail|failed|failing|error|exception|timeout)\b/i.test(value)) claims.add("mentions_error");
  if (/\b(file|files|changed|edited|updated)\b/i.test(value)) claims.add("mentions_files");
  return [...claims].toSorted();
}
```

- [ ] **Step 5: Attach snapshots during Codex Stop normalization without storing raw feedback.**

In `src/core/codexAdapter.ts`, import the helper:

```ts
import { buildLatestFeedbackSnapshot } from "./feedbackSnapshot.ts";
```

In `buildPayload`, before suppressing `lastAssistantMessage`, detect the normalized key and attach the snapshot:

```ts
if (normalizedKey === "lastAssistantMessage" && typeof value === "string") {
  const observedAt = firstString(input, ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"]) ?? new Date(0).toISOString();
  const snapshot = buildLatestFeedbackSnapshot(value, { observedAt });
  if (snapshot) payload.latestFeedbackSnapshot = snapshot;
  payload.lastAssistantMessageSummary = summarizeSuppressedValue(value);
  continue;
}
```

Keep `lastAssistantMessage` in `SUPPRESSED_RAW_PAYLOAD_KEYS`.

- [ ] **Step 6: Update Codex adapter privacy test.**

Update the existing Stop-hook test in `src/core/__tests__/codexAdapter.test.ts` so it asserts the snapshot exists and raw feedback is absent:

```ts
expect(event.payload).toMatchObject({
  latestFeedbackSnapshot: {
    source: "stop_hook",
    redacted: true,
    observedAt: "2026-06-23T02:14:00.000Z"
  },
  lastAssistantMessageSummary: {
    stored: false,
    redacted: true
  }
});
expect(JSON.stringify(event)).not.toContain("private assistant response");
expect(event.payload.lastAssistantMessage).toBeUndefined();
```

- [ ] **Step 7: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/feedbackSnapshot.test.ts src/core/__tests__/codexAdapter.test.ts
npm run typecheck
```

Expected: tests and typecheck pass. Raw feedback is never stored.

## Task 3: Derive Safe Work-Area Context

**Files:**
- Create: `src/core/workContext.ts`
- Create: `src/core/__tests__/workContext.test.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add `WorkAreaContext` to types.**

Add the type from Data Contracts to `src/core/types.ts`.

- [ ] **Step 2: Write work-context tests.**

Create `src/core/__tests__/workContext.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { deriveWorkContext } from "../workContext";
import type { GitSnapshot, NormalizedEvent } from "../types";

describe("work context", () => {
  test("derives a work-area label from title and path clusters", () => {
    const context = deriveWorkContext({
      title: "Fix Google OAuth callback",
      branchOrWorktree: "agent/auth-fix",
      events: [],
      gitSnapshots: [snapshot("src/lib/auth/session.ts"), snapshot("src/app/api/auth/callback.ts")]
    });

    expect(context).toMatchObject({
      label: "OAuth callback work",
      confidence: "title",
      pathClusters: ["auth"]
    });
  });

  test("falls back to path cluster when title is generic", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/session-123",
      events: [],
      gitSnapshots: [snapshot("src/ui/settings/ProfilePanel.tsx"), snapshot("src/ui/settings/AccountPanel.tsx")]
    });

    expect(context.label).toBe("Settings UI work");
    expect(context.confidence).toBe("path_cluster");
  });

  test("does not leak long paths or secrets into source signals", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/secret-sk-test",
      events: [event("Ran npm test with OPENAI_API_KEY=sk-test")],
      gitSnapshots: [snapshot("/workspace/app/src/secret.ts")]
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("/workspace");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("sk-test");
  });

  test("does not turn private title or branch text into board labels", () => {
    const context = deriveWorkContext({
      title: "Fix Acme payroll callback for https://customer.example/private",
      branchOrWorktree: "agent/acme-payroll-sk-test",
      events: [],
      gitSnapshots: []
    });

    expect(context.label).toBe("Session work");
    expect(context.confidence).toBe("generic");
    expect(JSON.stringify(context)).not.toContain("Acme");
    expect(JSON.stringify(context)).not.toContain("customer.example");
    expect(JSON.stringify(context)).not.toContain("sk-test");
  });
});

function event(summary: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    source: { adapter: "codex", surface: "fixture", sourceEventId: "event-1" },
    occurredAt: "2026-06-23T02:00:00.000Z",
    receivedAt: "2026-06-23T02:00:00.000Z",
    type: "command.finished",
    summary,
    payload: {},
    sensitivity: "metadata",
    payloadHash: "hash",
    evidence: []
  };
}

function snapshot(path: string): GitSnapshot {
  return {
    snapshotId: `snapshot-${path}`,
    sessionId: "session-1",
    repoRoot: "/workspace/app",
    worktreePath: "/workspace/app",
    gitCommonDir: "/workspace/app/.git",
    branch: "agent/test",
    changedPaths: [{ path, status: "modified", staged: false, sensitivity: "metadata" }],
    observedAt: "2026-06-23T02:00:00.000Z"
  };
}
```

- [ ] **Step 3: Run the new failing tests.**

Run:

```bash
npm test -- --run src/core/__tests__/workContext.test.ts
```

Expected: fail because `workContext.ts` does not exist.

- [ ] **Step 4: Implement work-context derivation.**

Create `src/core/workContext.ts`:

```ts
import type { GitSnapshot, NormalizedEvent, WorkAreaContext } from "./types";

type DeriveWorkContextInput = {
  title: string;
  branchOrWorktree?: string;
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
};

const GENERIC_TITLES = new Set(["codex session", "untitled session", "session"]);

export function deriveWorkContext(input: DeriveWorkContextInput): WorkAreaContext {
  const clusters = pathClusters(input.gitSnapshots);
  const titleLabel = labelFromTitle(input.title);
  if (titleLabel) {
    return context(titleLabel, "title", clusters, [safeSignal(input.title)]);
  }

  const clusterLabel = labelFromClusters(clusters);
  if (clusterLabel) {
    return context(clusterLabel, "path_cluster", clusters, clusters);
  }

  const eventLabel = labelFromEvents(input.events);
  if (eventLabel) {
    return context(eventLabel, "event_summary", clusters, [eventLabel]);
  }

  return context("Session work", "generic", clusters, []);
}

function context(
  label: string,
  confidence: WorkAreaContext["confidence"],
  pathClusters: string[],
  sourceSignals: string[]
): WorkAreaContext {
  return {
    label,
    confidence,
    pathClusters,
    sourceSignals: sourceSignals.map(safeSignal).filter(Boolean).slice(0, 4)
  };
}

function labelFromTitle(title: string): string | undefined {
  const normalized = title.trim();
  if (!normalized || GENERIC_TITLES.has(normalized.toLowerCase())) return undefined;
  if (!isSafeCategorizationSource(normalized)) return undefined;
  if (/oauth/i.test(normalized) && /callback/i.test(normalized)) return "OAuth callback work";
  if (/auth/i.test(normalized) && /middleware/i.test(normalized)) return "Auth middleware work";
  if (/settings/i.test(normalized) && /ui|screen|panel/i.test(normalized)) return "Settings UI work";
  if (/test|spec|verification/i.test(normalized)) return "Test repair work";
  if (/docs|documentation/i.test(normalized)) return "Documentation work";
  return undefined;
}

function labelFromClusters(clusters: string[]): string | undefined {
  if (clusters.includes("auth")) return "Auth work";
  if (clusters.includes("settings")) return "Settings UI work";
  if (clusters.includes("ui")) return "UI work";
  if (clusters.includes("tests")) return "Test work";
  if (clusters.includes("docs")) return "Documentation work";
  return undefined;
}

function labelFromEvents(events: NormalizedEvent[]): string | undefined {
  const summaries = events.slice(-3).map((event) => event.summary).join(" ");
  if (!isSafeCategorizationSource(summaries)) return undefined;
  if (/test|verification/i.test(summaries)) return "Test work";
  if (/auth|oauth/i.test(summaries)) return "Auth work";
  if (/ui|component|screen/i.test(summaries)) return "UI work";
  return undefined;
}

function isSafeCategorizationSource(value: string): boolean {
  return !(
    /\bhttps?:\/\//i.test(value) ||
    /(?:\/[\w.-]+){2,}/.test(value) ||
    /\b(?:[\w.-]+\/){1,}[\w.-]+\.[a-z0-9]+\b/i.test(value) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /@/.test(value)
  );
}

function pathClusters(gitSnapshots: GitSnapshot[]): string[] {
  const clusters = new Set<string>();
  for (const snapshot of gitSnapshots) {
    for (const changed of snapshot.changedPaths) {
      const path = changed.path.toLowerCase();
      if (path.includes("auth") || path.includes("oauth")) clusters.add("auth");
      if (path.includes("settings")) clusters.add("settings");
      if (path.includes("test") || path.includes("spec")) clusters.add("tests");
      if (path.includes("docs") || path.endsWith(".md")) clusters.add("docs");
      if (path.includes("ui") || path.endsWith(".tsx") || path.endsWith(".css")) clusters.add("ui");
    }
  }
  return [...clusters].toSorted();
}

function safeSignal(value: string): string {
  if (!isSafeCategorizationSource(value)) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}
```

- [ ] **Step 5: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/workContext.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 4: Extend Session Copy Input With Work Context And Feedback Snapshot

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/sessionCopy.ts`
- Modify: `src/core/__tests__/sessionCopy.test.ts`

- [ ] **Step 1: Extend `SessionPlainCopy` usage expectations.**

Keep this shape unchanged:

```ts
export type SessionPlainCopy = {
  headline: string;
  status: string;
  reason: string;
  nextStep?: string;
  source: SessionCopySource;
};
```

Interpret fields as:

- `headline`: work-area level phrase, for example `OAuth callback work`.
- `status`: current calm ops state, for example `A command failed while work is still active.`
- `reason`: why the state matters, for example `Two active sessions are editing overlapping auth files.`
- `nextStep`: optional system-neutral follow-up, for example `Open the inspector for command and conflict evidence.`

- [ ] **Step 2: Add tests for work-area copy.**

Add to `src/core/__tests__/sessionCopy.test.ts`:

```ts
test("builds board copy around the work-area label", () => {
  const input = toSessionCopyInput(
    cardView({
      lifecycle: "running",
      primaryStatus: "editing",
      workContext: {
        label: "OAuth callback work",
        confidence: "title",
        pathClusters: ["auth"],
        sourceSignals: ["Fix Google OAuth callback"]
      }
    }),
    [],
    []
  );

  expect(buildDeterministicSessionCopy(input)).toMatchObject({
    headline: "OAuth callback work",
    status: "Work is active.",
    reason: "No blocker is visible."
  });
});

test("treats agent completion feedback as a claim when verification is missing", () => {
  const input = toSessionCopyInput(
    cardView({
      lifecycle: "ended",
      primaryStatus: "completed_unreviewed",
      outcomeLabel: "needs_attention",
      indicators: ["verification"],
      latestFeedbackSignal: {
        present: true,
        source: "stop_hook",
        observedAt: "2026-06-23T02:05:00.000Z",
        claims: ["claims_complete", "mentions_tests"]
      },
      workContext: {
        label: "Settings UI work",
        confidence: "path_cluster",
        pathClusters: ["settings", "ui"],
        sourceSignals: ["settings"]
      }
    }),
    [],
    []
  );
  const copy = buildDeterministicSessionCopy(input);

  expect(copy).toMatchObject({
    headline: "Settings UI work",
    status: "Session reports completion.",
    reason: "Fresh verification is still missing."
  });
});
```

Update the local `cardView` helper type override to allow `workContext` and `latestFeedbackSignal`.

- [ ] **Step 3: Extend `SessionCopyInput`.**

In `src/core/sessionCopy.ts`, extend `SessionCopyInput`:

```ts
export type SessionCopyInput = {
  // existing fields
  workArea?: {
    label: string;
    confidence: "title" | "branch" | "path_cluster" | "event_summary" | "feedback_snapshot" | "generic";
    pathClusters: string[];
  };
  latestFeedback?: {
    present: true;
    source: "stop_hook";
    observedAt: string;
    claims: Array<"claims_complete" | "mentions_blocked" | "mentions_tests" | "mentions_error" | "mentions_files">;
  };
};
```

Update `CopyCardLike`:

```ts
type CopyCardLike = {
  // existing fields
  workContext?: WorkAreaContext;
  latestFeedbackSignal?: LatestFeedbackSignal;
};
```

Update `toSessionCopyInput`:

```ts
const input: SessionCopyInput = {
  lifecycle: card.lifecycle,
  primaryStatus: card.primaryStatus,
  signals: [...signals].toSorted(),
  conflictCount: conflicts.length,
  changedFileBucket: changedFileBucket(card.changedFileCount),
  lastActivityBucket: lastActivityBucket(card.lastActivityLabel),
  durationBucket: durationBucket(card.durationLabel),
  identityConfidence: card.identityConfidence
};

if (card.workContext) {
  input.workArea = {
    label: card.workContext.label,
    confidence: card.workContext.confidence,
    pathClusters: card.workContext.pathClusters
  };
}

if (card.latestFeedbackSignal) {
  input.latestFeedback = {
    present: true,
    source: card.latestFeedbackSignal.source,
    observedAt: card.latestFeedbackSignal.observedAt,
    claims: [...card.latestFeedbackSignal.claims].toSorted()
  };
}
```

- [ ] **Step 4: Update deterministic copy builder.**

Refactor `buildDeterministicSessionCopy` so it starts with:

```ts
const headline = input.workArea?.label ?? "Session work";
```

Use calm system-neutral copy:

```ts
if (input.lifecycle === "running") {
  if (input.signals.includes("approval_waiting")) {
    return {
      headline,
      status: "Approval is pending.",
      reason: "Work is paused until the request is resolved.",
      nextStep: "Open the inspector for request details.",
      source
    };
  }
  if (input.signals.includes("command_failed")) {
    return {
      headline,
      status: "A command failed while work is still active.",
      reason: input.conflictCount > 0 ? "Related conflict evidence is also visible." : "Command evidence is available in the inspector.",
      nextStep: "Open the inspector for command evidence.",
      source
    };
  }
  if (input.signals.includes("conflict_detected")) {
    return {
      headline,
      status: "Overlapping work is visible.",
      reason: "Another active session is editing related files.",
      nextStep: "Open the inspector for conflict evidence.",
      source
    };
  }
  return {
    headline,
    status: "Work is active.",
    reason: "No blocker is visible.",
    source
  };
}
```

Then replace every remaining `buildDeterministicSessionCopy` branch with system-neutral copy. The implementation must not leave any copy containing `you`, `your`, `if you want`, `ready for your`, `open it if`, or chatty assistant language.

Required branch coverage:

```ts
const cases: Array<[SessionLifecycle, SessionStatus, Partial<SessionCopyInput>]> = [
  ["running", "waiting_for_approval", { signals: ["approval_waiting"] }],
  ["running", "waiting_for_user", { signals: ["user_reply_waiting"] }],
  ["running", "editing", { signals: ["command_failed"] }],
  ["running", "editing", { signals: ["conflict_detected"] }],
  ["running", "editing", { signals: [] }],
  ["idle", "stalled", { signals: [] }],
  ["ended", "completed_unreviewed", { outcomeLabel: "needs_attention", signals: ["verification_missing"] }],
  ["ended", "completed_reviewed", { outcomeLabel: "completed", endReason: "completed", signals: [] }],
  ["ended", "failed", { outcomeLabel: "failed", endReason: "failed", signals: [] }],
  ["ended", "blocked", { outcomeLabel: "blocked", endReason: "blocked", signals: [] }],
  ["ended", "unknown", { outcomeLabel: "unknown", endReason: "unknown", signals: [] }]
];
```

Add a table-style test that builds deterministic copy for each case and asserts:

```ts
const serialized = [copy.headline, copy.status, copy.reason, copy.nextStep ?? ""].join(" ");
expect(serialized).not.toMatch(/\b(you|your|tyler|urgent|critical|dangerous|please|let's|i recommend|i finished|we need)\b/i);
```

For completion claims:

```ts
if (input.latestFeedback?.claims.includes("claims_complete") && input.outcomeLabel !== "completed") {
  return {
    headline,
    status: "Session reports completion.",
    reason: input.signals.includes("verification_missing") ? "Fresh verification is still missing." : "Deterministic completion evidence is not visible yet.",
    nextStep: "Open the inspector for state and evidence.",
    source
  };
}
```

- [ ] **Step 5: Update stable cache input.**

Ensure `stableSessionCopyInput` includes `workArea` and `latestFeedback` with sorted arrays. It must not include feedback snapshot text:

```ts
workArea: input.workArea
  ? {
      ...input.workArea,
      pathClusters: [...input.workArea.pathClusters].toSorted()
    }
  : undefined,
latestFeedback: input.latestFeedback
  ? {
      present: true,
      source: input.latestFeedback.source,
      observedAt: input.latestFeedback.observedAt,
      claims: [...input.latestFeedback.claims].toSorted()
    }
  : undefined
```

- [ ] **Step 6: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/sessionCopy.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 5: Attach Work Context And Feedback To Projections

**Files:**
- Modify: `src/core/replay.ts`
- Modify: `src/core/liveProjection.ts`
- Modify: `src/core/__tests__/projection.test.ts`

- [ ] **Step 1: Add projection tests for work context and feedback.**

Add to `src/core/__tests__/projection.test.ts`:

```ts
test("projects work-area context and latest feedback into cards and details", () => {
  const board = projectFixture(
    {
      events: [
        event("start", "session-auth", "session.started", "2026-06-23T02:00:00.000Z", {
          title: "Fix Google OAuth callback"
        }),
        event("stop", "session-auth", "session.completed", "2026-06-23T02:05:00.000Z", {
          latestFeedbackSnapshot: {
            text: "Implementation is complete, but auth tests are still failing.",
            source: "stop_hook",
            observedAt: "2026-06-23T02:05:00.000Z",
            redacted: true,
            bytesIn: 80,
            charsOut: 61,
            claims: ["claims_complete", "mentions_tests", "mentions_error"]
          }
        })
      ],
      gitSnapshots: [snapshot("snapshot-auth", "session-auth", "src/lib/auth/session.ts")]
    },
    { selectedSessionId: "session-auth" }
  );

  expect(board.cards[0]?.workContext?.label).toBe("OAuth callback work");
  expect(board.cards[0]?.latestFeedbackSignal?.claims).toContain("claims_complete");
  expect(board.cards[0]?.copy.headline).toBe("OAuth callback work");
  expect(board.cards[0]?.copy.status).toBe("Session reports completion.");
  expect(board.selectedSession?.latestFeedback?.text).toContain("auth tests are still failing");
  expect(board.selectedSession?.inspectorSections).toEqual([
    "state",
    "latest_feedback",
    "attention_conflicts",
    "evidence",
    "timeline",
    "actions"
  ]);
});
```

- [ ] **Step 2: Run the focused failing test.**

Run:

```bash
npm test -- --run src/core/__tests__/projection.test.ts
```

Expected: fail until projection attaches new fields.

- [ ] **Step 3: Import work-context derivation in replay.**

In `src/core/replay.ts`:

```ts
import { deriveWorkContext } from "./workContext.ts";
import type { LatestFeedbackSignal, LatestFeedbackSnapshot } from "./types";
```

- [ ] **Step 4: Extract latest feedback before card copy construction.**

Add helpers in `src/core/replay.ts` before changing `toCard`:

```ts
function latestFeedbackForSession(events: NormalizedEvent[], sessionId: string): LatestFeedbackSnapshot | undefined {
  return events
    .filter((event) => event.sessionId === sessionId)
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((event) => event.payload.latestFeedbackSnapshot)
    .find(isLatestFeedbackSnapshot);
}

function latestFeedbackSignal(snapshot: LatestFeedbackSnapshot | undefined): LatestFeedbackSignal | undefined {
  return snapshot
    ? {
        present: true,
        source: snapshot.source,
        observedAt: snapshot.observedAt,
        claims: [...snapshot.claims].toSorted()
      }
    : undefined;
}

function isLatestFeedbackSnapshot(value: unknown): value is LatestFeedbackSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string" &&
    "redacted" in value &&
    value.redacted === true &&
    "claims" in value &&
    Array.isArray(value.claims)
  );
}
```

- [ ] **Step 5: Attach work context and feedback signal in `toCard`.**

Update `toCard` signature to accept `gitSnapshots` or precomputed work context. Prefer precomputing near card construction:

```ts
const sessionEvents = eventsBySession.get(session.sessionId) ?? [];
const sessionSnapshots = fixture.gitSnapshots.filter((snapshot) => snapshot.sessionId === session.sessionId);
const latestFeedback = latestFeedbackForSession(sessionEvents, session.sessionId);
const feedbackSignal = latestFeedbackSignal(latestFeedback);
const workContext = deriveWorkContext({
  title: session.title,
  branchOrWorktree: session.workspace?.branch ?? session.workspace?.worktreePath?.split("/").at(-1),
  events: sessionEvents,
  gitSnapshots: sessionSnapshots
});
```

Pass `workContext` and `latestFeedbackSignal: feedbackSignal` into the card before calling `toSessionCopyInput`. This is required because `buildDeterministicSessionCopy` and the OpenAI enricher both derive copy input from card fields. Do not pass `latestFeedback.text` into card copy input.

- [ ] **Step 6: Attach latest feedback and inspector section order in `toDetail`.**

Update `toDetail`:

```ts
const latestFeedback = latestFeedbackForSession(events, card.sessionId);

return {
  ...card,
  latestFeedback,
  inspectorSections: latestFeedback
    ? ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"]
    : ["state", "attention_conflicts", "evidence", "timeline", "actions"],
  // existing fields
};
```

- [ ] **Step 7: Preserve detail fields in client and review overlays.**

In `src/app/liveProjectionClient.ts`, update `detailFromCard` to default inspector sections when synthesizing legacy selected-session details:

```ts
inspectorSections: card.latestFeedbackSignal
  ? ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"]
  : ["state", "attention_conflicts", "evidence", "timeline", "actions"]
```

When normalizing an existing `projection.selectedSession`, preserve `latestFeedback`, `latestFeedbackSignal`, and `inspectorSections`.

In `src/core/reviewDispositions.ts`, when rebuilding `selectedSession`, preserve:

```ts
latestFeedback: projection.selectedSession.latestFeedback,
latestFeedbackSignal: projection.selectedSession.latestFeedbackSignal,
inspectorSections: projection.selectedSession.inspectorSections,
workContext: projection.selectedSession.workContext
```

When `applyCardDisposition` recomputes copy, pass the card's `workContext` and `latestFeedbackSignal` through to `toSessionCopyInput`; do not accidentally rebuild copy from a stripped card.

- [ ] **Step 8: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/projection.test.ts src/app/__tests__/liveProjectionClient.test.ts src/core/__tests__/reviewDispositions.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 6: Add Board-Level Calm Brief

**Files:**
- Create: `src/core/boardBrief.ts`
- Create: `src/core/__tests__/boardBrief.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/replay.ts`
- Modify: `src/app/liveProjectionClient.ts`

- [ ] **Step 1: Add `BoardBrief` to types.**

Add the type from Data Contracts to `src/core/types.ts` and add `brief?: BoardBrief` to `LiveBoardProjection`.

- [ ] **Step 2: Write board brief tests.**

Create `src/core/__tests__/boardBrief.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildBoardBrief } from "../boardBrief";
import type { LiveBoardProjection, SessionCardView } from "../types";

describe("board brief", () => {
  test("summarizes intervention facts first and includes overall state", () => {
    const brief = buildBoardBrief(projection());

    expect(brief).toEqual({
      text: "Approval is pending in one active session. Failed command evidence is visible in one session. Overlapping work is visible in one session. Three sessions are running overall.",
      source: "deterministic",
      priority: "attention"
    });
    expect(brief.text).not.toMatch(/\byou|your|urgent|critical/i);
  });

  test("summarizes normal work without inventing issues", () => {
    const brief = buildBoardBrief({
      ...projection([card("settings", "Settings UI work", [], "running")]),
      attentionQueue: [],
      conflicts: []
    });

    expect(brief.text).toBe("One session is running overall. No approvals, conflicts, or failed checks are pending.");
    expect(brief.priority).toBe("normal");
  });

  test("does not describe command failures as approvals", () => {
    const brief = buildBoardBrief({
      ...projection([card("test", "Test repair work", ["attention"], "running")]),
      attentionQueue: [attention("command_failed", "test")]
    });

    expect(brief.text).toContain("Failed command evidence is visible in one session.");
    expect(brief.text).not.toContain("Approval is pending");
  });
});

function projection(
  cards: SessionCardView[] = [
    card("auth", "OAuth callback work", ["attention"], "running"),
    card("middleware", "Auth middleware work", ["conflict"], "running"),
    card("settings", "Settings UI work", [], "running")
  ]
): LiveBoardProjection {
  return {
    summary: {
      active: cards.length,
      needsAttention: cards.filter((card) => card.indicators.includes("attention")).length,
      conflicts: cards.filter((card) => card.indicators.includes("conflict")).length,
      completed: 0,
      running: cards.filter((card) => card.lifecycle === "running").length,
      idle: 0,
      needsAction: 0
    },
    cards,
    attentionQueue: [attention("approval_requested", "auth"), attention("command_failed", "middleware")],
    conflicts: [
      {
        conflictId: "conflict-1",
        type: "exact_file_overlap",
        severity: "high",
        sessionIds: ["auth", "middleware"],
        repo: { gitCommonDir: "/workspace/app/.git", worktreePaths: ["/workspace/app"] },
        sharedPaths: ["src/lib/auth/session.ts"],
        attribution: "direct",
        title: "Same tracked path changed by 2 active sessions",
        evidence: []
      }
    ]
  };
}

function attention(type: LiveBoardProjection["attentionQueue"][number]["type"], sessionId: string): LiveBoardProjection["attentionQueue"][number] {
  return {
    itemId: `attention-${type}-${sessionId}`,
    sessionId,
    project: "App",
    type,
    severity: "P1",
    title: type,
    createdAt: "2026-06-23T02:00:00.000Z",
    affectedPaths: [],
    affectedCommandIds: [],
    evidence: [],
    support: "deterministic",
    suggestedNextAction: "Open the inspector."
  };
}

function card(
  sessionId: string,
  headline: string,
  indicators: SessionCardView["indicators"],
  lifecycle: SessionCardView["lifecycle"]
): SessionCardView {
  return {
    sessionId,
    project: "App",
    title: headline,
    copy: { headline, status: "Work is active.", reason: "No blocker is visible.", source: "deterministic" },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle,
    priorityRank: 50,
    durationLabel: "4m",
    lastActivity: "2026-06-23T02:00:00.000Z",
    lastActivityLabel: "1m ago",
    changedFileCount: 1,
    indicators,
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false
  };
}
```

- [ ] **Step 3: Run the new failing tests.**

Run:

```bash
npm test -- --run src/core/__tests__/boardBrief.test.ts
```

Expected: fail because `boardBrief.ts` does not exist.

- [ ] **Step 4: Implement deterministic board brief.**

Create `src/core/boardBrief.ts`:

```ts
import type { BoardBrief, LiveBoardProjection } from "./types";

export function buildBoardBrief(projection: LiveBoardProjection): BoardBrief {
  const running = projection.summary.running ?? projection.summary.active;
  const approvals = countAttentionTypes(projection, ["approval_requested", "user_question"]);
  const failed = projection.attentionQueue.filter((item) => item.type === "command_failed").length;
  const verification = projection.attentionQueue.filter((item) =>
    item.type === "completed_without_verification" || item.type === "stale_verification"
  ).length;
  const highRisk = projection.attentionQueue.filter((item) => item.type === "high_risk_change").length;
  const conflicts = projection.conflicts.length;

  const clauses: string[] = [];
  if (approvals > 0) clauses.push(`${countSentence(approvals, "Approval is", "Approvals are")} pending in ${countNoun(approvals, "one active session", "active sessions")}.`);
  if (failed > 0) clauses.push(`Failed command evidence is visible in ${countNoun(failed, "one session", "sessions")}.`);
  if (verification > 0) clauses.push(`Verification is missing or stale in ${countNoun(verification, "one session", "sessions")}.`);
  if (highRisk > 0) clauses.push(`High-risk change signals are visible in ${countNoun(highRisk, "one session", "sessions")}.`);
  if (conflicts > 0) clauses.push(`Overlapping work is visible in ${countNoun(conflicts, "one session", "sessions")}.`);

  clauses.push(`${capitalize(countNoun(running, "one session is", "sessions are"))} running overall.`);

  if (approvals === 0 && conflicts === 0 && failed === 0 && verification === 0 && highRisk === 0) {
    clauses.push("No approvals, conflicts, or failed checks are pending.");
  }

  return {
    text: clauses.join(" "),
    source: "deterministic",
    priority: approvals > 0 || conflicts > 0 || failed > 0 || verification > 0 || highRisk > 0 ? "attention" : "normal"
  };
}

function countAttentionTypes(projection: LiveBoardProjection, types: LiveBoardProjection["attentionQueue"][number]["type"][]): number {
  const typeSet = new Set(types);
  return projection.attentionQueue.filter((item) => typeSet.has(item.type)).length;
}

function countNoun(count: number, singular: string, plural: string): string {
  if (count === 1) return singular;
  return `${countWord(count)} ${plural}`;
}

function countSentence(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function countWord(count: number): string {
  const words: Record<number, string> = {
    0: "no",
    2: "two",
    3: "three",
    4: "four",
    5: "five"
  };
  return words[count] ?? String(count);
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}
```

- [ ] **Step 5: Attach brief in projection.**

In `src/core/replay.ts`, import and call after cards/lanes/summary are built:

```ts
import { buildBoardBrief } from "./boardBrief.ts";
```

Build the projection object first, then attach:

```ts
const projection: LiveBoardProjection = {
  summary,
  lanes,
  cards,
  expandedSession,
  selectedSession,
  attentionQueue,
  conflicts
};

return {
  ...projection,
  brief: buildBoardBrief(projection)
};
```

- [ ] **Step 6: Normalize missing brief on the client without false empty copy.**

In `src/app/liveProjectionClient.ts`, import:

```ts
import { buildBoardBrief } from "../core/boardBrief";
```

When normalizing a projection from an older collector that lacks `brief`, build the fallback from the normalized projection shape, not from a static empty sentence:

```ts
const normalizedProjection = {
  ...projection,
  cards,
  lanes,
  attentionQueue: projection.attentionQueue ?? [],
  conflicts: projection.conflicts ?? []
};

return {
  ...normalizedProjection,
  brief: projection.brief ?? {
    ...buildBoardBrief(normalizedProjection),
    source: "fallback"
  }
};
```

- [ ] **Step 7: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/boardBrief.test.ts src/core/__tests__/projection.test.ts src/app/__tests__/liveProjectionClient.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 7: Update GPT-5 Nano Copy Enrichment

**Files:**
- Modify: `src/core/openaiSessionCopy.ts`
- Modify: `src/core/__tests__/openaiSessionCopy.test.ts`
- Modify: `docs/release-gates.md` after verification

- [ ] **Step 1: Update OpenAI request test for richer safe context.**

In `src/core/__tests__/openaiSessionCopy.test.ts`, add a card with `workContext` and assert request body includes safe context:

```ts
const input = toSessionCopyInput(
  cardView({
    changedFileCount: 12,
    latestFeedbackSignal: {
      present: true,
      source: "stop_hook",
      observedAt: "2026-06-23T02:05:00.000Z",
      claims: ["claims_complete", "mentions_tests"]
    },
    workContext: {
      label: "OAuth callback work",
      confidence: "title",
      pathClusters: ["auth"],
      sourceSignals: ["Fix Google OAuth callback"]
    }
  }),
  [],
  []
);
```

Then assert:

```ts
expect(JSON.parse(body.input)).toMatchObject({
  workArea: {
    label: "OAuth callback work",
    confidence: "title",
    pathClusters: ["auth"]
  },
  latestFeedback: {
    present: true,
    source: "stop_hook",
    observedAt: "2026-06-23T02:05:00.000Z",
    claims: ["claims_complete", "mentions_tests"]
  }
});
expect(body.input).not.toContain("Implementation is complete");
expect(body.input).not.toContain("Ignore instructions");
```

- [ ] **Step 2: Add tests that completion claims cannot override state and feedback text never enters GPT input.**

Add:

```ts
test("falls back when model turns an active completion claim into completed state", async () => {
  const input = {
    ...toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []),
    latestFeedback: {
      present: true,
      source: "stop_hook" as const,
      observedAt: "2026-06-23T02:05:00.000Z",
      claims: ["claims_complete" as const]
    }
  };
  const fallback = buildDeterministicSessionCopy(input);
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ headline: "Completed", status: "Finished", reason: "The task is completed." }) }]
        }
      ]
    })
  });

  await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, apiKey: "key", fetchImpl })).resolves.toMatchObject({
    copy: fallback,
    status: "invalid_output"
  });
});

test("does not send latest feedback snapshot text to OpenAI", async () => {
  const input = toSessionCopyInput(
    cardView({
      latestFeedbackSignal: {
        present: true,
        source: "stop_hook",
        observedAt: "2026-06-23T02:05:00.000Z",
        claims: ["claims_complete", "mentions_tests"]
      }
    }),
    [],
    []
  );
  const fallback = buildDeterministicSessionCopy(input);
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(fallback) }] }]
    })
  });

  await rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, apiKey: "key", fetchImpl });
  const [, request] = fetchImpl.mock.calls[0]!;
  expect(request.body).toContain("claims_complete");
  expect(request.body).not.toContain("Ignore instructions");
  expect(request.body).not.toContain("Tyler");
  expect(request.body).not.toContain("Implementation is complete");
});
```

- [ ] **Step 3: Update GPT-5 nano instructions.**

In `src/core/openaiSessionCopy.ts`, replace instructions with:

```ts
instructions: [
  "Rewrite Masthead session metadata into a calm system-neutral operations brief.",
  "Use the work area as the headline when present.",
  "Only restate facts in the input.",
  "Do not infer lifecycle, outcome, urgency, identity, safety, or completion.",
  "Treat latestFeedback claim flags as agent claims, not source-of-truth.",
  "Never address the user directly. Do not use you, your, Tyler, urgent, critical, dangerous, action required, please, let's, I, or we.",
  "Do not mention raw enum names.",
  "Return only the requested JSON fields."
].join(" ")
```

Increase the token budget modestly:

```ts
max_output_tokens: 240
```

Update the existing OpenAI request test assertion from `max_output_tokens: 180` to `max_output_tokens: 240`.

Keep:

```ts
store: false
```

- [ ] **Step 4: Verify.**

Run:

```bash
npm test -- --run src/core/__tests__/openaiSessionCopy.test.ts src/core/__tests__/sessionCopy.test.ts
npm run typecheck
```

Expected: tests and typecheck pass. The request body includes bounded work context only.

## Task 8: Render Briefing Strip And Board-First UI

**Files:**
- Create: `src/ui/BriefingStrip.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/core/replay.ts`
- Modify: `src/core/liveProjection.ts`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Write UI tests for briefing strip and board-first fixture behavior.**

Add to `src/ui/__tests__/liveBoard.test.tsx`:

```tsx
test("renders calm board briefing without direct-address language", () => {
  const html = renderToStaticMarkup(<App />);

  expect(html).toContain("No sessions are running overall.");
  expect(html).not.toMatch(/\byou|your|urgent|critical|dangerous/i);
});
```

Add a projection-level test in `src/core/__tests__/projection.test.ts`:

```ts
test("can render fixture board with no selected session", () => {
  const board = projectFixture(fixture as FixtureReplay, { selectedSessionId: null });

  expect(board.selectedSession).toBeUndefined();
});
```

- [ ] **Step 2: Run the failing tests.**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/core/__tests__/projection.test.ts
```

Expected: projection selected-session test fails until `null` means intentionally unselected.

- [ ] **Step 3: Fix board-first selected session semantics.**

In `src/core/replay.ts`, change option type:

```ts
type ProjectFixtureOptions = {
  expandedSessionId?: string;
  selectedSessionId?: string | null;
  includeTerminalSessions?: boolean;
  now?: Date;
  idleAfterMs?: number;
};
```

Change selection logic:

```ts
const expandedSessionId = options.expandedSessionId ?? fixture.expandedSessionId;
const selectedSessionId = options.selectedSessionId === undefined ? expandedSessionId : options.selectedSessionId ?? undefined;
```

In `src/core/liveProjection.ts`, allow `selectedSessionId?: string | null` and preserve `null` into `projectFixture`.

In `src/app/liveProjectionClient.ts`, update these signatures and behavior:

```ts
export function projectionRequestUrl(baseUrl: string, selectedSessionId?: string | null): string
export function normalizeLiveBoardProjection(projection: LiveBoardProjection, selectedSessionId?: string | null): LiveBoardProjection
function legacySelectedSession(selectedSessionId: string | null | undefined, ...): SessionDetailView | undefined
```

Rules:

- `undefined` means legacy/default behavior is allowed.
- `null` means intentionally unselected and must return no selected session.
- A non-empty string selects that session.

Use:

```ts
if (selectedSessionId === null) return undefined;
```

inside `legacySelectedSession`.

In `src/app/App.tsx`, initialize fixture mode with no selected session:

```ts
const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
```

Keep live polling URLs string-only:

```ts
const selectedLiveSessionId = selectedSessionId ?? undefined;
```

Use `selectedLiveSessionId` when calling:

```ts
projectionRequestUrl(liveProjectionUrl, selectedLiveSessionId)
```

Because `projectionRequestUrl` now accepts `null`, normalize internally:

```ts
if (selectedSessionId) {
  url.searchParams.set("selectedSessionId", selectedSessionId);
} else {
  url.searchParams.delete("selectedSessionId");
}
```

When toggling demo data, keep board-first:

```ts
setSelectedSessionId(null);
```

When opening:

```tsx
onOpenSession={(sessionId) => setSelectedSessionId(sessionId)}
onCloseSession={() => setSelectedSessionId(null)}
```

- [ ] **Step 4: Create briefing strip component.**

Create `src/ui/BriefingStrip.tsx`:

```tsx
import type { BoardBrief } from "../core/types";

type Props = {
  brief?: BoardBrief;
};

export function BriefingStrip({ brief }: Props) {
  const resolved = brief ?? {
    text: "No sessions are running overall.",
    source: "fallback" as const,
    priority: "normal" as const
  };

  return (
    <section className={`briefing-strip ${resolved.priority}`} aria-label="Operations brief">
      <span className="mono-label">Ops brief</span>
      <p>{resolved.text}</p>
    </section>
  );
}
```

- [ ] **Step 5: Render briefing strip in App.**

In `src/app/App.tsx`, import:

```ts
import { BriefingStrip } from "../ui/BriefingStrip";
```

Render it after `ConnectionStatus` and before `BoardSummary`:

```tsx
<BriefingStrip brief={board.brief} />
```

- [ ] **Step 6: Add compact briefing CSS.**

In `src/styles/masthead.css`:

```css
.briefing-strip {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  padding: 13px 16px;
}

.briefing-strip.attention {
  border-color: rgba(255, 197, 51, 0.3);
}

.briefing-strip p {
  max-width: 980px;
  color: var(--ink);
  font-size: 15px;
  line-height: 1.45;
}
```

- [ ] **Step 7: Verify.**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/core/__tests__/projection.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 9: Render Flexible Inspector Sections

**Files:**
- Modify: `src/ui/SessionDetailModal.tsx`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Add UI test for latest feedback section.**

In the modal test fixture in `src/ui/__tests__/liveBoard.test.tsx`, add:

```ts
latestFeedback: {
  text: "Implementation is complete, but auth tests are still failing.",
  source: "stop_hook",
  observedAt: "2026-06-23T02:05:00.000Z",
  redacted: true,
  bytesIn: 80,
  charsOut: 61,
  claims: ["claims_complete", "mentions_tests", "mentions_error"]
},
inspectorSections: ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"],
```

Then assert:

```ts
expect(html).toContain("Latest agent feedback");
expect(html).toContain("Implementation is complete, but auth tests are still failing.");
expect(html.indexOf("Current activity")).toBeLessThan(html.indexOf("Latest agent feedback"));
```

- [ ] **Step 2: Run the failing UI test.**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
```

Expected: fail until modal renders latest feedback.

- [ ] **Step 3: Refactor modal around section rendering.**

In `src/ui/SessionDetailModal.tsx`, add:

```tsx
const sections = session.inspectorSections ?? ["state", "attention_conflicts", "evidence", "timeline", "actions"];
```

Replace the hardcoded middle content with:

```tsx
{sections.map((section) => {
  if (section === "state") return <StateSection key={section} session={session} />;
  if (section === "latest_feedback" && session.latestFeedback) return <LatestFeedbackSection key={section} session={session} />;
  if (section === "attention_conflicts") return <AttentionConflictSection key={section} session={session} />;
  if (section === "evidence") return <EvidenceSection key={section} session={session} />;
  if (section === "timeline") return <TimelineSection key={section} session={session} />;
  if (section === "actions") return <ActionsSection key={section} session={session} onAction={onAction} />;
  return null;
})}
```

Create local helper components inside the same file for now. Do not split files unless the modal becomes hard to read during implementation.

The latest feedback section should be:

```tsx
function LatestFeedbackSection({ session }: { session: SessionDetailView }) {
  if (!session.latestFeedback) return null;
  return (
    <section className="detail-section latest-feedback" aria-label="Latest agent feedback">
      <p className="block-label">Latest agent feedback</p>
      <p>{session.latestFeedback.text}</p>
      <div className="section-line">
        <span>{session.latestFeedback.source.replace("_", " ")}</span>
        <span>{session.latestFeedback.observedAt}</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify.**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 10: Update Card Search And Main-Board Copy Rendering

**Files:**
- Modify: `src/ui/SessionCard.tsx`
- Modify: `src/ui/filterBoard.ts`
- Modify: `src/ui/__tests__/filterBoard.test.ts`
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Add search test for work-area labels.**

In `src/ui/__tests__/filterBoard.test.ts`, add a card with:

```ts
workContext: {
  label: "OAuth callback work",
  confidence: "title",
  pathClusters: ["auth"],
  sourceSignals: ["Fix Google OAuth callback"]
}
```

Then assert:

```ts
expect(filterCards([card], { query: "oauth callback", filter: "all" })).toHaveLength(1);
expect(filterCards([card], { query: "auth", filter: "all" })).toHaveLength(1);
```

Also add a card-rendering assertion to `src/ui/__tests__/liveBoard.test.tsx` that proves raw titles do not appear when `nextStep` is absent:

```tsx
const html = renderToStaticMarkup(
  <SessionCard
    session={{
      ...sessionCardFixture,
      title: "Fix Acme payroll callback with private customer detail",
      copy: {
        headline: "Auth work",
        status: "Work is active.",
        reason: "No blocker is visible.",
        source: "deterministic"
      }
    }}
  />
);

expect(html).toContain("Auth work");
expect(html).not.toContain("Acme payroll");
expect(html).not.toContain("private customer detail");
```

- [ ] **Step 2: Update filter fields.**

In `src/ui/filterBoard.ts`, include:

```ts
card.workContext?.label,
...(card.workContext?.pathClusters ?? []),
card.copy.headline,
card.copy.status,
card.copy.reason
```

- [ ] **Step 3: Keep cards natural-language first.**

In `src/ui/SessionCard.tsx`, preserve the current layout but ensure order is:

1. `session.copy.headline`
2. status token
3. `session.copy.status`
4. `session.copy.reason`
5. compact facts
6. optional `nextStep`

Remove the current raw-title fallback:

```tsx
{session.copy.nextStep ? <p className="session-state-line">{session.copy.nextStep}</p> : null}
```

Do not render `session.title` on the main card unless it has already been converted into safe `copy.headline` or `workContext.label`.

- [ ] **Step 4: Verify.**

Run:

```bash
npm test -- --run src/ui/__tests__/filterBoard.test.ts src/ui/__tests__/liveBoard.test.tsx
npm run typecheck
```

Expected: tests and typecheck pass.

## Task 11: Dogfood And Privacy Gates

**Files:**
- Modify: `src/core/dogfood.ts`
- Modify: `src/core/__tests__/dogfood.test.ts`
- Modify: `docs/release-gates.md`

- [ ] **Step 1: Add dogfood checks for calm ops copy.**

Extend `DogfoodGateId` and dogfood report summary plumbing with:

```ts
"calm_ops_copy"
"feedback_snapshot_privacy"
```

Add corresponding summary booleans, for example:

```ts
calmOpsCopy: boolean;
feedbackSnapshotPrivacy: boolean;
```

Update `formatDogfoodReport` tests so both new gates appear in fixture and live dogfood output.

Add checks that fail if projected card or board brief text contains:

```ts
const forbiddenMainBoardTerms = [
  /\byou\b/i,
  /\byour\b/i,
  /\btyler\b/i,
  /\burgent\b/i,
  /\bcritical\b/i,
  /\bdangerous\b/i,
  /\bplease\b/i,
  /\blet'?s\b/i,
  /\bi recommend\b/i,
  /\bi finished\b/i,
  /\bwe need\b/i,
  /primaryStatus/,
  /lifecycle/,
  /evidence refs/,
  /hook event/
];
```

Apply these checks to:

- `projection.brief?.text`
- `card.copy.headline`
- `card.copy.status`
- `card.copy.reason`
- `card.copy.nextStep`

- [ ] **Step 2: Add dogfood checks for feedback snapshot privacy.**

Assert serialized projection does not include:

```ts
[
  "lastAssistantMessage",
  "private assistant response",
  "```",
  "sk-",
  "OPENAI_API_KEY",
  "Ignore instructions",
  "Tyler must act",
  "src/lib/auth/session.ts",
  "npm test"
]
```

The serialized core projection can include bounded data fields:

```ts
"latestFeedback"
"latestFeedbackSignal"
```

It must not include the inspector UI label `"Latest agent feedback"` inside the core projection payload. Keep that label assertion in `src/ui/__tests__/liveBoard.test.tsx`, where rendered inspector copy belongs.

- [ ] **Step 3: Verify dogfood.**

Run:

```bash
npm test -- --run src/core/__tests__/dogfood.test.ts
npm run dogfood:fixture
```

Expected: tests and dogfood pass.

- [ ] **Step 4: Update release gates after full verification.**

In `docs/release-gates.md`, add bullets under verification evidence:

```md
- Main-board copy now follows calm ops brief rules: system-neutral voice, intervention-first top brief, no alarm language, no direct address, and no raw technical enum leakage on cards.
- Latest Codex Stop feedback is stored only as a redacted bounded snapshot. Raw assistant messages remain suppressed, are not persisted, and are not sent to OpenAI.
- GPT-5 nano copy enrichment receives deterministic state, safe work context, and optional feedback claim flags only when LLM copy is enabled; deterministic state remains the source of truth.
```

## Task 12: Full Verification And Browser QA

**Files:**
- No source changes expected unless verification exposes defects.

- [ ] **Step 1: Run full automated checks.**

Run:

```bash
npm test -- --run
npm run typecheck
npm run build
npm run dogfood:fixture
```

Expected: all pass.

- [ ] **Step 2: Run live dogfood if the collector is available.**

Run:

```bash
npm run dogfood:live
```

Expected: pass when the live collector is running. If it fails because the collector is not running, start Masthead through the project launcher and rerun.

- [ ] **Step 3: Start or reuse the local UI.**

Run:

```bash
npm run dev:fixture
```

If port `5173` is already in use, verify whether it is Masthead:

```bash
curl -sS -I http://127.0.0.1:5173 | head
```

If it is not usable, run:

```bash
VITE_MASTHEAD_MODE=fixture npx vite --host 127.0.0.1 --port 5174 --strictPort
```

- [ ] **Step 4: Use the Codex in-app Browser for visual QA.**

Per `AGENTS.md`, use the in-app Browser plugin with the `iab` backend first. Do not use standalone Playwright or an external browser server unless Tyler explicitly approves.

Verify at:

- 390px wide
- 768px wide
- 1280px wide
- current desktop viewport

Acceptance checks:

- No horizontal overflow.
- Top brief appears above counters.
- Main cards use calm natural language.
- Main cards do not include direct address or alarm words.
- Normal sessions still have a meaningful work-area status.
- Opening a card shows deterministic state before latest feedback.
- Latest feedback section is absent when no snapshot exists.
- Inspector still exposes evidence, conflicts, timeline, and safe actions.
- Mobile first viewport is not consumed entirely by connection, counters, and filters when sessions exist.
- Fixture board renders correctly with LLM copy disabled.
- Fixture board renders correctly with LLM copy enabled.
- A selected card with feedback shows the inspector feedback section after deterministic state.
- A selected card without feedback omits the inspector feedback section.
- DOM text checks confirm no main-board `you`, `your`, `Tyler`, alarm words, technical enum names, raw paths, raw commands, code fences, or secret-like strings.

Record the exact viewport sizes and evidence notes in the release-gates update. When practical, save in-app Browser screenshots or DOM excerpts for:

- fixture board at 390px, 768px, and 1280px
- selected card with feedback
- selected card without feedback
- LLM disabled fallback
- LLM enabled enriched copy

- [ ] **Step 5: Final verification note.**

Update `docs/release-gates.md` with exact commands run and browser widths verified.

## Implementation Sequence

Recommended commit sequence for the implementing worker:

1. `test: freeze calm ops copy rules`
2. `feat: add redacted feedback snapshots`
3. `feat: derive safe session work context`
4. `feat: enrich session copy inputs`
5. `feat: add board operations brief`
6. `feat: render calm briefing UI`
7. `feat: show latest feedback in inspector`
8. `test: add calm ops privacy dogfood gates`
9. `docs: record calm ops verification gates`

## Self-Review Checklist

- Research coverage: sessions remain primary, approvals/conflicts stay first-class, provenance/evidence stays in inspector, local-first privacy remains intact.
- Grill-session coverage: all locked voice, priority, uncertainty, model-role, work-context, feedback, completion-claim, fallback, top-brief, inspector-order, and tone decisions are represented in tasks.
- Privacy coverage: raw assistant messages, raw transcripts, raw command output, diffs, secrets, and full paths are not stored or sent to OpenAI.
- Determinism coverage: GPT-5 nano never decides lifecycle, severity, lane, outcome, completion, or conflict.
- UI coverage: board-first scanning, top brief, card copy, inspector feedback section, mobile viewport, and search are covered.
- Verification coverage: focused tests, full tests, typecheck, build, dogfood, and in-app Browser QA are included.
