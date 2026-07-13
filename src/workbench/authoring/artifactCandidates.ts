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
       WHERE sessions.deleted_at IS NULL
         AND workbench_session_state.publication_status = 'publish_path'
         AND scans.session_id IS NULL
       ORDER BY sessions.session_id
       LIMIT ?`
    )
    .all(limit) as Array<{ sessionId: string }>;
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
      return hasWorkbenchArtifactCandidateScan(db, { sessionId: row.sessionId, sourceRevision })
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
  if (item.kind === "file_effect") return true;
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
  if (
    /\b(?:if|could|might|may|would|should)\b[^.\n]{0,80}\b(?:decision|decided|adopted)\b/.test(
      normalized
    ) ||
    /\b(?:no|not|never)\b[^.\n]{0,40}\b(?:decision|decided|adopted|approved|recorded)\b/.test(
      normalized
    ) ||
    /\b(?:proposed|hypothetical|possible)\s+decision\b/.test(normalized) ||
    /\b(?:rejected|declined)\b[^.\n]{0,30}\bdecision\b|\bdecision\b[^.\n]{0,30}\b(?:rejected|declined)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  return (
    /\bdecision\s*:/.test(normalized) ||
    /\bdecided\s+to\b/.test(normalized) ||
    /\bdecision\s+(?:was\s+)?(?:approved|recorded)\b/.test(normalized)
  );
}

function isRejectedAlternative(normalized: string): boolean {
  if (
    /\b(?:if|could|might|may|would|should)\b[^.\n]{0,100}\b(?:alternatives?|considered|rejected|instead\s+of)\b/.test(
      normalized
    ) ||
    /\b(?:no|not|never)\b[^.\n]{0,60}\b(?:alternatives?|considered|rejected)\b/.test(normalized) ||
    /\balternatives?\b[^.\n]{0,40}\b(?:not|never)\s+(?:considered|rejected)\b/.test(normalized)
  ) {
    return false;
  }
  return (
    /\brejected\s+alternatives?\b/.test(normalized) ||
    /\balternatives?\b.*\brejected\b/.test(normalized) ||
    /\bconsidered\b.*\balternatives?\b/.test(normalized) ||
    /\bconsidered\b.*\binstead\s+of\b/.test(normalized)
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
