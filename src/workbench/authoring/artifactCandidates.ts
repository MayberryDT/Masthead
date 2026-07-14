import { stableRecordId } from "../../daemon/identity.ts";
import {
  hasWorkbenchArtifactCandidateScan,
  dismissWorkbenchArtifactCandidate,
  getWorkbenchArtifactCandidate,
  getWorkbenchArtifactCandidateSourceRevision,
  findBestWorkbenchArtifactCandidatePredecessor,
  findExactWorkbenchArtifactCandidate,
  listCurrentWorkbenchArtifactCandidatesForReconciliation,
  listCurrentWorkbenchArtifactCandidatesForSeed,
  listWorkbenchArtifactSignatureMembersForIdentities,
  listWorkbenchArtifactSignatureMembersForSessions,
  recordWorkbenchArtifactCandidateScan,
  replaceWorkbenchArtifactSignatureMembersForSessions,
  saveWorkbenchArtifactCandidate,
  setWorkbenchArtifactCandidateStatus,
  type StoredWorkbenchArtifactCandidate,
  type WorkbenchArtifactSignatureMember
} from "../../daemon/db/workbenchArtifactCandidateRepository.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import { withImmediateTransaction, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import type { WorkbenchAutomaticKind } from "../../daemon/db/workbenchPipelineRepository.ts";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript.ts";
import { authoringEvidenceRevision } from "./evidenceCatalog.ts";
import {
  hasNegativeVerificationOutcome,
  hasPositiveVerificationOutcome,
  hasStructuredVerificationReport
} from "./verificationSemantics.ts";

export type WorkbenchArtifactCandidate = StoredWorkbenchArtifactCandidate;

export const ARTIFACT_CANDIDATE_DETECTOR_REVISION = 3;

export type ArtifactCandidateProposal = {
  kind: WorkbenchAutomaticKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  signalEvidenceRefs: string[];
  signalSummary: string;
  signatureKey?: string;
};

type SignalRef = {
  index: number;
  itemKind: SessionTranscriptItem["kind"];
  messageIndex?: number;
  observedAt: string;
  ref: string;
  role: SessionTranscriptItem["role"];
  sessionId: string;
};

type IncidentStage = "impact" | "investigation" | "remediation" | "recovery";

type IncidentStageRef = SignalRef & {
  anchors: string[];
  stage: IncidentStage;
  textOffset: number;
};

type SessionSignals = {
  sessionId: string;
  failureRefs: SignalRef[];
  changeRefs: SignalRef[];
  verificationRefs: SignalRef[];
  completedProcedureRefs: SignalRef[];
  explicitDecisionRefs: SignalRef[];
  alternativeRefs: SignalRef[];
  incidentStageRefs: IncidentStageRef[];
  signatures: string[];
  signatureRefs: Array<SignalRef & { signatureKey: string }>;
  evidenceRefs: Set<string>;
};

type CandidateSeed = {
  kind: WorkbenchAutomaticKind;
  origin?: "automatic" | "proposal";
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
  return withImmediateTransaction(db, () => {
    const reconciled = reconcileArtifactCandidates(db, normalizedStrings(sessionIds));
    for (const sessionId of reconciled.acknowledgedSessionIds) {
      recordWorkbenchArtifactCandidateScan(db, {
        detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
        evidenceRevision: authoringEvidenceRevision(db, [sessionId]),
        sessionId,
        sourceRevision: getWorkbenchArtifactCandidateSourceRevision(db, sessionId)
      });
    }
    return reconciled.candidates;
  });
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
         AND workbench_session_state.publication_status <> 'not_added_to_logbook'
         AND sessions.session_id > ?
       ORDER BY sessions.session_id
       LIMIT ?`
    )
    .all(input.afterSessionId ?? "", limit) as Array<{ sessionId: string }>;

  const reconciled = reconcileCandidateScanRows(db, rows);
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

export function discoverNextArtifactCandidatePage(
  db: MastheadDatabase,
  input: { limit?: number } = {}
): { candidates: WorkbenchArtifactCandidate[]; scannedSessionIds: string[] } {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 100), 100));
  const rows = db
    .prepare(
      `SELECT sessions.session_id AS sessionId
       FROM sessions
       INNER JOIN workbench_session_state
         ON workbench_session_state.session_id = sessions.session_id
       LEFT JOIN workbench_artifact_candidate_source_revisions revisions
         ON revisions.session_id = sessions.session_id
       LEFT JOIN workbench_artifact_candidate_scans scans
         ON scans.session_id = sessions.session_id
        AND scans.source_revision = COALESCE(revisions.source_revision, 0)
        AND scans.detector_revision = ?
       WHERE sessions.deleted_at IS NULL
         AND workbench_session_state.publication_status <> 'not_added_to_logbook'
         AND scans.session_id IS NULL
       ORDER BY sessions.session_id
       LIMIT ?`
    )
    .all(ARTIFACT_CANDIDATE_DETECTOR_REVISION, limit) as Array<{ sessionId: string }>;
  const reconciled = reconcileCandidateScanRows(db, rows);
  return {
    candidates: reconciled.candidates,
    scannedSessionIds: reconciled.acknowledgedSessionIds
  };
}

function reconcileCandidateScanRows(
  db: MastheadDatabase,
  rows: Array<{ sessionId: string }>
): { acknowledgedSessionIds: string[]; candidates: WorkbenchArtifactCandidate[] } {
  return withImmediateTransaction(db, () => {
    const changed = rows.flatMap((row) => {
      const sourceRevision = getWorkbenchArtifactCandidateSourceRevision(db, row.sessionId);
      return hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
        sessionId: row.sessionId,
        sourceRevision
      })
        ? []
        : [{ sessionId: row.sessionId, sourceRevision }];
    });
    const reconciliation = reconcileArtifactCandidates(
      db,
      changed.map((entry) => entry.sessionId)
    );
    const acknowledged = new Set(reconciliation.acknowledgedSessionIds);
    for (const entry of changed) {
      if (acknowledged.has(entry.sessionId)) {
        recordWorkbenchArtifactCandidateScan(db, {
          ...entry,
          detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
          evidenceRevision: authoringEvidenceRevision(db, [entry.sessionId])
        });
      }
    }
    return reconciliation;
  });
}

export function proposeArtifactCandidate(
  db: MastheadDatabase,
  proposal: ArtifactCandidateProposal
): WorkbenchArtifactCandidate {
  return withImmediateTransaction(db, () => proposeArtifactCandidateInTransaction(db, proposal));
}

export function dismissArtifactCandidate(
  db: MastheadDatabase,
  input: { candidateId: string; reason: string; signalEvidenceRefs: string[] }
): WorkbenchArtifactCandidate {
  return withImmediateTransaction(db, () => {
    const candidate = getWorkbenchArtifactCandidate(db, input.candidateId);
    if (!candidate) throw new Error(`artifact_candidate_not_found:${input.candidateId}`);
    if (candidate.status !== "pending") return dismissWorkbenchArtifactCandidate(db, input);
    const signals = candidate.provenanceSessionIds.map((sessionId) => extractSessionSignals(db, sessionId));
    const selected = new Set(normalizedStrings(input.signalEvidenceRefs));
    const allEvidenceRefs = new Set(signals.flatMap((session) => [...session.evidenceRefs]));
    if (
      input.signalEvidenceRefs.some((ref) => !allEvidenceRefs.has(ref)) ||
      !proposalHasKindSignals(candidate.kind, signals, selected)
    ) {
      throw new Error("candidate_dismissal_evidence_changed");
    }
    return dismissWorkbenchArtifactCandidate(db, input);
  });
}

export function isArtifactCandidateEvidenceCurrent(
  db: MastheadDatabase,
  candidate: WorkbenchArtifactCandidate
): boolean {
  if (
    candidate.origin === "automatic" &&
    candidate.provenanceSessionIds.some((sessionId) => {
      const sourceRevision = getWorkbenchArtifactCandidateSourceRevision(db, sessionId);
      return !hasWorkbenchArtifactCandidateScan(db, {
        detectorRevision: ARTIFACT_CANDIDATE_DETECTOR_REVISION,
        sessionId,
        sourceRevision
      });
    })
  ) {
    return false;
  }
  if (candidate.origin !== "automatic" || !candidate.signatureKey) {
    return authoringEvidenceRevision(db, candidate.provenanceSessionIds) === candidate.evidenceRevision;
  }
  const members = listWorkbenchArtifactSignatureMembersForIdentities(db, [
    { kind: candidate.kind, signatureKey: candidate.signatureKey }
  ]).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  return (
    sameStrings(members.map((member) => member.sessionId), candidate.provenanceSessionIds) &&
    sameStrings(
      normalizedStrings(members.flatMap((member) => member.signalEvidenceRefs)),
      candidate.signalEvidenceRefs
    ) &&
    signatureGroupEvidenceRevision(members) === candidate.evidenceRevision
  );
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
  if (provenanceSessionIds.length > 1 && !proposal.signatureKey) {
    throw new Error("candidate_proposal_multi_session_signature_required");
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
    origin: "proposal",
    provenanceSessionIds,
    seedSessionId: proposal.seedSessionId,
    signalEvidenceRefs,
    signalSummary: proposal.signalSummary.trim(),
    evidenceRevision,
    ...(signatureKey ? { signatureKey } : {})
  });
}

function reconcileProposedCandidate(db: MastheadDatabase, seed: CandidateSeed): WorkbenchArtifactCandidate {
  const exact = findExactWorkbenchArtifactCandidate(db, seed);
  if (exact?.status === "dismissed" && candidateMatchesSeedRevision(exact, seed)) return exact;
  const predecessors = listCurrentWorkbenchArtifactCandidatesForSeed(db, seed);
  if (predecessors.length > 1) {
    throw new Error(
      `candidate_proposal_lineage_ambiguous:${predecessors
        .map((candidate) => candidate.candidateId)
        .sort()
        .join(",")}`
    );
  }
  const current = predecessors[0];
  if (current && candidateMatchesSeedRevision(current, seed)) return getStoredCandidate(db, current.candidateId);
  if (current?.status === "claimed") {
    throw new Error(`candidate_proposal_reconciliation_deferred:${current.candidateId}`);
  }
  if (current) {
    setWorkbenchArtifactCandidateStatus(db, { candidateId: current.candidateId, status: "superseded" });
  }
  return persistSeeds(db, [seed], current ? [current] : [])[0]!;
}

function proposalAllowedEvidenceRefs(
  kind: WorkbenchAutomaticKind,
  signals: SessionSignals[],
  selected: Set<string>,
  signatureKey?: string
): Set<string> {
  const allowed = new Set<string>();
  if (kind === "runbook") {
    for (const entry of signals.flatMap((signal) => [
      ...signal.failureRefs,
      ...signal.changeRefs,
      ...signal.verificationRefs,
      ...signal.completedProcedureRefs
    ])) {
      if (selected.has(entry.ref)) allowed.add(entry.ref);
    }
  } else if (kind === "adr") {
    for (const entry of signals.flatMap((signal) => [
      ...signal.explicitDecisionRefs,
      ...signal.alternativeRefs
    ])) {
      if (selected.has(entry.ref)) allowed.add(entry.ref);
    }
  } else {
    for (const entry of signals.flatMap((signal) => signal.incidentStageRefs)) {
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
  const previousSignatureMembers = listWorkbenchArtifactSignatureMembersForSessions(db, requested);
  const preliminaryIndividual = individualCandidateSeedsForSessions(db, requested);
  const preliminarySignatureMembers = signatureMembersFromSeeds(db, preliminaryIndividual);
  const preliminarySeeds = groupCandidateSeeds(preliminaryIndividual);
  const preliminaryIdentities = uniqueSignatureIdentities([
    ...previousSignatureMembers,
    ...preliminarySignatureMembers
  ]);
  const current = listCurrentWorkbenchArtifactCandidatesForReconciliation(db, {
    sessionIds: requested,
    identities: preliminaryIdentities
  });
  const relevantClaimed = current.filter(
    (candidate) =>
      candidate.status === "claimed" &&
      (candidate.provenanceSessionIds.some((sessionId) => requested.includes(sessionId)) ||
        preliminarySeeds.some((seed) => candidateIdentityMatches(candidate, seed)) ||
        Boolean(
          candidate.signatureKey &&
            [...previousSignatureMembers, ...preliminarySignatureMembers].some(
              (member) =>
                member.kind === candidate.kind && member.signatureKey === candidate.signatureKey
            )
        ))
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
    if (candidate.signatureKey) {
      for (const member of [...previousSignatureMembers, ...preliminarySignatureMembers]) {
        if (
          member.kind === candidate.kind &&
          member.signatureKey === candidate.signatureKey &&
          requested.includes(member.sessionId)
        ) {
          deferred.add(member.sessionId);
        }
      }
    }
  }

  const acknowledgedSessionIds = requested.filter((sessionId) => !deferred.has(sessionId));
  if (acknowledgedSessionIds.length === 0) return { acknowledgedSessionIds, candidates: [] };

  const activeIndividual = individualCandidateSeedsForSessions(db, acknowledgedSessionIds);
  const activePreliminary = groupCandidateSeeds(activeIndividual);
  const affectedSignatureIdentities = uniqueSignatureIdentities([
    ...previousSignatureMembers.filter((member) => acknowledgedSessionIds.includes(member.sessionId)),
    ...signatureMembersFromSeeds(db, activeIndividual)
  ]);
  replaceWorkbenchArtifactSignatureMembersForSessions(db, {
    sessionIds: acknowledgedSessionIds,
    members: signatureMembersFromSeeds(db, activeIndividual)
  });
  const storedSignatureMembers = listWorkbenchArtifactSignatureMembersForIdentities(
    db,
    affectedSignatureIdentities
  );
  const relevantMutable = current.filter(
    (candidate) =>
      (candidate.status === "pending" || candidate.status === "published") &&
      (candidate.provenanceSessionIds.some((sessionId) => acknowledgedSessionIds.includes(sessionId)) ||
        activePreliminary.some((seed) => candidateIdentityMatches(candidate, seed)) ||
        Boolean(
          candidate.signatureKey &&
            affectedSignatureIdentities.some(
              (identity) => identity.kind === candidate.kind && identity.signatureKey === candidate.signatureKey
            )
        ))
  );
  const proposalSeeds = relevantMutable
    .filter((candidate) => candidate.origin === "proposal")
    .flatMap((candidate) => validatedProposalSeedFromCandidate(db, candidate) ?? []);
  const automaticSeeds = [
    ...activeIndividual.filter((seed) => !seed.signatureKey),
    ...signatureCandidateSeeds(storedSignatureMembers)
  ].filter(
    (seed) => !proposalSeeds.some((proposalSeed) => candidateIdentityMatches(seed, proposalSeed))
  );
  const finalSeeds = [...automaticSeeds, ...proposalSeeds].sort(compareSeeds);
  const supersededCandidates: WorkbenchArtifactCandidate[] = [];
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
    supersededCandidates.push(candidate);
  }
  return {
    acknowledgedSessionIds,
    candidates: persistSeeds(db, finalSeeds, supersededCandidates)
  };
}

function validatedProposalSeedFromCandidate(
  db: MastheadDatabase,
  candidate: WorkbenchArtifactCandidate
): CandidateSeed | undefined {
  if (
    candidate.provenanceSessionIds.some(
      (sessionId) => !db.prepare("SELECT 1 FROM sessions WHERE session_id = ? AND deleted_at IS NULL").get(sessionId)
    )
  ) {
    return undefined;
  }
  const signals = candidate.provenanceSessionIds.map((sessionId) => extractSessionSignals(db, sessionId));
  const selected = new Set(candidate.signalEvidenceRefs);
  const allEvidenceRefs = new Set(signals.flatMap((session) => [...session.evidenceRefs]));
  if (candidate.signalEvidenceRefs.some((ref) => !allEvidenceRefs.has(ref))) return undefined;
  if (!proposalHasKindSignals(candidate.kind, signals, selected)) return undefined;
  if (
    candidate.signatureKey &&
    signals.some(
      (signal) =>
        !signal.signatureRefs.some(
          (entry) => entry.signatureKey === candidate.signatureKey && selected.has(entry.ref)
        )
    )
  ) {
    return undefined;
  }
  const allowed = proposalAllowedEvidenceRefs(candidate.kind, signals, selected, candidate.signatureKey);
  if (candidate.signalEvidenceRefs.some((ref) => !allowed.has(ref))) return undefined;
  if (
    signals.some(
      (signal) =>
        !sessionContributesKindSignal(candidate.kind, signal, selected) &&
        !(
          candidate.signatureKey &&
          signal.signatureRefs.some(
            (entry) => entry.signatureKey === candidate.signatureKey && selected.has(entry.ref)
          )
        )
    )
  ) {
    return undefined;
  }
  return {
    kind: candidate.kind,
    origin: "proposal",
    provenanceSessionIds: candidate.provenanceSessionIds,
    seedSessionId: candidate.seedSessionId,
    signalEvidenceRefs: candidate.signalEvidenceRefs,
    signalSummary: candidate.signalSummary,
    evidenceRevision: authoringEvidenceRevision(db, candidate.provenanceSessionIds),
    ...(candidate.signatureKey ? { signatureKey: candidate.signatureKey } : {})
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
    candidate.origin === (seed.origin ?? "automatic") &&
    candidate.seedSessionId === seed.seedSessionId &&
    candidate.signalSummary === seed.signalSummary &&
    candidate.evidenceRevision === seed.evidenceRevision &&
    arraysEqual(candidate.provenanceSessionIds, seed.provenanceSessionIds) &&
    arraysEqual(candidate.signalEvidenceRefs, seed.signalEvidenceRefs)
  );
}

function individualCandidateSeedsForSessions(db: MastheadDatabase, sessionIds: string[]): CandidateSeed[] {
  return sessionIds.flatMap((sessionId) => seedsForSignals(db, extractSessionSignals(db, sessionId)));
}

function groupCandidateSeeds(ungrouped: CandidateSeed[]): CandidateSeed[] {
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
        evidenceRevision: first.signatureKey
          ? signatureGroupEvidenceRevision(selected)
          : first.evidenceRevision
      };
    })
    .sort(compareSeeds);
}

function signatureCandidateSeeds(members: WorkbenchArtifactSignatureMember[]): CandidateSeed[] {
  const groups = new Map<string, WorkbenchArtifactSignatureMember[]>();
  for (const member of members) {
    const key = `${member.kind}\0${member.signatureKey}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  return [...groups.values()]
    .map((group) => {
      const selected = [...group].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
      const first = selected[0]!;
      const provenanceSessionIds = selected.map((member) => member.sessionId);
      return {
        kind: first.kind,
        seedSessionId: provenanceSessionIds[0]!,
        provenanceSessionIds,
        signalEvidenceRefs: normalizedStrings(selected.flatMap((member) => member.signalEvidenceRefs)),
        signalSummary: signalSummary(first.kind, provenanceSessionIds.length),
        signatureKey: first.signatureKey,
        evidenceRevision: signatureGroupEvidenceRevision(selected)
      };
    })
    .sort(compareSeeds);
}

function signatureGroupEvidenceRevision(
  members: Array<
    { seedSessionId: string; evidenceRevision: string } | { sessionId: string; evidenceRevision: string }
  >
): string {
  const selectedRevisions = members
    .map((member) => ({
      evidenceRevision: member.evidenceRevision,
      sessionId: "sessionId" in member ? member.sessionId : member.seedSessionId
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  return stableRecordId(
    "artifact-candidate-signature-revision",
    selectedRevisions.flatMap((member) => [member.sessionId, member.evidenceRevision])
  );
}

function uniqueSignatureIdentities(
  values: Array<{ kind: WorkbenchAutomaticKind; signatureKey: string }>
): Array<{ kind: WorkbenchAutomaticKind; signatureKey: string }> {
  const byKey = new Map<string, { kind: WorkbenchAutomaticKind; signatureKey: string }>();
  for (const value of values) byKey.set(`${value.kind}\0${value.signatureKey}`, value);
  return [...byKey.values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.signatureKey.localeCompare(right.signatureKey)
  );
}

function signatureMembersFromSeeds(
  db: MastheadDatabase,
  seeds: CandidateSeed[]
): WorkbenchArtifactSignatureMember[] {
  return seeds.flatMap((seed) =>
    seed.signatureKey
      ? [{
          evidenceRevision: seed.evidenceRevision,
          kind: seed.kind,
          sessionId: seed.seedSessionId,
          signalEvidenceRefs: seed.signalEvidenceRefs,
          sourceRevision: getWorkbenchArtifactCandidateSourceRevision(db, seed.seedSessionId),
          signatureKey: seed.signatureKey
        }]
      : []
  );
}

function seedsForSignals(db: MastheadDatabase, signals: SessionSignals): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  const signatureKey = signals.signatures.length === 1 ? signals.signatures[0] : undefined;
  const runbookRefs = runbookEvidence([signals]);
  if (runbookRefs) {
    const signatureEvidenceRefs = signatureKey
      ? signals.signatureRefs
          .filter((entry) => entry.signatureKey === signatureKey)
          .map(refValue)
      : [];
    seeds.push({
      kind: "runbook",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings([...runbookRefs.map(refValue), ...signatureEvidenceRefs]),
      signalSummary: signalSummary("runbook", 1),
      evidenceRevision: authoringEvidenceRevision(db, [signals.sessionId]),
      ...(signatureKey ? { signatureKey } : {})
    });
  }
  const adrRefs = adrEvidence([signals]);
  if (adrRefs) {
    seeds.push({
      kind: "adr",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings(adrRefs.map(refValue)),
      signalSummary: signalSummary("adr", 1),
      evidenceRevision: authoringEvidenceRevision(db, [signals.sessionId])
    });
  }
  const incidentRefs = incidentChain([signals]);
  if (incidentRefs) {
    seeds.push({
      kind: "incident_timeline",
      seedSessionId: signals.sessionId,
      provenanceSessionIds: [signals.sessionId],
      signalEvidenceRefs: normalizedStrings([
        ...incidentRefs.map(refValue),
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
    completedProcedureRefs: [],
    explicitDecisionRefs: [],
    alternativeRefs: [],
    incidentStageRefs: [],
    signatures: [],
    signatureRefs: [],
    evidenceRefs: new Set<string>()
  };
  let index = 0;
  let messageIndex = 0;
  const transcript = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })]
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort(compareTranscriptOrder);
  for (const { item } of transcript) {
    result.evidenceRefs.add(item.itemId);
    const normalized = normalizedItemText(item);
    const processInstruction = isInjectedProcessInstructionMessage(item);
    const narrativeMessage =
      !processInstruction &&
      item.kind === "message" &&
      (item.role === "user" || item.role === "assistant");
    const ref = {
      index,
      itemKind: item.kind,
      observedAt: item.observedAt,
      ref: item.itemId,
      role: item.role,
      sessionId,
      ...(narrativeMessage ? { messageIndex } : {})
    };
    if (!processInstruction) {
      if (isFailure(item, normalized)) result.failureRefs.push(ref);
      if (isChange(item, normalized)) result.changeRefs.push(ref);
      if (isPassedVerification(item, normalized)) result.verificationRefs.push(ref);
      if (isCompletedProcedure(item, normalized)) result.completedProcedureRefs.push(ref);
      if (isAdrEvidenceItem(item) && isExplicitDecision(item, normalized)) {
        result.explicitDecisionRefs.push(ref);
      }
      if (isAdrEvidenceItem(item) && isRejectedAlternative(normalized)) {
        result.alternativeRefs.push(ref);
      }
      result.incidentStageRefs.push(...incidentStageOccurrences(item, normalized, ref));
      const signature = strongSignature(item.text);
      if (signature) {
        result.signatures.push(signature);
        result.signatureRefs.push({ ...ref, signatureKey: signature });
      }
    }
    index += 1;
    if (narrativeMessage) messageIndex += 1;
  }
  result.signatures = normalizedStrings(result.signatures);
  return result;
}

function isInjectedProcessInstructionMessage(item: SessionTranscriptItem): boolean {
  if (item.kind !== "message") return false;
  const text = item.text.trimStart().toLowerCase();
  return (
    text.startsWith("<skill>") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<turn_aborted>") ||
    text.startsWith("<subagent_notification>") ||
    text.startsWith("# agents.md instructions")
  );
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

function runbookEvidence(signals: SessionSignals[], selected?: Set<string>): SignalRef[] | undefined {
  const eligible = (ref: SignalRef): boolean => !selected || selected.has(ref.ref);
  const completedProcedures = signals
    .flatMap((signal) => signal.completedProcedureRefs)
    .filter(eligible)
    .sort(compareSignalRefs);
  const chain = runbookChain(signals, selected);
  const completion = completedProcedures.at(-1);
  return completion ? [completion] : chain;
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

function compareTranscriptOrder(
  left: { item: SessionTranscriptItem; originalIndex: number },
  right: { item: SessionTranscriptItem; originalIndex: number }
): number {
  const leftTime = Date.parse(left.item.observedAt);
  const rightTime = Date.parse(right.item.observedAt);
  const timeOrder =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? leftTime - rightTime
      : left.item.observedAt.localeCompare(right.item.observedAt);
  if (timeOrder !== 0) return timeOrder;
  const leftSource = transcriptSourceSequence(left.item);
  const rightSource = transcriptSourceSequence(right.item);
  if (leftSource && rightSource && leftSource.scope === rightSource.scope) {
    const sourceOrder = leftSource.ordinal - rightSource.ordinal;
    if (sourceOrder !== 0) return sourceOrder;
  }
  return left.originalIndex - right.originalIndex;
}

function transcriptSourceSequence(
  item: SessionTranscriptItem
): { ordinal: number; scope: string } | undefined {
  const refs = Array.isArray(item.sourceRef) ? item.sourceRef : [item.sourceRef];
  for (const value of refs) {
    if (!value || typeof value !== "object") continue;
    const sourceRecordKey = (value as { sourceRecordKey?: unknown }).sourceRecordKey;
    if (typeof sourceRecordKey !== "string") continue;
    const match = /^(.*):(\d+)(?::[^:]*)?$/.exec(sourceRecordKey);
    if (!match) continue;
    const ordinal = Number.parseInt(match[2]!, 10);
    if (Number.isSafeInteger(ordinal)) return { ordinal, scope: match[1]! };
  }
  return undefined;
}

function adrEvidence(signals: SessionSignals[], selected?: Set<string>): SignalRef[] | undefined {
  const eligible = (ref: SignalRef): boolean => !selected || selected.has(ref.ref);
  const decisions = signals.flatMap((signal) => signal.explicitDecisionRefs).filter(eligible);
  const alternatives = signals.flatMap((signal) => signal.alternativeRefs).filter(eligible);
  const sameRef = decisions.find((decision) => alternatives.some((entry) => entry.ref === decision.ref));
  if (sameRef) return [sameRef];
  const pairs = decisions.flatMap((decision) =>
    alternatives
      .filter((alternative) => areDecisionSignalsLinked(decision, alternative))
      .map((alternative) => ({
        decision,
        alternative,
        distance: Math.abs(decision.index - alternative.index)
      }))
  ).sort(
    (left, right) =>
      left.distance - right.distance ||
      compareSignalRefs(left.decision, right.decision) ||
      compareSignalRefs(left.alternative, right.alternative)
  );
  const pair = pairs[0];
  return pair ? [pair.decision, pair.alternative].sort(compareSignalRefs) : undefined;
}

function incidentChain(signals: SessionSignals[], selected?: Set<string>): IncidentStageRef[] | undefined {
  const eligible = (ref: IncidentStageRef): boolean => !selected || selected.has(ref.ref);
  const stages = signals.flatMap((signal) => signal.incidentStageRefs).filter(eligible).sort(compareIncidentStages);
  const impacts = stages.filter((entry) => entry.stage === "impact").reverse();
  for (const requireRecovery of [true, false]) {
    for (const impact of impacts) {
      const investigations = stages.filter(
        (entry) =>
          entry.stage === "investigation" &&
          incidentStageComesBefore(impact, entry) &&
          areIncidentStagesLinked(impact, entry)
      );
      for (const investigation of investigations) {
        const remediation = stages.find(
          (entry) =>
            entry.stage === "remediation" &&
            incidentStageComesBefore(investigation, entry) &&
            areIncidentStagesLinked(investigation, entry)
        );
        if (!remediation) continue;
        const recovery = stages.find(
          (entry) =>
            entry.stage === "recovery" &&
            incidentStageComesBefore(remediation, entry) &&
            areIncidentStagesLinked(remediation, entry)
        );
        if (requireRecovery && !recovery) continue;
        if (!requireRecovery && recovery) continue;
        if (!recovery && impact.role !== "user" && !isStructuredIncidentStage(impact)) continue;
        return uniqueSignalRefs([impact, investigation, remediation, ...(recovery ? [recovery] : [])]);
      }
    }
  }
  return undefined;
}

function proposalHasKindSignals(
  kind: WorkbenchAutomaticKind,
  signals: SessionSignals[],
  selected: Set<string>
): boolean {
  if (kind === "runbook") return Boolean(runbookEvidence(signals, selected));
  if (kind === "adr") return Boolean(adrEvidence(signals, selected));
  return Boolean(incidentChain(signals, selected));
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
        selectedCount(signals.verificationRefs) +
        selectedCount(signals.completedProcedureRefs) >
      0
    );
  }
  if (kind === "adr") {
    return selectedCount(signals.explicitDecisionRefs) + selectedCount(signals.alternativeRefs) > 0;
  }
  return selectedCount(signals.incidentStageRefs) > 0;
}

function isFailure(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "tool_result") {
    return item.status === "failed" || (item.exitCode !== undefined && item.exitCode !== 0);
  }
  if (item.kind === "runtime_signal") {
    return /^(?:critical|error|fatal)$/.test((item.status ?? "").toLowerCase());
  }
  if (
    /\b(?:no|without)\s+(?:\w+\s+){0,3}(?:error|failure|exception)\b/.test(normalized) ||
    /\berror\s+handling\b/.test(normalized) ||
    /\b(?:if|when|would|could|may|might|should)\b[^.\n]{0,60}\b(?:fail|fails|failed|failure|error)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  return (
    /\b(?:the\s+)?(?:command|requests?|tests?|build|migration|callback|service|process|operation|deployment)\s+(?:has\s+|had\s+)?(?:failed|crashed)\b/.test(
      normalized
    ) ||
    /\b(?:observed|encountered|reported|returned|raised|threw|reproduced|confirmed|detected)\s+(?:an?\s+)?(?:error|failure|exception)\b/.test(
      normalized
    ) ||
    /\b(?:error|failure|exception)\s+(?:occurred|was\s+(?:observed|reproduced|confirmed|detected))\b/.test(
      normalized
    )
  );
}

function isChange(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "file_effect") {
    return !/(?:^|\/)plans?(?:\/|$)|(?:^|[\/_-])roadmap(?:[\/_-]|$)/i.test(item.filePath ?? item.text);
  }
  const changeTerm = "(?:change(?:d)?|fix(?:ed)?|patch(?:ed)?|repair(?:ed)?|update(?:d)?|migrat(?:ed)?|mitigat(?:ed)?)";
  if (
    new RegExp(`\\b(?:no|not|never|without)\\b[^.\\n]{0,40}\\b${changeTerm}\\b`).test(normalized) ||
    new RegExp(
      `\\b(?:if|could|might|may|would|should)\\b[^.\\n]{0,80}\\b${changeTerm}\\b`
    ).test(normalized)
  ) {
    return false;
  }
  return /\b(?:changed|fixed|patched|repaired|updated|migrated|mitigated)\b/.test(normalized);
}

function isPassedVerification(item: SessionTranscriptItem, normalized: string): boolean {
  const toolName = (item.toolName ?? "").toLowerCase();
  const verificationText = `${toolName} ${normalized}`.replace(/[_-]+/g, " ");
  const verificationSemantics = /\b(?:verification|verify|verified|tests?|checks?|typecheck|lint|build|smoke|health|probe)\b/.test(
    verificationText
  );
  if (hasNegativeVerificationOutcome(verificationText)) return false;
  if (
    item.kind === "tool_result" &&
    item.status === "succeeded" &&
    (item.exitCode ?? 0) === 0 &&
    !/(?:^|[._-])(?:read|cat|open|list|search|find|view)(?:[._-]|$)/.test(toolName) &&
    verificationSemantics &&
    hasPositiveVerificationOutcome(verificationText)
  ) {
    return true;
  }
  if (item.kind === "checkpoint" && verificationSemantics && hasPositiveVerificationOutcome(verificationText)) {
    return true;
  }
  return false;
}

function isCompletedProcedure(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind !== "message" || item.role !== "assistant") return false;
  if (
    /\b(?:still|remains?)\s+(?:untested|unverified|unresolved|broken|failing|pending)\b/.test(normalized) ||
    /\b(?:end[- ]to[- ]end|final|production)\b[^.\n]{0,50}\b(?:untested|unverified|unconfirmed|pending|not\s+(?:tested|verified|confirmed))\b/.test(
      normalized
    ) ||
    /\b(?:aborted|did not complete|not applied|stopped before completion|no option was (?:selected|applied))\b/.test(
      normalized
    )
  ) {
    return false;
  }
  const semanticText = normalized
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/g, " ")
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/g, " ");
  const actionMatches = normalized.match(
    /\b(?:applied|added|aligned|backed\s+up|bound|broadened|built|changed|cleaned|closed|committed|configured|corrected|created|deployed|disabled|edited|enabled|fixed|forced|implemented|installed|launched|migrated|modified|moved|patched|pointed|preserved|published|pushed|recovered|recreated|removed|rendered|repaired|replaced|repointed|restarted|restored|retained|rotated|ran|saved|set|shifted|updated|used|wrote)\b/g
  ) ?? [];
  const anchorMatches = normalized.match(
    /\b(?:browser|check|command|config(?:uration)?|container|cron|database|deployment|directory|file|health|host|job|launcher|path|port|process|report|script|service|setting|snapshot|test|url|worker|workflow)\b|`[^`]+`|(?:^|\s)[\w.-]+\/[\w./-]+/g
  ) ?? [];
  const hasExplicitProcedureShape =
    /\b(?:operations?|operating|repeatable|procedure|runbook|setup|workflow|deployment|recovery|reusable\s+(?:flow|process|steps))\b/.test(
      semanticText
    );
  const hasRecoveryShape =
    /\b(?:failed|failures?|errors?|outage|offline|unavailable|broken|unreadable|blocked|stalled|stuck|crashed?|regression|permission\s+denied|pairing\s+required|malformed)\b/.test(
      semanticText
    ) &&
    /\b(?:traced|diagnosed|root\s+cause|isolated|investigated|reproduced|identified|determined|what\s+(?:actually\s+)?(?:caused|was\s+wrong)|failures?\s+(?:were|was)\s+stale)\b/.test(
      semanticText
    );
  const hasVerification =
    hasStructuredVerificationReport(normalized) ||
    evidenceClauses(normalized).some((clause) => hasPositiveVerificationOutcome(clause.text));
  const planOnly =
    /\b(?:plan|roadmap|proposal|handoff)\b/.test(semanticText) &&
    (/\bno\s+(?:app|product|runtime|source)(?:\s+source)?\s+files?\s+(?:were\s+)?changed\b/.test(semanticText) ||
      /\bnext\s+(?:best\s+)?(?:move|step)\b[^.\n]{0,100}\b(?:start|implement|execute|touch)\b/.test(
        semanticText
      ));
  if (planOnly) return false;
  const executed =
    /\b(?:done|finished|implemented|got it fixed|i\s+(?:changed|moved)|live now)\b/.test(semanticText);
  const concreteChange =
    /\b(?:what i changed|what i did|what changed|changed files|files changed)\b/.test(semanticText) ||
    actionMatches.length >= 2;
  const reusableOperations =
    /\b(?:fast path next time|cron|scheduled?|daily|fallback path|canonical\s+(?:path|source)|restart command|container|gateway|uid|gid|permission|global\s+(?:codex\s+)?defaults?|approval_policy|sandbox_mode|verifier|status[- ]color|blocked predicate)\b/.test(
      semanticText
    ) ||
    (/\b(?:production|live now)\b/.test(semanticText) &&
      /\b(?:deploy(?:ed|ment)?|custom domains?|worker)\b/.test(semanticText));
  const fastPath =
    /\bfast path next time\b/.test(semanticText) && /(?:^|\n)\s*(?:[-*]\s*)?(?:ssh|docker|npm|npx|pnpm|yarn|node|curl|op|openclaw)\b/m.test(
      normalized
    );
  const completedOperationalReceipt =
    executed &&
    (concreteChange || (fastPath && actionMatches.length >= 1)) &&
    anchorMatches.length >= 2 &&
    hasVerification &&
    reusableOperations;
  return (
    completedOperationalReceipt ||
    (actionMatches.length >= 2 &&
      anchorMatches.length >= 2 &&
      (hasExplicitProcedureShape || hasRecoveryShape) &&
      hasVerification)
  );
}

function isExplicitDecision(item: SessionTranscriptItem, normalized: string): boolean {
  if (item.kind === "checkpoint" && /decision_(?:recorded|approved)/.test(item.label.toLowerCase())) {
    return hasMaterialDecisionContext(normalized);
  }
  if (item.kind === "message" && item.role === "assistant") {
    const compact = normalized.replace(/\s+/g, " ");
    const completed = /\b(?:done|completed|finished|what i changed|behavior now)\b/.test(compact);
    const transitionAnchor =
      "(?:architecture|defaults?|approvals?[^.]{0,24}mode|policy|source[- ]of[- ]truth|workflow|model)";
    const completedTransition =
      new RegExp(
        `\\b(?:set|updated|changed|reworked|moved|switched|migrated|replaced)\\b[^.]{0,140}\\b${transitionAnchor}\\b|\\b${transitionAnchor}\\b[^.]{0,100}\\b(?:set|updated|changed|reworked|moved|switched|migrated|replaced)\\b`
      ).test(compact);
    const decisionHeading = /\b(?:canonical|final|selected|settled)\s+[^.!?;]{0,40}\bdecision\b/.test(
      compact
    );
    if (completed && hasMaterialDecisionContext(compact) && (completedTransition || decisionHeading)) {
      return true;
    }
  }
  return hasMaterialDecisionContext(normalized) && evidenceClauses(normalized).some((clause) => {
    if (
      /\bif\b[^.\n]{0,100}\b(?:decision|decided|choice|chose|selected|adopted|approved|confirmed|settled)\b/.test(
        clause.text
      ) ||
      /\b(?:no|not|never)\b[^.\n]{0,45}\b(?:decision|decided|choice|chose|selected|adopted|approved|confirmed|settled)\b/.test(
        clause.text
      ) ||
      /\b(?:rejected|declined)\b[^.\n]{0,30}\b(?:decision|choice)\b|\b(?:decision|choice)\b[^.\n]{0,30}\b(?:rejected|declined)\b/.test(
        clause.text
      )
    ) {
      return false;
    }
    const committed =
      /\b(?:decided|chose|selected|adopted|committed|settled(?:\s+on)?)\b/.test(clause.text) ||
      /\b(?:approved|confirmed)\b[^.\n]{0,60}\b(?:decision|choice|direction|contract|policy|approach|architecture|design|default|selection)\b/.test(
        clause.text
      ) ||
      /\b(?:decision|choice|direction|contract|policy|approach|architecture|design|default|source\s+of\s+truth)\s*(?::|\bis\b|\bwas\b|\bwill\s+be\b)/.test(
        clause.text
      ) ||
      /\b(?:final|durable|settled)\s+(?:decision|choice|direction|contract|policy|approach)\b/.test(
        clause.text
      ) ||
      /\b(?:establishes?|resolves?|settles?)\b[^.\n]{0,100}\b(?:contract|direction|decision|choice|policy|architecture|design|workflow|approach)\b/.test(
        clause.text
      );
    if (!committed) return false;
    return !/\b(?:if|could|might|may|would|should|proposed|hypothetical|possible)\b/.test(clause.text) ||
      /\b(?:decided|chose|selected|adopted|committed|settled)\b/.test(clause.text);
  });
}

function hasMaterialDecisionContext(normalized: string): boolean {
  return /\b(?:adr|api|application|approval|architecture|artifact|automation|browser|cli|configuration|contract|database|deploy(?:ment)?|design|engine|filesystem|framework|infrastructure|integration|interface|jwt|logbook|migration|mode|permission|platform|policy|pricing|product|protocol|queue|rollback|runtime|schema|security|server|service|session\s+store|source\s+of\s+truth|sqlite|storage|strategy|system|technology|ui|uid|gid|worker|workflow)\b/.test(
    normalized
  );
}

function isRejectedAlternative(normalized: string): boolean {
  return evidenceClauses(normalized).some((clause) => {
    if (
      /\b(?:no|not|never)\b[^.\n]{0,60}\b(?:alternatives?|options?|considered|compared|evaluated|rejected)\b/.test(
        clause.text
      ) ||
      /\b(?:if|could|might|may|would|should|proposed|hypothetical|possible)\b/.test(clause.text) &&
        !/\b(?:rejected|declined|ruled\s+out|chose|selected|adopted)\b/.test(clause.text)
    ) {
      return false;
    }
    return (
      /\b(?:rejected|declined|ruled\s+out|avoided)\b/.test(clause.text) ||
      /\b(?:instead\s+of|rather\s+than|versus|vs\.?)\b/.test(clause.text) ||
      /\b(?:chose|selected|preferred)\b[^.\n]{1,100}\bover\b/.test(clause.text) ||
      /\b(?:compared|evaluated|considered)\b[^.\n]{0,80}\b(?:alternatives?|options?|approaches?|directions?)\b/.test(
        clause.text
      ) ||
      /\b(?:replaced?|moved?|switched?|migrated?)\b[^.\n]{1,100}\b(?:with|to|away\s+from)\b/.test(
        clause.text
      ) ||
      /\b(?:changed|moved|switched|migrated|replaced)\b[^.\n]{1,100}\bfrom\b[^.\n]{1,100}\bto\b/.test(
        clause.text
      ) ||
      /\b(?:fix|repair|use|read|write|configure|change)\w*\b[^.\n]{0,160}\bnot\s+by\b/.test(
        clause.text
      ) ||
      /\bdistinguish(?:ed|es)?\b[^.\n]{0,80}\bfrom\b/.test(clause.text)
    );
  });
}

function isAdrEvidenceItem(item: SessionTranscriptItem): boolean {
  return item.kind === "message" && (item.role === "user" || item.role === "assistant") || (
    item.kind === "checkpoint" && /decision_(?:recorded|approved)/.test(item.label.toLowerCase())
  );
}

function incidentStageOccurrences(
  item: SessionTranscriptItem,
  normalized: string,
  ref: SignalRef
): IncidentStageRef[] {
  const anchors = incidentAnchors(item.text);
  if (
    item.kind === "tool_result" &&
    (item.status === "failed" || (item.exitCode !== undefined && item.exitCode !== 0))
  ) {
    return [{ ...ref, anchors, stage: "impact", textOffset: 0 }];
  }
  if (item.kind === "runtime_signal" || item.kind === "checkpoint") {
    const label = `${item.label.toLowerCase()} ${normalized}`;
    const stage = /\bincident[_ -]detected\b/.test(label)
      ? "impact"
      : /\bincident[_ -](?:triage|investigated)\b/.test(label)
        ? "investigation"
        : /\bincident[_ -]mitigated\b/.test(label)
          ? "remediation"
          : /\bincident[_ -](?:recovered|restored|resolved)\b/.test(label)
            ? "recovery"
            : item.kind === "runtime_signal" && /^(?:critical|error|fatal)$/.test((item.status ?? "").toLowerCase())
              ? "impact"
            : undefined;
    return stage ? [{ ...ref, anchors, stage, textOffset: 0 }] : [];
  }
  if (item.kind !== "message" || (item.role !== "user" && item.role !== "assistant")) return [];
  if (/\b(?:implementation plan|goal prompt|optimized plan|plan written|replacing the plan|recovery roadmap|visual repair roadmap)\b/.test(normalized)) {
    return [];
  }
  const unresolvedMessage = /\b(?:what is not live yet|still serving|not logged in|need (?:one )?authorization|blocked piece)\b/.test(
    normalized
  );
  const occurrences = evidenceClauses(normalized).flatMap((clause) => {
    if (isHypotheticalOrAdvisoryClause(clause.text)) return [];
    const occurrences: IncidentStageRef[] = [];
    addIncidentStage(
      occurrences,
      ref,
      anchors,
      clause,
      "impact",
      /\b(?:failed|failure|failing|error|exception|outage|offline|unavailable|broken|unreadable|blocked|stalled|stuck|crashed?|data\s+loss|permission\s+denied|pairing\s+required|blank|incorrect|could\s+not|cannot|unable\s+to)\b/
    );
    addIncidentStage(
      occurrences,
      ref,
      anchors,
      clause,
      "investigation",
      /\b(?:traced|diagnosed|diagnosis|root[-\s]+cause|isolated|investigated|reproduced|identified|determined|narrowed|attributed|confirmed\s+(?:the\s+)?cause|found\s+that|showed\s+that|was\s+not\s+the\s+(?:correct\s+)?target|(?:wrong|incorrect)\s+(?:target|binding|route|source|path)|(?:helper|component|path)\s+is\s+(?:the\s+)?(?:unstable\s+(?:piece|path)|cause|culprit))\b/
    );
    addIncidentStage(
      occurrences,
      ref,
      anchors,
      clause,
      "remediation",
      /\b(?:applied|broadened|changed|configured|corrected|deployed|disabled|enabled|fixed|implemented|installed|migrated|moved|patched|recreated|recycled|remapped|removed|repaired|replaced|repointed|restarted|shifted|updated)\b/
    );
    addIncidentStage(
      occurrences,
      ref,
      anchors,
      clause,
      "recovery",
      /\b(?:verified|passed|succeeded|successful|restored|recovered|resolved|returned\s+to\s+baseline|working\s+again|healthy|green|available\s+again|opened\s+successfully|delivered\s+successfully)\b/
    );
    return occurrences;
  });
  return unresolvedMessage ? occurrences.filter((entry) => entry.stage !== "recovery") : occurrences;
}

function evidenceClauses(normalized: string): Array<{ offset: number; text: string }> {
  return [...normalized.matchAll(/[^.!?;\n]+(?:[.!?;]+|\n+|$)/g)]
    .map((match) => ({ offset: match.index, text: match[0].trim() }))
    .filter((clause) => clause.text.length > 0);
}

function isHypotheticalOrAdvisoryClause(clause: string): boolean {
  const withoutObservedInability = clause.replace(/\bcould\s+not\b/g, "");
  if (
    /\b(?:if|could|might|may|would|should|recommend(?:ed|ation)?|suggest|proposal|proposed|plan(?:ned)?\s+to|going\s+to|(?:i|we|you|it|they)\s*(?:['’]ll|will|won['’]t)|will(?:\s+not)?)\b/.test(
      withoutObservedInability
    )
  ) {
    return true;
  }
  return (
    /\b(?:no|not|never|without)\b[^.\n]{0,35}\b(?:failure|error|outage|crash|blocked|stalled|stuck|unavailable|broken|unreadable)\b/.test(
      clause
    ) ||
    /\b(?:remains?|still)\s+(?:unconfirmed|unverified|untested)\b/.test(clause)
    || /\bcannot\s+(?:blur|drift|regress|creep|diverge|be\s+confused)\b/.test(clause)
  );
}

function addIncidentStage(
  occurrences: IncidentStageRef[],
  ref: SignalRef,
  anchors: string[],
  clause: { offset: number; text: string },
  stage: IncidentStage,
  pattern: RegExp
): void {
  const match = clause.text.match(pattern);
  if (!match || match.index === undefined) return;
  if (
    ref.role === "user" &&
    (stage === "remediation" || stage === "recovery") &&
    /^(?:[-*]\s*|\d+[.)]\s*)?(?:task\s*:\s*)?(?:add|apply|back\s+up|change|configure|create|deploy|enable|fix|inspect|install|migrate|move|patch|recreate|remove|repair|replace|restart|restore|run|set|update|verify)\b/.test(
      clause.text
    )
  ) {
    return;
  }
  if (
    stage === "recovery" &&
    /\b(?:not|never|unconfirmed|unverified|untested|failed|failing|coming_up|rather\s+than\s+healthy)\b/.test(
      clause.text
    )
  ) {
    return;
  }
  occurrences.push({ ...ref, anchors, stage, textOffset: clause.offset + match.index });
}

function incidentStageComesBefore(left: IncidentStageRef, right: IncidentStageRef): boolean {
  if (left.sessionId === right.sessionId && left.index === right.index) {
    return left.textOffset < right.textOffset || (
      left.textOffset === right.textOffset && incidentStageOrder(left.stage) < incidentStageOrder(right.stage)
    );
  }
  return signalComesBefore(left, right);
}

function compareIncidentStages(left: IncidentStageRef, right: IncidentStageRef): number {
  return (
    compareSignalRefs(left, right) ||
    left.textOffset - right.textOffset ||
    incidentStageOrder(left.stage) - incidentStageOrder(right.stage)
  );
}

function incidentStageOrder(stage: IncidentStage): number {
  if (stage === "impact") return 0;
  if (stage === "investigation") return 1;
  if (stage === "remediation") return 2;
  return 3;
}

function isStructuredIncidentStage(entry: IncidentStageRef): boolean {
  return entry.itemKind === "checkpoint" || entry.itemKind === "runtime_signal" || entry.itemKind === "tool_result";
}

function areIncidentStagesLinked(left: IncidentStageRef, right: IncidentStageRef): boolean {
  if (
    left.ref === right.ref ||
    (
      left.itemKind === "message" &&
      right.itemKind === "message" &&
      left.messageIndex !== undefined &&
      left.messageIndex === right.messageIndex
    )
  ) {
    return true;
  }
  if (left.sessionId !== right.sessionId) return false;
  const exactStructuredEpisode = areExactStructuredIncidentEpisode(left, right);
  if (!exactStructuredEpisode && !hasSharedIncidentAnchor(left, right)) return false;
  if (
    left.messageIndex !== undefined &&
    right.messageIndex !== undefined &&
    right.messageIndex >= left.messageIndex &&
    right.messageIndex - left.messageIndex <= 32
  ) {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    return (
      !Number.isFinite(leftTime) ||
      !Number.isFinite(rightTime) ||
      rightTime - leftTime <= 30 * 60 * 1_000
    );
  }
  if (
    left.stage === "impact" &&
    left.role === "user" &&
    left.messageIndex !== undefined &&
    right.messageIndex !== undefined &&
    right.messageIndex >= left.messageIndex &&
    right.messageIndex - left.messageIndex <= 100
  ) {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    return (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      rightTime - leftTime >= 0 &&
      rightTime - leftTime <= 2 * 60 * 60 * 1_000
    );
  }
  if (isStructuredIncidentStage(left) && isStructuredIncidentStage(right)) {
    return exactStructuredEpisode && right.index >= left.index && right.index - left.index <= 40;
  }
  return (
    (isStructuredIncidentStage(left) || isStructuredIncidentStage(right)) &&
    right.index >= left.index &&
    right.index - left.index <= 20
  );
}

const INCIDENT_ANCHOR_STOP_WORDS = new Set([
  "about",
  "actual",
  "after",
  "again",
  "all",
  "already",
  "also",
  "and",
  "another",
  "any",
  "are",
  "around",
  "back",
  "because",
  "been",
  "before",
  "being",
  "both",
  "but",
  "can",
  "cannot",
  "changed",
  "checking",
  "completed",
  "confirmed",
  "could",
  "current",
  "did",
  "does",
  "done",
  "each",
  "earlier",
  "error",
  "even",
  "every",
  "failed",
  "failure",
  "final",
  "first",
  "fixed",
  "for",
  "found",
  "from",
  "had",
  "has",
  "have",
  "healthy",
  "here",
  "how",
  "identified",
  "implemented",
  "into",
  "investigated",
  "issue",
  "its",
  "just",
  "keep",
  "later",
  "left",
  "live",
  "missing",
  "more",
  "most",
  "new",
  "next",
  "not",
  "now",
  "only",
  "other",
  "our",
  "passed",
  "patched",
  "plan",
  "previous",
  "recovered",
  "repaired",
  "replaced",
  "resolved",
  "restored",
  "right",
  "running",
  "same",
  "second",
  "separate",
  "should",
  "still",
  "stuck",
  "succeeded",
  "successful",
  "successfully",
  "task",
  "test",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "too",
  "true",
  "unavailable",
  "updated",
  "verified",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "without",
  "work",
  "working",
  "would",
  "you",
  "your",
]);

const INCIDENT_ANCHOR_FAMILIES: Array<[string, RegExp]> = [
  ["availability", /\b(?:offline|outage|unavailable|availability)\b/],
  [
    "authentication",
    /\b(?:auth|authenticate\w*|credentials?|log(?:ged|ging)?\s+in|login|oauth|tokens?|vault)\b/,
  ],
  ["display", /\b(?:blank|clipped|overflow\w*|unreadable)\b/],
  [
    "runtime",
    /\b(?:containers?|daemons?|gateways?|operators?|pools?|process(?:es)?|runtimes?|services?|workers?)\b/,
  ],
  [
    "ui",
    /\b(?:applications?|css|interfaces?|layouts?|modals?|navigation|pages?|screens?|sidebars?|stylesheets?|ui|views?)\b/,
  ],
];

function incidentAnchors(text: string): string[] {
  const normalized = text.toLowerCase();
  const anchors = new Set<string>();
  const signature = strongSignature(normalized);
  if (signature) anchors.add(`signature:${signature}`);
  for (const match of normalized.matchAll(
    /\b[a-z0-9]+(?:[._:/][a-z0-9_-]+)+\b/g,
  )) {
    anchors.add(`literal:${match[0]}`);
  }
  for (const match of normalized.matchAll(/\b[a-z][a-z0-9]{2,}\b/g)) {
    const token = normalizeIncidentAnchorToken(match[0]);
    if (!INCIDENT_ANCHOR_STOP_WORDS.has(token)) anchors.add(`term:${token}`);
  }
  for (const [family, pattern] of INCIDENT_ANCHOR_FAMILIES) {
    if (pattern.test(normalized)) anchors.add(`family:${family}`);
  }
  return [...anchors].sort();
}

function normalizeIncidentAnchorToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function hasSharedIncidentAnchor(
  left: IncidentStageRef,
  right: IncidentStageRef,
): boolean {
  const leftAnchors = new Set(left.anchors);
  let sharedFamilyCount = 0;
  for (const anchor of right.anchors) {
    if (!leftAnchors.has(anchor)) continue;
    if (!anchor.startsWith("family:")) return true;
    sharedFamilyCount += 1;
  }
  return sharedFamilyCount >= 2;
}

function areExactStructuredIncidentEpisode(
  left: IncidentStageRef,
  right: IncidentStageRef,
): boolean {
  if (!isStructuredIncidentStage(left) || !isStructuredIncidentStage(right))
    return false;
  const leftEpisode = structuredIncidentEpisodeKey(left.ref);
  return (
    leftEpisode !== undefined &&
    leftEpisode === structuredIncidentEpisodeKey(right.ref)
  );
}

function structuredIncidentEpisodeKey(ref: string): string | undefined {
  const parts = ref.split(":");
  if (
    parts.length < 3 ||
    !/^(?:detected|investigated|mitigated|recovered|resolved|restored|triage)$/.test(
      parts.at(-1)!,
    )
  ) {
    return undefined;
  }
  return parts.slice(1, -1).join(":") || undefined;
}

function areDecisionSignalsLinked(left: SignalRef, right: SignalRef): boolean {
  if (left.ref === right.ref) return true;
  if (left.sessionId !== right.sessionId) return false;
  if (
    left.messageIndex !== undefined &&
    right.messageIndex !== undefined &&
    Math.abs(left.messageIndex - right.messageIndex) <= 4
  ) {
    return true;
  }
  return Math.abs(left.index - right.index) <= 12;
}

function uniqueSignalRefs(entries: IncidentStageRef[]): IncidentStageRef[] {
  const refs = new Set<string>();
  return entries.filter((entry) => {
    if (refs.has(entry.ref)) return false;
    refs.add(entry.ref);
    return true;
  });
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
  knownCurrentCandidates: WorkbenchArtifactCandidate[] = []
): WorkbenchArtifactCandidate[] {
  return seeds
    .map((seed) => {
      const current = listCurrentWorkbenchArtifactCandidatesForSeed(db, seed)[0];
      const unchanged = current && candidateMatchesSeedRevision(current, seed) ? current : undefined;
      if (unchanged) return getStoredCandidate(db, unchanged.candidateId);
      const exact = findExactWorkbenchArtifactCandidate(db, seed);
      if (exact?.status === "dismissed" && candidateMatchesSeedRevision(exact, seed)) return exact;
      const knownPredecessor = knownCurrentCandidates
        .filter(
          (candidate) =>
            candidate.kind === seed.kind &&
            (candidateIdentityMatches(candidate, seed) ||
              candidate.provenanceSessionIds.some((sessionId) => seed.provenanceSessionIds.includes(sessionId)))
        )
        .sort(
          (left, right) =>
            Number(candidateIdentityMatches(right, seed)) - Number(candidateIdentityMatches(left, seed)) ||
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.candidateId.localeCompare(right.candidateId)
        )[0];
      const storedPredecessor = findBestWorkbenchArtifactCandidatePredecessor(db, seed);
      const predecessor = knownPredecessor ?? (
        storedPredecessor?.status === "dismissed" || storedPredecessor?.status === "superseded"
          ? storedPredecessor
          : undefined
      );
      return saveWorkbenchArtifactCandidate(db, {
        candidateId: candidateId(
          seed.kind,
          seed.seedSessionId,
          seed.evidenceRevision,
          seed.signatureKey,
          predecessor?.candidateId
        ),
        kind: seed.kind,
        origin: seed.origin ?? "automatic",
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
  if (kind === "runbook") return `A verified repeatable procedure or recovery recipe was found in ${provenance}.`;
  if (kind === "adr") return `A committed decision and material alternative were found in ${provenance}.`;
  return `An ordered impact, investigation, and remediation history was found in ${provenance}.`;
}

function normalizedItemText(item: SessionTranscriptItem): string {
  return `${item.label} ${item.text}`.toLowerCase();
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
