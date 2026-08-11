export type ObjectId = `sha256-${string}`;

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export type VerificationStatus =
  | "passed"
  | "failed"
  | "mixed"
  | "missing"
  | "unknown";

export type EvidenceSupport =
  | "purpose"
  | "outcome"
  | "key-work"
  | "decisions"
  | "blockers"
  | "verification"
  | "continuation";

export type EvidenceItemV1 = {
  id: string;
  kind: "excerpt" | "verification";
  label: string;
  text: string;
  supports: EvidenceSupport[];
};

export type SourceLinkV1 = {
  rel: "repository" | "commit";
  label: string;
  url: string;
};

export type PageRevisionBodyV1 = {
  purpose?: string;
  outcome?: string;
  keyWork: string[];
  decisions: string[];
  blockers: string[];
  continuation: {
    nextStep?: string;
    openQuestions: string[];
    constraints: string[];
  };
  warnings: string[];
};

export type PageRevisionV1 = {
  schemaVersion: "masthead-page-revision-v1";
  kind: "session_dossier";
  title: string;
  summary: string;
  body: PageRevisionBodyV1;
  labels: {
    topics: string[];
    technologies: string[];
  };
  verification: {
    status: VerificationStatus;
    summary: string;
    checks: string[];
    failures: string[];
  };
  evidence: EvidenceItemV1[];
  provenance: {
    sourceKind: "session_dossier";
    sourceSchema: "canonical-session-dossier-v1";
    sourceDate?: string;
    sourceLinks: SourceLinkV1[];
  };
  license: "all-rights-reserved" | "cc-by-4.0";
  generator: {
    name: "Masthead";
    version: string;
    projection: "session-dossier-public-v1";
  };
};

export type PublishPageRequestV1 = {
  protocolVersion: "masthead-pages-publish-v1";
  publicLogbookId: string;
  pageId?: string;
  slug: string;
  expectedParentObjectId?: ObjectId;
  idempotencyKey: string;
  objectId: ObjectId;
  object: PageRevisionV1;
};

export type PublishPageBatchRequestV1 = {
  protocolVersion: "masthead-pages-publish-batch-v1";
  requests: PublishPageRequestV1[];
};

export type PublishPageSuccessV1 = {
  status: "published" | "idempotent-replay";
  idempotencyKey: string;
  pageId: string;
  objectId: ObjectId;
  parentObjectId?: ObjectId;
  currentUrl: string;
  exactRevisionUrl: string;
  publishedAt: string;
};

export type PublishPageFailureCode =
  | "invalid-request"
  | "unsupported-version"
  | "object-id-mismatch"
  | "content-blocked"
  | "not-authorized"
  | "not-owner"
  | "limit-reached"
  | "parent-conflict"
  | "idempotency-conflict"
  | "temporarily-unavailable";

export type PublishPageFailureV1 = {
  status: "rejected" | "conflict" | "retryable-failure";
  idempotencyKey: string;
  code: PublishPageFailureCode;
  retryable: boolean;
  message: string;
  currentObjectId?: ObjectId;
};

export type PublishPageResultV1 = PublishPageSuccessV1 | PublishPageFailureV1;

export type PublishPageBatchResultV1 = {
  protocolVersion: "masthead-pages-publish-batch-result-v1";
  results: PublishPageResultV1[];
};

export type PublisherAccess =
  | "publisher"
  | "request_required"
  | "requested"
  | "suspended";

export type LogbookVisibility = "discoverable" | "unlisted";

export type PageLicense = "all-rights-reserved" | "cc-by-4.0";

export type PublisherAccountV1 = {
  protocolVersion: "masthead-pages-account-v1";
  accountId: string;
  handle?: string;
  publisherAccess: PublisherAccess;
  defaultLogbookVisibility: LogbookVisibility;
};

export type PublisherAccountResultV1 = {
  protocolVersion: "masthead-pages-account-result-v1";
  account: PublisherAccountV1;
};

export type PublicLogbookSummaryV1 = {
  id: string;
  ownerAccountId: string;
  title: string;
  slug: string;
  description: string;
  visibility: LogbookVisibility;
  defaultLicense: PageLicense;
  companionUrl?: string;
  coverVersion?: string;
};

export type CreatePublicLogbookRequestV1 = {
  protocolVersion: "masthead-pages-logbook-v1";
  title: string;
  slug: string;
  description: string;
  visibility?: LogbookVisibility;
  defaultLicense: PageLicense;
  companionUrl?: string;
};

export type UpdatePublicLogbookRequestV1 = Partial<
  Pick<
    CreatePublicLogbookRequestV1,
    "title" | "description" | "visibility" | "defaultLicense" | "companionUrl"
  >
> & { protocolVersion: "masthead-pages-logbook-v1" };

export type PublicLogbookResultV1 = {
  protocolVersion: "masthead-pages-logbook-result-v1";
  publicLogbook: PublicLogbookSummaryV1;
};

export type PublicLogbookListResultV1 = {
  protocolVersion: "masthead-pages-logbook-list-v1";
  items: PublicLogbookSummaryV1[];
};

export type DeviceAuthorizationRequestV1 = {
  protocolVersion: "masthead-pages-device-authorization-v1";
};

export type DeviceAuthorizationV1 = {
  protocolVersion: "masthead-pages-device-authorization-v1";
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  pollingInterval: number;
};

export type DeviceScope =
  | "logbooks:read"
  | "logbooks:write"
  | "pages:create"
  | "pages:revise"
  | "pages:remove";

export type DeviceTokenAuthorizedV1 = {
  protocolVersion: "masthead-pages-device-token-v1";
  status: "authorized";
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  scopes: DeviceScope[];
  account: PublisherAccountV1;
};

export type DeviceTokenResultV1 =
  | {
      protocolVersion: "masthead-pages-device-token-v1";
      status: "pending" | "denied" | "expired";
    }
  | DeviceTokenAuthorizedV1;

export type DeviceTokenRequestV1 = {
  protocolVersion: "masthead-pages-device-token-v1";
  grantType: "device_code";
  deviceCode: string;
};

export type DeviceRefreshRequestV1 = {
  protocolVersion: "masthead-pages-device-token-v1";
  grantType: "refresh_token";
  refreshToken: string;
};

export type DeviceRevokeRequestV1 = {
  protocolVersion: "masthead-pages-device-revoke-v1";
  refreshToken: string;
};

export type DeviceRevokeResultV1 = {
  protocolVersion: "masthead-pages-device-revoke-result-v1";
  status: "revoked" | "already-revoked";
};

export type RemovePageRequestV1 = {
  protocolVersion: "masthead-pages-remove-v1";
  pageId: string;
  idempotencyKey: string;
};

export type RemovePageResultV1 = {
  protocolVersion: "masthead-pages-remove-result-v1";
  pageId: string;
  idempotencyKey: string;
  status: "removed" | "idempotent-replay" | "rejected" | "retryable-failure";
  removedAt?: string;
  retryable: boolean;
  code?: string;
  message?: string;
};
