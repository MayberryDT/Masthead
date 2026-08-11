import type { SourceLinkV1 } from "./types.ts";

const MAX_SOURCE_LINKS = 10;
const MAX_LABEL_CHARS = 100;

export type SourceLinkValidationError = {
  code:
    | "source_link_limit_exceeded"
    | "source_link_label_invalid"
    | "source_link_https_required"
    | "source_link_credentials_forbidden"
    | "source_link_url_invalid"
    | "source_link_rel_invalid";
  message: string;
  index: number;
};

export class InvalidSourceLinkError extends Error {
  readonly code: SourceLinkValidationError["code"];
  readonly index: number;

  constructor(error: SourceLinkValidationError) {
    super(error.message);
    this.name = "InvalidSourceLinkError";
    this.code = error.code;
    this.index = error.index;
  }
}

export function validateSourceLinks(links: readonly SourceLinkV1[]): SourceLinkV1[] {
  if (links.length > MAX_SOURCE_LINKS) {
    throw new InvalidSourceLinkError({
      code: "source_link_limit_exceeded",
      message: `At most ${MAX_SOURCE_LINKS} source links are allowed`,
      index: MAX_SOURCE_LINKS,
    });
  }

  return links.map((link, index) => validateSourceLink(link, index));
}

function validateSourceLink(link: SourceLinkV1, index: number): SourceLinkV1 {
  if (link.rel !== "repository" && link.rel !== "commit") {
    throw new InvalidSourceLinkError({
      code: "source_link_rel_invalid",
      message: "source link rel must be repository or commit",
      index,
    });
  }

  const label = link.label.trim();
  if (!label || label.length > MAX_LABEL_CHARS) {
    throw new InvalidSourceLinkError({
      code: "source_link_label_invalid",
      message: "source link label must be 1-100 characters",
      index,
    });
  }

  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    throw new InvalidSourceLinkError({
      code: "source_link_url_invalid",
      message: "source link url is not a valid URL",
      index,
    });
  }

  if (url.protocol !== "https:") {
    throw new InvalidSourceLinkError({
      code: "source_link_https_required",
      message: "source link url must use https",
      index,
    });
  }

  if (url.username || url.password) {
    throw new InvalidSourceLinkError({
      code: "source_link_credentials_forbidden",
      message: "source link url must not include credentials",
      index,
    });
  }

  return {
    rel: link.rel,
    label,
    url: url.href,
  };
}
