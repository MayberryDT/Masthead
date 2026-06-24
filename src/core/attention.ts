import { highRiskChangedPaths } from "./risk.ts";
import type { AttentionItem, ConflictCard, DerivedSession, GitSnapshot, NormalizedEvent } from "./types";
import { isFailedCommandEvent } from "./commandStatus.ts";

export function deriveAttentionItems(
  sessions: DerivedSession[],
  events: NormalizedEvent[],
  conflicts: ConflictCard[],
  snapshots: GitSnapshot[] = []
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const session of sessions) {
    const sessionEvents = events.filter((event) => event.sessionId === session.sessionId);
    const sessionSnapshots = snapshots.filter((snapshot) => snapshot.sessionId === session.sessionId);
    const approval = latestPendingEvent(sessionEvents, "approval.requested");
    if (approval) {
      items.push({
        itemId: `attention:${session.sessionId}:approval`,
        sessionId: session.sessionId,
        project: session.project,
        type: "approval_requested",
        severity: isP0Approval(approval) ? "P0" : "P1",
        title: "Approval requested",
        createdAt: approval.occurredAt,
        affectedPaths: [],
        affectedCommandIds: commandIds(approval),
        evidence: approval.evidence,
        support: "deterministic",
        suggestedNextAction: "Open the source Codex session and review the request."
      });
    }

    const question = latestPendingEvent(sessionEvents, "user.question");
    if (question) {
      items.push({
        itemId: `attention:${session.sessionId}:question`,
        sessionId: session.sessionId,
        project: session.project,
        type: "user_question",
        severity: "P1",
        title: "User input requested",
        createdAt: question.occurredAt,
        affectedPaths: [],
        affectedCommandIds: [],
        evidence: question.evidence,
        support: "deterministic",
        suggestedNextAction: "Open the source Codex session and answer the question."
      });
    }

    const failedCommands = sessionEvents.filter(isFailedCommandEvent);
    if (hasEquivalentRepeatedFailures(failedCommands)) {
      items.push({
        itemId: `attention:${session.sessionId}:repeated-failure`,
        sessionId: session.sessionId,
        project: session.project,
        type: "repeated_failure",
        severity: "P1",
        title: "Repeated command failure",
        createdAt: failedCommands.at(-1)?.occurredAt ?? session.lastMeaningfulActivityAt,
        affectedPaths: [],
        affectedCommandIds: failedCommands.flatMap(commandIds),
        evidence: failedCommands.flatMap((event) => event.evidence),
        support: "deterministic",
        suggestedNextAction: "Inspect the failing command before the agent repeats it again."
      });
    }

    if (session.primaryStatus === "completed_unreviewed" && session.flags.includes("no_tests_observed")) {
      items.push({
        itemId: `attention:${session.sessionId}:completed-without-verification`,
        sessionId: session.sessionId,
        project: session.project,
        type: "completed_without_verification",
        severity: "P2",
        title: "Completed without observed verification",
        createdAt: session.lastMeaningfulActivityAt,
        affectedPaths: [],
        affectedCommandIds: [],
        evidence: session.evidence,
        support: "deterministic",
        suggestedNextAction: "Review the diff and run or confirm verification."
      });
    }

    const staleVerification = staleVerificationEvidence(sessionEvents, sessionSnapshots);
    if (staleVerification) {
      items.push({
        itemId: `attention:${session.sessionId}:stale-verification`,
        sessionId: session.sessionId,
        project: session.project,
        type: "stale_verification",
        severity: "P2",
        title: "Verification is stale",
        createdAt: staleVerification.changedAt,
        affectedPaths: staleVerification.affectedPaths,
        affectedCommandIds: staleVerification.commandIds,
        evidence: staleVerification.evidence,
        support: "deterministic",
        suggestedNextAction: "Re-run verification after the latest observed change."
      });
    }

    const highRisk = highRiskEvidence(sessionSnapshots);
    if (highRisk) {
      items.push({
        itemId: `attention:${session.sessionId}:high-risk-change`,
        sessionId: session.sessionId,
        project: session.project,
        type: "high_risk_change",
        severity: "P2",
        title: "High-risk change",
        createdAt: highRisk.observedAt,
        affectedPaths: highRisk.affectedPaths,
        affectedCommandIds: [],
        evidence: highRisk.evidence,
        support: "deterministic",
        suggestedNextAction: "Review the high-risk path before treating this session as routine."
      });
    }
  }

  for (const conflict of conflicts) {
    for (const sessionId of conflict.sessionIds) {
      const session = sessions.find((candidate) => candidate.sessionId === sessionId);
      if (!session) continue;
      items.push({
        itemId: `attention:${sessionId}:${conflict.conflictId}`,
        sessionId,
        project: session.project,
        type: "conflict",
        severity: conflict.severity === "high" ? "P1" : "P2",
        title: conflict.title,
        createdAt: conflict.evidence[0]?.observedAt ?? session.lastMeaningfulActivityAt,
        affectedPaths: conflict.sharedPaths,
        affectedCommandIds: [],
        evidence: conflict.evidence,
        support: "deterministic",
        suggestedNextAction: "Review the overlapping diff before either session continues."
      });
    }
  }

  return items.toSorted((a, b) => attentionPriority(a) - attentionPriority(b) || a.createdAt.localeCompare(b.createdAt));
}

function latestPendingEvent(events: NormalizedEvent[], type: NormalizedEvent["type"]): NormalizedEvent | undefined {
  const ordered = events.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const latest = ordered.at(-1);
  return latest?.type === type ? latest : undefined;
}

function staleVerificationEvidence(
  events: NormalizedEvent[],
  snapshots: GitSnapshot[]
):
  | {
      changedAt: string;
      affectedPaths: string[];
      commandIds: string[];
      evidence: AttentionItem["evidence"];
    }
  | undefined {
  const verification = events
    .filter(
      (event) =>
        event.type === "command.finished" &&
        event.payload.exitCode === 0 &&
        ["test", "lint", "type-check", "build"].includes(String(event.payload.category ?? ""))
    )
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .at(-1);
  if (!verification) return undefined;

  const changeEvents = events.filter((event) => event.type === "file.changed" && event.occurredAt > verification.occurredAt);
  const changedSnapshots = changedSnapshotsAfterVerification(snapshots, verification.occurredAt);
  const latestChangeAt = [...changeEvents.map((event) => event.occurredAt), ...changedSnapshots.map((snapshot) => snapshot.observedAt)]
    .toSorted()
    .at(-1);
  if (!latestChangeAt) return undefined;

  const affectedPaths = [
      ...new Set([
        ...changeEvents.flatMap(pathsForChangedEvent),
        ...changedSnapshots.flatMap((snapshot) => snapshot.changedPaths.map((changedPath) => changedPath.path))
      ])
  ];
  const changeEvidence = [
    ...changeEvents.flatMap((event) => event.evidence),
    ...changedSnapshots.map((snapshot) => ({
      id: snapshot.snapshotId,
      kind: "git_snapshot" as const,
      observedAt: snapshot.observedAt,
      source: "git.observer"
    }))
  ];

  return {
    changedAt: latestChangeAt,
    affectedPaths,
    commandIds: commandIds(verification),
    evidence: [...verification.evidence, ...changeEvidence]
  };
}

function changedSnapshotsAfterVerification(snapshots: GitSnapshot[], verificationAt: string): GitSnapshot[] {
  const baseline = snapshots
    .filter((snapshot) => snapshot.observedAt <= verificationAt)
    .toSorted((a, b) => a.observedAt.localeCompare(b.observedAt))
    .at(-1);
  if (!baseline) return [];

  const baselineKeys = new Set(baseline.changedPaths.map(changedPathKey));
  return snapshots
    .filter((snapshot) => snapshot.observedAt > verificationAt)
    .filter((snapshot) => {
      const nextKeys = new Set(snapshot.changedPaths.map(changedPathKey));
      return !sameSet(baselineKeys, nextKeys);
    });
}

function highRiskEvidence(
  snapshots: GitSnapshot[]
):
  | {
      observedAt: string;
      affectedPaths: string[];
      evidence: AttentionItem["evidence"];
    }
  | undefined {
  const latestSnapshot = snapshots.toSorted((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
  if (!latestSnapshot) return undefined;
  const highRiskPaths = highRiskChangedPaths(latestSnapshot.changedPaths);
  if (highRiskPaths.length === 0) return undefined;

  return {
    observedAt: latestSnapshot.observedAt,
    affectedPaths: highRiskPaths.map((changedPath) => changedPath.path),
    evidence: [
      {
        id: latestSnapshot.snapshotId,
        kind: "git_snapshot",
        observedAt: latestSnapshot.observedAt,
        source: "git.observer"
      }
    ]
  };
}

function changedPathKey(path: GitSnapshot["changedPaths"][number]): string {
  return `${path.path}:${path.status}:${path.staged}`;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function pathsForChangedEvent(event: NormalizedEvent): string[] {
  const path = event.payload.path;
  if (typeof path === "string") return [path];
  const paths = event.payload.paths;
  return Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string") : [];
}

export function attentionPriority(item: AttentionItem): number {
  const severityRank = { P0: 0, P1: 10, P2: 20, P3: 30 }[item.severity];
  const typeRank: Record<string, number> = {
    approval_requested: 0,
    user_question: 1,
    conflict: 2,
    repeated_failure: 3,
    stalled: 4,
    completed_without_verification: 5,
    stale_verification: 6,
    high_risk_change: 7,
    command_failed: 8
  };
  return severityRank + (typeRank[item.type] ?? 9);
}

function isP0Approval(event: NormalizedEvent): boolean {
  return ["production", "destructive", "security", "data_loss", "remote_migration"].includes(
    String(event.payload.blastRadius ?? "")
  );
}

function hasEquivalentRepeatedFailures(events: NormalizedEvent[]): boolean {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = String(event.payload.normalizedCommand ?? event.payload.command ?? event.payload.commandId ?? event.eventId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

function commandIds(event: NormalizedEvent): string[] {
  const commandId = event.payload.commandId;
  return typeof commandId === "string" ? [commandId] : [];
}
