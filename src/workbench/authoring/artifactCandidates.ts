import { stableRecordId } from "../../daemon/identity.ts";
import {
  hasWorkbenchArtifactCandidateScan,
  getWorkbenchArtifactCandidate,
  listWorkbenchArtifactCandidates,
  recordWorkbenchArtifactCandidateScan,
  saveWorkbenchArtifactCandidate,
  setWorkbenchArtifactCandidateStatus,
  type StoredWorkbenchArtifactCandidate
} from "../../daemon/db/workbenchArtifactCandidateRepository.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import { withImmediateTransaction, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import type { WorkbenchAutomaticKind } from "../../daemon/db/workbenchPipelineRepository.ts";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript.ts";
import { authoringEvidenceRevision } from "./evidenceCatalog.ts";

export type WorkbenchArtifactCandidate = StoredWorkbenchArtifactCandidate;

export type ArtifactCandidateProposal = {
  kind: WorkbenchAutomaticKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  signalEvidenceRefs: string[];
  signalSummary: string;
  signatureKey?: string;
};

type SignalRef = { index: number; observedAt: string; ref: string; sessionId: string };

type SessionSignals = {
  sessionId: string;
  failureRefs: SignalRef[];
  changeRefs: SignalRef[];
  verificationRefs: SignalRef[];
  explicitDecisionRefs: SignalRef[];
  alternativeRefs: SignalRef[];
  timelineEventRefs: SignalRef[];
  signatures: string[];
  signatureRefs: Array<SignalRef & { signatureKey: string }>;
  evidenceRefs: Set<string>;
};

type CandidateSeed = {
  kind: WorkbenchAutomaticKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  signalEvidenceRefs: string[];
  signalSummary: string;
  signatureKey?: string;
  evidenceRevision: string;
};

export function discoverArtifactCandidates(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchArtifactCandidate[] {
  return withImmediateTransaction(
    db,
    () => reconcileArtifactCandidates(db, normalizedStrings(sessionIds)).candidates
  );
}

export function discoverArtifactCandidatePage(
  db: MastheadDatabase,
  input: { afterSessionId?: string; limit?: number }
): { candidates: WorkbenchArtifactCandidate[]; scannedSessionIds: string[]; nextCursor?: string } {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 100), 100));
  const rows = db
    .prepare(
      `SELECT sessions.session_id AS sessionId
       FROM sessions
       INNER JOIN workbench_session_state
         ON workbench_session_state.session_id = sessions.session_id
       WHERE sessions.deleted_at IS NULL
         AND workbench_session_state.publication_status = 'publish_path'
         AND sessions.session_id > ?
       ORDER BY sessions.session_id
       LIMIT ?`
    )
    .all(input.afterSessionId ?? "", limit) as Array<{ sessionId: string }>;

  const reconciled = withImmediateTransaction(db, () => {
    const changed = rows.flatMap((row) => {
      const evidenceRevision = authoringEvidenceRevision(db, [row.sessionId]);
      return hasWorkbenchArtifactCandidateScan(db, { evidenceRevision, sessionId: row.sessionId })
        ? []
        : [{ evidenceRevision, sessionId: row.sessionId }];
    });
    const reconciliation = reconcileArtifactCandidates(
      db,
      changed.map((entry) => entry.sessionId)
    );
    const acknowledged = new Set(reconciliation.acknowledgedSessionIds);
    for (const entry of changed) {
      if (acknowledged.has(entry.sessionId)) recordWorkbenchArtifactCandidateScan(db, entry);
    }
    return reconciliation;
  });
  const result: {
    candidates: WorkbenchArtifactCandidate[];
    scannedSessionIds: string[];
    nextCursor?: string;
  } = {
    candidates: reconciled.candidates,
    scannedSessionIds: reconciled.acknowledgedSessionIds
  };
  if (rows.length === limit) result.nextCursor = rows.at(-1)!.sessionId;
  return result;
}

export function proposeArtifactCandidate(
  db: MastheadDatabase,
  proposal: ArtifactCandidateProposal
): WorkbenchArtifactCandidate {
  return withImmediateTransaction(db, () => proposeArtifactCandidateInTransaction(db, proposal));
}

function proposeArtifactCandidateInTransaction(
  db: MastheadDatabase,
  proposal: ArtifactCandidateProposal
): WorkbenchArtifactCandidate {
  const provenanceSessionIds = normalizedStrings(proposal.provenanceSessionIds);
  const signalEvidenceRefs = normalizedStrings(proposal.signalEvidenceRefs);
  if (provenanceSessionIds.length < 1 || provenanceSessionIds.length > 12) {
    throw new Error("candidate_proposal_provenance_count_invalid");
  }
  if (!provenanceSessionIds.includes(proposal.seedSessionId)) {
    throw new Error("candidate_proposal_seed_not_in_provenance");
  }
  if (signalEvidenceRefs.length === 0) {
    throw new Error("candidate_proposal_positive_evidence_required");
  }
  if (proposal.signalSummary.trim().length < 12) {
    throw new Error("candidate_proposal_summary_too_short");
  }

  for (const sessionId of provenanceSessionIds) {
    if (!db.prepare("SELECT 1 FROM sessions WHERE session_id = ? AND deleted_at IS NULL").get(sessionId)) {
      throw new Error(`candidate_proposal_session_not_found:${sessionId}`);
    }
  }

  const signals = provenanceSessionIds.map((sessionId) => extractSessionSignals(db, sessionId));
  const allEvidenceRefs = new Set(signals.flatMap((session) => [...session.evidenceRefs]));
  if (signalEvidenceRefs.some((ref) => !allEvidenceRefs.has(ref))) {
    throw new Error("candidate_proposal_evidence_ref_unknown");
  }
  const selected = new Set(signalEvidenceRefs);
  if (!proposalHasKindSignals(proposal.kind, signals, selected)) {
    throw new Error("candidate_proposal_kind_signals_missing");
  }
  const signatureKey = proposal.signatureKey
    ? normalizeProposedSignature(proposal.signatureKey, signals, selected)
    : undefined;
  const allowedEvidenceRefs = proposalAllowedEvidenceRefs(proposal.kind, signals, selected, signatureKey);
  const extraEvidenceRef = signalEvidenceRefs.find((ref) => !allowedEvidenceRefs.has(ref));
  if (extraEvidenceRef) {
    throw new Error(`candidate_proposal_signal_evidence_extra:${extraEvidenceRef}`);
  }
  const unrelatedSession = signals.find(
    (session) =>
      !sessionContributesKindSignal(proposal.kind, session, selected) &&
      !(
        signatureKey &&
        session.signatureRefs.some(
          (entry) => entry.signatureKey === signatureKey && selected.has(entry.ref)
        )
      )
  );
  if (unrelatedSession) {
    throw new Error(`candidate_proposal_unrelated_provenance:${unrelatedSession.sessionId}`);
  }
  const evidenceRevision = authoringEvidenceRevision(db, provenanceSessionIds);
  return reconcileProposedCandidate(db, {
    kind: proposal.kind,
    provenanceSessionIds,
    seedSessionId: proposal.seedSessionId,
    signalEvidenceRefs,
    signalSummary: proposal.signalSummary,
    evidenceRevision,
    ...(signatureKey ? { signatureKey } : {})
  });
}

function reconcileProposedCandidate(db: MastheadDatabase, seed: CandidateSeed): WorkbenchArtifactCandidate {
  const allCandidates = listWorkbenchArtifactCandidates(db);
  const current = allCandidates.find(
    (candidate) =>
      (candidate.status === "pending" || candidate.status === "claimed" || candidate.status === "published") &&
      candidateIdentityMatches(candidate, seed)
  );
  if (current && candidateMatchesSeedRevision(current, seed)) return getStoredCandidate(db, current.candidateId);
  if (current?.status === "claimed") {
    throw new Error(`candidate_proposal_reconciliation_deferred:${current.candidateId}`);
  }
  if (current) {
    setWorkbenchArtifactCandidateStatus(db, { candidateId: current.candidateId, status: "superseded" });
  }
  return persistSeeds(db, [seed], allCandidates)[0]!;
}

function proposalAllowedEvidenceRefs(
  kind: WorkbenchAutomaticKind,
  signals: SessionSignals[],
  selected: Set<string>,
  signatureKey?: string
): Set<string> {
  const allowed = new Set<string>();
  if (kind === "runbook") {
    for (const entry of runbookChain(signals, selected) ?? []) allowed.add(entry.ref);
  } else if (kind === "adr") {
    for (const entry of signals.flatMap((signal) => [
      ...signal.explicitDecisionRefs,
      ...signal.alternativeRefs
    ])) {
      if (selected.has(entry.ref)) allowed.add(entry.ref);
    }
  } else {
    for (const entry of signals.flatMap((signal) => [
      ...signal.failureRefs,
      ...signal.timelineEventRefs
    ])) {
      if (selected.has(entry.ref)) allowed.add(entry.ref);
    }
  }
  if (signatureKey) {
    for (const entry of signals.flatMap((signal) => signal.signatureRefs)) {
      if (entry.signatureKey === signatureKey) allowed.add(entry.ref);
    }
  }
  return allowed;
}

function reconcileArtifactCandidates(
  db: MastheadDatabase,
  requestedSessionIds: string[]
): { acknowledgedSessionIds: string[]; candidates: WorkbenchArtifactCandidate[] } {
  if (requestedSessionIds.length === 0) return { acknowledgedSessionIds: [], candidates: [] };

  const requested = normalizedStrings(requestedSessionIds);
  const preliminarySeeds = candidateSeedsForSessions(db, requested);
  const allCandidates = listWorkbenchArtifactCandidates(db);
  const current = allCandidates.filter((candidate) =>
    candidate.status === "pending" || candidate.status === "claimed" || candidate.status === "published"
  );
  const relevantClaimed = current.filter(
    (candidate) =>
      candidate.status === "claimed" &&
      (candidate.provenanceSessionIds.some((sessionId) => requested.includes(sessionId)) ||
        preliminarySeeds.some((seed) => candidateIdentityMatches(candidate, seed)))
  );
  const deferred = new Set<string>();
  for (const candidate of relevantClaimed) {
    const exactSeed = preliminarySeeds.find(
      (seed) => candidateIdentityMatches(candidate, seed) && candidateMatchesSeedRevision(candidate, seed)
    );
    if (exactSeed) continue;
    for (const sessionId of candidate.provenanceSessionIds) {
      if (requested.includes(sessionId)) deferred.add(sessionId);
    }
    for (const seed of preliminarySeeds) {
      if (!candidateIdentityMatches(candidate, seed)) continue;
      for (const sessionId of seed.provenanceSessionIds) {
        if (requested.includes(sessionId)) deferred.add(sessionId);
      }
    }
  }

  const acknowledgedSessionIds = requested.filter((sessionId) => !deferred.has(sessionId));
  if (acknowledgedSessionIds.length === 0) return { acknowledgedSessionIds, candidates: [] };

  const activePreliminary = candidateSeedsForSessions(db, acknowledgedSessionIds);
  const relevantMutable = current.filter(
    (candidate) =>
      (candidate.status === "pending" || candidate.status === "published") &&
      (candidate.provenanceSessionIds.some((sessionId) => acknowledgedSessionIds.includes(sessionId)) ||
        activePreliminary.some((seed) => candidateIdentityMatches(candidate, seed)))
  );
  const reconciliationSessionIds = normalizedStrings([
    ...acknowledgedSessionIds,
    ...relevantMutable.flatMap((candidate) => candidate.provenanceSessionIds)
  ]);
  const finalSeeds = candidateSeedsForSessions(db, reconciliationSessionIds);
  for (const candidate of relevantMutable) {
    if (
      finalSeeds.some(
        (seed) => candidateIdentityMatches(candidate, seed) && candidateMatchesSeedRevision(candidate, seed)
      )
    ) {
      continue;
    }
    setWorkbenchArtifactCandidateStatus(db, {
      candidateId: candidate.candidateId,
      status: "superseded"
    });
  }
  return {
    acknowledgedSessionIds,
    candidates: persistSeeds(db, finalSeeds, allCandidates)
  };
}

function candidateIdentityMatches(
  candidate: Pick<WorkbenchArtifactCandidate, "kind" | "seedSessionId" | "signatureKey">,
  seed: Pick<CandidateSeed, "kind" | "seedSessionId" | "signatureKey">
): boolean {
  if (candidate.kind !== seed.kind) return false;
  if (candidate.signatureKey || seed.signatureKey) return candidate.signatureKey === seed.signatureKey;
  return candidate.seedSessionId === seed.seedSessionId;
}

function candidateMatchesSeedRevision(candidate: WorkbenchArtifactCandidate, seed: CandidateSeed): boolean {
  return (
    candidate.evidenceRevision === seed.evidenceRevision &&
    arraysEqual(candidate.provenanceSessionIds, seed.provenanceSessionIds) &&
    arraysEqual(candidate.signalEvidenceRefs, seed.signalEvidenceRefs)
  );
}

function candidateSeedsForSessions(db: MastheadDatabase, sessionIds: string[]): CandidateSeed[] {
  const ungrouped = sessionIds.flatMap((sessionId) => seedsForSignals(db, extractSessionSignals(db, sessionId)));
  const groups = new Map<string, CandidateSeed[]>();
  for (const seed of ungrouped) {
    const key = `${seed.kind}\0${seed.signatureKey ?? `session:${seed.seedSessionId}`}`;
    groups.set(key, [...(groups.get(key) ?? []), seed]);
  }
  return [...groups.values()]
    .map((seeds) => {
      // A current signature has one bounded candidate. Prefer the lexicographically
      // smallest session IDs so selection is deterministic regardless of scan order.
      const selected = [...seeds].sort((left, right) => left.seedSessionId.localeCompare(right.seedSessionId)).slice(0, 12);
      const first = selected[0]!;
      const provenanceSessionIds = normalizedStrings(selected.flatMap((seed) => seed.provenanceSessionIds));
      return {
        ...first,
        seedSessionId: provenanceSessionIds[0]!,
        provenanceSessionIds,
        signalEvidenceRefs: normalizedStrings(selected.flatMap((seed) => seed.signalEvidenceRefs)),
        signalSummary: signalSummary(first.kind, provenanceSessionIds.length),
        evidenceRevision: authoringEvidenceRevision(db, provenanceSessionIds)
      };
    })
    .sort(compareSeeds);
}

function seedsForSignals(db: MastheadDatabase, signals: SessionSignals): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  const signatureKey = signals.signatures.length === 1 ? signals.signatures[0] : undefined;
  const chain = runbookChain([signals]);
  if (chain) {
    const signatureEvidenceRefs = signatureKey
      ? signals.signatureRefs
          .filter((entry) => entry.signatureKey === signatureKey)
          .map(refValue)
      : [];
    seeds.push({
      kind: "runbook",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings([...chain.map(refValue), ...signatureEvidenceRefs]),
      signalSummary: signalSummary("runbook", 1),
      evidenceRevision: authoringEvidenceRevision(db, [signals.sessionId]),
      ...(signatureKey ? { signatureKey } : {})
    });
  }
  if (adrReady(signals)) {
    seeds.push({
      kind: "adr",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings([
        ...signals.explicitDecisionRefs.map(refValue),
        ...signals.alternativeRefs.map(refValue)
      ]),
      signalSummary: signalSummary("adr", 1),
      evidenceRevision: authoringEvidenceRevision(db, [signals.sessionId])
    });
  }
  if (incidentReady(signals)) {
    seeds.push({
      kind: "incident_timeline",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings([
        ...signals.failureRefs.map(refValue),
        ...signals.timelineEventRefs.map(refValue),
        ...(signatureKey
          ? signals.signatureRefs
              .filter((entry) => entry.signatureKey === signatureKey)
              .map(refValue)
          : [])
      ]),
      signalSummary: signalSummary("incident_timeline", 1),
      evidenceRevision: authoringEvidenceRevision(db, [signals.sessionId]),
      ...(signatureKey ? { signatureKey } : {})
    });
  }
  return seeds;
}

function extractSessionSignals(db: MastheadDatabase, sessionId: string): SessionSignals {
  const result: SessionSignals = {
    sessionId,
    failureRefs: [],
    changeRefs: [],
    verificationRefs: [],
    explicitDecisionRefs: [],
    alternativeRefs: [],
    timelineEventRefs: [],
    signatures: [],
    signatureRefs: [],
    evidenceRefs: new Set<string>()
  };
  let index = 0;
  for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
    result.evidenceRefs.add(item.itemId);
    const normalized = normalizedItemText(item);
    const ref = { index, observedAt: item.observedAt, ref: item.itemId, sessionId };
    if (isFailure(item, normalized)) result.failureRefs.push(ref);
    if (isChange(item, normalized)) result.changeRefs.push(ref);
    if (isPassedVerification(item, normalized)) result.verificationRefs.push(ref);
    if (isExplicitDecision(item, normalized)) result.explicitDecisionRefs.push(ref);
    if (isRejectedAlternative(normalized)) result.alternativeRefs.push(ref);
    if (isIncidentTimelineEvent(item, normalized)) result.timelineEventRefs.push(ref);
    const signature = strongSignature(item.text);
    if (signature) {
      result.signatures.push(signature);
      result.signatureRefs.push({ ...ref, signatureKey: signature });
    }
    index += 1;
  }
  result.signatures = normalizedStrings(result.signatures);
  return result;
}

function runbookChain(signals: SessionSignals[], selected?: Set<string>): [SignalRef, SignalRef, SignalRef] | undefined {
  const eligible = (ref: SignalRef): boolean => !selected || selected.has(ref.ref);
  const failures = signals.flatMap((signal) => signal.failureRefs).filter(eligible).sort(compareSignalRefs);
  const changes = signals.flatMap((signal) => signal.changeRefs).filter(eligible).sort(compareSignalRefs);
  const verifications = signals.flatMap((signal) => signal.verificationRefs).filter(eligible).sort(compareSignalRefs);
  for (const failure of failures) {
    for (const change of changes) {
      if (!signalComesBefore(failure, change)) continue;
      const verification = verifications.find((entry) => signalComesBefore(change, entry));
      if (verification) return [failure, change, verification];
    }
  }
  return undefined;
}

function signalComesBefore(left: SignalRef, right: SignalRef): boolean {
  if (left.sessionId === right.sessionId) return left.index < right.index;
  const leftTime = Date.parse(left.observedAt);
  const rightTime = Date.parse(right.observedAt);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime < rightTime;
}

function compareSignalRefs(left: SignalRef, right: SignalRef): number {
  const leftTime = Date.parse(left.observedAt);
  const rightTime = Date.parse(right.observedAt);
  return (
    (Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime - rightTime : 0) ||
    left.observedAt.localeCompare(right.observedAt) ||
    left.sessionId.localeCompare(right.sessionId) ||
    left.index - right.index ||
    left.ref.localeCompare(right.ref)
  );
}

function adrReady(signals: SessionSignals): boolean {
  return signals.explicitDecisionRefs.length > 0 && signals.alternativeRefs.length > 0;
}

function incidentReady(signals: SessionSignals): boolean {
  return signals.failureRefs.length > 0 && signals.timelineEventRefs.length >= 3;
}

function proposalHasKindSignals(
  kind: WorkbenchAutomaticKind,
  signals: SessionSignals[],
  selected: Set<string>
): boolean {
  const selectedCount = (refs: SignalRef[]): number => refs.filter((entry) => selected.has(entry.ref)).length;
  const countAcrossSessions = (select: (session: SessionSignals) => SignalRef[]): number =>
    signals.reduce((count, session) => count + selectedCount(select(session)), 0);
  if (kind === "runbook") {
    return Boolean(runbookChain(signals, selected));
  }
  if (kind === "adr") {
    return (
      countAcrossSessions((session) => session.explicitDecisionRefs) > 0 &&
      countAcrossSessions((session) => session.alternativeRefs) > 0
    );
  }
  return (
    countAcrossSessions((session) => session.failureRefs) > 0 &&
    countAcrossSessions((session) => session.timelineEventRefs) >= 3
  );
}

function sessionContributesKindSignal(
  kind: WorkbenchAutomaticKind,
  signals: SessionSignals,
  selected: Set<string>
): boolean {
  const selectedCount = (refs: SignalRef[]): number => refs.filter((entry) => selected.has(entry.ref)).length;
  if (kind === "runbook") {
    return (
      selectedCount(signals.failureRefs) +
        selectedCount(signals.changeRefs) +
        selectedCount(signals.verificationRefs) >
      0
    );
  }
  if (kind === "adr") {
    return selectedCount(signals.explicitDecisionRefs) + selectedCount(signals.alternativeRefs) > 0;
  }
  return selectedCount(signals.failureRefs) + selectedCount(signals.timelineEventRefs) > 0;
}

function isFailure(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "tool_result" && (item.exitCode !== undefined ? item.exitCode !== 0 : item.status === "failed")) {
    return true;
  }
  if (item.kind === "runtime_signal" && /^(?:critical|error|fatal)$/.test((item.status ?? "").toLowerCase())) {
    return true;
  }
  return /\b(?:failed|failure|fatal|crashed|exception|error)\b/.test(normalized);
}

function isChange(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "file_effect") return true;
  return /\b(?:changed|fixed|patched|repaired|updated|migrated|mitigated)\b/.test(normalized);
}

function isPassedVerification(item: SessionTranscriptItem, normalized: string): boolean {
  const toolName = (item.toolName ?? "").toLowerCase();
  const verificationText = `${toolName} ${normalized}`.replace(/[_-]+/g, " ");
  const verificationSemantics =
    /\b(?:verification|verify|verified|tests?|checks?|typecheck|lint|build|smoke|health|probe)\b/.test(
      verificationText
    );
  const passedSemantics = /\b(?:pass|passed|succeed|succeeded|success|successful|ok|verified)\b/.test(
    verificationText
  );
  const negativeOutcome =
    /\b(?:failed|failure|failing|errors?|exceptions?|false|not|no|0\s+tests?\s+passed|zero\s+tests?\s+passed)\b/.test(
      verificationText
    );
  if (negativeOutcome) return false;
  if (
    item.kind === "tool_result" &&
    item.status === "succeeded" &&
    (item.exitCode ?? 0) === 0 &&
    !/(?:^|[._-])(?:read|cat|open|list|search|find|view)(?:[._-]|$)/.test(toolName) &&
    verificationSemantics &&
    passedSemantics
  ) {
    return true;
  }
  if (item.kind === "checkpoint" && verificationSemantics && passedSemantics) return true;
  return false;
}

function isExplicitDecision(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "checkpoint" && /decision_(?:recorded|approved)/.test(item.label.toLowerCase())) return true;
  return /\bdecision(?:\s+(?:approved|recorded))?\s*:|\bdecided\s+to\b|\badopted\s+as\b/.test(normalized);
}

function isRejectedAlternative(normalized: string): boolean {
  return (
    /\brejected\s+alternatives?\b/.test(normalized) ||
    /\balternatives?\b.*\brejected\b/.test(normalized) ||
    /\bconsidered\b.*\balternatives?\b/.test(normalized) ||
    /\binstead\s+of\b/.test(normalized)
  );
}

function isIncidentTimelineEvent(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind !== "runtime_signal" && item.kind !== "checkpoint") return false;
  return /\bincident[_ -](?:detected|triage|investigated|mitigated|recovered|restored|resolved)\b/.test(
    `${item.label.toLowerCase()} ${normalized}`
  );
}

function strongSignature(text: string): string | undefined {
  const marker = text.match(/\bERROR_SIGNATURE\s*:\s*([^\n]+)/i)?.[1];
  if (!marker) return undefined;
  const tokens = marker
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
  return tokens.length >= 2 ? `error:${tokens[0]}:${tokens.slice(1).join("-")}` : undefined;
}

function normalizeProposedSignature(
  signatureKey: string,
  signals: SessionSignals[],
  selected: Set<string>
): string {
  const normalized = signatureKey.trim().toLowerCase();
  if (
    !/^error:[a-z0-9]+:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ||
    signals.some(
      (signal) =>
        !signal.signatureRefs.some(
          (entry) => entry.signatureKey === normalized && selected.has(entry.ref)
        )
    )
  ) {
    throw new Error("candidate_proposal_signature_not_in_evidence");
  }
  return normalized;
}

function persistSeeds(
  db: MastheadDatabase,
  seeds: CandidateSeed[],
  lineageCandidates: WorkbenchArtifactCandidate[] = []
): WorkbenchArtifactCandidate[] {
  return seeds
    .map((seed) => {
      const unchanged = lineageCandidates.find(
        (candidate) =>
          candidate.status !== "superseded" &&
          candidateIdentityMatches(candidate, seed) &&
          candidateMatchesSeedRevision(candidate, seed)
      );
      if (unchanged) return getStoredCandidate(db, unchanged.candidateId);
      const predecessor = lineageCandidates
        .filter(
          (candidate) =>
            candidate.kind === seed.kind &&
            (candidateIdentityMatches(candidate, seed) ||
              candidate.provenanceSessionIds.some((sessionId) => seed.provenanceSessionIds.includes(sessionId)))
        )
        .sort(compareLineageCandidates)[0];
      return saveWorkbenchArtifactCandidate(db, {
        candidateId: candidateId(
          seed.kind,
          seed.seedSessionId,
          seed.evidenceRevision,
          seed.signatureKey,
          predecessor?.candidateId
        ),
        kind: seed.kind,
        provenanceSessionIds: seed.provenanceSessionIds,
        seedSessionId: seed.seedSessionId,
        signalEvidenceRefs: seed.signalEvidenceRefs,
        signalSummary: seed.signalSummary,
        evidenceRevision: seed.evidenceRevision,
        ...(predecessor ? { supersedesCandidateId: predecessor.candidateId } : {}),
        ...(seed.signatureKey ? { signatureKey: seed.signatureKey } : {})
      });
    })
    .sort(compareCandidates);
}

function compareLineageCandidates(
  left: WorkbenchArtifactCandidate,
  right: WorkbenchArtifactCandidate
): number {
  const rank = (candidate: WorkbenchArtifactCandidate): number =>
    candidate.status === "pending" || candidate.status === "claimed" || candidate.status === "published" ? 0 : 1;
  return (
    rank(left) - rank(right) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function getStoredCandidate(db: MastheadDatabase, candidateIdValue: string): WorkbenchArtifactCandidate {
  const candidate = getWorkbenchArtifactCandidate(db, candidateIdValue);
  if (!candidate) throw new Error(`artifact_candidate_not_found:${candidateIdValue}`);
  return candidate;
}

function candidateId(
  kind: WorkbenchAutomaticKind,
  seedSessionId: string,
  evidenceRevision: string,
  signatureKey?: string,
  supersedesCandidateId?: string
): string {
  return stableRecordId("artifact-candidate", [
    kind,
    signatureKey ?? seedSessionId,
    evidenceRevision,
    supersedesCandidateId ?? "root"
  ]);
}

function signalSummary(kind: WorkbenchAutomaticKind, sessionCount: number): string {
  const provenance = sessionCount === 1 ? "one session" : `${sessionCount} strongly matched sessions`;
  if (kind === "runbook") return `Failure, corrective change, and later passed verification found in ${provenance}.`;
  if (kind === "adr") return `An explicit decision and rejected alternative were found in ${provenance}.`;
  return `A failure and at least three explicit incident timeline events were found in ${provenance}.`;
}

function normalizedItemText(item: SessionTranscriptItem): string {
  return `${item.label} ${item.text}`.toLowerCase();
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function refValue(value: SignalRef): string {
  return value.ref;
}

function compareSeeds(left: CandidateSeed, right: CandidateSeed): number {
  return left.kind.localeCompare(right.kind) || left.seedSessionId.localeCompare(right.seedSessionId);
}

function compareCandidates(left: WorkbenchArtifactCandidate, right: WorkbenchArtifactCandidate): number {
  return left.kind.localeCompare(right.kind) || left.candidateId.localeCompare(right.candidateId);
}
