import { expect, test } from "vitest";
import { buildWorkbenchHandoff } from "../workbenchHandoff";
import type { WorkbenchAuthoringV5CapabilitiesDto } from "../../../shared/workbenchAuthoringV5";

const capabilities: WorkbenchAuthoringV5CapabilitiesDto = {
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  bundleVersion: "workbench-authoring-v5",
  capability: "artifact_authoring",
  command: "/opt/masthead/bin/mastheadctl",
  databaseId: "database:test",
  instanceId: "instance:test",
  instanceManifest: "/tmp/masthead-instance.json",
  maximumSessionsPerPack: 12,
  minimumSessionsPerPack: 5,
  operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
  policyVersion: "workbench-authoring-v5",
  protocol: "masthead.workbench.authoring/v1"
};

const baseRequest = {
  handoff: {
    requestId: "authoring-v5-request:one",
    startCommand:
      "/opt/masthead/bin/mastheadctl workbench author bootstrap --request 'authoring-v5-request:one' --json"
  },
  nextAction: {
    command:
      "/opt/masthead/bin/mastheadctl workbench author start --request 'authoring-v5-request:one' --json",
    kind: "start" as const,
    reason: "Start or resume the next fixed pack."
  },
  request: { requestId: "authoring-v5-request:one" }
};

test("leads with orchestrator role and bans factories before completion rules", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: baseRequest as never
  });

  expect(text.startsWith("ROLE:")).toBe(true);
  expect(text).toContain("ORCHESTRATOR");
  expect(text).toContain("do NOT write dossier field prose yourself");
  expect(text).toContain("sub-agent");
  expect(text).toContain("PURPOSE (for every sub-agent):");
  expect(text).toContain("Logbook session dossiers");
  expect(text).toContain("HOW SUB-AGENTS WRITE:");
  expect(text).toContain("NO FACTORIES:");
  expect(text).toContain("fill scripts");
  expect(text).toContain("ORCHESTRATOR LOOP:");
  expect(text).toContain("COMPLETION:");
  expect(text).toContain("Finish every pack");
  expect(text).toContain("progress.packsCompleted === progress.packsTotal");
  expect(text).toContain("authoring-v5-request:one");
  expect(text).not.toContain("sessionIds");
  expect(text.indexOf("ROLE:")).toBeLessThan(text.indexOf("COMPLETION:"));
  expect(text.indexOf("NO FACTORIES:")).toBeLessThan(text.indexOf("COMPLETION:"));
});

test("adds opaque scope counts and pack orchestration when available", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: {
      ...baseRequest,
      request: {
        requestId: "authoring-v5-request:one",
        sessionCount: 25,
        packCount: 3
      }
    } as never
  });

  expect(text).toContain("Scope: 25 sessions in 3 fixed packs (daemon-owned). You orchestrate all 3 packs via sub-agents");
  expect(text).toContain("This request has 3 packs covering 25 sessions");
  expect(text).not.toContain("sessionIds");
});

test("omits numeric scope line when packCount is unavailable", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: {
      ...baseRequest,
      request: {
        requestId: "authoring-v5-request:one",
        sessionCount: 10
      }
    } as never
  });

  expect(text).not.toMatch(/^Scope:/m);
  expect(text).toContain("multiple fixed packs");
});

test("handoff encodes verification grounding and pack delegation", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: {
      ...baseRequest,
      request: {
        requestId: "authoring-v5-request:one",
        sessionCount: 25,
        packCount: 3
      }
    } as never
  });
  expect(text).toContain("Progress only counts when mastheadctl save/finish succeeds");
  expect(text).toContain('never set status "passed" with empty evidenceRefs.verification');
  expect(text).toContain("carefully author the next pack");
  expect(text).not.toContain("sessionIds");
});
