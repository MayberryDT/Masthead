import { describe, expect, test } from "vitest";
import type { RuntimeKind } from "../../adapters/types.ts";
import { parseLiveHookPayload } from "../liveHookAdapter.ts";
import { projectLiveEvents } from "../liveProjection.ts";
import type { LiveBoardProjection, NormalizedEvent } from "../types.ts";

const RELEASE_LIVE_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const satisfies readonly RuntimeKind[];

const RUNTIME_LABELS: Record<(typeof RELEASE_LIVE_RUNTIMES)[number], string> = {
  claude_code: "Claude Code",
  cursor: "Cursor",
  grok: "Grok Build",
  hermes: "Hermes",
  omp: "Oh My Pi",
  opencode: "OpenCode",
  pi: "Pi"
};

describe("release live runtime states", () => {
  test("projects active live sessions for every release harness", () => {
    const board = projectRuntimeEvents("active", "2026-07-05T16:00:00.000Z");

    expect(board.summary).toMatchObject({ active: RELEASE_LIVE_RUNTIMES.length, running: RELEASE_LIVE_RUNTIMES.length });
    for (const runtime of RELEASE_LIVE_RUNTIMES) {
      expect(cardForRuntime(board, runtime)).toMatchObject({
        branchOrWorktree: `agent/${runtime}`,
        harness: RUNTIME_LABELS[runtime],
        lifecycle: "running",
        model: "gpt-5-live",
        primaryStatus: "reading",
        runtime,
        stateLabel: "Running",
        totalTokens: 1200
      });
    }
  });

  test("projects idle live sessions for every release harness", () => {
    const board = projectRuntimeEvents("idle", "2026-07-05T16:00:00.000Z");

    expect(board.summary).toMatchObject({ active: RELEASE_LIVE_RUNTIMES.length, idle: RELEASE_LIVE_RUNTIMES.length });
    for (const runtime of RELEASE_LIVE_RUNTIMES) {
      expect(cardForRuntime(board, runtime)).toMatchObject({
        branchOrWorktree: `agent/${runtime}`,
        harness: RUNTIME_LABELS[runtime],
        lifecycle: "idle",
        model: "gpt-5-live",
        primaryStatus: "stalled",
        runtime,
        stateLabel: "Idle",
        totalTokens: 1200
      });
    }
  });

  test("projects blocked live sessions for every release harness", () => {
    const board = projectRuntimeEvents("blocked", "2026-07-05T16:00:00.000Z");

    expect(board.summary).toMatchObject({ active: RELEASE_LIVE_RUNTIMES.length, running: RELEASE_LIVE_RUNTIMES.length });
    for (const runtime of RELEASE_LIVE_RUNTIMES) {
      const card = cardForRuntime(board, runtime);
      expect(card).toMatchObject({
        branchOrWorktree: `agent/${runtime}`,
        harness: RUNTIME_LABELS[runtime],
        lifecycle: "running",
        model: "gpt-5-live",
        primaryStatus: "blocked",
        runtime,
        stateLabel: "Blocked",
        totalTokens: 1200
      });
      expect((card.headlineInput as { stateHint?: string } | undefined)?.stateHint).toBe("blocked");
    }
  });
});

function projectRuntimeEvents(state: "active" | "blocked" | "idle", generatedAt: string): LiveBoardProjection {
  const occurredAt = state === "idle" ? "2026-07-05T15:40:00.000Z" : "2026-07-05T15:59:30.000Z";
  const events = RELEASE_LIVE_RUNTIMES.map((runtime) => liveEvent(runtime, state, occurredAt));
  return projectLiveEvents(events, [], {
    generatedAt,
    headlineMode: "offline"
  }).projection;
}

function liveEvent(runtime: (typeof RELEASE_LIVE_RUNTIMES)[number], state: "active" | "blocked" | "idle", occurredAt: string): NormalizedEvent {
  const parsed = parseLiveHookPayload(JSON.stringify(payloadFor(runtime, state, occurredAt)), {
    receivedAt: "2026-07-05T16:00:01.000Z",
    runtime
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return parsed.event;
}

function payloadFor(runtime: (typeof RELEASE_LIVE_RUNTIMES)[number], state: "active" | "blocked" | "idle", occurredAt: string): Record<string, unknown> {
  const base = {
    branch: `agent/${runtime}`,
    model: "gpt-5-live",
    status: state === "idle" ? "idle" : state === "blocked" ? "blocked" : "active",
    summary: `${RUNTIME_LABELS[runtime]} ${state} state`,
    timestamp: occurredAt,
    totalTokens: 1200
  };
  const sessionId = `${runtime}-${state}-session`;
  switch (runtime) {
    case "claude_code":
      return { ...base, cwd: `/workspace/${runtime}`, hookEventName: state === "blocked" ? "Blocked" : "SessionStart", sessionId };
    case "cursor":
      return { ...base, cwd: `/workspace/${runtime}`, hookEventName: state === "blocked" ? "Blocked" : "SessionStart", sessionId };
    case "grok":
      return { ...base, cwd: `/workspace/${runtime}`, hookEventName: state === "blocked" ? "Blocked" : "SessionStart", sessionId };
    case "hermes":
      return { ...base, directory: `/workspace/${runtime}`, sessionId, type: state === "blocked" ? "approval.requested" : "session.start" };
    case "omp":
      return { ...base, cwd: `/workspace/${runtime}`, sessionId, type: state === "blocked" ? "blocked" : "session_start" };
    case "opencode":
      return { ...base, directory: `/workspace/${runtime}`, sessionID: sessionId, type: state === "blocked" ? "blocked" : "session.created" };
    case "pi":
      return { ...base, cwd: `/workspace/${runtime}`, sessionId, type: state === "blocked" ? "approval.requested" : "session.start" };
  }
}

function cardForRuntime(board: LiveBoardProjection, runtime: (typeof RELEASE_LIVE_RUNTIMES)[number]) {
  const card = board.cards.find((candidate) => candidate.runtime === runtime);
  expect(card).toBeDefined();
  return card!;
}
