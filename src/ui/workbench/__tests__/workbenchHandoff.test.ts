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

const STOP_RULE_LINE =
  'Stop rule: Do not stop, end, finish, or hand control back until nextAction.kind is "complete", a request receipt exists, and every pack for this request is done.';
const PACK_LOOP_LINE =
  "Pack finish is not request completion. One pack done is not done. Keep looping nextAction.command (and followUp if present) until all packs complete.";
const MILESTONE_LINE =
  "Progress only counts when mastheadctl save/finish succeeds. Local file edits are not progress.";
const VERIFICATION_LINE =
  'Verification: never set status "passed" with empty evidenceRefs.verification; if no verification evidence, use an honest not-run/boundary claim with refs (empty verification refs hard-reject).';
const LOOP_LINE =
  "After every pack finish, immediately claim and run the next pack. On hard_reject, read findings, fix the pattern, and continue — do not stop early.";

test("includes stop-rule lines so the copied prompt restates full-request obligation", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: baseRequest as never
  });

  expect(text).toBe(
    "Masthead authoring request: authoring-v5-request:one\n" +
      "Start: /opt/masthead/bin/mastheadctl workbench author bootstrap --request 'authoring-v5-request:one' --json\n" +
      `${STOP_RULE_LINE}\n` +
      `${PACK_LOOP_LINE}\n` +
      `${MILESTONE_LINE}\n` +
      `${VERIFICATION_LINE}\n` +
      LOOP_LINE
  );
  expect(text).toContain(STOP_RULE_LINE);
  expect(text).toContain(PACK_LOOP_LINE);
  expect(text).toContain("until all packs complete");
  expect(text).toContain("do not stop early");
  expect(text).not.toContain("sessionIds");
  expect(text).not.toContain("guided authoring");
  expect(text).not.toContain("claimSupport");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
  // request id, start, stop rule, pack-finish, milestone, verification, loop
  expect(text.split("\n")).toHaveLength(7);
  expect(text).not.toMatch(/^Scope:/m);
});

test("adds opaque scope counts when create response already exposes sessionCount and packCount", () => {
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

  expect(text).toContain("Scope: 25 sessions in 3 fixed packs (daemon-owned).");
  // scope sits between pack-finish and milestone lines
  expect(text.split("\n")).toHaveLength(8);
  expect(text).not.toContain("sessionIds");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
});

test("omits scope line when sessionCount or packCount is unavailable", () => {
  const text = buildWorkbenchHandoff({
    capabilities,
    request: {
      ...baseRequest,
      request: {
        requestId: "authoring-v5-request:one",
        sessionCount: 10
        // packCount missing
      }
    } as never
  });

  expect(text).not.toMatch(/^Scope:/m);
  expect(text.split("\n")).toHaveLength(7);
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
  expect(text).toContain("After every pack finish, immediately claim and run the next pack");
  expect(text).toContain("every pack for this request is done");
  expect(text).not.toContain("sessionIds");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
});
