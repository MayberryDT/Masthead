// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildCreatePublicLogbookRequest,
  createDefaultPublicLogbookForm,
  createMastheadPagesController,
  publicLogbookLicenseChoices,
  unlistedVisibilityWarning,
  validateCompanionUrl
} from "../../../app/mastheadPages/publicLogbookController";
import type { CoverPreview } from "../../../electron/mastheadPagesCover";
import type { PublicLogbookSummaryV1 } from "../../../mastheadPages/types";
import { PublicLogbookDialog } from "../PublicLogbookDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

const createdLogbook: PublicLogbookSummaryV1 = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerAccountId: "22222222-2222-4222-8222-222222222222",
  title: "Field Notes",
  slug: "field-notes",
  description: "Notes",
  visibility: "discoverable",
  defaultLicense: "all-rights-reserved"
};

function coverPreview(overrides: Partial<CoverPreview> = {}): CoverPreview {
  return {
    selectionId: "33333333-3333-4333-8333-333333333333",
    contentType: "image/png",
    byteLength: 128,
    previewDataUrl: "data:image/png;base64,aaa",
    ...overrides
  };
}

describe("Public Logbook creation defaults and cover consent", () => {
  test("defaults visibility to discoverable and offers exactly two licenses", () => {
    expect(createDefaultPublicLogbookForm(null).visibility).toBe("discoverable");
    expect(createDefaultPublicLogbookForm({ defaultLogbookVisibility: "unlisted" }).visibility).toBe(
      "unlisted"
    );
    expect(publicLogbookLicenseChoices()).toEqual(["all-rights-reserved", "cc-by-4.0"]);
    expect(unlistedVisibilityWarning("discoverable")).toBeNull();
    expect(unlistedVisibilityWarning("unlisted")).toMatch(/not private/i);
  });

  test("accepts HTTPS companion links only", () => {
    expect(validateCompanionUrl("")).toEqual({ ok: true, value: undefined });
    expect(validateCompanionUrl("https://example.com/launch").ok).toBe(true);
    expect(validateCompanionUrl("http://example.com")).toMatchObject({ ok: false });
    expect(validateCompanionUrl("https://user:pass@example.com")).toMatchObject({ ok: false });
  });

  test("create request omits empty companion and never includes repository fields", () => {
    const built = buildCreatePublicLogbookRequest({
      title: "Field Notes",
      slug: "field-notes",
      description: "Notes",
      visibility: "discoverable",
      defaultLicense: "cc-by-4.0",
      companionUrl: "  "
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toEqual({
      protocolVersion: "masthead-pages-logbook-v1",
      title: "Field Notes",
      slug: "field-notes",
      description: "Notes",
      visibility: "discoverable",
      defaultLicense: "cc-by-4.0"
    });
    expect(built.value).not.toHaveProperty("repository");
    expect(built.value).not.toHaveProperty("project");
    expect(built.value).not.toHaveProperty("path");
  });

  test("does not upload an unconfirmed cover selection", async () => {
    const remoteClient = {
      createPublicLogbook: vi.fn(async () => createdLogbook),
      uploadCover: vi.fn(async () => ({ coverVersion: "abc" }))
    };
    const fileHandle = coverPreview();
    const controller = createMastheadPagesController({
      remoteClient,
      chooseCoverFile: async () => fileHandle,
      account: { defaultLogbookVisibility: "discoverable" }
    });
    controller.setForm({
      title: "Field Notes",
      slug: "field-notes",
      description: "Notes",
      visibility: "discoverable",
      defaultLicense: "all-rights-reserved",
      companionUrl: ""
    });

    await controller.chooseCover(fileHandle);
    expect(remoteClient.uploadCover).not.toHaveBeenCalled();
    expect(remoteClient.createPublicLogbook).not.toHaveBeenCalled();

    await controller.confirmCreateLogbook();
    expect(remoteClient.createPublicLogbook).toHaveBeenCalledTimes(1);
    expect(remoteClient.uploadCover).toHaveBeenCalledTimes(1);
    expect(remoteClient.uploadCover).toHaveBeenCalledWith({
      publicLogbookId: createdLogbook.id,
      selectionId: fileHandle.selectionId
    });
  });

  test("cancellation clears pending cover without uploading", async () => {
    const remoteClient = {
      createPublicLogbook: vi.fn(async () => createdLogbook),
      uploadCover: vi.fn(async () => ({ coverVersion: "abc" }))
    };
    const clearCoverSelection = vi.fn(async () => undefined);
    const controller = createMastheadPagesController({
      remoteClient,
      chooseCoverFile: async () => coverPreview(),
      clearCoverSelection
    });
    await controller.chooseCover();
    await controller.clearCover();
    expect(clearCoverSelection).toHaveBeenCalled();
    expect(remoteClient.uploadCover).not.toHaveBeenCalled();
    expect(controller.getCover()).toBeNull();
  });

  test("dialog has no repository field and shows unlisted warning plus exact cover preview", async () => {
    const remoteClient = {
      createPublicLogbook: vi.fn(async () => createdLogbook),
      uploadCover: vi.fn(async () => ({ coverVersion: "abc" }))
    };
    const preview = coverPreview({
      previewDataUrl: "data:image/png;base64,exactpreview"
    });
    const controller = createMastheadPagesController({
      remoteClient,
      chooseCoverFile: async () => preview,
      account: { defaultLogbookVisibility: "discoverable" }
    });
    controller.setForm({
      title: "Field Notes",
      slug: "field-notes",
      description: "Notes",
      visibility: "unlisted",
      defaultLicense: "all-rights-reserved",
      companionUrl: "https://example.com"
    });
    await controller.chooseCover();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PublicLogbookDialog controller={controller} onCancel={() => undefined} open />
      );
    });

    const html = container.innerHTML;
    expect(html).not.toMatch(/name="repository"|data-testid=".*repository|project path|git remote/i);
    expect(container.querySelector('input[name="repository"], select[name="repository"], [data-testid="public-logbook-repository"]')).toBeNull();
    expect(controller.hasRepositoryField).toBe(false);
    expect(container.querySelector('[data-testid="public-logbook-unlisted-warning"]')?.textContent).toMatch(
      /not private/i
    );
    const img = container.querySelector(
      '[data-testid="public-logbook-cover-preview"]'
    ) as HTMLImageElement | null;
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,exactpreview");
    expect(container.querySelectorAll('input[name="public-logbook-default-license"]')).toHaveLength(2);
  });
});
