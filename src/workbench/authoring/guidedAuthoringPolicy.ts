import { stableRecordId } from "../../daemon/identity.ts";
import type { WorkbenchArtifactSuggestionDto, WorkbenchAutomaticArtifactKind } from "../../shared/workbenchAuthoring.ts";

export const GUIDED_TOOL_HEAVY_CALL_THRESHOLD = 50;

export type GuidedCoverageClass = "artifact_signal" | "tool_heavy" | "ordinary";

export type GuidedPlanningSession = {
  sessionId: string;
  ordinal: number;
  toolCallCount: number;
};

export type NormalizedGuidedOpportunity = {
  opportunityId: string;
  suggestedKind: WorkbenchAutomaticArtifactKind;
  signalStrength: "high" | "medium";
  summary: string;
  signatureKey?: string;
  evidenceRefs: string[];
  provenanceSessionIds: string[];
};

export type GuidedAssignmentGroup = {
  groupKey: string;
  sessionIds: string[];
  opportunityIds: string[];
  /** One entry per sessionId, in the same order. */
  coverageClasses: GuidedCoverageClass[];
};

export type GuidedAssignmentPlan = {
  opportunities: NormalizedGuidedOpportunity[];
  groups: GuidedAssignmentGroup[];
  canary: GuidedAssignmentGroup;
};

export type GuidedAssignmentPlanV5 = Omit<GuidedAssignmentPlan, "canary">;

export const GUIDED_EVIDENCE_QUESTIONS = [
  "What did the user actually ask for?",
  "What concrete work was performed?",
  "What changed or was produced?",
  "Which decisions were made and why?",
  "What verification ran and what did it prove?",
  "What failed, remained blocked, or stayed unresolved?",
  "What knowledge could another person reuse without this transcript?"
] as const;

export const GUIDED_ARTIFACT_RUBRICS = {
  runbook: ["trigger", "preconditions", "performed steps", "expected results", "verification", "failure or rollback handling"],
  adr: ["durable decision", "context", "alternatives actually considered", "consequences", "reversal conditions"],
  incident_timeline: ["symptoms or impact", "ordered events", "root cause", "contributing factors", "remediation", "recovery verification"]
} as const;

export function classifyPlanningSession(
  session: GuidedPlanningSession,
  ownsSingletonOpportunity: boolean
): GuidedCoverageClass {
  if (ownsSingletonOpportunity) return "artifact_signal";
  return session.toolCallCount >= GUIDED_TOOL_HEAVY_CALL_THRESHOLD ? "tool_heavy" : "ordinary";
}

export function planGuidedAssignments(
  sessionsInput: GuidedPlanningSession[],
  suggestions: WorkbenchArtifactSuggestionDto[]
): GuidedAssignmentPlan {
  return planGuidedAssignmentsInternal(sessionsInput, suggestions, "workbench-authoring-v4") as GuidedAssignmentPlan;
}

export function planGuidedAssignmentsV5(
  sessionsInput: GuidedPlanningSession[],
  suggestions: WorkbenchArtifactSuggestionDto[]
): GuidedAssignmentPlanV5 {
  return planGuidedAssignmentsInternal(sessionsInput, suggestions, "workbench-authoring-v5");
}

function planGuidedAssignmentsInternal(
  sessionsInput: GuidedPlanningSession[],
  suggestions: WorkbenchArtifactSuggestionDto[],
  contractVersion: "workbench-authoring-v4" | "workbench-authoring-v5"
): GuidedAssignmentPlan | GuidedAssignmentPlanV5 {
  const sessions = validatedPlanningSessions(sessionsInput);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const opportunities = normalizeOpportunities(suggestions, byId);
  const parent = new Map(sessions.map(({ sessionId }) => [sessionId, sessionId]));
  const find = (sessionId: string): string => {
    const current = parent.get(sessionId)!;
    if (current === sessionId) return current;
    const root = find(current);
    parent.set(sessionId, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const leftOrdinal = byId.get(leftRoot)!.ordinal;
    const rightOrdinal = byId.get(rightRoot)!.ordinal;
    parent.set(rightOrdinal < leftOrdinal ? leftRoot : rightRoot, rightOrdinal < leftOrdinal ? rightRoot : leftRoot);
  };
  const strong = opportunities.filter(({ provenanceSessionIds }) => provenanceSessionIds.length >= 2);
  for (const opportunity of strong) {
    const [first, ...rest] = opportunity.provenanceSessionIds;
    for (const sessionId of rest) union(first!, sessionId);
  }

  const strongMemberIds = new Set(strong.flatMap(({ provenanceSessionIds }) => provenanceSessionIds));
  const strongComponents = new Map<string, GuidedPlanningSession[]>();
  for (const session of sessions.filter(({ sessionId }) => strongMemberIds.has(sessionId))) {
    const root = find(session.sessionId);
    const members = strongComponents.get(root) ?? [];
    members.push(session);
    strongComponents.set(root, members);
  }
  for (const members of strongComponents.values()) {
    if (members.length > 12) throw new Error("guided_opportunity_group_too_large");
  }

  const opportunityIdsFor = (sessionIds: string[]): string[] => {
    const memberIds = new Set(sessionIds);
    return opportunities
      .filter(({ provenanceSessionIds }) => provenanceSessionIds.every((sessionId) => memberIds.has(sessionId)))
      .map(({ opportunityId }) => opportunityId)
      .sort();
  };
  const group = (members: GuidedPlanningSession[], strongGroup: boolean): GuidedAssignmentGroup => {
    const ordered = [...members].sort((left, right) => left.ordinal - right.ordinal);
    const sessionIds = ordered.map(({ sessionId }) => sessionId);
    const opportunityIds = opportunityIdsFor(sessionIds);
    const singletonOwners = new Set(
      opportunities.filter(({ provenanceSessionIds }) => provenanceSessionIds.length === 1)
        .map(({ provenanceSessionIds }) => provenanceSessionIds[0]!)
    );
    const coverageClasses = ordered.map((session) => strongGroup
      ? "artifact_signal" as const
      : classifyPlanningSession(session, singletonOwners.has(session.sessionId)));
    return {
      coverageClasses,
      groupKey: stableRecordId("guided-group", [...sessionIds, ...opportunityIds]),
      opportunityIds,
      sessionIds
    };
  };
  const strongGroups = [...strongComponents.values()]
    .map((members) => group(members, true))
    .sort((left, right) => lowestOrdinal(left, byId) - lowestOrdinal(right, byId));
  const fallback = sessions.filter(({ sessionId }) => !strongMemberIds.has(sessionId));
  if (contractVersion === "workbench-authoring-v5") {
    const groups = [...strongGroups];
    for (let index = 0; index < fallback.length; index += 12) {
      groups.push(group(fallback.slice(index, index + 12), false));
    }
    groups.sort((left, right) => lowestOrdinal(left, byId) - lowestOrdinal(right, byId));
    assertCompletePlan(sessions, opportunities, groups, contractVersion);
    return { groups, opportunities };
  }
  let canary = strongGroups.find(({ sessionIds }) => sessionIds.length <= 3);
  let fallbackCanaryIds = new Set<string>();
  if (!canary) {
    if (fallback.length === 0) throw new Error("guided_canary_not_constructible");
    const singletonOwners = new Set(
      opportunities.filter(({ provenanceSessionIds }) => provenanceSessionIds.length === 1)
        .map(({ provenanceSessionIds }) => provenanceSessionIds[0]!)
    );
    const selected: GuidedPlanningSession[] = [];
    for (const coverageClass of ["artifact_signal", "tool_heavy", "ordinary"] as const) {
      const match = fallback.find((session) => (
        !selected.includes(session) && classifyPlanningSession(session, singletonOwners.has(session.sessionId)) === coverageClass
      ));
      if (match) selected.push(match);
    }
    for (const session of fallback) {
      if (selected.length >= 3) break;
      if (!selected.includes(session)) selected.push(session);
    }
    canary = group(selected, false);
    fallbackCanaryIds = new Set(canary.sessionIds);
  }

  const remainingGroups: GuidedAssignmentGroup[] = [];
  for (const strongGroup of strongGroups) {
    if (strongGroup.groupKey !== canary.groupKey) remainingGroups.push(strongGroup);
  }
  const remainingFallback = fallback.filter(({ sessionId }) => !fallbackCanaryIds.has(sessionId));
  for (let index = 0; index < remainingFallback.length; index += 12) {
    remainingGroups.push(group(remainingFallback.slice(index, index + 12), false));
  }
  remainingGroups.sort((left, right) => lowestOrdinal(left, byId) - lowestOrdinal(right, byId));
  const groups = [canary, ...remainingGroups];
  assertCompletePlan(sessions, opportunities, groups, contractVersion);
  return { canary, groups, opportunities };
}

function validatedPlanningSessions(input: GuidedPlanningSession[]): GuidedPlanningSession[] {
  if (input.length === 0) throw new Error("guided_selection_empty");
  if (input.some(({ sessionId }) => sessionId.trim().length === 0 || sessionId !== sessionId.trim())) {
    throw new Error("guided_selection_session_invalid");
  }
  if (new Set(input.map(({ sessionId }) => sessionId)).size !== input.length) throw new Error("guided_selection_session_duplicate");
  const ordinals = [...input.map(({ ordinal }) => ordinal)].sort((left, right) => left - right);
  if (
    new Set(ordinals).size !== input.length || ordinals.some((ordinal, index) => ordinal !== index) ||
    input.some(({ toolCallCount }) => !Number.isSafeInteger(toolCallCount) || toolCallCount < 0)
  ) throw new Error("guided_selection_ordinal_invalid");
  return [...input].sort((left, right) => left.ordinal - right.ordinal);
}

function normalizeOpportunities(
  suggestions: WorkbenchArtifactSuggestionDto[],
  sessions: Map<string, GuidedPlanningSession>
): NormalizedGuidedOpportunity[] {
  const normalized = new Map<string, NormalizedGuidedOpportunity>();
  for (const suggestion of suggestions) {
    if (
      new Set(suggestion.provenanceSessionIds).size !== suggestion.provenanceSessionIds.length ||
      new Set(suggestion.evidenceRefs).size !== suggestion.evidenceRefs.length
    ) throw new Error("guided_opportunity_invalid");
    const provenanceSessionIds = [...suggestion.provenanceSessionIds]
      .sort((left, right) => (sessions.get(left)?.ordinal ?? Number.MAX_SAFE_INTEGER) - (sessions.get(right)?.ordinal ?? Number.MAX_SAFE_INTEGER));
    const evidenceRefs = [...suggestion.evidenceRefs].sort();
    if (
      suggestion.summary.trim().length === 0 || suggestion.suggestionId.trim().length === 0 ||
      provenanceSessionIds.length === 0 || provenanceSessionIds.some((sessionId) => !sessions.has(sessionId)) ||
      evidenceRefs.length === 0 || evidenceRefs.some((ref) => ref.trim().length === 0)
    ) throw new Error("guided_opportunity_invalid");
    const identity = suggestion.signatureKey ?? suggestion.suggestionId;
    const opportunityId = stableRecordId("guided-opportunity", [
      suggestion.kind,
      identity,
      ...provenanceSessionIds,
      ...evidenceRefs
    ]);
    const opportunity: NormalizedGuidedOpportunity = {
      evidenceRefs,
      opportunityId,
      provenanceSessionIds,
      signalStrength: provenanceSessionIds.length >= 2 ? "high" : "medium",
      ...(suggestion.signatureKey ? { signatureKey: suggestion.signatureKey } : {}),
      suggestedKind: suggestion.kind,
      summary: suggestion.summary
    };
    const existing = normalized.get(opportunityId);
    if (!existing || opportunity.summary.localeCompare(existing.summary) < 0) normalized.set(opportunityId, opportunity);
  }
  return [...normalized.values()].sort((left, right) => left.opportunityId.localeCompare(right.opportunityId));
}

function lowestOrdinal(group: GuidedAssignmentGroup, sessions: Map<string, GuidedPlanningSession>): number {
  return Math.min(...group.sessionIds.map((sessionId) => sessions.get(sessionId)!.ordinal));
}

function assertCompletePlan(
  sessions: GuidedPlanningSession[],
  opportunities: NormalizedGuidedOpportunity[],
  groups: GuidedAssignmentGroup[],
  contractVersion: "workbench-authoring-v4" | "workbench-authoring-v5"
): void {
  const assignedSessions = groups.flatMap(({ sessionIds }) => sessionIds);
  const assignedOpportunities = groups.flatMap(({ opportunityIds }) => opportunityIds);
  if (
    groups.length === 0 || (contractVersion === "workbench-authoring-v4" && groups[0]!.sessionIds.length > 3) || groups.some(({ sessionIds }) => sessionIds.length > 12) ||
    assignedSessions.length !== sessions.length || new Set(assignedSessions).size !== sessions.length ||
    sessions.some(({ sessionId }) => !assignedSessions.includes(sessionId)) ||
    assignedOpportunities.length !== opportunities.length || new Set(assignedOpportunities).size !== opportunities.length ||
    opportunities.some(({ opportunityId }) => !assignedOpportunities.includes(opportunityId)) ||
    groups.some(({ coverageClasses, sessionIds }) => coverageClasses.length !== sessionIds.length)
  ) throw new Error("guided_assignment_plan_incomplete");
}
