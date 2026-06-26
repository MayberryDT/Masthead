import { classifyDaemonHealth, type MastheadHealthDto } from "../../shared/protocol";
import { eventsRequestUrl, normalizeDaemonBaseUrl, projectionRequestUrl } from "../liveProjectionClient";
import { MastheadApiError } from "./MastheadApiError";

export class MastheadApiClient {
  readonly baseUrl: string;

  constructor(inputUrl: string) {
    this.baseUrl = normalizeDaemonBaseUrl(inputUrl);
  }

  url(pathname: string): URL {
    const url = new URL(this.baseUrl);
    url.pathname = pathname;
    url.search = "";
    return url;
  }

  projectionUrl(selectedSessionId?: string | null): string {
    return projectionRequestUrl(this.baseUrl, selectedSessionId);
  }

  async getHealth(signal?: AbortSignal): Promise<MastheadHealthDto> {
    const url = this.url("/health").toString();
    const value = await this.getJson(url, signal);
    const compatibility = classifyDaemonHealth(value);
    if (compatibility.state !== "compatible") {
      throw MastheadApiError.incompatible(compatibility, url);
    }
    return value as MastheadHealthDto;
  }

  async getLiveProjection(selectedSessionId?: string | null, signal?: AbortSignal): Promise<unknown> {
    await this.getHealth(signal);
    return this.getJson(this.projectionUrl(selectedSessionId), signal);
  }

  async getLiveEvents(signal?: AbortSignal): Promise<unknown> {
    await this.getHealth(signal);
    return this.getJson(eventsRequestUrl(this.baseUrl), signal);
  }

  async getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal });
    if (!response.ok) throw MastheadApiError.http(url, response.status);
    return response.json() as Promise<unknown>;
  }
}
