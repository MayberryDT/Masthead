export const WORKBENCH_AUTHORING_V5_STALL_MS = 30 * 60 * 1000;

export function evaluateAuthoringCampaignStall(input: {
  updatedAt: string;
  nowMs: number;
  stallMs?: number;
}): { stalled: boolean; idleMs: number } {
  const updatedMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedMs)) return { stalled: false, idleMs: 0 };
  const idleMs = Math.max(0, input.nowMs - updatedMs);
  const stallMs = input.stallMs ?? WORKBENCH_AUTHORING_V5_STALL_MS;
  return { stalled: idleMs >= stallMs, idleMs };
}
