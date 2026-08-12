import type {
  CreatePublicLogbookRequestV1,
  LogbookVisibility,
  PageLicense,
  PublicLogbookSummaryV1,
  PublisherAccountV1
} from "../../mastheadPages/types.ts";
import type { CoverPreview } from "../../electron/mastheadPagesCover.ts";

export type PublicLogbookFormState = {
  title: string;
  slug: string;
  description: string;
  visibility: LogbookVisibility;
  defaultLicense: PageLicense;
  companionUrl: string;
};

export type CoverUploadRequest = {
  publicLogbookId: string;
  selectionId: string;
};

export type MastheadPagesLogbookRemote = {
  createPublicLogbook: (input: CreatePublicLogbookRequestV1) => Promise<PublicLogbookSummaryV1>;
  uploadCover: (input: CoverUploadRequest) => Promise<{ coverVersion: string }>;
};

export type MastheadPagesCoverChooser = () => Promise<
  CoverPreview | { canceled: true } | { error: string }
>;

export type MastheadPagesControllerOptions = {
  remoteClient: MastheadPagesLogbookRemote;
  chooseCoverFile: MastheadPagesCoverChooser;
  clearCoverSelection?: (selectionId?: string) => Promise<void> | void;
  account?: Pick<PublisherAccountV1, "defaultLogbookVisibility"> | null;
};

const LICENSE_CHOICES: PageLicense[] = ["all-rights-reserved", "cc-by-4.0"];

export function createDefaultPublicLogbookForm(
  account?: Pick<PublisherAccountV1, "defaultLogbookVisibility"> | null
): PublicLogbookFormState {
  return {
    title: "",
    slug: "",
    description: "",
    visibility: account?.defaultLogbookVisibility ?? "discoverable",
    defaultLicense: "all-rights-reserved",
    companionUrl: ""
  };
}

export function publicLogbookLicenseChoices(): readonly PageLicense[] {
  return LICENSE_CHOICES;
}

export function unlistedVisibilityWarning(visibility: LogbookVisibility): string | null {
  if (visibility !== "unlisted") return null;
  return "Unlisted is not private. Anyone with the URL can read and redistribute this Public Logbook.";
}

export function validateCompanionUrl(raw: string): { ok: true; value?: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return { ok: false, reason: "companion_url_https_required" };
    if (url.username || url.password) return { ok: false, reason: "companion_url_credentials_forbidden" };
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, reason: "companion_url_invalid" };
  }
}

export function buildCreatePublicLogbookRequest(
  form: PublicLogbookFormState
): { ok: true; value: CreatePublicLogbookRequestV1 } | { ok: false; reason: string } {
  const title = form.title.trim();
  const slug = form.slug.trim();
  const description = form.description.trim();
  if (!title) return { ok: false, reason: "title_required" };
  if (!slug) return { ok: false, reason: "slug_required" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false, reason: "slug_invalid" };
  if (!LICENSE_CHOICES.includes(form.defaultLicense)) return { ok: false, reason: "license_invalid" };
  if (form.visibility !== "discoverable" && form.visibility !== "unlisted") {
    return { ok: false, reason: "visibility_invalid" };
  }
  const companion = validateCompanionUrl(form.companionUrl);
  if (!companion.ok) return companion;

  const request: CreatePublicLogbookRequestV1 = {
    protocolVersion: "masthead-pages-logbook-v1",
    title,
    slug,
    description,
    visibility: form.visibility,
    defaultLicense: form.defaultLicense
  };
  if (companion.value) request.companionUrl = companion.value;
  return { ok: true, value: request };
}

export function createMastheadPagesController(options: MastheadPagesControllerOptions) {
  let form = createDefaultPublicLogbookForm(options.account);
  let cover: CoverPreview | null = null;
  let busy = false;

  return {
    getForm(): PublicLogbookFormState {
      return { ...form };
    },
    setForm(patch: Partial<PublicLogbookFormState>): void {
      form = { ...form, ...patch };
    },
    getCover(): CoverPreview | null {
      return cover;
    },
    getBusy(): boolean {
      return busy;
    },
    licenseChoices: publicLogbookLicenseChoices(),
    unlistedWarning(): string | null {
      return unlistedVisibilityWarning(form.visibility);
    },
    hasRepositoryField: false as const,

    async chooseCover(_fileHandle?: unknown): Promise<CoverPreview | null> {
      const result = await options.chooseCoverFile();
      if ("canceled" in result) return cover;
      if ("error" in result) throw new Error(result.error);
      if (cover?.selectionId) await options.clearCoverSelection?.(cover.selectionId);
      cover = result;
      return cover;
    },

    async clearCover(): Promise<void> {
      if (cover?.selectionId) await options.clearCoverSelection?.(cover.selectionId);
      cover = null;
    },

    async confirmCreateLogbook(): Promise<PublicLogbookSummaryV1> {
      if (busy) throw new Error("create_in_progress");
      const built = buildCreatePublicLogbookRequest(form);
      if (!built.ok) throw new Error(built.reason);

      // Cover must never upload before the publisher confirms the full Public Logbook settings.
      const pendingCover = cover;
      busy = true;
      try {
        const created = await options.remoteClient.createPublicLogbook(built.value);
        if (pendingCover) {
          await options.remoteClient.uploadCover({
            publicLogbookId: created.id,
            selectionId: pendingCover.selectionId
          });
          cover = null;
        }
        return created;
      } finally {
        busy = false;
      }
    }
  };
}

export type MastheadPagesController = ReturnType<typeof createMastheadPagesController>;
