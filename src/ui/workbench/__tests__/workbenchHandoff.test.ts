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

test("includes critical all-packs obligation at the top of the handoff", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: baseRequest as never
  });

  expect(text.startsWith("CRITICAL OBLIGATION:")).toBe(true);
  expect(text).toContain("finish EVERY pack");
  expect(text).toContain("Stopping after 1 pack, 6 packs, or any partial count is a failure");
  expect(text).toContain('progress.packsCompleted === progress.packsTotal');
  expect(text).toContain("Never write a final answer until nextAction.kind is complete");
  expect(text).toContain("authoring-v5-request:one");
  expect(text).not.toContain("sessionIds");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
});

test("adds opaque scope counts and pack ownership when available", () => {
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

  expect(text).toContain("Scope: 25 sessions in 3 fixed packs (daemon-owned). You own all 3 packs.");
  expect(text).toContain("This request has 3 packs covering 25 sessions — all of them.");
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
  expect(text).toContain("multiple fixed packs — all of them");
});

test("handoff encodes verification grounding and durable milestones", () => {
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
  expect(text).toContain("Immediately claim and run the next pack");
  expect(text).not.toContain("sessionIds");
});
