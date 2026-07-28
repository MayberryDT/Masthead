import { createHash, randomUUID } from "node:crypto";
import { stableRecordId } from "../../daemon/identity.ts";
import {
  activeOrAvailableWorkbenchAuthoringV5Pack,
  activateWorkbenchAuthoringV5Pack,
  completeWorkbenchAuthoringV5PackRecord,
  getWorkbenchAuthoringV5EvidenceSnapshot,
  getSavedWorkbenchAuthoringV5Pack,
  getWorkbenchAuthoringV5PackReceipt,
  getWorkbenchAuthoringV5RequestReceipt,
  getWorkbenchAuthoringV5Request,
  completeWorkbenchAuthoringV5Preparation,
  getWorkbenchAuthoringV5Preparation,
  getWorkbenchAuthoringV5PreparationEvidenceProgress,
  insertWorkbenchAuthoringV5Preparation,
  insertWorkbenchAuthoringV5PreparationEvidencePage,
  insertPagedWorkbenchAuthoringV5EvidenceSnapshot,
  insertWorkbenchAuthoringV5Pack,
  insertWorkbenchAuthoringV5RequestSessions,
  insertWorkbenchAuthoringV5RequestShell,
  listIncompleteWorkbenchAuthoringV5RequestIds,
  listWorkbenchAuthoringV5EvidenceAccess,
  listWorkbenchAuthoringV5Packs,
  listWorkbenchAuthoringV5PreparedSessions,
  nextWorkbenchAuthoringV5PreparationOrdinal,
  recordWorkbenchAuthoringV5PreparedSession,
  recordWorkbenchAuthoringV5PreparationSelection,
  recordWorkbenchAuthoringV5EvidenceAccess,
  releaseFirstWorkbenchAuthoringV5Pack,
  retryWorkbenchAuthoringV5Preparation,
  requestBindingForWorkbenchAuthoringV5Pack,
  requireWorkbenchAuthoringV5Pack,
  requireWorkbenchAuthoringV5Request,
  saveWorkbenchAuthoringV5PackDraft
} from "../../daemon/db/workbenchAuthoringV5Repository.ts";
import { bumpDataRevisionInTransaction } from "../../daemon/db/dataRevisionRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import {
  getCompleteSessionTranscriptPage,
  iterateSessionTranscriptItems,
  type SessionTranscriptRowIdCutoffs
} from "../../daemon/db/sessionTranscriptRepository.ts";
import { recordWorkbenchActivity } from "../../daemon/db/workbenchPipelineRepository.ts";
import type { EvidenceRef } from "../../core/types.ts";
import type { DurableSessionEnrichment } from "../../shared/sessionEnrichment.ts";
import {
  WORKBENCH_AUTHORING_V5_VERSION,
  WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES,
  WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES,
  toWorkbenchAuthoringV5PreparationDto,
  toWorkbenchAuthoringV5AuthoredDraft,
  type WorkbenchAuthoringV5IncompleteRequestsDto,
  workbenchAuthoringV5PreparationWaitAction,
  type WorkbenchAuthoringV5AuthoredDraft,
  type WorkbenchAuthoringV5Draft,
  type WorkbenchAuthoringV5EvidenceCatalogItem,
  type WorkbenchAuthoringV5Fields,
  type WorkbenchAuthoringV5NextAction,
  type WorkbenchAuthoringV5OptionalConsideration,
  type WorkbenchAuthoringV5PackReceipt,
  type WorkbenchAuthoringV5RequestReceipt,
  type WorkbenchAuthoringV5SelectionDto,
  type WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import type { GuidedAuthoringExpectedIdentity } from "../../shared/instanceIdentity.ts";
import {
  assertGuidedAuthoringExpectedIdentity,
  assertStableGuidedRequestBinding
} from "../../shared/instanceIdentity.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import { workbenchAuthoringV5ReadinessReason } from "./guidedAuthoringPreflight.ts";
import * as workbenchAuthoringV5Quality from "./workbenchAuthoringV5Quality.ts";
import {
  applyGuidedSessionEnrichmentInTransaction,
  publishStagedGuidedArtifactsInTransaction,
  stageWorkbenchAuthoringV5CanonicalDossiersInTransaction,
  stageWorkbenchAuthoringV5OptionalArtifactsInTransaction
} from "./authoringService.ts";
import { validateWorkbenchOutput } from "../validation.ts";

const MINIMUM_PACK_SIZE = 5;
const MAXIMUM_PACK_SIZE = 12;

type MutationIdentity = {
  currentIdentity: GuidedAuthoringExpectedIdentity;
  expectedIdentity: GuidedAuthoringExpectedIdentity;
};

export class WorkbenchAuthoringV5NoEligibleSessionsError extends Error {
  constructor(readonly selection: WorkbenchAuthoringV5SelectionDto) {
    super("authoring_v5_no_eligible_sessions");
  }
}

export function createWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: MutationIdentity & {
    actorId: string;
    command: string;
    creationToken: string;
    reEnrich?: boolean;
    sessionIds: string[];
  }
) {
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
  assertRequestMembership(input.sessionIds);
  if (!input.creationToken.trim() || input.creationToken !== input.creationToken.trim()) {
    throw new Error("authoring_v5_creation_token_invalid");
  }
  return withImmediateTransaction(db, () => {
    const requestId = `authoring-v5-request:${randomUUID()}`;
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      actorId: input.actorId,
      identity: input.currentIdentity,
      sessionIds: input.sessionIds
    })).digest("hex");
    const readinessBySessionId = Object.fromEntries(input.sessionIds.map((sessionId) => [
      sessionId,
      workbenchAuthoringV5ReadinessReason(db, sessionId, { reEnrich: input.reEnrich }) ?? null
    ]));
    const preparation = insertWorkbenchAuthoringV5Preparation(db, {
      actorId: input.actorId,
      creationToken: input.creationToken,
      identity: {
        baseUrl: input.currentIdentity.baseUrl,
        buildSha: input.currentIdentity.buildSha,
        creationInstanceId: input.currentIdentity.instanceId,
        databaseId: input.currentIdentity.databaseId,
        instanceManifest: input.currentIdentity.instanceManifest
      },
      evidenceCutoffs: currentTranscriptRowIdCutoffs(db),
      readinessBySessionId,
      requestFingerprint,
      requestId,
      requestedSessionIds: input.sessionIds
    });
    return {
      handoff: {
        requestId: preparation.requestId,
        startCommand: `${input.command} workbench author bootstrap --request ${shellQuote(preparation.requestId)} --json`
      },
      nextAction: preparation.status === "ready"
        ? startAction(input.command, preparation.requestId)
        : workbenchAuthoringV5PreparationWaitAction(input.command, preparation.requestId),
      preparation: toWorkbenchAuthoringV5PreparationDto(preparation),
      ...(getWorkbenchAuthoringV5Request(db, preparation.requestId)
        ? { request: requireWorkbenchAuthoringV5Request(db, preparation.requestId) }
        : {}),
      ...(preparation.selection ? { selection: preparation.selection } : {})
    };
  });
}

export function prepareWorkbenchAuthoringV5RequestStep(
  db: MastheadDatabase,
  requestId: string
): { done: boolean } {
  const preparation = getWorkbenchAuthoringV5Preparation(db, requestId);
  if (!preparation || preparation.status !== "preparing") return { done: true };
  const ordinal = nextWorkbenchAuthoringV5PreparationOrdinal(db, requestId);
  if (ordinal === undefined) {
    return { done: finalizeWorkbenchAuthoringV5Preparation(db, requestId) };
  }
  withImmediateTransaction(db, () => {
    const batchEnd = Math.min(ordinal + 10, preparation.requestedSessionCount);
    for (let currentOrdinal = ordinal; currentOrdinal < batchEnd; currentOrdinal += 1) {
      const sessionId = preparation.requestedSessionIds[currentOrdinal]!;
      const frozenReadinessReason = preparation.readinessBySessionId[sessionId];
      if (frozenReadinessReason) {
        recordWorkbenchAuthoringV5PreparedSession(db, {
          exclusionReason: frozenReadinessReason,
          ordinal: currentOrdinal,
          outcome: "excluded",
          requestId,
          sessionId
        });
        recordPreparationExclusionActivity(db, preparation.actorId, requestId, sessionId, frozenReadinessReason);
        continue;
      }
      const progress = getWorkbenchAuthoringV5PreparationEvidenceProgress(db, requestId, sessionId);
      const page = getCompleteSessionTranscriptPage(db, {
        cursor: String(progress.nextOffset),
        limit: 25,
        order: "asc",
        rowIdCutoffs: preparation.evidenceCutoffs,
        sessionId
      });
      const pageJson = JSON.stringify(page.items);
      insertWorkbenchAuthoringV5PreparationEvidencePage(db, {
        itemOffset: progress.nextOffset,
        items: page.items,
        pageDigest: createHash("sha256").update(pageJson).digest("hex"),
        pageOrdinal: progress.nextPageOrdinal,
        requestId,
        sessionId,
        usableEvidence: evidenceCatalog.hasUsableAuthoringEvidenceItems(page.items)
      });
      if (page.nextCursor !== undefined) break;
      const completeProgress = getWorkbenchAuthoringV5PreparationEvidenceProgress(db, requestId, sessionId);
      if (!completeProgress.usableEvidence) {
        recordWorkbenchAuthoringV5PreparedSession(db, {
          exclusionReason: "missing_canonical_evidence",
          ordinal: currentOrdinal,
          outcome: "excluded",
          requestId,
          sessionId
        });
        recordPreparationExclusionActivity(db, preparation.actorId, requestId, sessionId, "missing_canonical_evidence");
        continue;
      }
      const sessionDigest = `sha256:${createHash("sha256")
        .update(`${JSON.stringify({ sessionId })}\n`)
        .update(completeProgress.pageDigests.join("\n"))
        .digest("hex")}` as const;
      insertPagedWorkbenchAuthoringV5EvidenceSnapshot(db, {
        requestId,
        sessionDigest,
        sessionId
      });
      recordWorkbenchAuthoringV5PreparedSession(db, {
        ordinal: currentOrdinal,
        outcome: "eligible",
        requestId,
        sessionDigest,
        sessionId
      });
      recordWorkbenchActivity(db, {
        actor: { id: preparation.actorId, kind: "agent" },
        details: { requestId },
        eventType: "authoring_request_created",
        relatedRunId: requestId,
        sessionId,
        summary: "V5 authoring request created"
      });
    }
  });
  return { done: false };
}

function finalizeWorkbenchAuthoringV5Preparation(db: MastheadDatabase, requestId: string): boolean {
  const result = withImmediateTransaction(db, (): boolean | { error: WorkbenchAuthoringV5NoEligibleSessionsError } => {
    const preparation = getWorkbenchAuthoringV5Preparation(db, requestId);
    if (!preparation || preparation.status !== "preparing") return true;
    const prepared = listWorkbenchAuthoringV5PreparedSessions(db, requestId);
    if (prepared.length !== preparation.requestedSessionCount) throw new Error("authoring_v5_preparation_incomplete");
    const eligible = prepared.filter((row) => row.outcome === "eligible");
    const excluded = prepared.filter((row) => row.outcome === "excluded");
    const selection: WorkbenchAuthoringV5SelectionDto = {
      eligibleSessionCount: eligible.length,
      excludedSessionCount: excluded.length,
      excludedSessions: excluded.map((row) => ({
        reason: row.exclusionReason!,
        sessionId: row.sessionId
      })),
      requestedSessionCount: prepared.length
    };
    recordWorkbenchAuthoringV5PreparationSelection(db, requestId, selection);
    if (eligible.length === 0) return { error: new WorkbenchAuthoringV5NoEligibleSessionsError(selection) };
    const packSessionIds = fixedPacks(eligible.map(({ sessionId }) => sessionId));
    const digestBySessionId = new Map(eligible.map((row) => [row.sessionId, row.sessionDigest!]));
    const requestInput = {
      actorId: preparation.actorId,
      identity: preparation.identity,
      packs: packSessionIds.map((sessionIds, ordinal) => ({
        evidenceRevision: evidenceCatalog.guidedAuthoringEvidenceRevisionFromInputs(
          sessionIds.map((sessionId) => ({ sessionDigest: digestBySessionId.get(sessionId) as `sha256:${string}`, sessionId }))
        ),
        ordinal,
        packId: stableRecordId("authoring-v5-pack", [requestId, String(ordinal)]),
        sessionIds
      })),
      requestId,
      sessions: eligible.map(({ sessionId }, ordinal) => ({ ordinal, sessionId }))
    };
    if (!getWorkbenchAuthoringV5Request(db, requestId)) {
      insertWorkbenchAuthoringV5RequestShell(db, requestInput);
      return false;
    }
    const storedSessionCount = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_authoring_v5_request_sessions WHERE request_id = ?"
    ).get(requestId) as { count: number }).count);
    if (storedSessionCount < requestInput.sessions.length) {
      insertWorkbenchAuthoringV5RequestSessions(
        db,
        requestId,
        requestInput.sessions.slice(storedSessionCount, storedSessionCount + 50)
      );
      return false;
    }
    const storedPackCount = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_authoring_v5_packs WHERE request_id = ?"
    ).get(requestId) as { count: number }).count);
    if (storedPackCount < requestInput.packs.length) {
      insertWorkbenchAuthoringV5Pack(db, requestId, requestInput.packs[storedPackCount]!, false);
      return false;
    }
    releaseFirstWorkbenchAuthoringV5Pack(db, requestId);
    completeWorkbenchAuthoringV5Preparation(db, requestId, selection);
    bumpDataRevisionInTransaction(db, "workbench");
    return true;
  });
  if (typeof result === "boolean") return result;
  throw result.error;
}

export function bootstrapWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: { command: string; requestId: string }
) {
  const status = getWorkbenchAuthoringV5RequestStatus(db, input);
  const request = status.request;
  return {
    contractVersion: WORKBENCH_AUTHORING_V5_VERSION,
    instanceIdentity: {
      baseUrl: request.baseUrl,
      buildSha: request.buildSha,
      databaseId: request.databaseId,
      instanceId: request.creationInstanceId,
      instanceManifest: request.instanceManifest
    },
    skillContract: {
      owner: "agent" as const,
      objective: "Author specific, evidence-grounded session knowledge for every session in the request.",
      scaffoldWritesProse: false as const,
      authoredFields: ["title", "description", "keywords", "purpose", "outcome", "keyWork", "decisions", "verification"],
      synthesisRule: "Synthesize each dossier from the substantive user ask and retained outcome. Do not treat environment, AGENTS/skill, monitor, protocol, path, timestamp, timezone, or tool rows as the primary ask, and do not extract first-message text, paths, timestamps, or tool tokens deterministically.",
      loop: ["start", "inspect", "scaffold", "save", "finish"],
      obligation: "Continue until the immutable request-complete receipt is returned. Resume is only crash recovery."
    },
    packPolicy: {
      minimumSessions: MINIMUM_PACK_SIZE,
      maximumSessions: MAXIMUM_PACK_SIZE,
      fixedAtRequestCreation: true,
      opportunityJoinRequired: false,
      fullSelectionRequired: true
    },
    optionalPolicy: {
      minimumConsiderationsPerPack: 1 as const,
      maximumConsiderationsPerPack: 3 as const,
      decisions: ["yes", "no"] as const,
      reason: "One grounded line per considered kind; evidenceRef is optional.",
      artifactDraft: "allowed_only_when_yes" as const,
      blocksDossierPublication: false as const
    },
    rejectRules: {
      behavior: "flag_and_continue" as const,
      hardReject: WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES,
      softFlag: WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES,
      requestFreezeOnReject: false
    },
    request,
    ...(status.selection ? { selection: status.selection } : {}),
    ...(status.receipt ? { receipt: status.receipt } : {}),
    nextAction: status.nextAction
  };
}

export function startWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  input: MutationIdentity & { command: string; requestId: string }
) {
  const preparation = getWorkbenchAuthoringV5Preparation(db, input.requestId);
  if (preparation?.status !== "ready") throw new Error(`authoring_v5_request_${preparation?.status ?? "not_found"}`);
  const request = requireWorkbenchAuthoringV5Request(db, input.requestId);
  assertRequestIdentity(request, input);
  if (request.status === "completed") {
    return {
      receipt: getWorkbenchAuthoringV5RequestReceipt(db, request.requestId),
      nextAction: completeAction(),
      request
    };
  }
  return withImmediateTransaction(db, () => {
    const candidate = activeOrAvailableWorkbenchAuthoringV5Pack(db, request.requestId);
    if (!candidate) throw new Error("authoring_v5_no_pack_available");
    const newlyClaimed = candidate.status === "available";
    const pack = activateWorkbenchAuthoringV5Pack(db, candidate.packId);
    if (newlyClaimed) {
      for (const sessionId of pack.sessionIds) {
        recordWorkbenchActivity(db, {
          actor: { id: request.actorId, kind: "agent" },
          details: { packId: pack.packId, requestId: request.requestId },
          eventType: "authoring_pack_claimed",
          relatedRunId: request.requestId,
          sessionId,
          summary: "V5 authoring pack claimed"
        });
      }
    }
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      pack,
      request: requireWorkbenchAuthoringV5Request(db, request.requestId),
      nextAction: packNextAction(db, input.command, pack.packId)
    };
  });
}

export function retryFailedWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  input: MutationIdentity & { requestId: string }
) {
  const preparation = getWorkbenchAuthoringV5Preparation(db, input.requestId);
  if (!preparation) throw new Error("authoring_v5_request_not_found");
  assertRequestIdentity({
    baseUrl: preparation.identity.baseUrl,
    buildSha: preparation.identity.buildSha,
    creationInstanceId: preparation.identity.creationInstanceId,
    databaseId: preparation.identity.databaseId,
    instanceManifest: preparation.identity.instanceManifest
  }, input);
  if (preparation.status !== "failed") throw new Error("authoring_v5_request_not_failed");
  if (preparation.errorCode === "authoring_v5_no_eligible_sessions") {
    throw new Error("authoring_v5_no_eligible_sessions");
  }
  return withImmediateTransaction(db, () => {
    retryWorkbenchAuthoringV5Preparation(db, input.requestId);
    return toWorkbenchAuthoringV5PreparationDto(getWorkbenchAuthoringV5Preparation(db, input.requestId)!);
  });
}

export function inspectWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  input: MutationIdentity & {
    command: string;
    packId: string;
    sessionId?: string;
    cursor?: string;
    limit?: number;
  }
) {
  assertPackIdentity(db, input.packId, input);
  return withImmediateTransaction(db, () => {
    const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
    if (pack.status !== "active") throw new Error("authoring_v5_pack_not_inspectable");
    assertFrozenOrCurrentEvidenceAvailable(db, pack);
    const before = coverage(db, pack.packId);
    const sessionId = input.sessionId ?? before.find(({ complete }) => !complete)?.sessionId ?? pack.sessionIds[0]!;
    if (!pack.sessionIds.includes(sessionId)) throw new Error("authoring_v5_session_not_in_pack");
    const canonical = evidenceForPackSession(db, pack, sessionId);
    const accessed = new Set(
      listWorkbenchAuthoringV5EvidenceAccess(db, pack.packId, pack.evidenceRevision)
        .filter((row) => row.sessionId === sessionId)
        .map(({ evidenceRef }) => evidenceRef)
    );
    const offset = input.cursor === undefined ? firstUnreadOffset(canonical, accessed) : parseCursor(input.cursor, canonical.length);
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error("authoring_v5_inspect_limit_invalid");
    const items = canonical.slice(offset, offset + limit);
    recordWorkbenchAuthoringV5EvidenceAccess(db, {
      evidenceRefs: items.map(({ itemId }) => itemId),
      evidenceRevision: pack.evidenceRevision,
      packId: pack.packId,
      requestId: pack.requestId,
      sessionId
    });
    bumpDataRevisionInTransaction(db, "workbench");
    const after = coverage(db, pack.packId);
    return {
      packId: pack.packId,
      evidenceRevision: pack.evidenceRevision,
      sessionId,
      evidence: {
        items,
        total: canonical.length,
        ...(offset + items.length < canonical.length ? { nextCursor: String(offset + items.length) } : {})
      },
      coverage: after,
      progressRecorded: items.length > 0,
      nextAction: after.every(({ complete }) => complete)
        ? scaffoldAction(input.command, pack.packId)
        : inspectAction(input.command, pack.packId)
    };
  });
}

export function buildWorkbenchAuthoringV5Scaffold(
  db: MastheadDatabase,
  input: { command: string; packId: string }
) {
  const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
  if (pack.status !== "active") throw new Error("authoring_v5_pack_not_scaffoldable");
  assertFrozenOrCurrentEvidenceAvailable(db, pack);
  if (coverage(db, pack.packId).some(({ complete }) => !complete)) throw new Error("authoring_v5_evidence_incomplete");
  const draft: WorkbenchAuthoringV5Draft = {
    bundleVersion: WORKBENCH_AUTHORING_V5_VERSION,
    evidenceRevision: pack.evidenceRevision,
    optionalArtifacts: [],
    optionalConsiderations: [],
    packId: pack.packId,
    sessions: pack.sessionIds.map((sessionId) => ({
      evidenceCatalog: evidenceForPackSession(db, pack, sessionId).map(catalogItem),
      fields: blankFields(),
      sessionId
    }))
  };
  return { draft, nextAction: saveAction(input.command, pack.packId), packId: pack.packId };
}

export function saveWorkbenchAuthoringV5Draft(
  db: MastheadDatabase,
  input: MutationIdentity & {
    command: string;
    draft: WorkbenchAuthoringV5AuthoredDraft;
    packId: string;
  }
) {
  assertPackIdentity(db, input.packId, input);
  return withImmediateTransaction(db, () => {
    const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
    if (pack.status !== "active" && pack.status !== "saved") throw new Error("authoring_v5_pack_not_saveable");
    assertFrozenOrCurrentEvidenceAvailable(db, pack);
    const draft = parseWorkbenchAuthoringV5Draft(db, input.draft, pack);
    const outcomes = draft.sessions.map((session) => classifySessionDraft(
      session,
      evidenceForPackSession(db, pack, session.sessionId)
    ));
    const saved = saveWorkbenchAuthoringV5PackDraft(db, {
      draft: toWorkbenchAuthoringV5AuthoredDraft(draft),
      outcomes,
      packId: pack.packId
    });
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      draftRevision: saved.currentDraftRevision,
      outcomes,
      packId: saved.packId,
      requestStatus: requireWorkbenchAuthoringV5Request(db, saved.requestId).status,
      nextAction: finishAction(input.command, saved.packId)
    };
  });
}

export function finishWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  input: MutationIdentity & { command: string; packId: string }
) {
  assertPackIdentity(db, input.packId, input);
  const existingReceipt = getWorkbenchAuthoringV5PackReceipt(db, input.packId);
  if (existingReceipt) return finishResult(db, input.command, existingReceipt);
  return withImmediateTransaction(db, () => {
    const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
    if (pack.status !== "saved") throw new Error("authoring_v5_pack_not_ready");
    assertFrozenOrCurrentEvidenceAvailable(db, pack);
    const saved = getSavedWorkbenchAuthoringV5Pack(db, pack.packId);
    if (!saved) throw new Error("authoring_v5_saved_draft_missing");
    const draft = parseWorkbenchAuthoringV5Draft(db, saved.draft, pack);
    const request = requireWorkbenchAuthoringV5Request(db, pack.requestId);
    const publishable = draft.sessions.filter(({ sessionId }) => (
      saved.outcomes.find((outcome) => outcome.sessionId === sessionId)?.disposition !== "hard_reject"
    ));
    for (const session of publishable) {
      applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: request.actorId,
        enrichment: durableEnrichment(db, session.sessionId, session.fields, session.evidenceCatalog),
        sessionId: session.sessionId
      });
    }
    const dossierArtifacts = stageWorkbenchAuthoringV5CanonicalDossiersInTransaction(db, {
      actorId: request.actorId,
      evidenceRevision: pack.evidenceRevision,
      sessionIds: publishable.map(({ sessionId }) => sessionId)
    });
    const optionalArtifacts = stageWorkbenchAuthoringV5OptionalArtifactsInTransaction(db, {
      actorId: request.actorId,
      artifacts: draft.optionalArtifacts,
      sessionIds: pack.sessionIds
    });
    const published = publishStagedGuidedArtifactsInTransaction(db, { dossierArtifacts, optionalArtifacts });
    const completedAt = new Date().toISOString();
    const packReceipt: WorkbenchAuthoringV5PackReceipt = {
      completedAt,
      counts: {
        attempted: saved.outcomes.length,
        consideredNo: draft.optionalConsiderations.filter(({ decision }) => decision === "no").length,
        optionalPublished: optionalArtifacts.length,
        published: publishable.length,
        rejected: saved.outcomes.filter(({ disposition }) => disposition === "hard_reject").length,
        softFlagged: saved.outcomes.filter(({ disposition }) => disposition === "soft_flag").length
      },
      draftRevision: pack.currentDraftRevision,
      evidenceRevision: pack.evidenceRevision,
      optionalArtifacts: published.publishedArtifacts.filter(({ kind }) => kind !== "session_dossier") as WorkbenchAuthoringV5PackReceipt["optionalArtifacts"],
      optionalConsiderations: draft.optionalConsiderations,
      outcomes: saved.outcomes,
      packId: pack.packId,
      publishedArtifacts: published.publishedArtifacts.filter(({ kind }) => kind === "session_dossier") as WorkbenchAuthoringV5PackReceipt["publishedArtifacts"],
      receiptVersion: "workbench-authoring-v5-pack-receipt-v1",
      requestId: pack.requestId
    };
    const completedReceipts = listWorkbenchAuthoringV5Packs(db, pack.requestId)
      .map(({ packId }) => getWorkbenchAuthoringV5PackReceipt(db, packId))
      .filter((receipt): receipt is WorkbenchAuthoringV5PackReceipt => Boolean(receipt));
    const hasLaterPack = listWorkbenchAuthoringV5Packs(db, pack.requestId)
      .some(({ ordinal, status }) => ordinal > pack.ordinal && status === "pending");
    const requestReceipt = hasLaterPack ? undefined : requestReceiptFrom([...completedReceipts, packReceipt], completedAt, pack.requestId);
    recordFinishActivity(db, request.actorId, packReceipt, draft, Boolean(requestReceipt));
    completeWorkbenchAuthoringV5PackRecord(db, { packReceipt, ...(requestReceipt ? { requestReceipt } : {}) });
    bumpDataRevisionInTransaction(db, "logbook");
    bumpDataRevisionInTransaction(db, "workbench");
    return finishResult(db, input.command, packReceipt);
  });
}

export function getWorkbenchAuthoringV5RequestStatus(
  db: MastheadDatabase,
  input: { command: string; requestId: string }
) {
  const request = requireWorkbenchAuthoringV5Request(db, input.requestId);
  const receipt = getWorkbenchAuthoringV5RequestReceipt(db, request.requestId);
  const preparation = getWorkbenchAuthoringV5Preparation(db, request.requestId);
  return {
    request,
    ...(preparation?.selection ? { selection: preparation.selection } : {}),
    ...(receipt ? { receipt } : {}),
    nextAction: request.status === "completed" ? completeAction() : requestNextAction(db, input.command, request.requestId)
  };
}

/** Most recent open/active V5 request for Workbench incomplete-resume banner. */
export function getIncompleteWorkbenchAuthoringV5RequestSummary(
  db: MastheadDatabase,
  input: { command: string }
): WorkbenchAuthoringV5IncompleteRequestsDto {
  const requestId = listIncompleteWorkbenchAuthoringV5RequestIds(db)[0];
  if (!requestId) return {};
  const request = getWorkbenchAuthoringV5Request(db, requestId);
  if (!request || (request.status !== "open" && request.status !== "active")) return {};
  const packsCompleted = listWorkbenchAuthoringV5Packs(db, requestId)
    .filter(({ status }) => status === "completed")
    .length;
  return {
    request: {
      requestId: request.requestId,
      status: request.status,
      packsCompleted,
      packCount: request.packCount,
      sessionsCompleted: request.attemptedSessionCount,
      sessionCount: request.sessionCount,
      handoff: {
        requestId: request.requestId,
        startCommand: `${input.command} workbench author bootstrap --request ${shellQuote(request.requestId)} --json`
      },
      updatedAt: request.updatedAt
    }
  };
}

export function getWorkbenchAuthoringV5RequestReceiptStatus(db: MastheadDatabase, requestId: string) {
  const request = requireWorkbenchAuthoringV5Request(db, requestId);
  return { requestId, status: request.status, receipt: getWorkbenchAuthoringV5RequestReceipt(db, requestId) };
}

function fixedPacks(sessionIds: string[]): string[][] {
  const packCount = Math.ceil(sessionIds.length / MAXIMUM_PACK_SIZE);
  const baseSize = Math.floor(sessionIds.length / packCount);
  const remainder = sessionIds.length % packCount;
  const packs: string[][] = [];
  let offset = 0;
  for (let ordinal = 0; ordinal < packCount; ordinal += 1) {
    const size = baseSize + (ordinal < remainder ? 1 : 0);
    packs.push(sessionIds.slice(offset, offset + size));
    offset += size;
  }
  if (packs.some((pack) => (
    pack.length > MAXIMUM_PACK_SIZE || (sessionIds.length > MAXIMUM_PACK_SIZE && pack.length < MINIMUM_PACK_SIZE)
  ))) {
    throw new Error("authoring_v5_pack_size_invalid");
  }
  return packs;
}

function assertRequestMembership(sessionIds: string[]): void {
  if (sessionIds.length === 0) throw new Error("authoring_v5_selection_empty");
  if (sessionIds.some((sessionId) => !sessionId.trim() || sessionId !== sessionId.trim())) {
    throw new Error("authoring_session_id_blank");
  }
  if (new Set(sessionIds).size !== sessionIds.length) throw new Error("authoring_session_id_duplicate");
}

function currentTranscriptRowIdCutoffs(db: MastheadDatabase): SessionTranscriptRowIdCutoffs {
  const maximumRowId = (table: string): number => Number((
    db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS rowId FROM ${table}`).get() as { rowId: number }
  ).rowId);
  return {
    checkpoints: maximumRowId("checkpoints"),
    fileEffects: maximumRowId("file_effects"),
    messages: maximumRowId("messages"),
    runtimeSignals: maximumRowId("runtime_signals"),
    toolCalls: maximumRowId("tool_calls"),
    toolResults: maximumRowId("tool_results")
  };
}

function recordPreparationExclusionActivity(
  db: MastheadDatabase,
  actorId: string,
  requestId: string,
  sessionId: string,
  reason: WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"]
): void {
  const exists = db.prepare("SELECT 1 AS present FROM sessions WHERE session_id = ?").get(sessionId);
  if (!exists) return;
  recordWorkbenchActivity(db, {
    actor: { id: actorId, kind: "agent" },
    details: { reason, requestId },
    eventType: "authoring_request_session_excluded",
    relatedRunId: requestId,
    sessionId,
    summary: "Session excluded from V5 authoring request"
  });
}

function assertRequestIdentity(request: {
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  creationInstanceId: string;
}, input: MutationIdentity): void {
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
  assertStableGuidedRequestBinding(request, input.currentIdentity);
}

function assertPackIdentity(db: MastheadDatabase, packId: string, input: MutationIdentity): void {
  const request = requestBindingForWorkbenchAuthoringV5Pack(db, packId);
  if (!request) throw new Error("authoring_v5_pack_not_found");
  assertRequestIdentity(request, input);
}

function assertCurrentEvidenceRevision(db: MastheadDatabase, pack: ReturnType<typeof requireWorkbenchAuthoringV5Pack>): void {
  if (evidenceCatalog.guidedAuthoringEvidenceRevision(db, pack.sessionIds) !== pack.evidenceRevision) {
    throw new Error("evidence_revision_changed");
  }
}

function assertFrozenOrCurrentEvidenceAvailable(
  db: MastheadDatabase,
  pack: ReturnType<typeof requireWorkbenchAuthoringV5Pack>
): void {
  const hasCompleteSnapshot = pack.sessionIds.every((sessionId) => (
    Boolean(getWorkbenchAuthoringV5EvidenceSnapshot(db, pack.requestId, sessionId))
  ));
  if (!hasCompleteSnapshot) assertCurrentEvidenceRevision(db, pack);
}

function evidenceForPackSession(
  db: MastheadDatabase,
  pack: ReturnType<typeof requireWorkbenchAuthoringV5Pack>,
  sessionId: string
) {
  const snapshot = getWorkbenchAuthoringV5EvidenceSnapshot(db, pack.requestId, sessionId);
  return snapshot?.evidence ?? [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })];
}

function coverage(db: MastheadDatabase, packId: string) {
  const pack = requireWorkbenchAuthoringV5Pack(db, packId);
  const accessed = listWorkbenchAuthoringV5EvidenceAccess(db, packId, pack.evidenceRevision);
  return pack.sessionIds.map((sessionId) => {
    const totalItems = evidenceForPackSession(db, pack, sessionId).length;
    const accessedItems = new Set(accessed.filter((row) => row.sessionId === sessionId).map(({ evidenceRef }) => evidenceRef)).size;
    return { sessionId, accessedItems, totalItems, complete: accessedItems >= totalItems };
  });
}

function catalogItem(item: ReturnType<typeof iterateSessionTranscriptItems> extends Generator<infer T> ? T : never): WorkbenchAuthoringV5EvidenceCatalogItem {
  return { id: item.itemId, itemId: item.itemId, kind: item.kind, observedAt: item.observedAt, role: item.role, text: item.text, source: "canonical" };
}

function blankFields(): WorkbenchAuthoringV5Fields {
  return {
    decisions: [],
    description: "",
    evidenceRefs: { description: [], keyWork: [], outcome: [], purpose: [], title: [], verification: [] },
    keyWork: [],
    keywords: [],
    outcome: "",
    purpose: "",
    title: "",
    verification: { status: "unknown", summary: "" }
  };
}

function parseWorkbenchAuthoringV5Draft(
  db: MastheadDatabase,
  value: WorkbenchAuthoringV5AuthoredDraft,
  pack: ReturnType<typeof requireWorkbenchAuthoringV5Pack>
): WorkbenchAuthoringV5Draft {
  if (!value || value.bundleVersion !== WORKBENCH_AUTHORING_V5_VERSION || value.packId !== pack.packId ||
      value.evidenceRevision !== pack.evidenceRevision || !Array.isArray(value.sessions) ||
      !Array.isArray(value.optionalConsiderations) || !Array.isArray(value.optionalArtifacts)) {
    throw new Error("invalid_workbench_authoring_v5_bundle");
  }
  if (value.sessions.length !== pack.sessionIds.length ||
      value.sessions.some((session, index) => session.sessionId !== pack.sessionIds[index] || !session.fields)) {
    throw new Error("invalid_workbench_authoring_v5_membership");
  }
  const sessions: WorkbenchAuthoringV5Draft["sessions"] = value.sessions.map((session) => ({
    evidenceCatalog: evidenceForPackSession(db, pack, session.sessionId).map(catalogItem),
    fields: session.fields,
    sessionId: session.sessionId
  }));
  for (const session of sessions) {
    const fields = session.fields;
    const refs = fields.evidenceRefs;
    if (
      typeof fields.title !== "string" || typeof fields.description !== "string" ||
      typeof fields.purpose !== "string" || typeof fields.outcome !== "string" ||
      !isStringArray(fields.keywords) || !isStringArray(fields.keyWork) || !isStringArray(fields.decisions) ||
      !refs || !isStringArray(refs.title) || !isStringArray(refs.description) ||
      !isStringArray(refs.purpose) || !isStringArray(refs.outcome) ||
      !isStringArray(refs.keyWork) || !isStringArray(refs.verification) ||
      !fields.verification ||
      !["passed", "failed", "mixed", "missing", "unknown"].includes(fields.verification.status) ||
      typeof fields.verification.summary !== "string"
    ) {
      throw new Error("invalid_workbench_authoring_v5_fields");
    }
  }
  if (value.optionalConsiderations.length < 1 || value.optionalConsiderations.length > 3) {
    throw new Error("invalid_workbench_authoring_v5_optional_consideration");
  }
  if (value.optionalConsiderations.some((consideration) => !isOptionalConsideration(consideration))) {
    throw new Error("invalid_workbench_authoring_v5_optional_consideration");
  }
  const considerationByKind = new Map(value.optionalConsiderations.map((consideration) => [consideration.kind, consideration]));
  if (considerationByKind.size !== value.optionalConsiderations.length) {
    throw new Error("invalid_workbench_authoring_v5_optional_consideration");
  }
  const canonicalIds = new Set(sessions.flatMap(({ evidenceCatalog }) => evidenceCatalog.map(({ id }) => id)));
  if (value.optionalConsiderations.some(({ evidenceRef }) => evidenceRef && !canonicalIds.has(evidenceRef))) {
    throw new Error("invalid_workbench_authoring_v5_optional_evidence_ref");
  }
  if (value.optionalArtifacts.some((artifact) => (
    !isOptionalArtifactDraft(artifact, considerationByKind.get(artifact.kind), pack.sessionIds, sessions)
  ))) {
    throw new Error("invalid_workbench_authoring_v5_optional_artifact");
  }
  const draftIds = value.optionalArtifacts.map(({ draftId }) => draftId);
  if (new Set(draftIds).size !== draftIds.length) {
    throw new Error("invalid_workbench_authoring_v5_optional_artifact");
  }
  return structuredClone({ ...value, sessions });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalConsideration(value: unknown): value is WorkbenchAuthoringV5OptionalConsideration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const consideration = value as Record<string, unknown>;
  const reason = typeof consideration.reason === "string" ? consideration.reason.trim() : "";
  return (
    ["runbook", "adr", "incident_timeline"].includes(String(consideration.kind)) &&
    (consideration.decision === "yes" || consideration.decision === "no") &&
    reason.length >= 20 && reason.length <= 240 && !/[\r\n]/.test(reason) &&
    (consideration.evidenceRef === undefined || (
      typeof consideration.evidenceRef === "string" && Boolean(consideration.evidenceRef.trim())
    ))
  );
}

function isOptionalArtifactDraft(
  value: unknown,
  consideration: WorkbenchAuthoringV5OptionalConsideration | undefined,
  packSessionIds: string[],
  sessions: WorkbenchAuthoringV5Draft["sessions"]
): value is WorkbenchAuthoringV5Draft["optionalArtifacts"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value) || consideration?.decision !== "yes") return false;
  const artifact = value as Record<string, unknown>;
  const provenanceSessionIds = isStringArray(artifact.provenanceSessionIds) ? artifact.provenanceSessionIds : undefined;
  if (
    typeof artifact.draftId !== "string" || !artifact.draftId.trim() ||
    artifact.kind !== consideration.kind ||
    typeof artifact.seedSessionId !== "string" ||
    !packSessionIds.includes(artifact.seedSessionId) ||
    !provenanceSessionIds || provenanceSessionIds.length === 0 ||
    new Set(provenanceSessionIds).size !== provenanceSessionIds.length ||
    !provenanceSessionIds.includes(artifact.seedSessionId) ||
    provenanceSessionIds.some((sessionId) => !packSessionIds.includes(sessionId)) ||
    !artifact.output || typeof artifact.output !== "object" || Array.isArray(artifact.output)
  ) return false;
  const output = artifact.output as Record<string, unknown>;
  if (!validateWorkbenchOutput(artifact.kind as "runbook" | "adr" | "incident_timeline", output).ok) return false;
  if (!sameStrings(output.provenanceSessionIds, provenanceSessionIds)) return false;
  const refs = isStringArray(output.evidenceRefs) ? output.evidenceRefs : [];
  const evidenceOwners = new Map(sessions.flatMap(({ evidenceCatalog, sessionId }) => (
    evidenceCatalog.map(({ id }) => [id, sessionId] as const)
  )));
  return refs.length > 0 && refs.every((ref) => {
    const owner = evidenceOwners.get(ref);
    return owner !== undefined && provenanceSessionIds.includes(owner);
  });
}

function sameStrings(value: unknown, expected: string[]): boolean {
  return isStringArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

// Kept separate so S4 can replace classification without changing save/finish state transitions.
function classifySessionDraft(
  session: WorkbenchAuthoringV5Draft["sessions"][number],
  canonicalEvidence: ReturnType<typeof evidenceForPackSession>
): WorkbenchAuthoringV5SessionOutcome {
  const canonicalEvidenceIds = new Set(canonicalEvidence.map(({ itemId }) => itemId));
  const catalogIds = new Set(session.evidenceCatalog.map(({ id }) => id));
  const referencedIds = Object.values(session.fields.evidenceRefs).flat();
  const unknown = [...new Set(referencedIds.filter((id) => !canonicalEvidenceIds.has(id) || !catalogIds.has(id)))];
  if (unknown.length > 0) {
    return {
      disposition: "hard_reject",
      findings: unknown.map((id) => ({
        code: "unknown_canonical_evidence_ref",
        message: `Evidence reference is not canonical for this session: ${id}`
      })),
      sessionId: session.sessionId
    };
  }
  return workbenchAuthoringV5Quality.classifyWorkbenchAuthoringV5Session(session);
}

function recordFinishActivity(
  db: MastheadDatabase,
  actorId: string,
  receipt: WorkbenchAuthoringV5PackReceipt,
  draft: WorkbenchAuthoringV5Draft,
  requestCompleted: boolean
): void {
  const actor = { id: actorId, kind: "agent" } as const;
  for (const outcome of receipt.outcomes) {
    const details = { findings: outcome.findings, packId: receipt.packId, requestId: receipt.requestId };
    if (outcome.disposition !== "hard_reject") {
      recordWorkbenchActivity(db, {
        actor,
        details,
        eventType: "authoring_session_published",
        relatedRunId: receipt.requestId,
        sessionId: outcome.sessionId,
        summary: "V5 session dossier published"
      });
    }
    if (outcome.disposition === "soft_flag") {
      recordWorkbenchActivity(db, {
        actor,
        details,
        eventType: "authoring_session_soft_flagged",
        relatedRunId: receipt.requestId,
        sessionId: outcome.sessionId,
        summary: "V5 session published with a soft flag"
      });
    } else if (outcome.disposition === "hard_reject") {
      recordWorkbenchActivity(db, {
        actor,
        details,
        eventType: "authoring_session_rejected",
        relatedRunId: receipt.requestId,
        sessionId: outcome.sessionId,
        summary: "V5 session rejected"
      });
    }
    recordWorkbenchActivity(db, {
      actor,
      details,
      eventType: "authoring_pack_finished",
      relatedRunId: receipt.requestId,
      sessionId: outcome.sessionId,
      summary: "V5 authoring pack finished"
    });
    if (requestCompleted) {
      recordWorkbenchActivity(db, {
        actor,
        details,
        eventType: "authoring_request_completed",
        relatedRunId: receipt.requestId,
        sessionId: outcome.sessionId,
        summary: "V5 authoring request completed"
      });
    }
  }
  for (const consideration of receipt.optionalConsiderations.filter(({ decision }) => decision === "no")) {
    const sessionId = draft.sessions.find(({ evidenceCatalog }) => (
      consideration.evidenceRef && evidenceCatalog.some(({ id }) => id === consideration.evidenceRef)
    ))?.sessionId ?? draft.sessions[0]!.sessionId;
    recordWorkbenchActivity(db, {
      actor,
      details: { ...consideration, packId: receipt.packId, requestId: receipt.requestId },
      eventType: "authoring_optional_considered_no",
      relatedRunId: receipt.requestId,
      sessionId,
      summary: `V5 optional ${consideration.kind} considered and declined`
    });
  }
  for (const artifact of receipt.optionalArtifacts) {
    recordWorkbenchActivity(db, {
      actor,
      details: { ...artifact, packId: receipt.packId, requestId: receipt.requestId },
      eventType: "authoring_optional_artifact_published",
      relatedRunId: receipt.requestId,
      sessionId: artifact.sessionIds[0] ?? draft.sessions[0]!.sessionId,
      summary: `V5 optional ${artifact.kind} published`
    });
  }
}

function durableEnrichment(
  db: MastheadDatabase,
  sessionId: string,
  fields: WorkbenchAuthoringV5Fields,
  catalog: WorkbenchAuthoringV5EvidenceCatalogItem[]
): DurableSessionEnrichment {
  const refs = (ids: string[]): EvidenceRef[] => ids.map((id) => {
    const item = catalog.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`unknown_canonical_evidence_ref:${id}`);
    return { id, kind: evidenceKind(item.kind), observedAt: item.observedAt, source: "canonical" };
  });
  return {
    version: "session-capsule-v4",
    source: "remote_model",
    promptVersion: WORKBENCH_AUTHORING_V5_VERSION,
    sessionTitle: { text: fields.title, basis: "dominant_work", confidence: "medium", evidenceRefs: refs(fields.evidenceRefs.title) },
    sessionSummary: {
      text: fields.description,
      state: canonicalSessionSummaryState(db, sessionId),
      confidence: "medium",
      evidenceRefs: refs(fields.evidenceRefs.description)
    },
    sessionDossier: {
      purpose: fields.purpose,
      outcome: fields.outcome,
      keyWork: fields.keyWork,
      decisions: fields.decisions,
      blockers: [],
      warnings: [],
      evidenceRefs: refs([...fields.evidenceRefs.purpose, ...fields.evidenceRefs.outcome, ...fields.evidenceRefs.keyWork]),
      verification: {
        status: fields.verification.status,
        summary: fields.verification.summary,
        commands: [],
        failures: [],
        evidenceRefs: refs(fields.evidenceRefs.verification)
      },
      continuation: { openQuestions: [], constraints: [] }
    },
    keywords: [...fields.keywords]
  } as DurableSessionEnrichment;
}

function canonicalSessionSummaryState(
  db: MastheadDatabase,
  sessionId: string
): DurableSessionEnrichment["sessionSummary"]["state"] {
  const row = db.prepare(
    "SELECT lifecycle, outcome_label AS outcomeLabel FROM sessions WHERE session_id = ?"
  ).get(sessionId) as { lifecycle: string; outcomeLabel: string | null } | undefined;
  const outcome = row?.outcomeLabel?.trim().toLowerCase();
  if (outcome === "completed" || outcome === "succeeded" || outcome === "success") return "completed";
  if (outcome === "failed" || outcome === "error") return "failed";
  if (outcome === "blocked") return "blocked";
  if (outcome === "partial") return "partial";
  if (outcome === "paused") return "paused";
  return "unknown";
}

function evidenceKind(kind: WorkbenchAuthoringV5EvidenceCatalogItem["kind"]): EvidenceRef["kind"] {
  if (kind === "tool_call" || kind === "tool_result") return "command";
  if (kind === "file_effect") return "file_change";
  return "event";
}

function requestReceiptFrom(
  receipts: WorkbenchAuthoringV5PackReceipt[],
  completedAt: string,
  requestId: string
): WorkbenchAuthoringV5RequestReceipt {
  return {
    completedAt,
    counts: {
      attempted: receipts.reduce((sum, receipt) => sum + receipt.counts.attempted, 0),
      consideredNo: receipts.reduce((sum, receipt) => sum + receipt.counts.consideredNo, 0),
      optionalPublished: receipts.reduce((sum, receipt) => sum + receipt.counts.optionalPublished, 0),
      published: receipts.reduce((sum, receipt) => sum + receipt.counts.published, 0),
      rejected: receipts.reduce((sum, receipt) => sum + receipt.counts.rejected, 0),
      softFlagged: receipts.reduce((sum, receipt) => sum + receipt.counts.softFlagged, 0)
    },
    packReceipts: receipts,
    receiptVersion: "workbench-authoring-v5-request-receipt-v1",
    requestId
  };
}

function finishResult(db: MastheadDatabase, command: string, receipt: WorkbenchAuthoringV5PackReceipt) {
  const request = requireWorkbenchAuthoringV5Request(db, receipt.requestId);
  return {
    receipt,
    ...(request.status === "completed" ? { requestReceipt: getWorkbenchAuthoringV5RequestReceipt(db, request.requestId) } : {}),
    nextAction: request.status === "completed" ? completeAction() : claimNextAction(command, request.requestId)
  };
}

function requestNextAction(db: MastheadDatabase, command: string, requestId: string): WorkbenchAuthoringV5NextAction {
  const pack = activeOrAvailableWorkbenchAuthoringV5Pack(db, requestId);
  if (!pack || pack.status === "available") return startAction(command, requestId);
  return packNextAction(db, command, pack.packId);
}

function packNextAction(db: MastheadDatabase, command: string, packId: string): WorkbenchAuthoringV5NextAction {
  const pack = requireWorkbenchAuthoringV5Pack(db, packId);
  if (pack.status === "saved") return finishAction(command, packId);
  return coverage(db, packId).every(({ complete }) => complete) ? scaffoldAction(command, packId) : inspectAction(command, packId);
}

function startAction(command: string, requestId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "start", command: `${command} workbench author start --request ${shellQuote(requestId)} --json`, reason: "Start or resume the next fixed pack." };
}

function inspectAction(command: string, packId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "inspect", command: `${command} workbench author inspect --pack ${shellQuote(packId)} --json`, reason: "Inspect the next unread canonical evidence page." };
}
function scaffoldAction(command: string, packId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "scaffold", command: `${command} workbench author scaffold --pack ${shellQuote(packId)} --file ${shellQuote(`${packId}.json`)} --json`, reason: "Write the blank skill-field scaffold and evidence catalog to a file." };
}
function saveAction(command: string, packId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "save", command: `${command} workbench author save --pack ${shellQuote(packId)} --file ${shellQuote(`${packId}.json`)} --json`, reason: "Fill every session field from inspected evidence, then save the pack." };
}
function finishAction(command: string, packId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "finish", command: `${command} workbench author finish --pack ${shellQuote(packId)} --json`, reason: "Publish passers and soft flags, record rejects, and release the next pack." };
}
function claimNextAction(command: string, requestId: string): WorkbenchAuthoringV5NextAction {
  return { kind: "claim_next", command: `${command} workbench author start --request ${shellQuote(requestId)} --json`, reason: "The next fixed pack is available." };
}
function completeAction(): WorkbenchAuthoringV5NextAction {
  return { kind: "complete", command: "", reason: "The full request is complete; this receipt is immutable." };
}

function firstUnreadOffset(items: Array<{ itemId: string }>, accessed: Set<string>): number {
  const index = items.findIndex(({ itemId }) => !accessed.has(itemId));
  return index === -1 ? items.length : index;
}
function parseCursor(cursor: string, total: number): number {
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > total) throw new Error("authoring_v5_cursor_invalid");
  return parsed;
}
function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}
