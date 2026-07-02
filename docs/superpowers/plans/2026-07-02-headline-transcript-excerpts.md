# Headline Transcript Excerpts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Board headline LLM requests enough role-labeled transcript context to write useful headlines, and make disabled hook transcript catch-up obvious because it prevents live token import.

**Architecture:** Add a bounded `transcriptExcerpt` to `BoardHeadlineFacts` and use it as the primary OpenAI payload and refresh-key input. Keep hook/tool/file data as secondary context. Surface hook transcript catch-up state in health so disabled live token capture is diagnosable.

**Tech Stack:** TypeScript, Vitest, Node SQLite, Masthead daemon and core projection modules.

---

### Task 1: Transcript Excerpt Contract

**Files:**
- Modify: `src/core/boardHeadlineFacts.ts`
- Test: `src/core/__tests__/boardHeadlineFacts.test.ts`

- [ ] **Step 1: Write failing tests**
  - Add a test that sends recent user and assistant transcript messages through `buildBoardHeadlineFacts`.
  - Assert `facts.transcriptExcerpt` preserves roles, includes assistant progress text, and is bounded.

- [ ] **Step 2: Implement minimal facts support**
  - Add `BoardHeadlineTranscriptExcerpt`.
  - Build `transcriptExcerpt` from recent transcript facts with redaction, placeholder filtering, per-message length cap, count cap, and total character budget.
  - Derive `recentTranscriptMessages` from the excerpt for existing candidate/evidence paths.

### Task 2: OpenAI Payload And Refresh Key

**Files:**
- Modify: `src/core/openaiBoardHeadlineFrame.ts`
- Modify: `src/core/boardHeadlineRefreshKey.ts`
- Test: `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`
- Test: `src/core/__tests__/boardHeadlineRefreshKey.test.ts`

- [ ] **Step 1: Write failing tests**
  - Assert OpenAI payload includes `facts.transcriptExcerpt` with roles and text.
  - Assert refresh keys are undefined without transcript excerpt and change when excerpt text changes.

- [ ] **Step 2: Implement minimal payload/key support**
  - Add `transcriptExcerpt` to the OpenAI provider payload.
  - Update instructions to name `facts.transcriptExcerpt` as primary context.
  - Build refresh keys from role-labeled transcript excerpt, falling back to legacy strings only when needed.

### Task 3: Token Catch-Up Diagnostics

**Files:**
- Modify: `src/daemon/healthService.ts`
- Test: relevant health/config tests

- [ ] **Step 1: Write failing test**
  - Assert health output exposes hook transcript catch-up as disabled when config sets `hookTranscriptCatchupEnabled: false`.

- [ ] **Step 2: Implement minimal health field**
  - Add a stable boolean under health data or runtime diagnostics so Settings/doctor can detect disabled catch-up.

### Task 4: Verification

- [ ] Run focused tests:
  - `npx vitest --run src/core/__tests__/boardHeadlineFacts.test.ts src/core/__tests__/openaiBoardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineRefreshKey.test.ts`
  - plus health tests touched by Task 3.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run verify:no-citations`.
- [ ] Run `npm test -- --run` if focused checks are clean.
