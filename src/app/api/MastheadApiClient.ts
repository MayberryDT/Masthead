import { classifyDaemonHealth, type MastheadHealthDto } from "../../shared/protocol.ts";
import { eventsRequestUrl, healthRequestUrl, projectionRequestUrl } from "../liveProjectionClient.ts";
import { MastheadApiError } from "./MastheadApiError.ts";

export class MastheadApiClient {
  constructor(private readonly projectionUrl: string) {}

  async getHealth(signal?: AbortSignal): Promise<MastheadHealthDto> {
    const health = await this.getJson(healthRequestUrl(this.projectionUrl), signal);
    const compatibility = classifyDaemonHealth(health);
    if (compatibility.state !== "compatible") {
      throw new MastheadApiError("incompatible", `Masthead daemon is not compatible: ${describeCompatibility(compatibility)}`);
    }
    return health as MastheadHealthDto;
  }

  async getLiveProjection(selectedSessionId?: string | null, signal?: AbortSignal): Promise<unknown> {
    await this.getHealth(signal);
    return this.getJson(projectionRequestUrl(this.projectionUrl, selectedSessionId), signal);
  }

  async getLiveEvents(signal?: AbortSignal): Promise<unknown> {
    await this.getHealth(signal);
    return this.getJson(eventsRequestUrl(this.projectionUrl), signal);
  }

  private async getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal });
    if (!response.ok) {
      throw new MastheadApiError("http", `${url} returned ${response.status}`, { status: response.status });
    }
    return response.json() as Promise<unknown>;
  }
}

function describeCompatibility(value: ReturnType<typeof classifyDaemonHealth>): string {
  if ("reason" in value) return value.reason;
  return value.state;
}
