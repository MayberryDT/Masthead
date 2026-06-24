# Session-Centric Control Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Masthead from a stacked dashboard into the research-backed session-centric control desktop: left session rail, center natural-language ops scan, and right technical inspector.

**Architecture:** Keep the current projection, ingestion, dogfood, and session-copy data flow. This plan changes the visible information architecture first: extract detail rendering into a reusable inspector, add a three-pane shell, move session navigation into a left rail, keep natural-language scanning in the center, and make technical details persistent in the right pane. The redesign ships behind the existing app path, with no new event model or adapter behavior.

**Tech Stack:** React, TypeScript, CSS, Vitest server-render tests, Vite, Codex in-app Browser with `iab` backend for local visual QA.

---

## Optimizer Result

**Final score:** 92/100

**Rubric:**

| Criterion | Weight | Score | Rationale |
|---|---:|---:|---|
| Visible redesign impact | 25 | 24 | Three-pane layout and first-viewport acceptance are explicit. |
| Implementation safety | 20 | 18 | Inspector extraction happens before app-shell integration; data flow remains unchanged. |
| Testability | 20 | 18 | Component tests, focused UI tests, full suite, build, dogfood, and Browser QA are specified. |
| Responsive craft | 15 | 13 | Mobile/tablet checkpoints and failure fixes are explicit; final exact CSS may need Browser tuning. |
| Privacy/calm-scan boundary | 10 | 10 | Rail and center explicitly reject raw technical metadata; inspector owns technical detail. |
| Sequencing and rollback | 10 | 9 | Tasks are ordered by dependency and include a rollback point before App integration. |

**Score trajectory:** 82 -> 89 -> 92 -> 92

**Substantive improvements from the first draft:**

- Added a baseline visual evidence step so implementation can prove the UI actually changed.
- Reordered work to extract the inspector before rewiring the app shell, reducing breakage risk.
- Added a design contract, risk table, rollback point, and stricter Browser QA acceptance.

---

## Design Contract

This is the first implementation slice. It must make the app visibly different without changing the underlying Masthead runtime.

**Main layout:**

- Left rail: session navigation, source state, summary counts, and calm session labels.
- Center scan: connection state, ops brief, board summary, search/filter toolbar, visible session cards, and attention queue.
- Right inspector: selected-session technical detail, latest feedback, evidence, timeline, safe actions, local history, and operations.

**Copy boundary:**

- Rail and center use natural-language copy from `SessionCardView.copy`.
- Rail and center must not render raw session titles, branches, paths, commands, event types, or evidence IDs.
- Inspector can render technical detail that already exists in `SessionDetailView`, because it is the explicit drill-down surface.

**Scope exclusions for this slice:**

- No adapter work.
- No storage schema changes.
- No ingestion/hook changes.
- No OpenAI prompt changes.
- No plugin manager, command palette, provider metrics, or project tree yet.

**Rollback point:**

- After Task 3, the extracted `SessionInspector` should still work through the existing modal. If shell integration becomes messy, stop there and keep the app behavior unchanged while retaining the reusable inspector component.

---

## File Structure

- Create `src/ui/ControlDesktopShell.tsx`  
  Owns the three-pane landmarks and responsive shell slots.

- Create `src/ui/SessionRail.tsx`  
  Renders left-pane session navigation from `SessionCardView[]` and `LiveBoardProjection["summary"]`.

- Create `src/ui/SessionInspector.tsx`  
  Extracts the existing selected-session technical detail UI from `SessionDetailModal.tsx`.

- Modify `src/ui/SessionDetailModal.tsx`  
  Becomes a thin modal wrapper around `SessionInspector`, preserving focus trapping and Escape close behavior.

- Modify `src/ui/SessionBoard.tsx`  
  Renders only lanes/cards and emits selection changes. It no longer owns desktop detail rendering.

- Modify `src/app/App.tsx`  
  Composes the three-pane shell using the existing data already derived in App.

- Modify `src/styles/masthead.css`  
  Adds shell, rail, inspector, responsive behavior, and mobile nav fixes if Browser QA finds nav collision.

- Modify `src/ui/__tests__/liveBoard.test.tsx`  
  Verifies shell landmarks, center scan, inspector empty state, and absence of unsafe actions.

- Create `src/ui/__tests__/controlDesktopShell.test.tsx`  
  Verifies slot rendering and landmark labels.

- Create `src/ui/__tests__/sessionRail.test.tsx`  
  Verifies calm rail copy, counts, selection state, and raw metadata suppression.

- Create `src/ui/__tests__/sessionInspector.test.tsx`  
  Verifies empty state, selected technical detail, and action rendering.

---

## Risks And Mitigations

| Risk | Trigger | Mitigation |
|---|---|---|
| UI still looks like stacked cards | Browser desktop screenshot shows vertical stack or equal-weight panels | Do not proceed to final verification; adjust `.control-desktop` grid and pane styling until three-pane structure is visually obvious. |
| Raw metadata leaks into scan surface | Tests or Browser body check finds raw branch/path/command/title in rail or center | Keep raw fields out of `SessionRail`; use only `project`, `copy`, counts, indicators, and status labels. |
| Inspector extraction breaks modal tests | `liveBoard.test.tsx` or modal assertions fail after extraction | Fix `SessionDetailModal` as a wrapper before App integration. |
| Mobile becomes unusable | Browser at 320/360/390/430 shows horizontal overflow or sticky trapped panes | Stack shell panes, disable sticky rail/inspector, and reduce nav chrome under 760px. |
| Existing dogfood gates regress | `dogfood:fixture` reports `calmOpsCopy` or `feedbackSnapshotPrivacy` false | Revert scan-surface copy changes and inspect the serialized projection/UI assumptions. |

---

## Task 0: Capture Baseline Visual State

**Files:**
- Read: `src/app/App.tsx`
- Read: `src/styles/masthead.css`
- Read: `src/ui/SessionBoard.tsx`
- Read: `src/ui/SessionDetailModal.tsx`
- Artifact: `/tmp/masthead-before-control-desktop.png`

- [ ] **Step 1: Start or reuse the dev server**

Run:

```bash
npm run dev
```

Expected: Vite serves Masthead at a localhost URL, usually `http://127.0.0.1:5173`.

- [ ] **Step 2: Capture the current desktop UI**

Use the Codex in-app Browser with the `iab` backend. Navigate to the Vite URL and capture a desktop screenshot at `1280 x 800`.

Save or emit the screenshot as:

```text
/tmp/masthead-before-control-desktop.png
```

Expected: Current UI shows the old stacked layout. Use this as visual proof that the redesign changes the first viewport.

- [ ] **Step 3: Record current high-level DOM landmarks**

In the in-app Browser, run a read-only DOM check that returns whether these current sections exist:

```text
nav
#sessions
#attention
#history
#operations
```

Expected: Existing sections are present. This is the baseline before shell landmarks are added.

---

## Task 1: Add Failing Tests For Shell, Rail, And Inspector

**Files:**
- Create: `src/ui/__tests__/controlDesktopShell.test.tsx`
- Create: `src/ui/__tests__/sessionRail.test.tsx`
- Create: `src/ui/__tests__/sessionInspector.test.tsx`

- [ ] **Step 1: Create shell landmark test**

Create `src/ui/__tests__/controlDesktopShell.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ControlDesktopShell } from "../ControlDesktopShell";

describe("ControlDesktopShell", () => {
  test("renders the three-pane control desktop landmarks", () => {
    const html = renderToStaticMarkup(
      <ControlDesktopShell
        rail={<p>Session rail</p>}
        center={<p>Ops scan</p>}
        inspector={<p>Technical inspector</p>}
      />
    );

    expect(html).toContain("Session rail");
    expect(html).toContain("Ops scan");
    expect(html).toContain("Technical inspector");
    expect(html).toContain("aria-label=\"Session navigation\"");
    expect(html).toContain("aria-label=\"Operations scan\"");
    expect(html).toContain("aria-label=\"Session inspector\"");
  });
});
```

- [ ] **Step 2: Create rail behavior test**

Create `src/ui/__tests__/sessionRail.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SessionCardView } from "../../core/types";
import { SessionRail } from "../SessionRail";

describe("SessionRail", () => {
  test("renders calm session navigation without raw technical metadata", () => {
    const html = renderToStaticMarkup(
      <SessionRail
        sourceLabel="Live ingestion"
        summary={{ active: 1, needsAttention: 1, conflicts: 0, completed: 0, running: 1, idle: 0, needsAction: 0 }}
        sessions={[
          session({
            sessionId: "session-1",
            project: "Masthead",
            title: "Fix private branch src/auth/token.ts",
            branchOrWorktree: "agent/private-branch",
            copy: {
              headline: "Auth work",
              status: "Tests need another look.",
              reason: "A failed test signal is visible.",
              source: "deterministic"
            }
          })
        ]}
        selectedSessionId="session-1"
        onSelectSession={() => undefined}
      />
    );

    expect(html).toContain("Live ingestion");
    expect(html).toContain("1 active");
    expect(html).toContain("1 needs attention");
    expect(html).toContain("Auth work");
    expect(html).toContain("Tests need another look.");
    expect(html).toContain("aria-current=\"true\"");
    expect(html).not.toContain("Fix private branch");
    expect(html).not.toContain("src/auth/token.ts");
    expect(html).not.toContain("agent/private-branch");
  });
});

function session(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Raw title",
    copy: {
      headline: "Session activity",
      status: "Work is active.",
      reason: "No blocker is visible.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 10,
    durationLabel: "4m",
    branchOrWorktree: "local",
    lastActivity: "2026-06-23T02:04:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 1,
    indicators: ["attention"],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}
```

- [ ] **Step 3: Create inspector behavior test**

Create `src/ui/__tests__/sessionInspector.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SessionDetailView } from "../../core/types";
import { SessionInspector } from "../SessionInspector";

describe("SessionInspector", () => {
  test("renders an empty inspector state when nothing is selected", () => {
    const html = renderToStaticMarkup(<SessionInspector session={undefined} />);

    expect(html).toContain("Select a session");
    expect(html).toContain("Technical details appear here");
  });

  test("renders technical detail for the selected session", () => {
    const html = renderToStaticMarkup(<SessionInspector session={session()} />);

    expect(html).toContain("Still running");
    expect(html).toContain("Latest agent feedback");
    expect(html).toContain("Implementation is complete, but auth tests are still failing.");
    expect(html).toContain("1 timeline events");
    expect(html).toContain("open source session");
  });
});

function session(): SessionDetailView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Raw selected title",
    copy: {
      headline: "Still running",
      status: "Tests need another look.",
      reason: "A failed test signal is visible.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 10,
    durationLabel: "4m",
    lastActivity: "2026-06-23T02:04:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 1,
    indicators: ["attention"],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: true,
    currentActivity: "Running",
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
    reviewAnnotations: [],
    evidence: { observed: [], inferred: [], missing: [] },
    conflicts: [],
    attentionItems: [],
    timeline: [
      { eventId: "event-1", type: "file.changed", occurredAt: "2026-06-23T02:04:00.000Z", summary: "File changed" }
    ]
  };
}
```

- [ ] **Step 4: Run tests and confirm they fail for missing modules**

Run:

```bash
npm test -- --run src/ui/__tests__/controlDesktopShell.test.tsx src/ui/__tests__/sessionRail.test.tsx src/ui/__tests__/sessionInspector.test.tsx
```

Expected: FAIL because `ControlDesktopShell`, `SessionRail`, and `SessionInspector` do not exist yet.

---

## Task 2: Extract SessionInspector Before Rewiring The App

**Files:**
- Create: `src/ui/SessionInspector.tsx`
- Modify: `src/ui/SessionDetailModal.tsx`
- Test: `src/ui/__tests__/sessionInspector.test.tsx`
- Test: `src/ui/__tests__/liveBoard.test.tsx`

- [ ] **Step 1: Create `SessionInspector.tsx` with moved detail sections**

Create `src/ui/SessionInspector.tsx` by moving the section-rendering helpers from `src/ui/SessionDetailModal.tsx`: `StateSection`, `LatestFeedbackSection`, `AttentionConflictSection`, `EvidenceSection`, `TimelineSection`, `ActionsSection`, `reviewSummary`, and `actionLabel`.

The new top-level component must start with this public API:

```tsx
import type { SafeAction, SessionDetailView } from "../core/types";
import { stateClassName, statusTokenLabel } from "./format";

type Props = {
  session?: SessionDetailView;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
};

export function SessionInspector({ session, onAction, actionStatus }: Props) {
  if (!session) {
    return (
      <section className="session-inspector-panel empty" aria-label="Session inspector empty state">
        <p className="mono-label">Inspector</p>
        <h2>Select a session</h2>
        <p>Technical details appear here after a session is selected.</p>
      </section>
    );
  }

  const sections = session.inspectorSections ?? ["state", "attention_conflicts", "evidence", "timeline", "actions"];

  return (
    <article className={`session-inspector-panel ${stateClassName(session)}`} aria-label="Selected session technical details">
      <header className="inspector-head">
        <div>
          <p className="mono-label">
            {session.project} / {session.title}
          </p>
          <h2>{session.copy.headline}</h2>
        </div>
        <span className={`state-token ${session.indicators.includes("attention") ? "attention" : ""}`}>
          {statusTokenLabel(session)}
        </span>
      </header>

      <div className="modal-content inspector-content">
        {sections.map((section) => {
          if (section === "state") return <StateSection key={section} session={session} />;
          if (section === "latest_feedback" && session.latestFeedback) return <LatestFeedbackSection key={section} session={session} />;
          if (section === "attention_conflicts") return <AttentionConflictSection key={section} session={session} />;
          if (section === "evidence") return <EvidenceSection key={section} session={session} />;
          if (section === "timeline") return <TimelineSection key={section} session={session} />;
          if (section === "actions") return <ActionsSection key={section} session={session} onAction={onAction} actionStatus={actionStatus} />;
          return null;
        })}
      </div>
    </article>
  );
}
```

Keep the moved helper implementations behaviorally identical to the current modal helpers.

- [ ] **Step 2: Convert `SessionDetailModal.tsx` into a wrapper**

Replace the detail body in `src/ui/SessionDetailModal.tsx` with `SessionInspector`, while preserving the existing modal backdrop, role, focus, Escape close, and Tab trap behavior.

The final file should contain:

```tsx
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SafeAction, SessionDetailView } from "../core/types";
import { SessionInspector } from "./SessionInspector";

type Props = {
  session: SessionDetailView;
  onClose: () => void;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
};

export function SessionDetailModal({ session, onClose, onAction, actionStatus }: Props) {
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    modalRef.current?.focus();
  }, [session.sessionId]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article
        ref={modalRef}
        className="session-detail-modal"
        aria-labelledby={`${session.sessionId}-modal-title`}
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, modalRef.current, onClose)}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={`${session.sessionId}-modal-title`}>{session.copy.headline}</h2>
          <button type="button" className="icon-button" aria-label="Close session details" onClick={onClose}>
            x
          </button>
        </header>
        <SessionInspector session={session} onAction={onAction} actionStatus={actionStatus} />
      </article>
    </div>
  );
}
```

Keep the existing `handleModalKeyDown` implementation in the same file.

- [ ] **Step 3: Run inspector and existing modal tests**

Run:

```bash
npm test -- --run src/ui/__tests__/sessionInspector.test.tsx src/ui/__tests__/liveBoard.test.tsx
```

Expected: PASS. The app still uses the existing modal path at this point, but its content comes from `SessionInspector`.

---

## Task 3: Add ControlDesktopShell And SessionRail

**Files:**
- Create: `src/ui/ControlDesktopShell.tsx`
- Create: `src/ui/SessionRail.tsx`
- Modify: `src/styles/masthead.css`
- Test: `src/ui/__tests__/controlDesktopShell.test.tsx`
- Test: `src/ui/__tests__/sessionRail.test.tsx`

- [ ] **Step 1: Create `ControlDesktopShell.tsx`**

Create `src/ui/ControlDesktopShell.tsx`:

```tsx
import type { ReactNode } from "react";

type Props = {
  rail: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
};

export function ControlDesktopShell({ rail, center, inspector }: Props) {
  return (
    <main className="control-desktop" aria-label="Masthead control desktop">
      <aside className="control-rail" aria-label="Session navigation">
        {rail}
      </aside>
      <section className="control-center" aria-label="Operations scan">
        {center}
      </section>
      <aside className="control-inspector" aria-label="Session inspector">
        {inspector}
      </aside>
    </main>
  );
}
```

- [ ] **Step 2: Create `SessionRail.tsx`**

Create `src/ui/SessionRail.tsx`:

```tsx
import type { LiveBoardProjection, SessionCardView } from "../core/types";

type Props = {
  sourceLabel: string;
  summary: LiveBoardProjection["summary"];
  sessions: SessionCardView[];
  selectedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
};

export function SessionRail({ sourceLabel, summary, sessions, selectedSessionId, onSelectSession }: Props) {
  return (
    <div className="session-rail-panel">
      <header className="rail-head">
        <p className="mono-label">Control plane</p>
        <h2>Sessions</h2>
        <span className="source-token">{sourceLabel}</span>
      </header>

      <dl className="rail-counts" aria-label="Session counts">
        <div>
          <dt>Active</dt>
          <dd>{summary.active} active</dd>
        </div>
        <div>
          <dt>Attention</dt>
          <dd>{summary.needsAttention} needs attention</dd>
        </div>
        <div>
          <dt>Conflicts</dt>
          <dd>{summary.conflicts} overlaps</dd>
        </div>
      </dl>

      <nav className="rail-session-list" aria-label="Visible sessions">
        {sessions.length === 0 ? (
          <p className="rail-empty">No sessions are visible.</p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              className={`rail-session ${session.sessionId === selectedSessionId ? "selected" : ""}`}
              onClick={() => onSelectSession(session.sessionId)}
              aria-current={session.sessionId === selectedSessionId ? "true" : undefined}
            >
              <span className="rail-session-project">{session.project}</span>
              <strong>{session.copy.headline}</strong>
              <span>{session.copy.status}</span>
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: Add shell, rail, and inspector CSS**

Append these styles after the existing `main` rule in `src/styles/masthead.css`:

```css
.control-desktop {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(520px, 1fr) minmax(320px, 420px);
  gap: 14px;
  width: min(1760px, calc(100vw - 24px));
  min-height: calc(100vh - 80px);
  margin: 0 auto;
  padding: 14px 0 36px;
}

.control-rail,
.control-center,
.control-inspector {
  min-width: 0;
}

.control-rail,
.control-inspector {
  position: sticky;
  top: 70px;
  align-self: start;
  max-height: calc(100vh - 90px);
  overflow: auto;
}

.control-center,
.control-inspector,
.session-rail-panel,
.session-inspector-panel {
  display: grid;
  align-content: start;
  gap: 14px;
}

.session-rail-panel,
.session-inspector-panel {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  padding: 14px;
}

.rail-head {
  display: grid;
  gap: 8px;
}

.rail-head .source-token {
  justify-self: start;
}

.rail-counts {
  display: grid;
  gap: 8px;
}

.rail-counts div,
.rail-session {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-elevated);
}

.rail-counts div {
  padding: 10px;
}

.rail-counts dt {
  color: var(--ash);
  font-family: var(--font-mono);
  font-size: 11px;
}

.rail-counts dd {
  margin-top: 4px;
  color: var(--body);
  font-size: 13px;
}

.rail-session-list {
  display: grid;
  gap: 8px;
}

.rail-session {
  display: grid;
  width: 100%;
  min-height: 82px;
  gap: 5px;
  padding: 11px;
  color: var(--body);
  text-align: left;
}

.rail-session.selected {
  border-color: var(--line-strong);
  background: var(--surface-card);
}

.rail-session-project {
  color: var(--ash);
  font-family: var(--font-mono);
  font-size: 11px;
}

.rail-session strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.rail-session span:last-child,
.rail-empty {
  color: var(--mute);
  font-size: 12px;
  line-height: 1.4;
}

.session-inspector-panel.empty {
  min-height: 180px;
  align-content: center;
}

.inspector-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.inspector-content {
  display: grid;
  gap: 10px;
}
```

- [ ] **Step 4: Run new component tests**

Run:

```bash
npm test -- --run src/ui/__tests__/controlDesktopShell.test.tsx src/ui/__tests__/sessionRail.test.tsx src/ui/__tests__/sessionInspector.test.tsx
```

Expected: PASS.

---

## Task 4: Integrate The Three-Pane Shell In App

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/ui/SessionBoard.tsx`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`

- [ ] **Step 1: Remove desktop modal ownership from `SessionBoard`**

Modify `src/ui/SessionBoard.tsx` so the prop type is:

```tsx
type Props = {
  cards: SessionCardView[];
  lanes?: LifecycleLaneView[];
  onOpenSession?: (sessionId: string) => void;
  emptyTitle?: string;
  emptyMessage?: string;
};
```

Remove the `selectedSession`, `onCloseSession`, `onSessionAction`, and `actionStatus` props from the function signature.

Remove the `SessionDetailModal` render at the bottom of the component.

Keep card clicks unchanged:

```tsx
return card ? <SessionCard key={sessionId} session={card} onToggle={onOpenSession} /> : null;
```

- [ ] **Step 2: Add shell imports in `App.tsx`**

Add these imports to `src/app/App.tsx`:

```tsx
import { ControlDesktopShell } from "../ui/ControlDesktopShell";
import { SessionInspector } from "../ui/SessionInspector";
import { SessionRail } from "../ui/SessionRail";
```

- [ ] **Step 3: Replace the stacked `<main>` with `ControlDesktopShell`**

Replace the current `<main>...</main>` block in `src/app/App.tsx` with:

```tsx
<ControlDesktopShell
  rail={
    <SessionRail
      sourceLabel={boardSource}
      summary={board.summary}
      sessions={filteredCards}
      selectedSessionId={filteredSelectedSession?.sessionId ?? null}
      onSelectSession={setSelectedSessionId}
    />
  }
  center={
    <>
      <ConnectionStatus
        connection={liveConnection}
        projectionUrl={liveProjectionUrl}
        showDemoData={showDemoData}
        onToggleDemoData={handleToggleDemoData}
      />
      <BriefingStrip brief={board.brief} summary={board.summary} cardCount={board.cards.length} />
      <BoardSummary summary={board.summary} />
      <Toolbar
        query={query}
        filter={filter}
        resultCount={filteredCards.length}
        totalCount={board.cards.length}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        searchInputRef={searchInputRef}
      />
      <SessionBoard
        cards={filteredCards}
        lanes={board.lanes}
        emptyTitle={emptyBoardTitle({ showDemoData, query, liveConnection })}
        emptyMessage={emptyBoardMessage({ showDemoData, query, liveConnection })}
        onOpenSession={setSelectedSessionId}
      />
      <AttentionQueue items={board.attentionQueue} />
    </>
  }
  inspector={
    <>
      <SessionInspector
        session={filteredSelectedSession}
        onAction={handleSessionAction}
        actionStatus={sessionActionStatus?.sessionId === filteredSelectedSession?.sessionId ? sessionActionStatus.message : undefined}
      />
      <HistoryPanel records={historyRecords} query={historyQuery} onQueryChange={setHistoryQuery} />
      <OperationsPanel
        localDataStatus={localDataStatus}
        onExportLocalData={handleExportLocalData}
        onRequestPruneLocalData={handleRequestPruneLocalData}
        onConfirmPruneLocalData={handleConfirmPruneLocalData}
        onRequestDeleteLocalData={handleRequestDeleteLocalData}
        onConfirmDeleteLocalData={handleConfirmDeleteLocalData}
      />
    </>
  }
/>
```

- [ ] **Step 4: Update `liveBoard.test.tsx` shell expectations**

In `src/ui/__tests__/liveBoard.test.tsx`, add these expectations to the main app render test:

```tsx
expect(html).toContain("aria-label=\"Masthead control desktop\"");
expect(html).toContain("aria-label=\"Session navigation\"");
expect(html).toContain("aria-label=\"Operations scan\"");
expect(html).toContain("aria-label=\"Session inspector\"");
expect(html).toContain("Select a session");
```

Remove expectations that require the detail modal to appear in the default render. Keep existing assertions that unsafe actions are absent from default render.

- [ ] **Step 5: Run integration tests**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/controlDesktopShell.test.tsx src/ui/__tests__/sessionRail.test.tsx src/ui/__tests__/sessionInspector.test.tsx
```

Expected: PASS.

---

## Task 5: Apply Responsive Layout And Visual Hierarchy

**Files:**
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Make center scan visually dominant**

Add after the shell CSS:

```css
.control-center .briefing-strip {
  padding: 16px 18px;
}

.control-center .session-board {
  display: grid;
  gap: 14px;
}

.control-center .session-lane {
  border-radius: 10px;
}

.control-center .attention-queue {
  border-radius: 10px;
}
```

- [ ] **Step 2: Make inspector secondary but persistent**

Add:

```css
.control-inspector .history-panel,
.control-inspector .ops-card {
  border-radius: 10px;
}

.control-inspector .history-panel h1,
.control-inspector .ops-card h2 {
  font-size: 14px;
}
```

- [ ] **Step 3: Add tablet layout**

Add:

```css
@media (max-width: 1180px) {
  .control-desktop {
    grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
  }

  .control-inspector {
    grid-column: 1 / -1;
    position: static;
    max-height: none;
    overflow: visible;
  }
}
```

- [ ] **Step 4: Add mobile layout**

Add:

```css
@media (max-width: 760px) {
  .control-desktop {
    grid-template-columns: 1fr;
    width: min(100%, calc(100vw - 20px));
    padding-top: 10px;
  }

  .control-rail,
  .control-inspector {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .session-rail-panel,
  .session-inspector-panel {
    padding: 12px;
  }

  .rail-session {
    min-height: 72px;
  }
}
```

- [ ] **Step 5: Add mobile nav collision guard if Browser shows wrapping overlap**

If Browser QA at 320, 360, 390, or 430 px shows nav links colliding with source/demo controls, add:

```css
@media (max-width: 760px) {
  .nav {
    grid-template-columns: 1fr auto;
    gap: 10px;
    padding: 0 12px;
  }

  .nav-links {
    display: none;
  }

  .nav-actions {
    gap: 8px;
  }
}
```

Expected: one compact top bar with logo and actions; no duplicate header bars.

---

## Task 6: Browser QA And Visual Acceptance

**Files:**
- Modify: `src/styles/masthead.css` only if a concrete Browser failure is observed.
- Artifact: `/tmp/masthead-after-control-desktop-1280.png`
- Artifact: `/tmp/masthead-after-control-desktop-390.png`

- [ ] **Step 1: Run the app locally**

Run:

```bash
npm run dev
```

Expected: Vite serves the app on localhost.

- [ ] **Step 2: Verify desktop first viewport with in-app Browser**

Use the Codex in-app Browser with `iab` backend. At `1280 x 800`, verify:

- `aria-label="Session navigation"` exists and is visible.
- `aria-label="Operations scan"` exists and is visible.
- `aria-label="Session inspector"` exists and is visible.
- left rail, center scan, and right inspector are visible in one first viewport.
- center scan is the widest pane.
- old stacked sequence is no longer the dominant page structure.

Capture:

```text
/tmp/masthead-after-control-desktop-1280.png
```

- [ ] **Step 3: Verify rail and center raw-metadata boundary**

In the Browser, run a read-only DOM check scoped to `.control-rail` and `.control-center`.

Search for these forbidden patterns:

```text
agent/
src/
npm 
pnpm 
yarn 
command.finished
file.changed
event-
payloadHash
```

Expected: No matches in rail or center. Inspector may contain technical detail.

- [ ] **Step 4: Verify selected-session interaction**

Click one visible session card or rail session button.

Expected:

- right inspector updates to selected technical detail;
- no modal opens on desktop;
- focus remains visible;
- safe actions remain buttons inside inspector.

- [ ] **Step 5: Verify responsive widths**

Use Browser viewport controls for:

```text
320 x 720
360 x 740
390 x 844
430 x 932
768 x 1024
1280 x 800
```

At each width, verify:

- no horizontal overflow;
- no text overlaps buttons/cards;
- nav does not collide;
- panes stack intentionally below `760px`;
- sticky rail/inspector do not trap content;
- the first viewport still communicates session control.

Capture:

```text
/tmp/masthead-after-control-desktop-390.png
```

- [ ] **Step 6: Patch only observed layout failures**

If Browser QA fails, patch the smallest CSS rule that fixes the observed failure, then rerun the failed viewport check.

---

## Task 7: Mechanical Verification

**Files:**
- Modify: `docs/release-gates.md` only if verification counts or gate descriptions change.

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
npm test -- --run src/ui/__tests__/controlDesktopShell.test.tsx src/ui/__tests__/sessionRail.test.tsx src/ui/__tests__/sessionInspector.test.tsx src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/historyPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run fixture dogfood**

Run:

```bash
npm run dogfood:fixture
```

Expected: PASS with `calmOpsCopy: true` and `feedbackSnapshotPrivacy: true`.

- [ ] **Step 6: Run live dogfood**

Run:

```bash
npm run dogfood:live
```

Expected: The known older live-data gates may still fail if no live failed-command/conflict/degraded-attribution evidence exists. `calmOpsCopy` and `feedbackSnapshotPrivacy` must remain true.

- [ ] **Step 7: Update release-gate docs if counts changed**

If test counts or dogfood details differ from `docs/release-gates.md`, update only the changed verification facts.

---

## Implementation Notes For Subagents

- Do not change `src/core/` projection or dogfood behavior unless a test failure proves a type mismatch caused by UI extraction.
- Do not add new dependencies.
- Do not introduce a route, router, or state manager.
- Do not add decorative gradients, SVG illustrations, or marketing-page sections.
- Keep cards at `8px` radius or less unless preserving an existing `10px` app panel style.
- Use existing color variables; add new variables only if a repeated value appears at least three times.
- Treat `.control-rail` and `.control-center` as scan surfaces. Raw technical metadata belongs only in `.control-inspector`.
- Preserve keyboard access: rail session items must be buttons; visible focus must remain.

## Self-Review

- Spec coverage: The plan implements the research-backed control desktop and Tyler’s natural-language main scan requirement.
- Placeholder scan: No placeholder markers remain.
- Type consistency: New components use `SessionCardView`, `SessionDetailView`, and `LiveBoardProjection["summary"]`.
- Sequencing: Inspector extraction has a rollback point before App shell integration.
- Verification: The plan includes failing tests, focused tests, full tests, typecheck, build, fixture dogfood, live dogfood, and Browser QA with screenshots.
