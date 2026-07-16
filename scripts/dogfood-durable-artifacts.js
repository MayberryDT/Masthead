#!/usr/bin/env node

import { runDurableArtifactCorpus } from "../dist/daemon/src/workbench/authoring/durableArtifactCorpusAcceptance.js";

try {
  const report = await runDurableArtifactCorpus();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.machineGatePassed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    reportVersion: "durable-artifact-gate-v1",
    machineGatePassed: false,
    failures: ["harness_error"],
    error: error instanceof Error ? error.message : String(error),
    productionAccessed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
