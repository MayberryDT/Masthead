import type { RuntimeKind, SessionAdapter } from "./types.ts";
import { cursorAdapter } from "./cursor/adapter.ts";
import { claudeCodeAdapter } from "./claudeCode/adapter.ts";
import { opencodeAdapter } from "./opencode/adapter.ts";
import { grokAdapter } from "./grok/adapter.ts";
import { hermesAdapter } from "./hermes/adapter.ts";
import { piAdapter } from "./pi/adapter.ts";
import { ompAdapter } from "./omp/adapter.ts";
import { createDetectorAdapter } from "./generic/detectorAdapter.ts";
import { codexAdapter } from "./codex/adapter.ts";
import { canImportHarness, scanTargetHarnesses } from "./harnessCatalog.ts";

export const sessionAdapters: SessionAdapter[] = [
  codexAdapter,
  cursorAdapter,
  claudeCodeAdapter,
  opencodeAdapter,
  grokAdapter,
  hermesAdapter,
  piAdapter,
  ompAdapter
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
