import type { RuntimeKind, SessionAdapter } from "./types.ts";
import { codexAdapter } from "./codex/adapter.ts";
import { cursorAdapter } from "./cursor/adapter.ts";
import { claudeCodeAdapter } from "./claudeCode/adapter.ts";
import { antigravityAdapter } from "./antigravity/adapter.ts";
import { opencodeAdapter } from "./opencode/adapter.ts";
import { aiderAdapter } from "./aider/adapter.ts";
import { openclawAdapter } from "./openclaw/adapter.ts";
import { hermesAdapter } from "./hermes/adapter.ts";
import { piAdapter } from "./pi/adapter.ts";
import { createDetectorAdapter } from "./generic/detectorAdapter.ts";
import { canImportHarness, scanTargetHarnesses } from "./harnessCatalog.ts";

export const sessionAdapters: SessionAdapter[] = [
  codexAdapter,
  cursorAdapter,
  claudeCodeAdapter,
  antigravityAdapter,
  opencodeAdapter,
  aiderAdapter,
  openclawAdapter,
  hermesAdapter,
  piAdapter
];

export const detectorAdapters: SessionAdapter[] = scanTargetHarnesses().filter((harness) => !canImportHarness(harness)).map(createDetectorAdapter);

export const scanAdapters: SessionAdapter[] = requiredScanRuntimes()
  .map((runtime) => adapterForRuntime(runtime) ?? detectorAdapters.find((adapter) => adapter.runtime === runtime))
  .filter((adapter): adapter is SessionAdapter => Boolean(adapter));

export function adapterForRuntime(runtime: RuntimeKind): SessionAdapter | undefined {
  return sessionAdapters.find((adapter) => adapter.runtime === runtime);
}

export function requiredScanRuntimes(): RuntimeKind[] {
  return scanTargetHarnesses().map((entry) => entry.runtime);
}
