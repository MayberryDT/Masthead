// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { REMOVAL_HONEST_COPY } from "../../../mastheadPages/releaseState";
import { MastheadPagesReleaseActions } from "../MastheadPagesReleaseActions";

describe("MastheadPagesReleaseActions", () => {
  test("shows changed_locally status and Publish new revision", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesReleaseActions
        releaseState="changed_locally"
        canPublish
        friendlyUrl="https://masthead.page/u/demo/notes/page"
        exactUrl="https://masthead.page/r/old-object"
        onPublish={() => undefined}
      />
    );
    expect(html).toContain("Changed locally");
    expect(html).toContain("Publish new revision");
    expect(html).toContain("https://masthead.page/u/demo/notes/page");
    expect(html).toContain("https://masthead.page/r/old-object");
  });

  test("preserves old exact URL alongside friendly URL after a live release", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesReleaseActions
        releaseState="live"
        friendlyUrl="https://masthead.page/u/demo/notes/page"
        exactUrl="https://masthead.page/r/previous"
      />
    );
    expect(html).toContain("Exact revision");
    expect(html).toContain("https://masthead.page/r/previous");
  });

  test("displays parent conflict object id without offering blind overwrite", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesReleaseActions
        releaseState="failed"
        parentConflictObjectId="sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        lastError="parent-conflict"
      />
    );
    expect(html).toContain("Parent conflict");
    expect(html).toContain("sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    expect(html).toContain("do not blind overwrite");
    expect(html).not.toContain("Force publish");
  });

  test("offers retry publication and honest removal confirmation copy", () => {
    const onRetry = vi.fn();
    const retryHtml = renderToStaticMarkup(
      <MastheadPagesReleaseActions
        releaseState="failed"
        canRetryPublish
        onRetryPublish={onRetry}
        canRemove
        onRemove={() => undefined}
      />
    );
    expect(retryHtml).toContain("Retry publication");
    expect(retryHtml).toContain("Remove from Masthead Pages");

    const removalHtml = renderToStaticMarkup(
      <MastheadPagesReleaseActions
        releaseState="live"
        showRemovalWarning
        onConfirmRemove={() => undefined}
        onCancelRemove={() => undefined}
      />
    );
    expect(removalHtml).toContain(REMOVAL_HONEST_COPY);
    expect(removalHtml).toContain("Confirm remove from Masthead Pages");
    expect(removalHtml.toLowerCase()).not.toContain("erased from every device");
  });

  test("offers retry removal after staged withdrawal timeout", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesReleaseActions releaseState="failed" canRetryRemove onRetryRemove={() => undefined} />
    );
    expect(html).toContain("Retry removal");
  });
});
