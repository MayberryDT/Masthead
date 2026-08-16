import deviceAuthorizationSchema from "../../schemas/masthead-pages/v1/schema/device-authorization-v1.schema.json" with { type: "json" };
import pageRevisionSchema from "../../schemas/masthead-pages/v1/schema/page-revision-v1.schema.json" with { type: "json" };
import publicLogbookApiSchema from "../../schemas/masthead-pages/v1/schema/public-logbook-api-v1.schema.json" with { type: "json" };
import publishPageBatchRequestSchema from "../../schemas/masthead-pages/v1/schema/publish-page-batch-request-v1.schema.json" with { type: "json" };
import publishPageBatchResultSchema from "../../schemas/masthead-pages/v1/schema/publish-page-batch-result-v1.schema.json" with { type: "json" };
import publishPageRequestSchema from "../../schemas/masthead-pages/v1/schema/publish-page-request-v1.schema.json" with { type: "json" };
import publishPageResultSchema from "../../schemas/masthead-pages/v1/schema/publish-page-result-v1.schema.json" with { type: "json" };
import publisherAccountSchema from "../../schemas/masthead-pages/v1/schema/publisher-account-v1.schema.json" with { type: "json" };
import removePageApiSchema from "../../schemas/masthead-pages/v1/schema/remove-page-api-v1.schema.json" with { type: "json" };

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { computePageObjectId, MAX_CANONICAL_PAGE_BYTES, canonicalPageBytes } from "./objectIdentity.ts";
import type {
  CreatePublicLogbookRequestV1,
  DeviceAuthorizationRequestV1,
  DeviceAuthorizationV1,
  DeviceRefreshRequestV1,
  DeviceRevokeRequestV1,
  DeviceRevokeResultV1,
  DeviceTokenRequestV1,
  DeviceTokenResultV1,
  PageRevisionV1,
  PublishPageBatchRequestV1,
  PublishPageBatchResultV1,
  PublishPageRequestV1,
  PublishPageResultV1,
  PublisherAccountResultV1,
  PublisherAccountV1,
  PublicLogbookListResultV1,
  PublicLogbookResultV1,
  RemovePageRequestV1,
  RemovePageResultV1,
  UpdatePublicLogbookRequestV1,
  ValidationIssue,
  ValidationResult,
} from "./types.ts";

const CONTRACT_SCHEMAS: readonly object[] = [
  deviceAuthorizationSchema,
  pageRevisionSchema,
  publicLogbookApiSchema,
  publishPageBatchRequestSchema,
  publishPageBatchResultSchema,
  publishPageRequestSchema,
  publishPageResultSchema,
  publisherAccountSchema,
  removePageApiSchema,
];

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail(issues: ValidationIssue | ValidationIssue[]): ValidationResult<never> {
  return { ok: false, issues: Array.isArray(issues) ? issues : [issues] };
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function mapAjvErrors(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors || errors.length === 0) {
    return [issue("invalid", "", "Value failed schema validation")];
  }
  return errors.map((error) => {
    const path = error.instancePath || "";
    if (error.keyword === "additionalProperties") {
      const extra =
        typeof error.params === "object" &&
        error.params !== null &&
        "additionalProperty" in error.params
          ? String((error.params as { additionalProperty: string }).additionalProperty)
          : "unknown";
      return issue("unknown-field", path ? `${path}/${extra}` : `/${extra}`, `Unknown field: ${extra}`);
    }
    if (error.keyword === "const" || error.keyword === "enum") {
      return issue(
        "unsupported-version",
        path,
        error.message ?? "Unsupported protocol or schema version",
      );
    }
    return issue(error.keyword || "invalid", path, error.message ?? "Invalid value");
  });
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateSchema: false,
    code: { esm: true },
  });
  addFormats(ajv);
  for (const schema of CONTRACT_SCHEMAS) {
    ajv.addSchema(schema);
  }
  return ajv;
}

const ajv = createAjv();

function compileRef<T>(ref: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(ref) ?? ajv.compile<T>({ $ref: ref });
  return validate;
}

const validators = {
  pageRevision: compileRef<PageRevisionV1>(
    "https://masthead.page/schema/page-revision-v1.schema.json",
  ),
  publishRequest: compileRef<PublishPageRequestV1>(
    "https://masthead.page/schema/publish-page-request-v1.schema.json",
  ),
  publishBatchRequest: compileRef<PublishPageBatchRequestV1>(
    "https://masthead.page/schema/publish-page-batch-request-v1.schema.json",
  ),
  publishResult: compileRef<PublishPageResultV1>(
    "https://masthead.page/schema/publish-page-result-v1.schema.json",
  ),
  publishBatchResult: compileRef<PublishPageBatchResultV1>(
    "https://masthead.page/schema/publish-page-batch-result-v1.schema.json",
  ),
  publisherAccount: compileRef<PublisherAccountV1>(
    "https://masthead.page/schema/publisher-account-v1.schema.json#/$defs/account",
  ),
  publisherAccountResult: compileRef<PublisherAccountResultV1>(
    "https://masthead.page/schema/publisher-account-v1.schema.json#/$defs/result",
  ),
  createPublicLogbook: compileRef<CreatePublicLogbookRequestV1>(
    "https://masthead.page/schema/public-logbook-api-v1.schema.json#/$defs/createRequest",
  ),
  updatePublicLogbook: compileRef<UpdatePublicLogbookRequestV1>(
    "https://masthead.page/schema/public-logbook-api-v1.schema.json#/$defs/updateRequest",
  ),
  publicLogbookResult: compileRef<PublicLogbookResultV1>(
    "https://masthead.page/schema/public-logbook-api-v1.schema.json#/$defs/result",
  ),
  publicLogbookListResult: compileRef<PublicLogbookListResultV1>(
    "https://masthead.page/schema/public-logbook-api-v1.schema.json#/$defs/listResult",
  ),
  deviceAuthorizationRequest: compileRef<DeviceAuthorizationRequestV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/authorizationRequest",
  ),
  deviceAuthorization: compileRef<DeviceAuthorizationV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/authorization",
  ),
  deviceTokenRequest: compileRef<DeviceTokenRequestV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/tokenRequest",
  ),
  deviceRefreshRequest: compileRef<DeviceRefreshRequestV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/refreshRequest",
  ),
  deviceTokenResult: compileRef<DeviceTokenResultV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/tokenResult",
  ),
  deviceRevokeRequest: compileRef<DeviceRevokeRequestV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/revokeRequest",
  ),
  deviceRevokeResult: compileRef<DeviceRevokeResultV1>(
    "https://masthead.page/schema/device-authorization-v1.schema.json#/$defs/revokeResult",
  ),
  removePageRequest: compileRef<RemovePageRequestV1>(
    "https://masthead.page/schema/remove-page-api-v1.schema.json#/$defs/request",
  ),
  removePageResult: compileRef<RemovePageResultV1>(
    "https://masthead.page/schema/remove-page-api-v1.schema.json#/$defs/result",
  ),
};

function runValidator<T>(validate: ValidateFunction<T>, value: unknown): ValidationResult<T> {
  if (validate(value)) {
    return ok(value as T);
  }
  return fail(mapAjvErrors(validate.errors));
}

export function validatePageRevisionV1(value: unknown): ValidationResult<PageRevisionV1> {
  const schemaResult = runValidator(validators.pageRevision, value);
  if (!schemaResult.ok) return schemaResult;

  try {
    const bytes = canonicalPageBytes(schemaResult.value);
    if (bytes.byteLength > MAX_CANONICAL_PAGE_BYTES) {
      return fail(
        issue(
          "canonical-too-large",
          "",
          `Canonical page exceeds ${MAX_CANONICAL_PAGE_BYTES} bytes`,
        ),
      );
    }
  } catch {
    return fail(issue("canonicalize-failed", "", "Failed to canonicalize page revision"));
  }

  return schemaResult;
}

export function validatePublishPageRequestV1(
  value: unknown,
): ValidationResult<PublishPageRequestV1> {
  const schemaResult = runValidator(validators.publishRequest, value);
  if (!schemaResult.ok) return schemaResult;

  const pageResult = validatePageRevisionV1(schemaResult.value.object);
  if (!pageResult.ok) {
    return fail(
      pageResult.issues.map((item) => ({
        ...item,
        path: item.path ? `/object${item.path}` : "/object",
      })),
    );
  }

  const hasPageId = schemaResult.value.pageId !== undefined;
  const hasParent = schemaResult.value.expectedParentObjectId !== undefined;
  if (hasPageId !== hasParent) {
    return fail(
      issue(
        "invalid-request",
        "",
        "pageId and expectedParentObjectId must both be present for revisions or both absent for creates",
      ),
    );
  }

  const expectedObjectId = computePageObjectId(pageResult.value);
  if (schemaResult.value.objectId !== expectedObjectId) {
    return fail(
      issue(
        "object-id-mismatch",
        "/objectId",
        "objectId does not match canonical page bytes",
      ),
    );
  }

  return ok({
    ...schemaResult.value,
    object: pageResult.value,
  });
}

export function validatePublishPageBatchRequestV1(
  value: unknown,
): ValidationResult<PublishPageBatchRequestV1> {
  const schemaResult = runValidator(validators.publishBatchRequest, value);
  if (!schemaResult.ok) return schemaResult;

  const requests: PublishPageRequestV1[] = [];
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < schemaResult.value.requests.length; i += 1) {
    const item = validatePublishPageRequestV1(schemaResult.value.requests[i]);
    if (!item.ok) {
      issues.push(
        ...item.issues.map((entry) => ({
          ...entry,
          path: entry.path ? `/requests/${i}${entry.path}` : `/requests/${i}`,
        })),
      );
      continue;
    }
    if (seen.has(item.value.idempotencyKey)) {
      issues.push(
        issue(
          "duplicate-idempotency-key",
          `/requests/${i}`,
          "Duplicate idempotencyKey in batch",
        ),
      );
    }
    seen.add(item.value.idempotencyKey);
    requests.push(item.value);
  }
  if (issues.length > 0) return fail(issues);
  return ok({
    protocolVersion: "masthead-pages-publish-batch-v1",
    requests,
  });
}

export function validatePublishPageResultV1(
  value: unknown,
): ValidationResult<PublishPageResultV1> {
  return runValidator(validators.publishResult, value);
}

export function validatePublishPageBatchResultV1(
  value: unknown,
): ValidationResult<PublishPageBatchResultV1> {
  return runValidator(validators.publishBatchResult, value);
}

export function validatePublisherAccountV1(
  value: unknown,
): ValidationResult<PublisherAccountV1> {
  return runValidator(validators.publisherAccount, value);
}

export function validatePublisherAccountResultV1(
  value: unknown,
): ValidationResult<PublisherAccountResultV1> {
  return runValidator(validators.publisherAccountResult, value);
}

export function validateCreatePublicLogbookRequestV1(
  value: unknown,
): ValidationResult<CreatePublicLogbookRequestV1> {
  return runValidator(validators.createPublicLogbook, value);
}

export function validateUpdatePublicLogbookRequestV1(
  value: unknown,
): ValidationResult<UpdatePublicLogbookRequestV1> {
  return runValidator(validators.updatePublicLogbook, value);
}

export function validatePublicLogbookResultV1(
  value: unknown,
): ValidationResult<PublicLogbookResultV1> {
  return runValidator(validators.publicLogbookResult, value);
}

export function validatePublicLogbookListResultV1(
  value: unknown,
): ValidationResult<PublicLogbookListResultV1> {
  return runValidator(validators.publicLogbookListResult, value);
}

export function validateDeviceAuthorizationRequestV1(
  value: unknown,
): ValidationResult<DeviceAuthorizationRequestV1> {
  return runValidator(validators.deviceAuthorizationRequest, value);
}

export function validateDeviceAuthorizationV1(
  value: unknown,
): ValidationResult<DeviceAuthorizationV1> {
  return runValidator(validators.deviceAuthorization, value);
}

export function validateDeviceTokenRequestV1(
  value: unknown,
): ValidationResult<DeviceTokenRequestV1> {
  return runValidator(validators.deviceTokenRequest, value);
}

export function validateDeviceRefreshRequestV1(
  value: unknown,
): ValidationResult<DeviceRefreshRequestV1> {
  return runValidator(validators.deviceRefreshRequest, value);
}

export function validateDeviceTokenResultV1(
  value: unknown,
): ValidationResult<DeviceTokenResultV1> {
  return runValidator(validators.deviceTokenResult, value);
}

export function validateDeviceRevokeRequestV1(
  value: unknown,
): ValidationResult<DeviceRevokeRequestV1> {
  return runValidator(validators.deviceRevokeRequest, value);
}

export function validateDeviceRevokeResultV1(
  value: unknown,
): ValidationResult<DeviceRevokeResultV1> {
  return runValidator(validators.deviceRevokeResult, value);
}

export function validateRemovePageRequestV1(
  value: unknown,
): ValidationResult<RemovePageRequestV1> {
  return runValidator(validators.removePageRequest, value);
}

export function validateRemovePageResultV1(
  value: unknown,
): ValidationResult<RemovePageResultV1> {
  return runValidator(validators.removePageResult, value);
}
