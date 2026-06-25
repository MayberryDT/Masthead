export type MastheadApiErrorKind = "http" | "incompatible" | "malformed";

export class MastheadApiError extends Error {
  readonly kind: MastheadApiErrorKind;
  readonly status?: number;

  constructor(kind: MastheadApiErrorKind, message: string, options: { status?: number } = {}) {
    super(message);
    this.name = "MastheadApiError";
    this.kind = kind;
    this.status = options.status;
  }
}
