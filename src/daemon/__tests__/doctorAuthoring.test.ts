import { describe, expect, test } from "vitest";
// @ts-expect-error Doctor is a runtime JavaScript entrypoint with exported pure contract helpers.
import { inspectAuthoringCapabilities, inspectInstanceManifestIdentity, resolveAuthoringCommand } from "../../../scripts/masthead-doctor.js";

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

  test("requires a complete manifest that agrees with health and the instance launcher", () => {
    const instanceDir = "/state/masthead";
    const health = {
      buildSha: "build-1",
      data: { dataDirectory: instanceDir, databaseId: "database-1" },
      runtime: {
        authoringCommand: `${instanceDir}/bin/mastheadctl`,
        baseUrl: "http://127.0.0.1:17373",
        daemonInstanceId: "instance-1",
        instanceDir,
        instanceManifest: `${instanceDir}/masthead-instance.json`,
        pid: 12345
      }
    };
    const manifest = {
      schemaVersion: 1,
      instanceId: "instance-1",
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database-1",
      buildSha: "build-1",
      pid: 12345,
      instanceDir,
      updatedAt: "2026-07-19T12:00:00.000Z"
    };
    expect(inspectInstanceManifestIdentity(manifest, health, health.runtime.baseUrl)).toMatchObject({ ok: true, problems: [] });
    const mismatches = [
      [{ ...manifest, schemaVersion: 2 }, health, health.runtime.baseUrl, "manifest schema version mismatch"],
      [{ ...manifest, updatedAt: "not-a-time" }, health, health.runtime.baseUrl, "manifest timestamp is invalid"],
      [{ ...manifest, pid: 999 }, health, health.runtime.baseUrl, "manifest PID mismatch"],
      [{ ...manifest, instanceDir: "/state/other" }, health, health.runtime.baseUrl, "manifest instance directory mismatch"],
      [manifest, { ...health, runtime: { ...health.runtime, instanceManifest: "/state/other/masthead-instance.json" } }, health.runtime.baseUrl, "manifest path identity mismatch"],
      [manifest, { ...health, runtime: { ...health.runtime, authoringCommand: "/state/other/bin/mastheadctl" } }, health.runtime.baseUrl, "authoring command identity mismatch"],
      [manifest, health, "http://127.0.0.1:17374", "base URL identity mismatch"],
      [{ ...manifest, databaseId: "database-2" }, health, health.runtime.baseUrl, "databaseId identity mismatch"],
      [{ ...manifest, buildSha: "build-2" }, health, health.runtime.baseUrl, "buildSha identity mismatch"],
      [{ ...manifest, instanceId: "instance-2" }, health, health.runtime.baseUrl, "instance ID mismatch"]
    ] as const;
    for (const [changedManifest, changedHealth, expectedBaseUrl, problem] of mismatches) {
      expect(inspectInstanceManifestIdentity(changedManifest, changedHealth, expectedBaseUrl)).toMatchObject({ ok: false });
      expect(inspectInstanceManifestIdentity(changedManifest, changedHealth, expectedBaseUrl).problems).toContain(problem);
    }
  });
});
