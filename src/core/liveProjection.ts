import { projectFixture } from "./replay.ts";
import type { FixtureReplay, GitSnapshot, LiveBoardProjection, NormalizedEvent } from "./types";

export type LiveProjectionEnvelope = {
  ok: true;
  source: "live";
  generatedAt: string;
  events: number;
  gitSnapshots: number;
  diagnostics: number;
  projection: LiveBoardProjection;
};

type LiveProjectionOptions = {
  expandedSessionId?: string;
  selectedSessionId?: string | null;
  generatedAt?: string;
  diagnostics?: number;
};

export function projectLiveEvents(
  events: NormalizedEvent[],
  gitSnapshots: GitSnapshot[] = [],
  options: LiveProjectionOptions = {}
): LiveProjectionEnvelope {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const selectedSessionId = options.selectedSessionId === null ? null : options.selectedSessionId ?? options.expandedSessionId;
  const replay: FixtureReplay = {
    events,
    gitSnapshots,
    expandedSessionId: options.expandedSessionId
  };

  return {
    ok: true,
    source: "live",
    generatedAt,
    events: events.length,
    gitSnapshots: gitSnapshots.length,
    diagnostics: options.diagnostics ?? 0,
    projection: projectFixture(replay, {
      expandedSessionId: options.expandedSessionId,
      selectedSessionId,
      now: new Date(generatedAt)
    })
  };
}
