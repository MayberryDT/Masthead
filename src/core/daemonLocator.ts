import { classifyDaemonHealth, type DaemonCompatibility, type MastheadHealthDto } from "../shared/protocol.ts";

export type CompatibleDaemon = {
  baseUrl: string;
  compatibility: Extract<DaemonCompatibility, { state: "compatible" }>;
  health: MastheadHealthDto;
};

export type DaemonLocation =
  | CompatibleDaemon
  | {
      baseUrl: string;
      compatibility: Exclude<DaemonCompatibility, { state: "compatible" }>;
      health: Record<string, unknown> | undefined;
      state: "incompatible";
    };

export async function locateCompatibleDaemon(
  baseUrl: string,
  getHealth: (baseUrl: string) => Promise<Record<string, unknown> | undefined>
): Promise<DaemonLocation> {
  const health = await getHealth(baseUrl);
  const compatibility = classifyDaemonHealth(health);
  if (compatibility.state === "compatible") {
    return { baseUrl, compatibility, health: health as MastheadHealthDto };
  }
  return { baseUrl, compatibility, health, state: "incompatible" };
}
