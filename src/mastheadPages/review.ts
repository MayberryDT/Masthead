import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import { scanCompleteOutboundRequest, type EgressFinding } from "./egressPreflight.ts";
import { computePageObjectId } from "./objectIdentity.ts";
import { projectSessionDossier, type SessionDossierProjectionInput } from "./publicProjection.ts";
import type { ObjectId, PageRevisionV1, PublishPageRequestV1, RemovePageRequestV1 } from "./types.ts";

export type FinalizeReviewInput = SessionDossierProjectionInput & {
  publicLogbookId: string;
  slug: string;
  idempotencyKey: string;
  pageId?: string;
  expectedParentObjectId?: ObjectId;
};

export type FinalizedPageReview = {
  decision: "ready" | "needs_review" | "blocked";
  findings: EgressFinding[];
  request: PublishPageRequestV1;
  requestDigest: ObjectId;
};

export function finalizePageReview(input: FinalizeReviewInput): FinalizedPageReview {
  const object = projectSessionDossier(input);
  const objectId = computePageObjectId(object);
  const request = buildPublishPageRequest({ ...input, object, objectId });
  const scan = scanCompleteOutboundRequest(request);
  return {
    decision: scan.decision,
    findings: scan.findings,
    request,
    requestDigest: sha256CanonicalRequest(request),
  };
}

export function buildPublishPageRequest(input: {
  publicLogbookId: string;
  slug: string;
  idempotencyKey: string;
  object: PageRevisionV1;
  objectId: ObjectId;
  pageId?: string;
  expectedParentObjectId?: ObjectId;
}): PublishPageRequestV1 {
  const isRevision = input.pageId !== undefined || input.expectedParentObjectId !== undefined;
  if (isRevision && (input.pageId === undefined || input.expectedParentObjectId === undefined)) {
    throw new Error("page_id_and_parent_object_id_required_for_revision");
  }
  return {
    protocolVersion: "masthead-pages-publish-v1",
    publicLogbookId: input.publicLogbookId,
    slug: input.slug,
    idempotencyKey: input.idempotencyKey,
    objectId: input.objectId,
    object: input.object,
    ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
    ...(input.expectedParentObjectId === undefined ? {} : { expectedParentObjectId: input.expectedParentObjectId }),
  };
}

export function sha256CanonicalRequest(request: PublishPageRequestV1 | RemovePageRequestV1): ObjectId {
  const canonical = canonicalize(request);
  if (canonical === undefined) throw new Error("canonicalize_failed");
  return `sha256-${createHash("sha256").update(canonical, "utf8").digest("hex")}` as ObjectId;
}
