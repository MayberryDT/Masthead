import type { DaemonCompatibility } from "../../shared/protocol";

export type MastheadApiErrorKind = "http" | "incompatible" | "malformed" | "offline" | "read_only";

export class MastheadApiError extends Error {
  readonly kind: MastheadApiErrorKind;
  readonly status?: number;
  readonly url?: string;
  readonly compatibility?: DaemonCompatibility;

  constructor(
    kind: MastheadApiErrorKind,
    message: string,
    options: { status?: number; url?: string; compatibility?: DaemonCompatibility } = {}
  ) {
    super(message);
    this.name = "MastheadApiError";
    this.kind = kind;
    this.status = options.status;
    this.url = options.url;
    this.compatibility = options.compatibility;
  }

  static http(url: string, status: number): MastheadApiError {
    return new MastheadApiError("http", `${url} returned ${status}`, { status, url });
  }

  static incompatible(compatibility: DaemonCompatibility, url: string): MastheadApiError {
    const reason = "reason" in compatibility ? compatibility.reason : compatibility.state;
    return new MastheadApiError("incompatible", `Masthead daemon is not compatible: ${reason}`, {
      compatibility,
      url
    });
  }
}
