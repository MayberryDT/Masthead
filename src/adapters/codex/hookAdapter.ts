import { adapterRecordFromLiveHook, liveHookSourceForRuntime } from "../live/hookAdapter.ts";

export const codexHookSource = liveHookSourceForRuntime("codex");

export function adapterRecordFromCodexHook(raw: string, receivedAt: string) {
  return adapterRecordFromLiveHook(raw, receivedAt, "codex");
}
