import { expect, test } from "vitest";
import { buildWorkbenchHandoff } from "../workbenchHandoff";

test("keeps the V5 clipboard handoff to the request id and instance-bound bootstrap command", () => {
  const text = buildWorkbenchHandoff({
    capabilities: {
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
    },
    request: {
      handoff: {
        requestId: "authoring-v5-request:one",
        startCommand: "/opt/masthead/bin/mastheadctl workbench author bootstrap --request 'authoring-v5-request:one' --json"
      },
      nextAction: {
        command: "/opt/masthead/bin/mastheadctl workbench author start --request 'authoring-v5-request:one' --json",
        kind: "start",
        reason: "Start or resume the next fixed pack."
      },
      request: { requestId: "authoring-v5-request:one" }
    }
  } as never);

  expect(text).toBe(
    "Masthead authoring request: authoring-v5-request:one\n" +
    "Start: /opt/masthead/bin/mastheadctl workbench author bootstrap --request 'authoring-v5-request:one' --json"
  );
  expect(text).not.toContain("sessionIds");
  expect(text).not.toContain("guided authoring");
  expect(text).not.toContain("claimSupport");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
  expect(text.split("\n")).toHaveLength(2);
});
