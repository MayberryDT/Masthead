#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rehearsalRoot = mkdtempSync(join(tmpdir(), "masthead-production-activation-rehearsal-"));
try {
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/electron/__tests__/productionLauncher.test.ts",
    "-t",
    "process-death activation journal|real SIGKILL activation|same crash-safe lifecycle lease|cleans the copied candidate|resumes finalization|another staged receipt"
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MASTHEAD_PRODUCTION_REHEARSAL_ROOT: rehearsalRoot },
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(rehearsalRoot, { force: true, recursive: true });
}
