import { randomUUID } from "node:crypto";
import { stableRecordId } from "../../daemon/identity.ts";
import {
  activeOrAvailableWorkbenchAuthoringV5Pack,
  activateWorkbenchAuthoringV5Pack,
  completeWorkbenchAuthoringV5PackRecord,
  getSavedWorkbenchAuthoringV5Pack,
  getWorkbenchAuthoringV5PackReceipt,
  getWorkbenchAuthoringV5RequestReceipt,
  insertWorkbenchAuthoringV5Request,
  listWorkbenchAuthoringV5EvidenceAccess,
  listWorkbenchAuthoringV5Packs,
  recordWorkbenchAuthoringV5EvidenceAccess,
  requestBindingForWorkbenchAuthoringV5Pack,
  requireWorkbenchAuthoringV5Pack,
  requireWorkbenchAuthoringV5Request,
  saveWorkbenchAuthoringV5PackDraft
} from "../../daemon/db/workbenchAuthoringV5Repository.ts";
import { bumpDataRevisionInTransaction } from "../../daemon/db/dataRevisionRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import { recordWorkbenchActivity } from "../../daemon/db/workbenchPipelineRepository.ts";
import type { EvidenceRef } from "../../core/types.ts";
import type { DurableSessionEnrichment } from "../../shared/sessionEnrichment.ts";
import {
  WORKBENCH_AUTHORING_V5_VERSION,
  type WorkbenchAuthoringV5Draft,
  type WorkbenchAuthoringV5EvidenceCatalogItem,
  type WorkbenchAuthoringV5Fields,
  type WorkbenchAuthoringV5NextAction,
  type WorkbenchAuthoringV5PackReceipt,
  type WorkbenchAuthoringV5RequestReceipt,
  type WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import type { GuidedAuthoringExpectedIdentity } from "../../shared/instanceIdentity.ts";
import {
  assertGuidedAuthoringExpectedIdentity,
  assertStableGuidedRequestBinding
} from "../../shared/instanceIdentity.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import { assertGuidedSelectionCompileReady } from "./guidedAuthoringPreflight.ts";
import * as workbenchAuthoringV5Quality from "./workbenchAuthoringV5Quality.ts";
import {
  applyGuidedSessionEnrichmentInTransaction,
  publishStagedGuidedArtifactsInTransaction,
  stageWorkbenchAuthoringV5CanonicalDossiersInTransaction
} from "./authoringService.ts";

const MINIMUM_PACK_SIZE = 5;
const MAXIMUM_PACK_SIZE = 12;

type MutationIdentity = {
  currentIdentity: GuidedAuthoringExpectedIdentity;
  expectedIdentity: GuidedAuthoringExpectedIdentity;
};

export function createWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: MutationIdentity & {
    actorId: string;
    command: string;
    sessionIds: string[];
  }
) {
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
  assertRequestMembership(input.sessionIds);
  return withImmediateTransaction(db, () => {
    const preflight = assertGuidedSelectionCompileReady(db, input.sessionIds);
    const requestId = `authoring-v5-request:${randomUUID()}`;
    const packSessionIds = fixedPacks(preflight.sessions.map(({ sessionId }) => sessionId));
    const request = insertWorkbenchAuthoringV5Request(db, {
      actorId: input.actorId,
      identity: {
        baseUrl: input.currentIdentity.baseUrl,
        buildSha: input.currentIdentity.buildSha,
        creationInstanceId: input.currentIdentity.instanceId,
        databaseId: input.currentIdentity.databaseId,
        instanceManifest: input.currentIdentity.instanceManifest
      },
      packs: packSessionIds.map((sessionIds, ordinal) => ({
        evidenceRevision: evidenceCatalog.guidedAuthoringEvidenceRevision(db, sessionIds),
        ordinal,
        packId: stableRecordId("authoring-v5-pack", [requestId, String(ordinal)]),
        sessionIds
      })),
      requestId,
      sessions: preflight.sessions.map(({ sessionId }, ordinal) => ({ ordinal, sessionId }))
    });
    bumpDataRevisionInTransaction(db, "workbench");
    const result = {
      handoff: {
        requestId,
        startCommand: `${input.command} workbench author bootstrap --request ${shellQuote(requestId)} --json`
      },
      nextAction: startAction(input.command, requestId),
      request
    };
    for (const sessionId of input.sessionIds) {
      recordWorkbenchActivity(db, {
        actor: { id: input.actorId, kind: "agent" },
        details: { packCount: request.packCount, requestId },
        eventType: "authoring_request_created",
        relatedRunId: requestId,
        sessionId,
        summary: "V5 authoring request created"
      });
    }
    return result;
  });
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
    rejectRules: {
      behavior: "flag_and_continue" as const,
      hardReject: ["empty_or_generic_title", "protocol_or_compaction_summary", "empty_keywords", "purpose_not_user_ask"],
      softFlag: ["weak_verification", "thin_key_work"],
      requestFreezeOnReject: false
    },
    request,
    ...(status.receipt ? { receipt: status.receipt } : {}),
    nextAction: status.nextAction
  };
}

export function startWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  input: MutationIdentity & { command: string; requestId: string }
) {
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
    assertCurrentEvidenceRevision(db, pack);
    const before = coverage(db, pack.packId);
    const sessionId = input.sessionId ?? before.find(({ complete }) => !complete)?.sessionId ?? pack.sessionIds[0]!;
    if (!pack.sessionIds.includes(sessionId)) throw new Error("authoring_v5_session_not_in_pack");
    const canonical = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })];
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
  assertCurrentEvidenceRevision(db, pack);
  if (coverage(db, pack.packId).some(({ complete }) => !complete)) throw new Error("authoring_v5_evidence_incomplete");
  const draft: WorkbenchAuthoringV5Draft = {
    bundleVersion: WORKBENCH_AUTHORING_V5_VERSION,
    evidenceRevision: pack.evidenceRevision,
    optionalArtifacts: [],
    optionalConsiderations: [],
    packId: pack.packId,
    sessions: pack.sessionIds.map((sessionId) => ({
      evidenceCatalog: [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })].map(catalogItem),
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
    draft: WorkbenchAuthoringV5Draft;
    packId: string;
  }
) {
  assertPackIdentity(db, input.packId, input);
  return withImmediateTransaction(db, () => {
    const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
    if (pack.status !== "active" && pack.status !== "saved") throw new Error("authoring_v5_pack_not_saveable");
    assertCurrentEvidenceRevision(db, pack);
    const draft = parseWorkbenchAuthoringV5Draft(input.draft, pack);
    const outcomes = draft.sessions.map((session) => classifySessionDraft(db, session));
    const saved = saveWorkbenchAuthoringV5PackDraft(db, { draft, outcomes, packId: pack.packId });
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
    assertCurrentEvidenceRevision(db, pack);
    const saved = getSavedWorkbenchAuthoringV5Pack(db, pack.packId);
    if (!saved) throw new Error("authoring_v5_saved_draft_missing");
    const request = requireWorkbenchAuthoringV5Request(db, pack.requestId);
    const publishable = saved.draft.sessions.filter(({ sessionId }) => (
      saved.outcomes.find((outcome) => outcome.sessionId === sessionId)?.disposition !== "hard_reject"
    ));
    for (const session of publishable) {
      applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: request.actorId,
        enrichment: durableEnrichment(session.fields, session.evidenceCatalog),
        sessionId: session.sessionId
      });
    }
    const dossierArtifacts = stageWorkbenchAuthoringV5CanonicalDossiersInTransaction(db, {
      actorId: request.actorId,
      evidenceRevision: pack.evidenceRevision,
      sessionIds: publishable.map(({ sessionId }) => sessionId)
    });
    const published = publishStagedGuidedArtifactsInTransaction(db, { dossierArtifacts, optionalArtifacts: [] });
    const completedAt = new Date().toISOString();
    const packReceipt: WorkbenchAuthoringV5PackReceipt = {
      completedAt,
      counts: {
        attempted: saved.outcomes.length,
        published: publishable.length,
        rejected: saved.outcomes.filter(({ disposition }) => disposition === "hard_reject").length,
        softFlagged: saved.outcomes.filter(({ disposition }) => disposition === "soft_flag").length
      },
      draftRevision: pack.currentDraftRevision,
      evidenceRevision: pack.evidenceRevision,
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
    recordFinishActivity(db, request.actorId, packReceipt, Boolean(requestReceipt));
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
  return {
    request,
    ...(receipt ? { receipt } : {}),
    nextAction: request.status === "completed" ? completeAction() : requestNextAction(db, input.command, request.requestId)
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

function coverage(db: MastheadDatabase, packId: string) {
  const pack = requireWorkbenchAuthoringV5Pack(db, packId);
  const accessed = listWorkbenchAuthoringV5EvidenceAccess(db, packId, pack.evidenceRevision);
  return pack.sessionIds.map((sessionId) => {
    const totalItems = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })].length;
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
  value: WorkbenchAuthoringV5Draft,
  pack: ReturnType<typeof requireWorkbenchAuthoringV5Pack>
): WorkbenchAuthoringV5Draft {
  if (!value || value.bundleVersion !== WORKBENCH_AUTHORING_V5_VERSION || value.packId !== pack.packId ||
      value.evidenceRevision !== pack.evidenceRevision || !Array.isArray(value.sessions)) {
    throw new Error("invalid_workbench_authoring_v5_bundle");
  }
  if (value.sessions.length !== pack.sessionIds.length ||
      value.sessions.some((session, index) => session.sessionId !== pack.sessionIds[index] || !session.fields || !Array.isArray(session.evidenceCatalog))) {
    throw new Error("invalid_workbench_authoring_v5_membership");
  }
  for (const session of value.sessions) {
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
      typeof fields.verification.summary !== "string" ||
      session.evidenceCatalog.some(({ id }) => typeof id !== "string" || !id.trim())
    ) {
      throw new Error("invalid_workbench_authoring_v5_fields");
    }
  }
  return structuredClone(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Kept separate so S4 can replace classification without changing save/finish state transitions.
function classifySessionDraft(
  db: MastheadDatabase,
  session: WorkbenchAuthoringV5Draft["sessions"][number]
): WorkbenchAuthoringV5SessionOutcome {
  const liveEvidenceIds = new Set(
    [...iterateSessionTranscriptItems(db, { order: "asc", sessionId: session.sessionId })].map(({ itemId }) => itemId)
  );
  const catalogIds = new Set(session.evidenceCatalog.map(({ id }) => id));
  const referencedIds = Object.values(session.fields.evidenceRefs).flat();
  const unknown = [...new Set(referencedIds.filter((id) => !liveEvidenceIds.has(id) || !catalogIds.has(id)))];
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
}

function durableEnrichment(
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
    sessionSummary: { text: fields.description, state: "completed", confidence: "medium", evidenceRefs: refs(fields.evidenceRefs.description) },
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
      consideredNo: 0,
      optionalPublished: 0,
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
