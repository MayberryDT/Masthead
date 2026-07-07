import type { LiveBlocker } from "./liveBlockers.ts";
import { liveStateImpliedByEvent } from "./livePermission.ts";
import {
  displayStateForLiveState,
  type LiveRuntimeDisplayState,
  type LiveRuntimeSemanticState,
  type LiveStateReport,
  reportIsFresh
} from "./liveState.ts";
import type { DerivedSession, NormalizedEvent } from "./types.ts";

export type EffectiveLiveStateAuthority = "live_state" | "blocker" | "event" | "timeout" | "unknown";

export type EffectiveLiveState = {
  semanticState: LiveRuntimeSemanticState;
  displayState: LiveRuntimeDisplayState;
  authority: EffectiveLiveStateAuthority;
  reason: string;
  stateObservedAt?: string;
  stateMessage?: string;
  stale?: boolean;
};

export function selectEffectiveLiveState(input: {
  session: DerivedSession;
  latestLiveState?: LiveStateReport;
  unresolvedBlockers: LiveBlocker[];
  latestEvent?: NormalizedEvent;
  latestStateEvent?: NormalizedEvent;
  eventWorkingGraceMs?: number;
  now: Date;
}): EffectiveLiveState {
  const freshLiveState = input.latestLiveState && reportIsFresh(input.latestLiveState, input.now) ? input.latestLiveState : undefined;
  const unseenCompletedTurn = input.latestEvent?.type === "turn.completed" || input.session.primaryStatus === "completed_unreviewed";
  const eventWorkingGraceMs = input.eventWorkingGraceMs ?? 30_000;

  if (freshLiveState?.state === "blocked") return fromLiveState(freshLiveState, unseenCompletedTurn, "Fresh blocked live state report.");
  if (input.unresolvedBlockers.length > 0) {
    return {
      semanticState: "blocked",
      displayState: "blocked",
      authority: "blocker",
      reason: "Unresolved approval blocker."
    };
  }
  if (freshLiveState?.state === "working" || freshLiveState?.state === "idle" || freshLiveState?.state === "unknown") {
    return fromLiveState(freshLiveState, unseenCompletedTurn, "Fresh live state report.");
  }

  const eventState = input.latestStateEvent ? liveStateImpliedByEvent(input.latestStateEvent) : undefined;
  if (eventState === "blocked" && input.latestStateEvent) {
    if (eventIsFresh(input.latestStateEvent, input.now, eventWorkingGraceMs)) {
      return {
        semanticState: "blocked",
        displayState: "blocked",
        authority: "event",
        reason: `Latest state-bearing event ${input.latestStateEvent.type} is within the live blocker grace window.`,
        stateObservedAt: input.latestStateEvent.occurredAt
      };
    }
    return staleIdle(input.latestStateEvent, `Latest blocked event ${input.latestStateEvent.type} is older than the live activity grace window.`);
  }
  if (eventState === "working" && input.latestStateEvent) {
    if (eventIsFresh(input.latestStateEvent, input.now, eventWorkingGraceMs)) {
      return {
        semanticState: "working",
        displayState: displayStateForLiveState("working", { unseenCompletedTurn }),
        authority: "event",
        reason: `Latest state-bearing event ${input.latestStateEvent.type} is within the live activity grace window.`,
        stateObservedAt: input.latestStateEvent.occurredAt
      };
    }
    return staleIdle(input.latestStateEvent, `Latest working event ${input.latestStateEvent.type} is older than the live activity grace window.`);
  }
  if (eventState === "idle" && input.latestStateEvent) {
    return {
      semanticState: "idle",
      displayState: displayStateForLiveState("idle", { unseenCompletedTurn }),
      authority: "event",
      reason: `Latest state-bearing event ${input.latestStateEvent.type} implies idle.`,
      stateObservedAt: input.latestStateEvent.occurredAt
    };
  }

  if (input.session.lifecycle === "idle") {
    return {
      semanticState: "idle",
      displayState: displayStateForLiveState("idle", { unseenCompletedTurn }),
      authority: "timeout",
      reason: "Session is idle by timeout or closed lifecycle.",
      stale: Boolean(input.latestLiveState && !freshLiveState)
    };
  }
  if (input.session.lifecycle === "running") {
    return staleIdle(input.latestStateEvent ?? input.latestEvent, "Session has no fresh live-state report, unresolved approval blocker, or recent working event.");
  }

  return {
    semanticState: "unknown",
    displayState: "unknown",
    authority: "unknown",
    reason: "No fresh live state, blocker, event, or idle fallback."
  };
}

function fromLiveState(report: LiveStateReport, unseenCompletedTurn: boolean, reason: string): EffectiveLiveState {
  return {
    semanticState: report.state,
    displayState: displayStateForLiveState(report.state, { unseenCompletedTurn }),
    authority: "live_state",
    reason,
    stateObservedAt: report.observedAt,
    stateMessage: report.message ?? report.customStatus
  };
}

function staleIdle(event: NormalizedEvent | undefined, reason: string): EffectiveLiveState {
  return {
    semanticState: "idle",
    displayState: displayStateForLiveState("idle", { unseenCompletedTurn: false }),
    authority: "timeout",
    reason,
    stateObservedAt: event?.occurredAt,
    stale: true
  };
}

function eventIsFresh(event: NormalizedEvent, now: Date, graceMs: number): boolean {
  const occurredAt = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAt)) return false;
  return Math.max(0, now.getTime() - occurredAt) <= graceMs;
}
