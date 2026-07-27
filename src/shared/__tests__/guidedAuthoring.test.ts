import { describe, expect, test } from "vitest";
import {
  GUIDED_AUTHORING_IDENTITY_HEADERS,
  GUIDED_AUTHORING_OPERATIONS,
  isGuidedAuthoringCapabilitiesDto
} from "../guidedAuthoring";

const capabilities = () => ({
  capability: "artifact_authoring",
  protocol: "masthead.workbench.authoring/v1",
  bundleVersion: "workbench-authoring-v4",
  policyVersion: "guided-authoring-v1",
  command: "/state/masthead/bin/mastheadctl",
  baseUrl: "http://127.0.0.1:17373",
  databaseId: "database:test",
  buildSha: "build:test",
  instanceManifest: "/state/masthead/masthead-instance.json",
  instanceId: "instance:test",
  maxSessionsPerAssignment: 12,
  canarySessions: 3,
  operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
});

describe("guided authoring capabilities", () => {
  test("enforces the instance-bound V5 command", () => {
    const v5 = {
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
    expect(isGuidedAuthoringCapabilitiesDto(v5, { expectedCommand: v5.command })).toBe(true);
    expect(isGuidedAuthoringCapabilitiesDto(v5, { expectedCommand: "/wrong/mastheadctl" })).toBe(false);
  });

  test("publishes one canonical ordered operation contract", () => {
    expect(GUIDED_AUTHORING_OPERATIONS).toEqual(["start", "inspect", "scaffold", "save", "review", "finish"]);
    expect(isGuidedAuthoringCapabilitiesDto(capabilities(), {
      expectedCommand: "/state/masthead/bin/mastheadctl"
    })).toBe(true);
  });

  test.each([
    ["legacy bundle", { bundleVersion: "workbench-authoring-v3" }],
    ["wrong policy", { policyVersion: "guided-authoring-v2" }],
    ["reordered operations", { operations: ["inspect", "start", "scaffold", "save", "review", "finish"] }],
    ["missing scaffold operation", { operations: ["start", "inspect", "save", "review", "finish"] }],
    ["extra operation", { operations: ["start", "inspect", "scaffold", "save", "review", "finish", "open"] }],
    ["relative command", { command: "mastheadctl" }],
    ["noncanonical base URL", { baseUrl: "http://127.0.0.1:17373/" }],
    ["whitespace-wrapped manifest", { instanceManifest: " /state/masthead/masthead-instance.json " }],
    ["noncanonical manifest", { instanceManifest: "/state/masthead/../masthead/masthead-instance.json" }],
    ["wrong assignment bound", { maxSessionsPerAssignment: 11 }],
    ["wrong canary bound", { canarySessions: 2 }]
  ])("rejects %s", (_label, change) => {
    expect(isGuidedAuthoringCapabilitiesDto({ ...capabilities(), ...change })).toBe(false);
  });

  test("centralizes the five canonical inspect identity header names", () => {
    expect(GUIDED_AUTHORING_IDENTITY_HEADERS).toEqual({
      baseUrl: "x-masthead-authoring-base-url",
      databaseId: "x-masthead-authoring-database-id",
      buildSha: "x-masthead-authoring-build-sha",
      instanceManifest: "x-masthead-authoring-instance-manifest",
      instanceId: "x-masthead-authoring-instance-id"
    });
  });
});
