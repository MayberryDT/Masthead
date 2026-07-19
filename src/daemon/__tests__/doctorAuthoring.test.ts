import { describe, expect, test } from "vitest";
// @ts-expect-error Doctor is a runtime JavaScript entrypoint with exported pure contract helpers.
import { inspectAuthoringCapabilities, resolveAuthoringCommand } from "../../../scripts/masthead-doctor.js";

describe("Doctor authoring checks", () => {
  test("requires the complete authoring contract and the health database identity", () => {
    const valid = {
      bundleVersion: "workbench-authoring-v3",
      capability: "artifact_authoring",
      command: "/opt/masthead/bin/mastheadctl",
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build-1",
      databaseId: "database-1",
      evidencePolicy: "selected_session_canonical_evidence",
      instanceManifest: "/state/masthead/masthead-instance.json",
      instanceId: "instance-1",
      maxSessionsPerRun: 12,
      suggestionsAreBinding: false,
      operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      transport: "daemon_http"
    };

    const expected = {
      baseUrl: valid.baseUrl,
      buildSha: valid.buildSha,
      command: valid.command,
      databaseId: valid.databaseId,
      instanceManifest: valid.instanceManifest,
      instanceId: valid.instanceId
    };
    expect(inspectAuthoringCapabilities(valid, expected)).toEqual({
      command: "/opt/masthead/bin/mastheadctl",
      databaseId: "database-1",
      ok: true,
      identity: {
        baseUrl: valid.baseUrl,
        buildSha: valid.buildSha,
        databaseId: valid.databaseId,
        instanceManifest: valid.instanceManifest,
        instanceId: valid.instanceId
      },
      operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
      problems: []
    });
    expect(inspectAuthoringCapabilities({ ...valid, databaseId: "database-2", operations: ["open"] }, expected)).toMatchObject({
      ok: false,
      problems: ["databaseId identity mismatch", "authoring operations are incomplete"]
    });
  });

  test("accepts an executable absolute command or a bare command found on PATH", async () => {
    const executable = async (path: string) => path === "/opt/masthead/bin/mastheadctl" || path === "/usr/bin/mastheadctl";

    await expect(
      resolveAuthoringCommand("/opt/masthead/bin/mastheadctl", {
        isExecutable: executable,
        pathEntries: ["/usr/bin"]
      })
    ).resolves.toBe("/opt/masthead/bin/mastheadctl");
    await expect(
      resolveAuthoringCommand("mastheadctl", {
        isExecutable: executable,
        pathEntries: ["/missing", "/usr/bin"]
      })
    ).resolves.toBe("/usr/bin/mastheadctl");
    await expect(
      resolveAuthoringCommand("missing", {
        isExecutable: executable,
        pathEntries: ["/usr/bin"]
      })
    ).resolves.toBeUndefined();
  });
});
