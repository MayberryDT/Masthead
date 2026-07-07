import type {
  DerivedSession,
  GitSnapshot,
  NormalizedEvent,
  SessionEndReason,
  SessionFlag,
  SessionLifecycle,
  SessionStatus,
  WorkspaceRef
} from "./types";
import { highRiskChangedPaths } from "./risk.ts";
import { isFailedCommandEvent, isSuccessfulVerificationCommandEvent } from "./commandStatus.ts";

export type DeriveSessionsOptions = {
  now?: Date;
  idleAfterMs?: number;
};

const DEFAULT_IDLE_AFTER_MS = 15 * 60_000;
type RuntimeLifecycleState = "running" | "idle" | "blocked";


export function deriveSessions(
  events: NormalizedEvent[],
  snapshots: GitSnapshot[] = [],
  options: DeriveSessionsOptions = {}
): DerivedSession[] {
  const now = options.now ?? latestInstant(...events.map((event) => event.occurredAt), ...snapshots.map((snapshot) => snapshot.observedAt)) ?? new Date();
  const idleAfterMs = options.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    if (!event.sessionId) continue;
    grouped.set(event.sessionId, [...(grouped.get(event.sessionId) ?? []), event]);
  }

  return [...grouped.entries()].map(([sessionId, sessionEvents]) => {
    const ordered = sessionEvents.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const latest = ordered.at(-1);
    const start = ordered.find((event) => event.type === "session.started");
    const sessionSnapshots = snapshots.filter((snapshot) => snapshot.sessionId === sessionId);
    const latestSnapshot = sessionSnapshots.toSorted((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    const workspace = mergeWorkspace(latestSnapshot, latest?.workspace);
    const failedCommands = ordered.filter(isFailedCommandEvent);
    const metadataEvent =
      ordered.find(
        (event) =>
          stringPayload(event, "project") ||
          stringPayload(event, "title") ||
          stringPayload(event, "sourceSessionId") ||
          stringPayload(event, "runtime") ||
          stringPayload(event, "harness")
      ) ??
      start ??
      latest;
    const successfulVerification = ordered.some(isSuccessfulVerificationCommandEvent);
    const completed = latest?.type === "session.completed" || latest?.type === "turn.completed";
    const blocked = latest ? isBlockedEvent(latest) : false;
    const pendingApproval = latest?.type === "approval.requested";
    const pendingQuestion = latest?.type === "user.question";
    const runtimeWaiting = latest ? runtimeWaitingStatus(latest) : undefined;
    const latestFailedCommand = latest ? isFailedCommandEvent(latest) : false;
    const flags: SessionFlag[] = [];
    let primaryStatus: SessionStatus = "unknown";
    const latestSignalAt = latestInstant(latest?.occurredAt);
    const terminal = eventIsTerminalSessionClose(latest);
    const lifecycle = deriveLifecycle({
      latest,
      latestSignalAt,
      now,
      idleAfterMs
    });
    const endReason = terminal ? endReasonForLatestEvent(latest) : undefined;

    if (blocked) {
      primaryStatus = "blocked";
    } else if (pendingApproval) {
      primaryStatus = "waiting_for_approval";
      flags.push("approval_pending");
    } else if (pendingQuestion) {
      primaryStatus = "waiting_for_user";
      flags.push("question_pending");
    } else if (runtimeWaiting) {
      primaryStatus = runtimeWaiting;
      flags.push(runtimeWaiting === "waiting_for_approval" ? "approval_pending" : "question_pending");
    } else if (latestFailedCommand && failedCommands.length >= 3 && hasEquivalentRepeatedFailures(failedCommands)) {
      primaryStatus = "possibly_looping";
      flags.push("tests_failed");
    } else if (latestFailedCommand) {
      primaryStatus = "failed";
      flags.push("tests_failed");
    } else if (latest?.type === "command.started" && latest.payload.category === "test") {
      primaryStatus = "testing";
    } else if (completed) {
      primaryStatus = "completed_unreviewed";
      flags.push("agent_claims_complete");
    } else if (lifecycle === "idle") {
      primaryStatus = "stalled";
    } else if (latestSnapshot && latestSnapshot.changedPaths.length > 0) {
      primaryStatus = "editing";
      flags.push("dirty_worktree", "uncommitted_changes");
    } else if (latest) {
      primaryStatus = "reading";
    }

    if (latestSnapshot && latestSnapshot.changedPaths.length > 0) {
      pushUnique(flags, "dirty_worktree");
      pushUnique(flags, "uncommitted_changes");
      if (highRiskChangedPaths(latestSnapshot.changedPaths).length > 0) {
        pushUnique(flags, "high_risk_change");
      }
      if (completed && !successfulVerification) {
        pushUnique(flags, "no_tests_observed");
      }
    }

    const workspaceProject =
      pathBaseName(workspace?.repoRoot) ??
      pathBaseName(workspace?.cwd);
    const project =
      stringPayload(start, "project") ??
      stringPayload(metadataEvent, "project") ??
      workspaceProject ??
      "Unknown project";
    const sourceSessionId = stringPayload(metadataEvent, "sourceSessionId") ?? stringPayload(start, "sourceSessionId") ?? sessionId;
    const runtime = stringPayload(metadataEvent, "runtime") ?? stringPayload(start, "runtime") ?? metadataEvent?.source.adapter ?? start?.source.adapter ?? latest?.source.adapter;
    const harness = stringPayload(metadataEvent, "harness") ?? stringPayload(start, "harness") ?? harnessLabel(runtime);
    const title =
      stringPayload(start, "title") ??
      stringPayload(start, "objective") ??
      stringPayload(metadataEvent, "title") ??
      stringPayload(metadataEvent, "objective") ??
      `${project} session`;

    return {
      sessionId,
      sourceSessionId,
      runtime,
      harness,
      project,
      title,
      objective: stringPayload(start, "objective") ?? stringPayload(metadataEvent, "objective"),
      primaryStatus,
      lifecycle,
      endReason,
      endedAt: lifecycle === "ended" ? latest?.occurredAt : undefined,
      lastEventType: latest?.type,
      flags,
      lastMeaningfulActivityAt: latestSignalAt?.toISOString() ?? new Date(0).toISOString(),
      attribution: latest?.payload.attribution === "shared_workspace" ? "shared_workspace" : "direct",
      workspace,
      changedFileCount: latestSnapshot?.changedPaths.length ?? 0,
      evidence: ordered.flatMap((event) => event.evidence)
    };
  });
}

function mergeWorkspace(snapshot: GitSnapshot | undefined, eventWorkspace: WorkspaceRef | undefined): WorkspaceRef | undefined {
  const workspace: WorkspaceRef = {};

  if (snapshot) {
    workspace.repoRoot = snapshot.repoRoot;
    workspace.worktreePath = snapshot.worktreePath;
    workspace.gitCommonDir = snapshot.gitCommonDir;
    if (snapshot.branch) workspace.branch = snapshot.branch;
    if (snapshot.headSha) workspace.headSha = snapshot.headSha;
  }

  if (eventWorkspace?.cwd) workspace.cwd = eventWorkspace.cwd;
  if (eventWorkspace?.repoRoot) workspace.repoRoot = eventWorkspace.repoRoot;
  if (eventWorkspace?.worktreePath) workspace.worktreePath = eventWorkspace.worktreePath;
  if (eventWorkspace?.gitCommonDir) workspace.gitCommonDir = eventWorkspace.gitCommonDir;
  if (eventWorkspace?.branch) workspace.branch = eventWorkspace.branch;
  if (eventWorkspace?.headSha) workspace.headSha = eventWorkspace.headSha;

  return Object.keys(workspace).length > 0 ? workspace : undefined;
}

function deriveLifecycle({
  latest,
  latestSignalAt,
  now,
  idleAfterMs
}: {
  latest: NormalizedEvent | undefined;
  latestSignalAt: Date | undefined;
  now: Date;
  idleAfterMs: number;
}): SessionLifecycle {
  if (eventIsTerminalSessionClose(latest)) return "ended";
  if (latest?.type === "turn.completed") return "idle";
  if (latest?.type === "approval.requested" || latest?.type === "user.question") return "running";
  if (runtimeWaitingStatus(latest)) return "running";
  const runtimeLifecycle = freshRuntimeLifecycle(latest, latestSignalAt, now, idleAfterMs);
  if (runtimeLifecycle) return runtimeLifecycle;
  if (!latest) return "idle";
  if (!latestSignalAt) return "idle";
  return now.getTime() - latestSignalAt.getTime() > idleAfterMs ? "idle" : "running";
}

function freshRuntimeLifecycle(
  event: NormalizedEvent | undefined,
  latestSignalAt: Date | undefined,
  now: Date,
  idleAfterMs: number
): SessionLifecycle | undefined {
  const state = runtimeLifecycleState(event);
  if (!state) return undefined;
  if (state === "blocked") return "running";
  if (state === "idle") return "idle";
  if (!latestSignalAt) return "idle";
  return now.getTime() - latestSignalAt.getTime() > idleAfterMs ? "idle" : "running";
}

function runtimeLifecycleState(event: NormalizedEvent | undefined): RuntimeLifecycleState | undefined {
  const explicitState = normalizeRuntimeState(stringPayload(event, "runtimeLifecycleState"));
  if (explicitState === "running" || explicitState === "idle" || explicitState === "blocked") return explicitState;
  const state = firstNormalizedStringPayload(event, ["state", "status", "runtimeState", "lifecycleState"]);
  if (!state) return undefined;
  if (["active", "working", "running", "busy", "thinking", "executing"].includes(state)) return "running";
  if (["idle", "logged", "ready", "waiting"].includes(state)) return "idle";
  if (state === "blocked") return "blocked";
  if (["done", "completed", "complete", "stopped", "ended"].includes(state)) return "idle";
  return undefined;
}

function runtimeWaitingStatus(event: NormalizedEvent | undefined): "waiting_for_approval" | "waiting_for_user" | undefined {
  const state =
    firstNormalizedStringPayload(event, ["state", "status", "runtimeState", "lifecycleState"]) ??
    firstNormalizedStringPayload(event, ["primaryStatus"]);
  if (!state) return undefined;
  if (["approval_requested", "approval_required", "requires_approval", "waiting_for_approval", "permission_requested"].includes(state)) {
    return "waiting_for_approval";
  }
  if (["waiting_for_user", "user_input_requested", "needs_user", "needs_input", "question_requested"].includes(state)) {
    return "waiting_for_user";
  }
  return undefined;
}

function firstNormalizedStringPayload(event: NormalizedEvent | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const state = normalizeRuntimeState(stringPayload(event, key));
    if (state) return state;
  }
  return undefined;
}

function normalizeRuntimeState(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function endReasonForLatestEvent(event: NormalizedEvent | undefined): SessionEndReason | undefined {
  if (eventIsTerminalSessionClose(event)) return "completed";
  return undefined;
}

function eventIsTerminalSessionClose(event: NormalizedEvent | undefined): boolean {
  return event?.type === "session.closed" || event?.type === "session.completed";
}

function latestInstant(...timestamps: Array<string | undefined>): Date | undefined {
  const dates = timestamps
    .flatMap((timestamp) => {
      if (!timestamp) return [];
      const millis = Date.parse(timestamp);
      return Number.isNaN(millis) ? [] : [new Date(millis)];
    })
    .toSorted((a, b) => a.getTime() - b.getTime());
  return dates.at(-1);
}

function pathBaseName(path: string | undefined): string | undefined {
  return path?.split("/").filter(Boolean).at(-1);
}

function hasEquivalentRepeatedFailures(events: NormalizedEvent[]): boolean {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = String(event.payload.normalizedCommand ?? event.payload.command ?? event.payload.commandId ?? event.eventId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

function stringPayload(event: NormalizedEvent | undefined, key: string): string | undefined {
  const value = event?.payload[key];
  return typeof value === "string" ? value : undefined;
}

function isBlockedEvent(event: NormalizedEvent): boolean {
  if (event.payload.blocked === true) return true;
  if (stringPayload(event, "runtimeLifecycleState") === "blocked") return true;
  return ["status", "state", "primaryStatus", "disposition", "endReason", "reason", "runtimeState"].some(
    (key) => stringPayload(event, key)?.toLowerCase() === "blocked"
  );
}

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
    case "hermes":
      return "Hermes";
    case "pi":
      return "Pi";
    case "omp":
      return "Oh My Pi";
    default:
      return undefined;
  }
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}
