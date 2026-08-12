import { describe, expect, test } from "vitest";
import {
  PARENT_CONFLICT_COPY,
  REMOVAL_HONEST_COPY,
  canRemoveFromPages,
  canRetryPendingPublication,
  canRetryPendingRemoval,
  confirmPublishLabel,
  deriveReleaseState,
  parentConflictDisplay,
  type ReleaseMappingSnapshot
} from "../releaseState";

const liveMapping: ReleaseMappingSnapshot = {
  status: "live",
  localContentFingerprint: "fp-old",
  pageId: "page-1",
  objectId: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  friendlyUrl: "https://masthead.page/u/demo/notes/page",
  exactUrl: "https://masthead.page/r/old-object"
};

describe("deriveReleaseState", () => {
  test("marks a live Page changed when the local content fingerprint differs", () => {
    expect(deriveReleaseState({ mapping: liveMapping, currentFingerprint: "new" })).toBe("changed_locally");
  });

  test("keeps live when fingerprint matches", () => {
    expect(deriveReleaseState({ mapping: liveMapping, currentFingerprint: "fp-old" })).toBe("live");
  });

  test("returns not_on_pages without a mapping", () => {
    expect(deriveReleaseState({})).toBe("not_on_pages");
  });

  test("returns removed for withdrawn mappings", () => {
    expect(deriveReleaseState({ mapping: { status: "removed", pageId: "page-1" } })).toBe("removed");
  });

  test("returns failed for failed mappings and retained retryable publish errors", () => {
    expect(deriveReleaseState({ mapping: { status: "failed", pageId: "page-1" } })).toBe("failed");
    expect(
      deriveReleaseState({
        mapping: {
          status: "none",
          pendingOperationKind: "publish",
          pendingRequestDigest: "sha256-abc",
          pendingIdempotencyKey: "idem-1",
          lastErrorClass: "temporarily-unavailable"
        }
      })
    ).toBe("failed");
  });

  test("surfaces preparing and publishing controller phases", () => {
    expect(deriveReleaseState({ phase: "loading" })).toBe("preparing");
    expect(deriveReleaseState({ phase: "finalizing", mapping: liveMapping })).toBe("preparing");
    expect(deriveReleaseState({ phase: "publishing", mapping: liveMapping })).toBe("publishing");
  });

  test("surfaces needs_review when finalize requires warning acknowledgement", () => {
    expect(deriveReleaseState({ phase: "finalized", decision: "needs_review", mapping: liveMapping })).toBe(
      "needs_review"
    );
  });
});

describe("release action helpers", () => {
  test("labels revision confirmation for changed local Pages", () => {
    expect(confirmPublishLabel(liveMapping, "changed_locally")).toBe("Publish new revision");
    expect(confirmPublishLabel(undefined, "not_on_pages")).toBe("Publish to Masthead Pages");
  });

  test("allows publication replay only when a staged publish digest and idempotency key remain", () => {
    expect(
      canRetryPendingPublication({
        status: "none",
        pendingOperationKind: "publish",
        pendingRequestDigest: "sha256-digest",
        pendingIdempotencyKey: "idem-timeout"
      })
    ).toBe(true);
    expect(canRetryPendingPublication(liveMapping)).toBe(false);
  });

  test("allows removal replay after timeout when staged remove remains", () => {
    expect(
      canRetryPendingRemoval({
        status: "live",
        pageId: "page-1",
        pendingOperationKind: "remove",
        pendingRequestDigest: "sha256-remove",
        pendingIdempotencyKey: "idem-remove"
      })
    ).toBe(true);
    expect(canRemoveFromPages(liveMapping)).toBe(true);
    expect(canRemoveFromPages({ status: "removed", pageId: "page-1" })).toBe(false);
  });

  test("parent conflict display requires refresh rather than blind overwrite", () => {
    const display = parentConflictDisplay(
      "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    expect(display.message).toBe(PARENT_CONFLICT_COPY);
    expect(display.currentObjectId).toMatch(/^sha256-/);
  });

  test("honest removal copy never claims erasure of copies", () => {
    expect(REMOVAL_HONEST_COPY).toMatch(/cannot be recalled/i);
    expect(REMOVAL_HONEST_COPY.toLowerCase()).toContain("downloaded");
    expect(REMOVAL_HONEST_COPY.toLowerCase()).toContain("cached");
    expect(REMOVAL_HONEST_COPY.toLowerCase()).not.toContain("permanently erased everywhere");
  });
});
