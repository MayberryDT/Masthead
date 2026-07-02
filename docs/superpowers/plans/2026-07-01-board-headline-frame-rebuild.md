# Board Headline Frame Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Masthead Board headlines around an LLM-first `BoardHeadlineFrame` contract rendered as `Subject: disposition.`, with deterministic/offline copy used only when live LLM access is unavailable or explicitly disabled.

**Architecture:** Replace the current `SessionPlainCopy` Board API with `BoardHeadlineView`, backed by validated `BoardHeadlineFrame` objects. When live LLM copy is enabled and configured, Board cards show either a completed LLM headline frame or a pending headline state; they do not use deterministic headline text as a fallback. When LLM copy is unavailable or disabled, an explicit offline frame generator provides conservative local headlines and marks them as `offline`.

**Tech Stack:** TypeScript, Vite/Vitest, Node SQLite daemon, OpenAI Responses API JSON schema, React SessionCard UI.

---

## Non-Negotiable Product Rules

- Do not start `npm run dev`, `npm run dev:ui`, or any browser-only UI on port `5173`. That port is reserved for Electron Dev.
- If a visual check is needed later, use Electron Dev or explicitly choose another UI port, for example `MASTHEAD_UI_PORT=5180 npm run dev`.
- If `OPENAI_API_KEY` is present and `MASTHEAD_LIVE_COPY` is not `0`, Board headline generation is LLM-first.
- In LLM-first mode, do not render deterministic summary prose while waiting for the model. Render a pending headline state or the last successful LLM frame.
- Deterministic/offline headline generation is allowed only when there is no LLM access or live copy is disabled.
- The final Board API must not expose `SessionPlainCopy`, `copy`, `copyInput`, or `copyRefresh` on `SessionCardView`.
- The final Board API should expose `headline`, `headlineInput`, and `headlineRefresh`.
- OpenAI should extract a frame, not write a final headline. Code renders the headline with `renderBoardHeadlineFrame(frame)`.

## File Structure

### Create

- `src/core/boardHeadlineFrame.ts`
  - Owns `BoardHeadlineFrame`, `BoardHeadlineView`, state/subject-kind/confidence enums, banned phrases, validation, sanitation, and rendering.

- `src/core/boardHeadlineInput.ts`
  - Builds compact `BoardHeadlineInput` from card/facts/attention/conflicts. Replaces `SessionCopyInput` and `toSessionCopyInput`.

- `src/core/offlineBoardHeadline.ts`
  - Provides `buildOfflineBoardHeadlineView(input)` and `buildPendingBoardHeadlineView(input)`.
  - Offline is used only when live LLM access is unavailable or disabled.

- `src/core/openaiBoardHeadlineFrame.ts`
  - Replaces `openaiSessionCopy.ts`.
  - Sends `BoardHeadlineInput` to the Responses API and validates returned `BoardHeadlineFrame`.

- `src/core/boardHeadlineEnricher.ts`
  - Replaces the Board live-copy enricher with background LLM frame refresh, in-flight dedupe, failure cooldown, audit events, and last-good frame application.

- `src/daemon/db/boardHeadlineFrameRepository.ts`
  - Persists the latest successful headline frame per canonical session.

- `src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts`
  - Tests storage and lookup of last-good Board headline frames.

### Modify

- `src/core/types.ts`
  - Remove `SessionPlainCopy`, `SessionCopyRefreshState`, and copy fields from `SessionCardView`.
  - Add `BoardHeadlineView`, `BoardHeadlineRefreshState`, and headline fields.

- `src/core/replay.ts`
  - Stop building deterministic `copy`.
  - Build `headlineInput`.
  - Build `headline` from pending or offline mode, depending on projection options.

- `src/core/liveProjection.ts`
  - Accept a `headlineMode` option and last-known headline frames.

- `src/daemon/server.ts`
  - Replace `createOpenAISessionCopyEnricher` with `createBoardHeadlineEnricher`.
  - Pass headline mode into `projectLiveEvents`.
  - Load persisted frames before projection and persist successful frames from the enricher.

- `src/ui/SessionCard.tsx`
  - Render `session.headline`, not `session.copy`.
  - Remove visible AI failure badge behavior.
  - Render a calm pending state when `headline.status === "pending"`.

- `src/ui/__tests__/observabilitySessionCard.test.tsx`
  - Update tests to assert frame-rendered headlines and pending/offline states.

- `docs/reference/board.md`
  - Document `BoardHeadlineFrame` and LLM-first behavior.

- `docs/reference/session-copy.md`
  - Rename or replace with Board headline frame contract. Do not keep “session copy” as the Board headline abstraction.

### Delete Or Retire

- Delete `src/core/openaiSessionCopy.ts` after replacements pass.
- Delete or rewrite `src/core/__tests__/openaiSessionCopy.test.ts`.
- Delete `SessionPlainCopy` type from `src/core/types.ts`.
- Delete `buildDeterministicSessionCopy`, `validateSessionCopy`, and `SessionCopyInput` from `src/core/sessionCopy.ts`; either delete the file or reduce it to non-Board legacy utilities if another surface still needs it.

---

## Task 1: Add Board Headline Frame Contract

**Files:**
- Create: `src/core/boardHeadlineFrame.ts`
- Create: `src/core/__tests__/boardHeadlineFrame.test.ts`

- [ ] **Step 1: Write failing tests for rendering, validation, and banned phrases**

Add `src/core/__tests__/boardHeadlineFrame.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  renderBoardHeadlineFrame,
  validateBoardHeadlineFrame,
  type BoardHeadlineFrame
} from "../boardHeadlineFrame";

function frame(overrides: Partial<BoardHeadlineFrame> = {}): BoardHeadlineFrame {
  return {
    subject: "Board card headlines",
    disposition: "structured around subject and outcome",
    state: "active",
    subjectKind: "feature",
    confidence: "high",
    evidence: ["Latest user task requested structured Board headlines."],
    ...overrides
  };
}

describe("board headline frame", () => {
  test("renders the fixed subject disposition grammar", () => {
    expect(renderBoardHeadlineFrame(frame())).toBe("Board card headlines: structured around subject and outcome.");
  });

  test("normalizes extra punctuation before rendering", () => {
    expect(renderBoardHeadlineFrame(frame({ subject: "Board card headlines:", disposition: "structured around subject and outcome." }))).toBe(
      "Board card headlines: structured around subject and outcome."
    );
  });

  test("accepts a useful frame with concrete subject and disposition", () => {
    expect(validateBoardHeadlineFrame(frame())).toMatchObject({ ok: true });
  });

  test("rejects weak subjects", () => {
    expect(validateBoardHeadlineFrame(frame({ subject: "UI changes" }))).toMatchObject({
      ok: false,
      reason: "weak_subject"
    });
  });

  test("rejects weak dispositions", () => {
    expect(validateBoardHeadlineFrame(frame({ disposition: "has recent activity" }))).toMatchObject({
      ok: false,
      reason: "weak_disposition"
    });
  });

  test("rejects unsafe evidence in subject or disposition", () => {
    expect(validateBoardHeadlineFrame(frame({ disposition: "uses https://example.com/callback" }))).toMatchObject({
      ok: false,
      reason: "unsafe_text"
    });
  });

  test("allows longer but still scannable technical headlines", () => {
    expect(
      validateBoardHeadlineFrame(
        frame({
          subject: "OpenAI live copy refresh",
          disposition: "scheduled in the background without blocking Board projection"
        })
      )
    ).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineFrame.test.ts
```

Expected: FAIL because `src/core/boardHeadlineFrame.ts` does not exist.

- [ ] **Step 3: Implement the frame contract**

Create `src/core/boardHeadlineFrame.ts`:

```ts
export type BoardHeadlineState = "active" | "blocked" | "needs_verification" | "paused" | "completed" | "failed" | "waiting" | "unknown";

export type BoardHeadlineSubjectKind =
  | "feature"
  | "component"
  | "bug"
  | "test"
  | "import"
  | "settings"
  | "docs"
  | "source"
  | "project"
  | "unknown";

export type BoardHeadlineConfidence = "high" | "medium" | "low";

export type BoardHeadlineFrame = {
  subject: string;
  disposition: string;
  state: BoardHeadlineState;
  subjectKind: BoardHeadlineSubjectKind;
  confidence: BoardHeadlineConfidence;
  evidence: string[];
};

export type BoardHeadlineSource = "llm" | "offline" | "pending" | "enrichment";

export type BoardHeadlineView = {
  headline: string;
  frame?: BoardHeadlineFrame;
  source: BoardHeadlineSource;
  status: "ready" | "pending" | "unavailable";
  generatedAt?: string;
  model?: string;
  provider?: string;
  failureReason?: string;
};

export type BoardHeadlineValidationResult =
  | { ok: true; frame: BoardHeadlineFrame }
  | { ok: false; reason: "invalid_shape" | "weak_subject" | "weak_disposition" | "unsafe_text" | "unsupported_state" };

const bannedHeadlinePhrases = [
  "recent activity",
  "recent completion note",
  "is focused on",
  "work is focused on",
  "being updated around",
  "being fixed around",
  "session update",
  "session activity",
  "work is in progress",
  "changes have",
  "updates have",
  "had recent",
  "has recent",
  "quiet but open",
  "needs attention",
  "follow-up had",
  "follow-up has"
];

const bannedSubjects = [
  "session",
  "work",
  "changes",
  "updates",
  "recent activity",
  "verification follow-up",
  "codex hook event",
  "session narrative",
  "ui changes"
];

const allowedStates = new Set<BoardHeadlineState>(["active", "blocked", "needs_verification", "paused", "completed", "failed", "waiting", "unknown"]);
const allowedKinds = new Set<BoardHeadlineSubjectKind>(["feature", "component", "bug", "test", "import", "settings", "docs", "source", "project", "unknown"]);
const allowedConfidence = new Set<BoardHeadlineConfidence>(["high", "medium", "low"]);

export function renderBoardHeadlineFrame(frame: BoardHeadlineFrame): string {
  const subject = cleanSlot(frame.subject).replace(/:+$/g, "");
  const disposition = cleanSlot(frame.disposition).replace(/[.!?]+$/g, "");
  return `${subject}: ${lowercaseFirst(disposition)}.`;
}

export function validateBoardHeadlineFrame(candidate: unknown): BoardHeadlineValidationResult {
  if (!isRecord(candidate)) return { ok: false, reason: "invalid_shape" };
  if (
    typeof candidate.subject !== "string" ||
    typeof candidate.disposition !== "string" ||
    typeof candidate.state !== "string" ||
    typeof candidate.subjectKind !== "string" ||
    typeof candidate.confidence !== "string" ||
    !Array.isArray(candidate.evidence)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }
  if (!allowedStates.has(candidate.state as BoardHeadlineState) || !allowedKinds.has(candidate.subjectKind as BoardHeadlineSubjectKind)) {
    return { ok: false, reason: "unsupported_state" };
  }
  if (!allowedConfidence.has(candidate.confidence as BoardHeadlineConfidence)) return { ok: false, reason: "invalid_shape" };

  const frame: BoardHeadlineFrame = {
    subject: cleanSlot(candidate.subject),
    disposition: cleanSlot(candidate.disposition),
    state: candidate.state as BoardHeadlineState,
    subjectKind: candidate.subjectKind as BoardHeadlineSubjectKind,
    confidence: candidate.confidence as BoardHeadlineConfidence,
    evidence: candidate.evidence.map((value) => (typeof value === "string" ? cleanSlot(value) : "")).filter(Boolean).slice(0, 6)
  };

  if (isUnsafeText(frame.subject) || isUnsafeText(frame.disposition) || frame.evidence.some(isUnsafeText)) return { ok: false, reason: "unsafe_text" };
  if (!isUsefulSubject(frame.subject)) return { ok: false, reason: "weak_subject" };
  if (!isUsefulDisposition(frame.disposition)) return { ok: false, reason: "weak_disposition" };
  return { ok: true, frame };
}

export function isUsefulSubject(value: string): boolean {
  const normalized = cleanSlot(value).toLowerCase();
  if (normalized.length < 4 || normalized.length > 72) return false;
  return !bannedSubjects.some((subject) => normalized === subject);
}

export function isUsefulDisposition(value: string): boolean {
  const normalized = cleanSlot(value).toLowerCase();
  if (normalized.length < 12 || normalized.length > 140) return false;
  return !bannedHeadlinePhrases.some((phrase) => normalized.includes(phrase));
}

export function isUnsafeText(value: string): boolean {
  return (
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /\bhttps?:\/\//i.test(value) ||
    /::[-\w]+\{[^}]*\}/i.test(value) ||
    /\[url\]/i.test(value)
  );
}

function cleanSlot(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineFrame.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/boardHeadlineFrame.ts src/core/__tests__/boardHeadlineFrame.test.ts
git commit -m "feat: add board headline frame contract"
```

---

## Task 2: Replace Session Copy Types With Board Headline Types

**Files:**
- Modify: `src/core/types.ts`
- Modify: tests that construct `SessionCardView`

- [ ] **Step 1: Write a failing type-level usage test**

Create or modify `src/core/__tests__/boardHeadlineTypes.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { SessionCardView } from "../types";

describe("board headline card types", () => {
  test("session cards expose headline instead of session copy", () => {
    const card: SessionCardView = {
      sessionId: "session-1",
      project: "Masthead",
      title: "Board headline rebuild",
      headline: {
        headline: "Board headlines: structured around subject and outcome.",
        source: "llm",
        status: "ready",
        frame: {
          subject: "Board headlines",
          disposition: "structured around subject and outcome",
          state: "active",
          subjectKind: "feature",
          confidence: "high",
          evidence: ["The latest task asks for frame-based Board headlines."]
        }
      },
      stateLabel: "Running",
      primaryStatus: "editing",
      lifecycle: "running",
      priorityRank: 50,
      durationLabel: "4m",
      lastActivity: "2026-07-01T12:00:00.000Z",
      lastActivityLabel: "now",
      changedFileCount: 1,
      indicators: [],
      identityConfidence: "direct",
      safeActions: ["open_source_session"],
      isExpanded: false
    };

    expect(card.headline.headline).toContain(":");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineTypes.test.ts
```

Expected: FAIL because `SessionCardView` still requires `copy`.

- [ ] **Step 3: Modify `src/core/types.ts`**

Update imports and types:

```ts
import type { BoardHeadlineView } from "./boardHeadlineFrame";
```

Remove:

```ts
export type SessionPlainCopy = { ... };
export type SessionCopyRefreshStatus = ...;
export type SessionCopyRefreshState = { ... };
```

Add:

```ts
export type BoardHeadlineRefreshStatus = "success" | "pending" | "not_configured" | "api_error" | "invalid_output" | "validation_failed";

export type BoardHeadlineRefreshState = {
  requestedAt: string;
  status: BoardHeadlineRefreshStatus;
  provider?: string;
  model?: string;
  latencyMs?: number;
  failureMessage?: string;
};
```

In `SessionCardView`, replace:

```ts
copy: SessionPlainCopy;
copyInput?: unknown;
copyRefresh?: SessionCopyRefreshState;
```

with:

```ts
headline: BoardHeadlineView;
headlineInput?: unknown;
headlineRefresh?: BoardHeadlineRefreshState;
```

In `LiveBoardProjection`, replace `copyRefreshSummary` with:

```ts
headlineRefreshSummary?: {
  requested: number;
  succeeded: number;
  failed: number;
  pending: number;
  generatedAt: string;
};
```

- [ ] **Step 4: Run typecheck and collect compile errors**

Run:

```bash
npm run typecheck
```

Expected: FAIL with references to `copy`, `copyInput`, `copyRefresh`, `SessionPlainCopy`, and `copyRefreshSummary`. Do not fix all errors in this task; record them in the task notes.

- [ ] **Step 5: Run the type usage test**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineTypes.test.ts
```

Expected: PASS once `SessionCardView` accepts `headline`.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/__tests__/boardHeadlineTypes.test.ts
git commit -m "refactor: replace board copy types with headline types"
```

---

## Task 3: Build Board Headline Inputs From Existing Evidence

**Files:**
- Create: `src/core/boardHeadlineInput.ts`
- Create: `src/core/__tests__/boardHeadlineInput.test.ts`
- Modify: `src/core/boardLiveCopyFacts.ts` only if a missing fact is discovered by tests.

- [ ] **Step 1: Write failing tests for compact headline input**

Add `src/core/__tests__/boardHeadlineInput.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";

const baseFacts: BoardLiveCopyFacts = {
  sessionId: "session-1",
  project: "Masthead",
  lifecycle: "running",
  primaryStatus: "editing",
  workContext: {
    label: "Settings UI work",
    confidence: "path_cluster",
    pathClusters: ["settings"],
    sourceSignals: ["path:settings"]
  },
  recentEvents: [],
  recentTranscriptMessages: ["Fix the Settings danger zone delete preview copy."],
  recentToolNames: [],
  recentFileBasenames: ["SettingsPanel.tsx", "DangerZone.tsx"],
  recentCommandFailures: [],
  changedFileCount: 2,
  attentionTitles: [],
  conflictTitles: []
};

describe("board headline input", () => {
  test("prioritizes latest transcript task and component evidence", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: baseFacts
    });

    expect(input.subjectCandidates).toEqual(expect.arrayContaining(["Settings danger zone", "Settings UI", "DangerZone.tsx"]));
    expect(input.evidence).toContain("Fix the Settings danger zone delete preview copy.");
  });

  test("preserves blocker signals for the model", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "blocked",
      signals: ["command_failed"],
      facts: {
        ...baseFacts,
        recentCommandFailures: ["vitest failed on Settings danger zone tests"],
        attentionTitles: ["Settings delete flow failed verification"]
      }
    });

    expect(input.stateHint).toBe("blocked");
    expect(input.dispositionHints).toEqual(expect.arrayContaining(["vitest failed on Settings danger zone tests"]));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineInput.test.ts
```

Expected: FAIL because `boardHeadlineInput.ts` does not exist.

- [ ] **Step 3: Implement `BoardHeadlineInput`**

Create `src/core/boardHeadlineInput.ts`:

```ts
import type { BoardLiveCopyFacts } from "./boardLiveCopyFacts";
import type { BoardHeadlineState } from "./boardHeadlineFrame";

export type BoardHeadlineSignal =
  | "approval_waiting"
  | "user_reply_waiting"
  | "command_failed"
  | "repeated_failure"
  | "stalled"
  | "verification_missing"
  | "verification_stale"
  | "high_risk_change"
  | "conflict_detected";

export type BoardHeadlineInput = {
  lifecycle: string;
  primaryStatus: string;
  stateHint: BoardHeadlineState;
  signals: BoardHeadlineSignal[];
  subjectCandidates: string[];
  dispositionHints: string[];
  evidence: string[];
  facts: BoardLiveCopyFacts;
};

export function toBoardHeadlineInput(input: {
  lifecycle: string;
  primaryStatus: string;
  signals: BoardHeadlineSignal[];
  facts: BoardLiveCopyFacts;
}): BoardHeadlineInput {
  return {
    lifecycle: input.lifecycle,
    primaryStatus: input.primaryStatus,
    stateHint: stateHint(input.lifecycle, input.primaryStatus, input.signals),
    signals: [...input.signals].toSorted(),
    subjectCandidates: subjectCandidates(input.facts),
    dispositionHints: dispositionHints(input.facts),
    evidence: evidence(input.facts),
    facts: input.facts
  };
}

function stateHint(lifecycle: string, primaryStatus: string, signals: BoardHeadlineSignal[]): BoardHeadlineState {
  if (primaryStatus === "blocked" || signals.includes("command_failed") || signals.includes("repeated_failure")) return "blocked";
  if (primaryStatus === "waiting_for_approval" || primaryStatus === "waiting_for_user") return "waiting";
  if (signals.includes("verification_missing") || signals.includes("verification_stale")) return "needs_verification";
  if (lifecycle === "idle" || primaryStatus === "stalled") return "paused";
  if (lifecycle === "ended" && primaryStatus === "failed") return "failed";
  if (lifecycle === "ended") return "completed";
  if (lifecycle === "running") return "active";
  return "unknown";
}

function subjectCandidates(facts: BoardLiveCopyFacts): string[] {
  return unique([
    ...facts.recentTranscriptMessages?.flatMap(extractSubjectCandidatesFromText) ?? [],
    facts.canonicalEnrichment?.subject,
    facts.canonicalEnrichment?.object,
    cleanWorkContextSubject(facts.workContext?.label),
    ...facts.recentFileBasenames.map(fileSubject),
    facts.title,
    facts.project
  ].filter(isString)).slice(0, 12);
}

function dispositionHints(facts: BoardLiveCopyFacts): string[] {
  return unique([
    facts.latestFeedback?.summary,
    ...facts.recentCommandFailures,
    ...facts.attentionTitles,
    facts.canonicalEnrichment?.action,
    facts.canonicalEnrichment?.outcome,
    facts.canonicalEnrichment?.liveSummary,
    ...facts.recentTranscriptMessages ?? [],
    ...facts.recentEvents.map((event) => event.summary)
  ].filter(isString)).slice(0, 12);
}

function evidence(facts: BoardLiveCopyFacts): string[] {
  return unique([
    ...facts.recentTranscriptMessages ?? [],
    ...facts.recentEvents.map((event) => event.summary),
    ...facts.recentCommandFailures,
    ...facts.attentionTitles,
    ...facts.conflictTitles,
    ...facts.recentFileBasenames,
    ...facts.recentToolNames
  ].filter(isString)).slice(0, 20);
}

function extractSubjectCandidatesFromText(value: string): string[] {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const candidates: string[] = [];
  if (/\bsettings danger zone\b/i.test(cleaned)) candidates.push("Settings danger zone");
  if (/\bsettings ui\b/i.test(cleaned)) candidates.push("Settings UI");
  if (/\bboard headlines?\b/i.test(cleaned)) candidates.push("Board headlines");
  if (/\blogbook\b/i.test(cleaned)) candidates.push("Logbook");
  if (/\bsession dossier\b/i.test(cleaned)) candidates.push("Session dossier");
  if (/\bsources?\b/i.test(cleaned)) candidates.push("Sources screen");
  if (/\btranscript import\b/i.test(cleaned)) candidates.push("Transcript import");
  return candidates;
}

function cleanWorkContextSubject(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.endsWith(" work")) return value.slice(0, -" work".length);
  if (value.endsWith(" changes")) return value.slice(0, -" changes".length);
  return value;
}

function fileSubject(value: string): string | undefined {
  const stem = value.replace(/\.[^.]+$/g, "");
  if (/DangerZone/i.test(stem)) return "Settings danger zone";
  if (/SessionDossier/i.test(stem)) return "Session dossier";
  if (/Logbook/i.test(stem)) return "Logbook";
  if (/Board|SessionCard/i.test(stem)) return "Board cards";
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineInput.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/boardHeadlineInput.ts src/core/__tests__/boardHeadlineInput.test.ts
git commit -m "feat: build board headline input from evidence"
```

---

## Task 4: Add Pending And Offline Headline Views

**Files:**
- Create: `src/core/offlineBoardHeadline.ts`
- Create: `src/core/__tests__/offlineBoardHeadline.test.ts`

- [ ] **Step 1: Write failing tests for pending vs offline behavior**

Add `src/core/__tests__/offlineBoardHeadline.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "../offlineBoardHeadline";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";

const facts: BoardLiveCopyFacts = {
  sessionId: "session-1",
  project: "Masthead",
  lifecycle: "running",
  primaryStatus: "editing",
  workContext: { label: "Board headline work", confidence: "title", sourceSignals: ["title:board"] },
  recentEvents: [],
  recentTranscriptMessages: ["Implement Board headline frames from subject and disposition."],
  recentToolNames: [],
  recentFileBasenames: ["SessionCard.tsx"],
  recentCommandFailures: [],
  changedFileCount: 1,
  attentionTitles: [],
  conflictTitles: []
};

describe("offline board headline", () => {
  test("pending view does not pretend to be a deterministic headline", () => {
    const input = toBoardHeadlineInput({ lifecycle: "running", primaryStatus: "editing", signals: [], facts });

    expect(buildPendingBoardHeadlineView(input)).toMatchObject({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
  });

  test("offline view uses frame grammar and marks source as offline", () => {
    const input = toBoardHeadlineInput({ lifecycle: "running", primaryStatus: "editing", signals: [], facts });

    expect(buildOfflineBoardHeadlineView(input)).toMatchObject({
      headline: "Board headlines: waiting for LLM headline access.",
      source: "offline",
      status: "ready"
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/offlineBoardHeadline.test.ts
```

Expected: FAIL because `offlineBoardHeadline.ts` does not exist.

- [ ] **Step 3: Implement pending and offline views**

Create `src/core/offlineBoardHeadline.ts`:

```ts
import type { BoardHeadlineInput } from "./boardHeadlineInput";
import { renderBoardHeadlineFrame, type BoardHeadlineFrame, type BoardHeadlineView } from "./boardHeadlineFrame";

export function buildPendingBoardHeadlineView(_input: BoardHeadlineInput): BoardHeadlineView {
  return {
    headline: "Generating headline...",
    source: "pending",
    status: "pending"
  };
}

export function buildOfflineBoardHeadlineView(input: BoardHeadlineInput): BoardHeadlineView {
  const frame = offlineFrame(input);
  return {
    headline: renderBoardHeadlineFrame(frame),
    frame,
    source: "offline",
    status: "ready"
  };
}

function offlineFrame(input: BoardHeadlineInput): BoardHeadlineFrame {
  const subject = offlineSubject(input);
  return {
    subject,
    disposition: offlineDisposition(input),
    state: input.stateHint,
    subjectKind: subjectKind(subject),
    confidence: "low",
    evidence: input.evidence.slice(0, 4)
  };
}

function offlineSubject(input: BoardHeadlineInput): string {
  const subject = input.subjectCandidates.find((candidate) => !/^(Masthead|Session|Work|UI changes)$/i.test(candidate));
  if (!subject) return input.facts.project ?? "Project";
  if (/^Board headline/i.test(subject)) return "Board headlines";
  return subject;
}

function offlineDisposition(input: BoardHeadlineInput): string {
  if (input.stateHint === "blocked") return blocker(input);
  if (input.stateHint === "needs_verification") return "needs verification after recent changes";
  if (input.stateHint === "paused") return "paused after latest collected evidence";
  if (input.stateHint === "completed") return "latest outcome is ready for review";
  if (input.stateHint === "failed") return "failed on latest recorded evidence";
  if (input.stateHint === "waiting") return "waiting for the next required input";
  return "waiting for LLM headline access";
}

function blocker(input: BoardHeadlineInput): string {
  const failure = input.dispositionHints.find((hint) => /\b(failed|blocked|missing)\b/i.test(hint));
  return failure ? `blocked by ${cleanFragment(failure)}` : "blocked by recorded session evidence";
}

function cleanFragment(value: string): string {
  return value.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 96);
}

function subjectKind(subject: string): BoardHeadlineFrame["subjectKind"] {
  if (/settings/i.test(subject)) return "settings";
  if (/test/i.test(subject)) return "test";
  if (/import/i.test(subject)) return "import";
  if (/docs|guide/i.test(subject)) return "docs";
  if (/source/i.test(subject)) return "source";
  if (/bug|fix/i.test(subject)) return "bug";
  return "feature";
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
npx vitest --run src/core/__tests__/offlineBoardHeadline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offlineBoardHeadline.ts src/core/__tests__/offlineBoardHeadline.test.ts
git commit -m "feat: add pending and offline board headlines"
```

---

## Task 5: Replace OpenAI Session Copy With Frame Extraction

**Files:**
- Create: `src/core/openaiBoardHeadlineFrame.ts`
- Create: `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`
- Later delete: `src/core/openaiSessionCopy.ts`

- [ ] **Step 1: Write failing tests for frame schema and validation**

Add `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { rewriteBoardHeadlineFrameWithOpenAI } from "../openaiBoardHeadlineFrame";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";

const facts: BoardLiveCopyFacts = {
  sessionId: "session-1",
  project: "Masthead",
  lifecycle: "running",
  primaryStatus: "editing",
  workContext: { label: "Board headline work", confidence: "title", sourceSignals: ["title:board"] },
  recentEvents: [],
  recentTranscriptMessages: ["Use subject and disposition frames for Board headlines."],
  recentToolNames: [],
  recentFileBasenames: ["SessionCard.tsx"],
  recentCommandFailures: [],
  changedFileCount: 1,
  attentionTitles: [],
  conflictTitles: []
};

const input = toBoardHeadlineInput({ lifecycle: "running", primaryStatus: "editing", signals: [], facts });

describe("OpenAI board headline frame", () => {
  test("requests frame JSON instead of final headline prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseWithFrame());

    const result = await rewriteBoardHeadlineFrameWithOpenAI(input, {
      enabled: true,
      apiKey: "key",
      fetchImpl,
      model: "gpt-5-nano-2025-08-07"
    });

    expect(result).toMatchObject({
      status: "llm",
      frame: {
        subject: "Board headlines",
        disposition: "structured around subject and disposition"
      }
    });
    const [, request] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(request.body);
    expect(body.text.format.schema.required).toEqual(["subject", "disposition", "state", "subjectKind", "confidence", "evidence"]);
    expect(body.instructions).toContain("Do not summarize the session");
    expect(body.instructions).toContain("smallest concrete work object");
    expect(body.input).not.toContain("OPENAI_API_KEY");
  });

  test("rejects weak model frames", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseWithFrame({ subject: "UI changes", disposition: "has recent activity" }));

    await expect(rewriteBoardHeadlineFrameWithOpenAI(input, { enabled: true, apiKey: "key", fetchImpl })).resolves.toMatchObject({
      status: "validation_failed",
      validationReason: "weak_subject"
    });
  });
});

function responseWithFrame(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                subject: "Board headlines",
                disposition: "structured around subject and disposition",
                state: "active",
                subjectKind: "feature",
                confidence: "high",
                evidence: ["Use subject and disposition frames for Board headlines."],
                ...overrides
              })
            }
          ]
        }
      ]
    })
  };
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/openaiBoardHeadlineFrame.test.ts
```

Expected: FAIL because `openaiBoardHeadlineFrame.ts` does not exist.

- [ ] **Step 3: Implement OpenAI frame extraction**

Create `src/core/openaiBoardHeadlineFrame.ts`:

```ts
import { validateBoardHeadlineFrame, type BoardHeadlineFrame } from "./boardHeadlineFrame";
import type { BoardHeadlineInput } from "./boardHeadlineInput";

export type OpenAIBoardHeadlineFrameStatus = "llm" | "disabled" | "not_configured" | "timeout" | "api_error" | "invalid_output" | "validation_failed";

export type OpenAIBoardHeadlineFrameConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type OpenAIBoardHeadlineFrameResult = {
  frame?: BoardHeadlineFrame;
  status: OpenAIBoardHeadlineFrameStatus;
  failureMessage?: string;
  validationReason?: string;
  latencyMs?: number;
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_TIMEOUT_MS = 12_000;

export async function rewriteBoardHeadlineFrameWithOpenAI(
  input: BoardHeadlineInput,
  config: OpenAIBoardHeadlineFrameConfig = {}
): Promise<OpenAIBoardHeadlineFrameResult> {
  if (config.enabled !== true) return { failureMessage: "OpenAI Board headline extraction is disabled.", status: "disabled" };
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return { failureMessage: "OpenAI Board headline extraction is enabled but not configured.", status: "not_configured" };

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { failureMessage: "No fetch implementation is available for OpenAI Board headline extraction.", status: "api_error" };

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        instructions: frameInstructions(),
        input: JSON.stringify(input),
        max_output_tokens: 500,
        reasoning: { effort: "minimal" },
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "masthead_board_headline_frame",
            strict: true,
            schema: frameSchema()
          }
        }
      }),
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) return { failureMessage: `OpenAI Board headline request failed with HTTP ${response.status}.`, latencyMs, status: "api_error" };
    const outputText = extractOutputText(await response.json());
    if (!outputText) return { failureMessage: "OpenAI Board headline response did not include output text.", latencyMs, status: "invalid_output" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return { failureMessage: "OpenAI Board headline response was not valid JSON.", latencyMs, status: "invalid_output" };
    }
    const validation = validateBoardHeadlineFrame(parsed);
    if (!validation.ok) {
      return {
        failureMessage: "OpenAI Board headline frame failed validation.",
        latencyMs,
        status: "validation_failed",
        validationReason: validation.reason
      };
    }
    return { frame: validation.frame, latencyMs, status: "llm" };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return { failureMessage: `OpenAI Board headline timed out after ${timeoutMs}ms.`, latencyMs, status: "timeout" };
    }
    return {
      failureMessage: error instanceof Error ? error.message : "OpenAI Board headline request failed.",
      latencyMs,
      status: "api_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function frameInstructions(): string {
  return [
    "You are extracting a Board card headline frame for Masthead.",
    "Do not summarize the session. Identify the smallest concrete work object and its current disposition.",
    "Return JSON only.",
    "subject must be a concrete noun phrase.",
    "disposition must describe the current meaningful state of the subject.",
    "Do not use generic phrases like recent activity, session update, work is focused on, has recent completion note, or being updated around.",
    "Do not mention session unless the session system itself is the subject.",
    "Do not include secrets, URLs, emails, raw commands, or long file paths.",
    "Prefer product, component, or task names over project names.",
    "If blocked, disposition must start with blocked by.",
    "If verification is missing, disposition must start with needs verification after.",
    "If idle, disposition should start with paused after unless there is a completed outcome.",
    "If completed, disposition should describe the completed product outcome."
  ].join(" ");
}

function frameSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["subject", "disposition", "state", "subjectKind", "confidence", "evidence"],
    properties: {
      subject: { type: "string" },
      disposition: { type: "string" },
      state: { type: "string", enum: ["active", "blocked", "needs_verification", "paused", "completed", "failed", "waiting", "unknown"] },
      subjectKind: { type: "string", enum: ["feature", "component", "bug", "test", "import", "settings", "docs", "source", "project", "unknown"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      evidence: { type: "array", items: { type: "string" } }
    }
  };
}

function extractOutputText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.output)) return undefined;
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
npx vitest --run src/core/__tests__/openaiBoardHeadlineFrame.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openaiBoardHeadlineFrame.ts src/core/__tests__/openaiBoardHeadlineFrame.test.ts
git commit -m "feat: extract board headline frames with OpenAI"
```

---

## Task 6: Add Background Board Headline Enricher

**Files:**
- Create: `src/core/boardHeadlineEnricher.ts`
- Create: `src/core/__tests__/boardHeadlineEnricher.test.ts`

- [ ] **Step 1: Write failing tests for LLM-first pending behavior**

Add `src/core/__tests__/boardHeadlineEnricher.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { createBoardHeadlineEnricher } from "../boardHeadlineEnricher";
import type { LiveBoardProjection, SessionCardView } from "../types";

describe("board headline enricher", () => {
  test("LLM mode returns immediately without offline fallback while a frame is in flight", async () => {
    const response = deferredResponse();
    const fetchImpl = vi.fn(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const projection = liveProjection([card()]);

    const result = await enricher.enrichProjection(projection);
    response.resolve(frameResponse());

    expect(result.cards[0]?.headline).toMatchObject({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("applies completed LLM frame on later projection", async () => {
    const response = deferredResponse();
    const fetchImpl = vi.fn(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const projection = liveProjection([card()]);

    await enricher.enrichProjection(projection);
    response.resolve(frameResponse());
    await delay(0);
    await delay(0);
    const refreshed = await enricher.enrichProjection(projection);

    expect(refreshed.cards[0]?.headline).toMatchObject({
      headline: "Board headlines: structured around subject and disposition.",
      source: "llm",
      status: "ready"
    });
  });

  test("uses offline headline only when live copy is disabled", async () => {
    const fetchImpl = vi.fn();
    const enricher = createBoardHeadlineEnricher({ enabled: false, fetchImpl });

    const result = await enricher.enrichProjection(liveProjection([card()]));

    expect(result.cards[0]?.headline.source).toBe("offline");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Board headline rebuild",
    headline: { headline: "Generating headline...", source: "pending", status: "pending" },
    headlineInput: {
      lifecycle: "running",
      primaryStatus: "editing",
      stateHint: "active",
      signals: [],
      subjectCandidates: ["Board headlines"],
      dispositionHints: ["structured around subject and disposition"],
      evidence: ["Use subject and disposition frames for Board headlines."],
      facts: {
        sessionId: "session-1",
        project: "Masthead",
        lifecycle: "running",
        primaryStatus: "editing",
        recentEvents: [],
        recentTranscriptMessages: ["Use subject and disposition frames for Board headlines."],
        recentToolNames: [],
        recentFileBasenames: [],
        recentCommandFailures: [],
        changedFileCount: 1,
        attentionTitles: [],
        conflictTitles: []
      }
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 50,
    durationLabel: "4m",
    lastActivity: "2026-07-01T12:00:00.000Z",
    lastActivityLabel: "now",
    changedFileCount: 1,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}

function liveProjection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: { active: cards.length, needsAttention: 0, conflicts: 0, completed: 0, running: cards.length, needsAction: 0, idle: 0 },
    cards,
    attentionQueue: [],
    conflicts: []
  };
}

function frameResponse() {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                subject: "Board headlines",
                disposition: "structured around subject and disposition",
                state: "active",
                subjectKind: "feature",
                confidence: "high",
                evidence: ["Use subject and disposition frames for Board headlines."]
              })
            }
          ]
        }
      ]
    })
  };
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineEnricher.test.ts
```

Expected: FAIL because `boardHeadlineEnricher.ts` does not exist.

- [ ] **Step 3: Implement the enricher**

Create `src/core/boardHeadlineEnricher.ts`:

```ts
import { renderBoardHeadlineFrame, type BoardHeadlineView } from "./boardHeadlineFrame";
import { rewriteBoardHeadlineFrameWithOpenAI, type OpenAIBoardHeadlineFrameResult } from "./openaiBoardHeadlineFrame";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "./offlineBoardHeadline";
import type { BoardHeadlineInput } from "./boardHeadlineInput";
import type { LiveBoardProjection } from "./types";

export type BoardHeadlineEnricherConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

export type BoardHeadlineEnricher = {
  enrichProjection: (projection: LiveBoardProjection) => Promise<LiveBoardProjection>;
  status: () => { enabled: boolean; configured: boolean; model: string };
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";

export function createBoardHeadlineEnricher(config: BoardHeadlineEnricherConfig = {}): BoardHeadlineEnricher {
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  const model = config.model ?? DEFAULT_MODEL;
  const inFlight = new Map<string, Promise<OpenAIBoardHeadlineFrameResult>>();
  const completed = new Map<string, BoardHeadlineView>();

  return {
    async enrichProjection(projection) {
      return enrichProjection(projection, { enabled, apiKey, model, config, inFlight, completed });
    },
    status() {
      return { enabled, configured: Boolean(apiKey), model };
    }
  };
}

async function enrichProjection(
  projection: LiveBoardProjection,
  context: {
    enabled: boolean;
    apiKey: string | undefined;
    model: string;
    config: BoardHeadlineEnricherConfig;
    inFlight: Map<string, Promise<OpenAIBoardHeadlineFrameResult>>;
    completed: Map<string, BoardHeadlineView>;
  }
): Promise<LiveBoardProjection> {
  const headlineBySession = new Map<string, BoardHeadlineView>();
  let requested = 0;
  let succeeded = 0;
  let pending = 0;

  for (const card of projection.cards) {
    const input = card.headlineInput as BoardHeadlineInput | undefined;
    if (!input || card.lifecycle !== "running") continue;
    const key = JSON.stringify({ model: context.model, input });
    const completedHeadline = context.completed.get(key);
    if (completedHeadline) {
      headlineBySession.set(card.sessionId, completedHeadline);
      succeeded += 1;
      continue;
    }
    if (!context.enabled || !context.apiKey) {
      headlineBySession.set(card.sessionId, buildOfflineBoardHeadlineView(input));
      continue;
    }
    headlineBySession.set(card.sessionId, buildPendingBoardHeadlineView(input));
    pending += 1;
    if (!context.inFlight.has(key)) {
      requested += 1;
      const request = rewriteBoardHeadlineFrameWithOpenAI(input, {
        enabled: true,
        apiKey: context.apiKey,
        model: context.model,
        fetchImpl: context.config.fetchImpl,
        timeoutMs: context.config.timeoutMs
      }).then((result) => {
        if (result.status === "llm" && result.frame) {
          context.completed.set(key, {
            headline: renderBoardHeadlineFrame(result.frame),
            frame: result.frame,
            source: "llm",
            status: "ready",
            generatedAt: new Date(context.config.now?.() ?? Date.now()).toISOString(),
            model: context.model,
            provider: "openai"
          });
        }
        return result;
      }).finally(() => {
        context.inFlight.delete(key);
      });
      context.inFlight.set(key, request);
    }
  }

  return {
    ...projection,
    cards: projection.cards.map((card) => {
      const headline = headlineBySession.get(card.sessionId);
      return headline ? { ...card, headline } : card;
    }),
    headlineRefreshSummary: {
      failed: 0,
      generatedAt: new Date(context.config.now?.() ?? Date.now()).toISOString(),
      pending,
      requested,
      succeeded
    }
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineEnricher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/boardHeadlineEnricher.ts src/core/__tests__/boardHeadlineEnricher.test.ts
git commit -m "feat: refresh board headline frames in background"
```

---

## Task 7: Integrate Headline Frames Into Projection

**Files:**
- Modify: `src/core/replay.ts`
- Modify: `src/core/liveProjection.ts`
- Modify: `src/core/__tests__/liveProjection.test.ts`
- Modify: `src/core/__tests__/projection.test.ts`

- [ ] **Step 1: Add failing projection tests**

Add tests to `src/core/__tests__/liveProjection.test.ts`:

```ts
test("LLM headline mode creates pending Board headlines instead of deterministic fallback prose", () => {
  const started = normalizeCodexHookPayload(
    {
      provider_event_id: "headline-mode-start",
      event: "session_started",
      session_id: "headline-mode-session",
      timestamp: "2026-07-01T12:00:00.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      title: "Board headline rebuild"
    },
    { receivedAt: "2026-07-01T12:00:00.010Z" }
  );

  const envelope = projectLiveEvents([started], [], {
    generatedAt: "2026-07-01T12:01:00.000Z",
    headlineMode: "llm"
  });

  expect(envelope.projection.cards[0]?.headline).toMatchObject({
    headline: "Generating headline...",
    source: "pending",
    status: "pending"
  });
  expect(envelope.projection.cards[0]?.headlineInput).toBeDefined();
});

test("offline headline mode uses local frame fallback when LLM access is unavailable", () => {
  const started = normalizeCodexHookPayload(
    {
      provider_event_id: "offline-headline-start",
      event: "session_started",
      session_id: "offline-headline-session",
      timestamp: "2026-07-01T12:00:00.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      title: "Board headline rebuild"
    },
    { receivedAt: "2026-07-01T12:00:00.010Z" }
  );

  const envelope = projectLiveEvents([started], [], {
    generatedAt: "2026-07-01T12:01:00.000Z",
    headlineMode: "offline"
  });

  expect(envelope.projection.cards[0]?.headline.source).toBe("offline");
  expect(envelope.projection.cards[0]?.headline.headline).toContain(":");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest --run src/core/__tests__/liveProjection.test.ts
```

Expected: FAIL because `headlineMode`, `headline`, and `headlineInput` are not wired.

- [ ] **Step 3: Modify `src/core/liveProjection.ts` options**

Add:

```ts
type LiveProjectionOptions = {
  expandedSessionId?: string;
  selectedSessionId?: string | null;
  sessionEnrichments?: Map<string, LiveSessionEnrichment>;
  sessionTranscriptFacts?: Map<string, LiveSessionTranscriptFacts>;
  headlineMode?: "llm" | "offline";
  generatedAt?: string;
  diagnostics?: number;
};
```

Pass into `projectFixture`:

```ts
projection: projectFixture(replay, {
  expandedSessionId: options.expandedSessionId,
  sessionEnrichments: normalizeLiveSessionEnrichments(options.sessionEnrichments),
  sessionTranscriptFacts: options.sessionTranscriptFacts,
  headlineMode: options.headlineMode ?? "offline",
  selectedSessionId,
  now: new Date(generatedAt)
})
```

- [ ] **Step 4: Modify `src/core/replay.ts` projection options**

Add to `ProjectFixtureOptions`:

```ts
headlineMode?: "llm" | "offline";
```

Replace the old copy-building block in `toCard` with:

```ts
const headlineInput = toBoardHeadlineInput({
  lifecycle: card.lifecycle,
  primaryStatus: card.primaryStatus,
  signals: signalsFromCard(card, sessionAttention, sessionConflicts),
  facts: buildBoardLiveCopyFacts({
    attentionItems: sessionAttention,
    card,
    canonicalEnrichment: cardEnrichment,
    conflicts: sessionConflicts,
    events: sessionEvents,
    gitSnapshots: sessionSnapshots,
    recentTranscriptMessages: transcriptFacts?.recentMessages
  })
});
const headline = headlineMode === "llm" ? buildPendingBoardHeadlineView(headlineInput) : buildOfflineBoardHeadlineView(headlineInput);
return withEnrichmentHeadline({ ...card, headline, headlineInput }, cardEnrichment, transcriptFacts, headlineMode);
```

Add helper:

```ts
function signalsFromCard(
  card: Pick<SessionCardView, "indicators" | "primaryStatus">,
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[]
): BoardHeadlineSignal[] {
  const signals = new Set<BoardHeadlineSignal>();
  for (const item of attentionItems) {
    if (item.type === "approval_requested") signals.add("approval_waiting");
    if (item.type === "user_question") signals.add("user_reply_waiting");
    if (item.type === "command_failed") signals.add("command_failed");
    if (item.type === "repeated_failure") signals.add("repeated_failure");
    if (item.type === "stalled") signals.add("stalled");
    if (item.type === "completed_without_verification") signals.add("verification_missing");
    if (item.type === "stale_verification") signals.add("verification_stale");
    if (item.type === "high_risk_change") signals.add("high_risk_change");
    if (item.type === "conflict") signals.add("conflict_detected");
  }
  if (card.indicators.includes("risk")) signals.add("high_risk_change");
  if (card.indicators.includes("verification")) signals.add("verification_missing");
  if (card.indicators.includes("conflict") || conflicts.length > 0) signals.add("conflict_detected");
  return [...signals].toSorted();
}
```

Temporarily keep `withEnrichmentHeadline` simple:

```ts
function withEnrichmentHeadline(card: SessionCardView, _enrichment: LiveSessionEnrichment | undefined, _transcriptFacts: LiveSessionTranscriptFacts | undefined, _headlineMode: "llm" | "offline"): SessionCardView {
  return card;
}
```

Do not reuse old enrichment `liveSummary` as a Board headline in LLM mode.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest --run src/core/__tests__/liveProjection.test.ts src/core/__tests__/projection.test.ts
```

Expected: PASS after updating assertions from `copy` to `headline`.

- [ ] **Step 6: Commit**

```bash
git add src/core/replay.ts src/core/liveProjection.ts src/core/__tests__/liveProjection.test.ts src/core/__tests__/projection.test.ts
git commit -m "refactor: project board headline frames"
```

---

## Task 8: Wire Daemon To LLM-First Headline Mode

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/__tests__/config.test.ts`
- Modify: `src/core/__tests__/ingestServer.test.ts` if it asserts projection shape.

- [ ] **Step 1: Add failing daemon projection behavior test**

In the server/API test that exercises `/projection`, add:

```ts
test("projection uses LLM headline mode when live copy is enabled and configured", async () => {
  const response = await requestProjection({
    env: {
      OPENAI_API_KEY: "sk-test",
      MASTHEAD_LIVE_COPY: "1"
    }
  });

  expect(response.projection.cards[0].headline.source).toBe("pending");
  expect(response.projection.cards[0].headlineInput).toBeDefined();
});
```

If the existing helper name differs, put this assertion in `src/core/__tests__/ingestServer.test.ts` where `/projection` responses are already tested.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npx vitest --run src/core/__tests__/ingestServer.test.ts
```

Expected: FAIL because daemon still calls session copy enricher and projection defaults to offline/deterministic.

- [ ] **Step 3: Replace session copy enricher in `src/daemon/server.ts`**

Replace import:

```ts
import { createOpenAISessionCopyEnricher } from "../core/openaiSessionCopy.ts";
```

with:

```ts
import { createBoardHeadlineEnricher } from "../core/boardHeadlineEnricher.ts";
```

Replace instance:

```ts
const sessionCopyEnricher = createOpenAISessionCopyEnricher(...)
```

with:

```ts
const boardHeadlineEnricher = createBoardHeadlineEnricher({
  enabled: config.liveCopyEnabled ?? config.llmCopyEnabled,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  timeoutMs: config.liveCopyTimeoutMs
});
```

In `/projection`, compute:

```ts
const headlineMode = (config.liveCopyEnabled ?? config.llmCopyEnabled) && config.openaiApiKey?.trim() ? "llm" : "offline";
```

Pass to `projectLiveEvents`:

```ts
headlineMode,
```

Replace:

```ts
liveEnvelope.projection = await sessionCopyEnricher.enrichProjection(liveEnvelope.projection, { refreshIntervalMs });
```

with:

```ts
liveEnvelope.projection = await boardHeadlineEnricher.enrichProjection(liveEnvelope.projection);
```

Update health/status payload from `llmCopy` to:

```ts
boardHeadlines: boardHeadlineEnricher.status()
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest --run src/core/__tests__/ingestServer.test.ts src/daemon/__tests__/config.test.ts
```

Expected: PASS after assertion updates.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/server.ts src/core/__tests__/ingestServer.test.ts src/daemon/__tests__/config.test.ts
git commit -m "feat: enable llm-first board headline mode"
```

---

## Task 9: Persist Last Successful LLM Headline Frames

**Files:**
- Modify: `src/daemon/db/schema.ts`
- Create: `src/daemon/db/boardHeadlineFrameRepository.ts`
- Create: `src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts`
- Modify: `src/daemon/server.ts`

- [ ] **Step 1: Write failing repository test**

Add `src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { currentBoardHeadlineFrames, upsertBoardHeadlineFrame } from "../boardHeadlineFrameRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("board headline frame repository", () => {
  test("stores and loads latest frame by source session id", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-board-headlines-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");

    upsertBoardHeadlineFrame(db, {
      sessionId: "session-a",
      sourceSessionId: "source-a",
      generatedAt: "2026-07-01T12:00:00.000Z",
      provider: "openai",
      model: "gpt-5-nano-2025-08-07",
      frame: {
        subject: "Board headlines",
        disposition: "structured around subject and disposition",
        state: "active",
        subjectKind: "feature",
        confidence: "high",
        evidence: ["Frame extraction succeeded."]
      }
    });

    expect(currentBoardHeadlineFrames(db, new Set(["source-a"])).get("source-a")?.headline).toBe(
      "Board headlines: structured around subject and disposition."
    );
    db.close();
  });
});

function seedSession(db, sessionId: string, sourceSessionId: string): void {
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", "2026-07-01T12:00:00.000Z", "2026-07-01T12:00:00.000Z");
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run("runtime:test", "codex", "test", "2026-07-01T12:00:00.000Z", "2026-07-01T12:00:00.000Z");
  db.prepare(
    `INSERT INTO sessions (session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "host:test", "runtime:test", sourceSessionId, "running", "2026-07-01T12:00:00.000Z", "authoritative", "2026-07-01T12:00:00.000Z", "2026-07-01T12:00:00.000Z");
}
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest --run src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
```

Expected: FAIL because table/repository do not exist.

- [ ] **Step 3: Add schema migration**

In `src/daemon/db/schema.ts`, add a migration:

```sql
CREATE TABLE IF NOT EXISTS board_headline_frames (
  frame_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  frame_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_headline_frames_source_session ON board_headline_frames(source_session_id, generated_at DESC);
```

- [ ] **Step 4: Add repository**

Create `src/daemon/db/boardHeadlineFrameRepository.ts`:

```ts
import { renderBoardHeadlineFrame, validateBoardHeadlineFrame, type BoardHeadlineFrame, type BoardHeadlineView } from "../../core/boardHeadlineFrame.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type UpsertBoardHeadlineFrameInput = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frame: BoardHeadlineFrame;
};

export function upsertBoardHeadlineFrame(db: MastheadDatabase, input: UpsertBoardHeadlineFrameInput): void {
  const validation = validateBoardHeadlineFrame(input.frame);
  if (!validation.ok) throw new Error(`Invalid Board headline frame: ${validation.reason}`);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO board_headline_frames (
      frame_id, session_id, source_session_id, provider, model, generated_at, frame_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(frame_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      generated_at = excluded.generated_at,
      frame_json = excluded.frame_json,
      updated_at = excluded.updated_at`
  ).run(
    `board-headline:${input.sessionId}`,
    input.sessionId,
    input.sourceSessionId,
    input.provider,
    input.model,
    input.generatedAt,
    JSON.stringify(validation.frame),
    now,
    now
  );
}

export function currentBoardHeadlineFrames(db: MastheadDatabase, sourceSessionIds: Iterable<string>): Map<string, BoardHeadlineView> {
  const ids = [...new Set([...sourceSessionIds].filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT source_session_id AS sourceSessionId, provider, model, generated_at AS generatedAt, frame_json AS frameJson
       FROM board_headline_frames
       WHERE source_session_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY source_session_id ASC, generated_at DESC`
    )
    .all(...ids) as Array<{ sourceSessionId: string; provider: string; model: string; generatedAt: string; frameJson: string }>;

  const result = new Map<string, BoardHeadlineView>();
  for (const row of rows) {
    if (result.has(row.sourceSessionId)) continue;
    const parsed = safeJson(row.frameJson);
    const validation = validateBoardHeadlineFrame(parsed);
    if (!validation.ok) continue;
    result.set(row.sourceSessionId, {
      headline: renderBoardHeadlineFrame(validation.frame),
      frame: validation.frame,
      source: "llm",
      status: "ready",
      generatedAt: row.generatedAt,
      model: row.model,
      provider: row.provider
    });
  }
  return result;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run repository test**

Run:

```bash
npx vitest --run src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/db/schema.ts src/daemon/db/boardHeadlineFrameRepository.ts src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
git commit -m "feat: persist board headline frames"
```

---

## Task 10: Apply Persisted Frames In Projection

**Files:**
- Modify: `src/core/liveProjection.ts`
- Modify: `src/core/replay.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/__tests__/liveProjection.test.ts`

- [ ] **Step 1: Add failing test for last-good frame application**

In `src/core/__tests__/liveProjection.test.ts`, add:

```ts
test("applies last successful LLM headline frame when available", () => {
  const started = normalizeCodexHookPayload(
    {
      provider_event_id: "stored-frame-start",
      event: "session_started",
      session_id: "stored-frame-session",
      timestamp: "2026-07-01T12:00:00.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      title: "Board headline rebuild"
    },
    { receivedAt: "2026-07-01T12:00:00.010Z" }
  );

  const envelope = projectLiveEvents([started], [], {
    generatedAt: "2026-07-01T12:01:00.000Z",
    headlineMode: "llm",
    sessionHeadlineViews: new Map([
      [
        "stored-frame-session",
        {
          headline: "Board headlines: structured around subject and disposition.",
          source: "llm",
          status: "ready"
        }
      ]
    ])
  });

  expect(envelope.projection.cards[0]?.headline).toMatchObject({
    headline: "Board headlines: structured around subject and disposition.",
    source: "llm",
    status: "ready"
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest --run src/core/__tests__/liveProjection.test.ts
```

Expected: FAIL because `sessionHeadlineViews` is not wired.

- [ ] **Step 3: Add projection option**

In `src/core/liveProjection.ts`:

```ts
import type { BoardHeadlineView } from "./boardHeadlineFrame";

type LiveProjectionOptions = {
  ...
  sessionHeadlineViews?: Map<string, BoardHeadlineView>;
};
```

Pass to `projectFixture`.

In `src/core/replay.ts`, add `sessionHeadlineViews?: Map<string, BoardHeadlineView>` to `ProjectFixtureOptions`, then select:

```ts
const storedHeadline = options.sessionHeadlineViews?.get(session.sessionId);
const headline = storedHeadline ?? (headlineMode === "llm" ? buildPendingBoardHeadlineView(headlineInput) : buildOfflineBoardHeadlineView(headlineInput));
```

- [ ] **Step 4: Wire daemon repository**

In `src/daemon/server.ts`, import:

```ts
import { currentBoardHeadlineFrames } from "./db/boardHeadlineFrameRepository.ts";
```

Before `projectLiveEvents`:

```ts
const sessionHeadlineViews = currentBoardHeadlineFrames(database, projectionSessionIds);
```

Pass:

```ts
sessionHeadlineViews,
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest --run src/core/__tests__/liveProjection.test.ts src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/liveProjection.ts src/core/replay.ts src/daemon/server.ts src/core/__tests__/liveProjection.test.ts
git commit -m "feat: apply persisted board headline frames"
```

---

## Task 11: Persist Successful Background Frames From Daemon

**Files:**
- Modify: `src/core/boardHeadlineEnricher.ts`
- Modify: `src/core/__tests__/boardHeadlineEnricher.test.ts`
- Modify: `src/daemon/server.ts`

- [ ] **Step 1: Add callback test for successful frames**

In `src/core/__tests__/boardHeadlineEnricher.test.ts`, add:

```ts
test("calls onFrameApplied when a background frame completes", async () => {
  const response = deferredResponse();
  const onFrameApplied = vi.fn();
  const enricher = createBoardHeadlineEnricher({
    enabled: true,
    apiKey: "key",
    fetchImpl: vi.fn(() => response.promise),
    onFrameApplied
  });
  const projection = liveProjection([card()]);

  await enricher.enrichProjection(projection);
  response.resolve(frameResponse());
  await delay(0);
  await delay(0);

  expect(onFrameApplied).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "session-1",
      frame: expect.objectContaining({ subject: "Board headlines" })
    })
  );
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineEnricher.test.ts
```

Expected: FAIL because `onFrameApplied` is not supported.

- [ ] **Step 3: Add callback to enricher config**

Modify `src/core/boardHeadlineEnricher.ts`:

```ts
export type BoardHeadlineAppliedEvent = {
  sessionId: string;
  frame: BoardHeadlineFrame;
  headline: BoardHeadlineView;
  provider: string;
  model: string;
  generatedAt: string;
};

export type BoardHeadlineEnricherConfig = {
  ...
  onFrameApplied?: (event: BoardHeadlineAppliedEvent) => void;
};
```

When a background result succeeds:

```ts
const generatedAt = new Date(context.config.now?.() ?? Date.now()).toISOString();
const headline: BoardHeadlineView = {
  headline: renderBoardHeadlineFrame(result.frame),
  frame: result.frame,
  source: "llm",
  status: "ready",
  generatedAt,
  model: context.model,
  provider: "openai"
};
context.completed.set(key, headline);
context.config.onFrameApplied?.({
  sessionId: card.sessionId,
  frame: result.frame,
  headline,
  provider: "openai",
  model: context.model,
  generatedAt
});
```

- [ ] **Step 4: Wire callback in daemon**

In `src/daemon/server.ts`, import:

```ts
import { upsertBoardHeadlineFrame } from "./db/boardHeadlineFrameRepository.ts";
```

When creating `boardHeadlineEnricher`:

```ts
onFrameApplied: (event) => {
  const row = database
    .prepare("SELECT session_id AS sessionId, source_session_id AS sourceSessionId FROM sessions WHERE source_session_id = ?")
    .get(event.sessionId) as { sessionId: string; sourceSessionId: string } | undefined;
  if (!row) return;
  upsertBoardHeadlineFrame(database, {
    sessionId: row.sessionId,
    sourceSessionId: row.sourceSessionId,
    provider: event.provider,
    model: event.model,
    generatedAt: event.generatedAt,
    frame: event.frame
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest --run src/core/__tests__/boardHeadlineEnricher.test.ts src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/boardHeadlineEnricher.ts src/core/__tests__/boardHeadlineEnricher.test.ts src/daemon/server.ts
git commit -m "feat: persist completed board headline frames"
```

---

## Task 12: Update Session Card UI

**Files:**
- Modify: `src/ui/SessionCard.tsx`
- Modify: `src/ui/__tests__/observabilitySessionCard.test.tsx`
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Add failing UI tests**

In `src/ui/__tests__/observabilitySessionCard.test.tsx`, replace copy assertions with:

```tsx
test("renders frame headline text", () => {
  render(<SessionCard session={session({ headline: { headline: "Board headlines: structured around subject and disposition.", source: "llm", status: "ready" } })} />);

  expect(screen.getByText("Board headlines: structured around subject and disposition.")).toBeInTheDocument();
});

test("renders pending headline state without an AI failure badge", () => {
  render(<SessionCard session={session({ headline: { headline: "Generating headline...", source: "pending", status: "pending" } })} />);

  expect(screen.getByText("Generating headline...")).toBeInTheDocument();
  expect(screen.queryByText(/AI headline failed/i)).not.toBeInTheDocument();
});

test("renders offline headline source calmly when LLM access is unavailable", () => {
  render(<SessionCard session={session({ headline: { headline: "Board headlines: waiting for LLM headline access.", source: "offline", status: "ready" } })} />);

  expect(screen.getByText("Board headlines: waiting for LLM headline access.")).toBeInTheDocument();
  expect(screen.queryByText(/AI headline failed/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npx vitest --run src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: FAIL because `SessionCard` still reads `session.copy`.

- [ ] **Step 3: Update `SessionCard.tsx`**

Replace headline rendering references:

```tsx
session.copy.headline
session.copy.reason
session.copy.status
session.copyRefresh
```

with:

```tsx
session.headline.headline
session.headline.frame?.evidence?.[0] ?? headlineSourceLabel(session.headline.source)
session.headline.frame?.state ?? session.headline.status
session.headlineRefresh
```

Remove `CopyRefreshBadge` or replace it with:

```tsx
function HeadlineSourceBadge({ session }: { session: SessionCardView }) {
  if (session.headline.source === "pending") return <span className="headline-source pending">Pending</span>;
  if (session.headline.source === "offline") return <span className="headline-source offline">Offline</span>;
  return null;
}

function headlineSourceLabel(source: SessionCardView["headline"]["source"]): string {
  if (source === "pending") return "Waiting for generated Board headline.";
  if (source === "offline") return "Local headline because LLM access is unavailable.";
  if (source === "llm") return "Generated from validated Board headline frame.";
  return "Board headline evidence.";
}
```

Do not render `AI headline failed` on cards.

- [ ] **Step 4: Update CSS**

In `src/styles/masthead.css`, replace `.copy-refresh-badge` rules with:

```css
.headline-source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1;
}

.headline-source.pending {
  opacity: 0.72;
}

.headline-source.offline {
  opacity: 0.68;
}
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
npx vitest --run src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/SessionCard.tsx src/ui/__tests__/observabilitySessionCard.test.tsx src/styles/masthead.css
git commit -m "refactor: render board headline views in session cards"
```

---

## Task 13: Delete Legacy Session Copy API

**Files:**
- Delete: `src/core/openaiSessionCopy.ts`
- Delete or rewrite: `src/core/__tests__/openaiSessionCopy.test.ts`
- Modify or delete: `src/core/sessionCopy.ts`
- Modify: all imports found by `rg "SessionPlainCopy|sessionCopy|copyRefresh|copyInput|\\.copy\\b" src`

- [ ] **Step 1: Search legacy references**

Run:

```bash
rg -n "SessionPlainCopy|SessionCopy|openaiSessionCopy|copyRefresh|copyInput|copyRefreshSummary|\\.copy\\b" src docs
```

Expected: Output still includes legacy references.

- [ ] **Step 2: Delete old OpenAI copy module**

Run:

```bash
git rm src/core/openaiSessionCopy.ts src/core/__tests__/openaiSessionCopy.test.ts
```

- [ ] **Step 3: Remove old deterministic copy functions**

If `src/core/sessionCopy.ts` has no non-Board uses, delete it:

```bash
git rm src/core/sessionCopy.ts src/core/__tests__/sessionCopy.test.ts
```

If another non-Board surface still imports it, reduce it to that surface only and remove these exports:

```ts
buildDeterministicSessionCopy
validateSessionCopy
SessionCopyInput
SessionCopyRefreshContext
SessionCopyRecentDelta
SessionCopySignal
sessionCopyCacheKey
```

- [ ] **Step 4: Update docs search references**

Replace docs terminology:

- `session copy` -> `Board headline frame` where it refers to Board headlines.
- `copyRefresh` -> `headlineRefresh`.
- `copyRefreshSummary` -> `headlineRefreshSummary`.
- `AI headline failed` -> remove from Board docs.

- [ ] **Step 5: Run search until clean**

Run:

```bash
rg -n "SessionPlainCopy|openaiSessionCopy|copyRefresh|copyInput|copyRefreshSummary|AI headline failed" src docs
```

Expected: No matches, except historical plan files under `docs/superpowers/plans/` if you intentionally exclude them:

```bash
rg -n "SessionPlainCopy|openaiSessionCopy|copyRefresh|copyInput|copyRefreshSummary|AI headline failed" src docs --glob '!docs/superpowers/plans/**'
```

- [ ] **Step 6: Run compile and tests**

Run:

```bash
npm run typecheck
npx vitest --run src/core src/daemon src/ui
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src docs
git commit -m "refactor: remove legacy session copy API"
```

---

## Task 14: Update Board Documentation And Configuration Reference

**Files:**
- Modify: `docs/reference/board.md`
- Modify: `docs/reference/session-copy.md`
- Modify: `docs/reference/configuration.md`
- Modify: `docs/acceptance/product-release-gate.md`

- [ ] **Step 1: Update Board docs**

Replace `docs/reference/board.md` with content matching this structure:

```md
# Board

Board is Masthead's live view over continuously collected session data. It is not the canonical database; it projects the latest canonical and live evidence into cards.

## Headline Contract

Board headlines use a validated frame:

`Subject: disposition.`

The frame contains `subject`, `disposition`, `state`, `subjectKind`, `confidence`, and `evidence`. The model extracts the frame. Masthead renders the final headline.

## LLM-first Behavior

When live headline generation is enabled and configured, Board cards use the latest successful LLM frame or a pending headline state. Masthead does not render deterministic fallback prose while waiting for the model.

## Offline Behavior

Offline headline generation is used only when LLM access is unavailable or live headline generation is disabled. Offline headlines are marked with `source: "offline"`.

## Failure Handling

Provider failures are recorded in the enrichment audit stream. They do not block `/projection` and do not render visible AI failure badges on cards.
```

- [ ] **Step 2: Rename session-copy docs**

Either rename `docs/reference/session-copy.md` to `docs/reference/board-headlines.md`, or replace its contents with a pointer:

```md
# Board Headline Frames

Board headline generation is documented in `docs/reference/board.md`.

Historical `SessionPlainCopy` APIs are retired. Board cards expose `headline`, `headlineInput`, and `headlineRefresh`.
```

- [ ] **Step 3: Update configuration docs**

In `docs/reference/configuration.md`, update optional enrichment rows:

```md
| `MASTHEAD_LIVE_COPY` | Set to `0` or `1` to explicitly disable or enable live Board headline frame generation |
| `MASTHEAD_LIVE_COPY_TIMEOUT_MS` | Timeout for individual background Board headline frame requests. Defaults to `12000` |
| `OPENAI_API_KEY` | API key for live Board headline frames and optional remote enrichment |
```

- [ ] **Step 4: Update release gate**

In `docs/acceptance/product-release-gate.md`, replace Board live copy checklist entries with:

```md
- [ ] Board cards render validated `Subject: disposition.` headlines from `BoardHeadlineFrame`.
- [ ] With LLM access configured, Board cards show pending or last successful LLM frames, not deterministic fallback prose.
- [ ] With LLM access disabled or unavailable, Board cards show offline headline frames marked as offline.
- [ ] Provider failures do not block `/projection` or render visible AI failure badges.
```

- [ ] **Step 5: Commit**

```bash
git add docs/reference/board.md docs/reference/session-copy.md docs/reference/configuration.md docs/acceptance/product-release-gate.md
git commit -m "docs: document board headline frame contract"
```

---

## Task 15: Final Verification Without Stealing Electron Port

**Files:**
- No product code changes.

- [ ] **Step 1: Run full static verification**

Run:

```bash
npm run typecheck
npm run build:daemon
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest --run \
  src/core/__tests__/boardHeadlineFrame.test.ts \
  src/core/__tests__/boardHeadlineInput.test.ts \
  src/core/__tests__/offlineBoardHeadline.test.ts \
  src/core/__tests__/openaiBoardHeadlineFrame.test.ts \
  src/core/__tests__/boardHeadlineEnricher.test.ts \
  src/core/__tests__/liveProjection.test.ts \
  src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run broader relevant suites**

Run:

```bash
npx vitest --run src/core src/daemon src/ui
```

Expected: PASS. If this is too broad or slow, capture the exact failing/slow test list and rerun the failing subsets after fixes.

- [ ] **Step 4: Optional visual check on non-5173 port**

Only if the user approves browser/worktree testing:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
```

Open `http://127.0.0.1:5180`, not `5173`.

Expected:

- Board cards show `Subject: disposition.` headlines when LLM frames are available.
- Cards show `Generating headline...` while LLM frames are pending.
- Cards do not show `AI headline failed`.
- Offline mode shows an offline badge/source state only when LLM access is unavailable or disabled.

- [ ] **Step 5: Final search**

Run:

```bash
rg -n "AI headline failed|recent activity|recent completion note|SessionPlainCopy|copyRefresh|copyInput|copyRefreshSummary" src docs --glob '!docs/superpowers/plans/**'
```

Expected:

- No `SessionPlainCopy`, `copyRefresh`, `copyInput`, or `copyRefreshSummary`.
- No visible `AI headline failed`.
- Any remaining `recent activity` references must be test fixtures asserting rejection or documentation listing banned phrases.

- [ ] **Step 6: Final commit**

```bash
git status --short
git add -A
git commit -m "feat: rebuild board headlines around llm frames"
```

---

## Self-Review

### Spec Coverage

- Fixed headline grammar: covered by Tasks 1, 5, 7, 12, and 14.
- No model free-written headline: covered by Tasks 1 and 5.
- LLM-first behavior: covered by Tasks 6, 8, and 12.
- Deterministic fallback only without LLM access: covered by Tasks 4, 6, 7, and 8.
- Remove `SessionPlainCopy` API: covered by Tasks 2 and 13.
- Preserve background refresh behavior: covered by Tasks 6, 8, 9, 10, and 11.
- Persist last good LLM frames: covered by Tasks 9 through 11.
- UI no longer shows headline failure badges: covered by Task 12.
- Docs updated: covered by Task 14.
- No `5173` dev-server theft: covered by Task 15.

### Placeholder Scan

This plan avoids `TBD`, `TODO`, and “write tests for the above” placeholders. Each task includes exact target files, test snippets, implementation snippets, commands, and expected outcomes.

### Type Consistency

Final names used throughout:

- `BoardHeadlineFrame`
- `BoardHeadlineView`
- `BoardHeadlineInput`
- `BoardHeadlineRefreshState`
- `headline`
- `headlineInput`
- `headlineRefresh`
- `headlineRefreshSummary`

Legacy names intentionally removed:

- `SessionPlainCopy`
- `SessionCopyInput`
- `copy`
- `copyInput`
- `copyRefresh`
- `copyRefreshSummary`

