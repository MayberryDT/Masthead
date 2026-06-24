import type { DerivedSession, NormalizedEvent, SessionOutcomeLabel } from "./types";
import { commandExitCode, isVerificationCommandEvent } from "./commandStatus.ts";

export type VerificationCommand = {
  commandId: string;
  category: string;
  normalizedCommand: string;
  exitCode: number;
  occurredAt: string;
};

export type OutcomeEvidence = {
  sessionId: string;
  project: string;
  changedFileCount: number;
  finalStatus: DerivedSession["primaryStatus"];
  flags: DerivedSession["flags"];
  verificationCommands: VerificationCommand[];
  evidenceRefCount: number;
};

export type OutcomePolicy = {
  allowAutoAcceptedWhenCleanAndVerified?: boolean;
  allowAutoCompletedWhenCleanAndVerified?: boolean;
};

export type OutcomeResult = {
  evidence: OutcomeEvidence;
  policyResult: {
    label: SessionOutcomeLabel;
    reasons: string[];
  };
};

export function deriveOutcome(
  session: DerivedSession,
  events: NormalizedEvent[],
  policy: OutcomePolicy = {}
): OutcomeResult {
  const verificationCommands = events
    .filter(isVerificationCommandEvent)
    .flatMap((event) => {
      const exitCode = commandExitCode(event);
      if (exitCode === undefined) return [];
      return [
        {
          commandId: String(event.payload.commandId ?? event.eventId),
          category: String(event.payload.category),
          normalizedCommand: String(event.payload.normalizedCommand ?? event.payload.command ?? ""),
          exitCode,
          occurredAt: event.occurredAt
        }
      ];
    });

  const evidence: OutcomeEvidence = {
    sessionId: session.sessionId,
    project: session.project,
    changedFileCount: session.changedFileCount,
    finalStatus: session.primaryStatus,
    flags: [...session.flags],
    verificationCommands,
    evidenceRefCount: session.evidence.length + events.flatMap((event) => event.evidence).length
  };

  const reasons: string[] = [];
  const latestVerification = verificationCommands.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
  const hasPassingVerification = latestVerification?.exitCode === 0;
  const hasFailingVerification = latestVerification !== undefined && latestVerification.exitCode !== 0;
  const dirty = session.flags.includes("dirty_worktree") || session.flags.includes("uncommitted_changes");
  const terminal = session.lifecycle === "ended" || session.primaryStatus.startsWith("completed") || session.primaryStatus === "abandoned";

  if (!hasPassingVerification && session.changedFileCount > 0) reasons.push("no verification observed");
  if (hasFailingVerification) reasons.push("verification failed");
  if (dirty) reasons.push("working tree still dirty");

  if (hasFailingVerification) {
    return { evidence, policyResult: { label: "failed", reasons } };
  }

  if (session.primaryStatus === "abandoned" || session.endReason === "abandoned") {
    return { evidence, policyResult: { label: "abandoned", reasons: ["user marked abandoned"] } };
  }

  if (session.endReason === "needs_user" || session.endReason === "needs_approval") {
    return { evidence, policyResult: { label: "blocked", reasons: ["ended while waiting for input"] } };
  }

  if ((policy.allowAutoAcceptedWhenCleanAndVerified || policy.allowAutoCompletedWhenCleanAndVerified || terminal) && hasPassingVerification && !dirty) {
    return { evidence, policyResult: { label: "completed", reasons: ["clean verified outcome"] } };
  }

  if (terminal && session.changedFileCount === 0 && !dirty) {
    return { evidence, policyResult: { label: "completed", reasons: ["no changed files observed"] } };
  }

  if (terminal && reasons.length > 0) {
    return { evidence, policyResult: { label: "needs_attention", reasons } };
  }

  return {
    evidence,
    policyResult: {
      label: reasons.length > 0 ? "needs_attention" : "unknown",
      reasons: reasons.length > 0 ? reasons : ["requires user disposition"]
    }
  };
}
