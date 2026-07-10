import { describe, expect, test } from "vitest";
// @ts-expect-error Doctor is a runtime JavaScript entrypoint with exported pure contract helpers.
import { inspectAuthoringCapabilities, resolveAuthoringCommand } from "../../../scripts/masthead-doctor.js";

describe("Doctor authoring checks", () => {
  test("requires the complete authoring contract and the health database identity", () => {
    const valid = {
      bundleVersion: "workbench-authoring-v1",
      capability: "artifact_authoring",
      command: "/opt/masthead/bin/mastheadctl",
      databaseId: "database-1",
      evidencePolicy: "all_canonical_redacted_evidence",
      operations: ["open", "status", "evidence", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      transport: "daemon_http"
    };

    expect(inspectAuthoringCapabilities(valid, "database-1")).toEqual({
      command: "/opt/masthead/bin/mastheadctl",
      databaseId: "database-1",
      ok: true,
      operations: ["open", "status", "evidence", "submit", "finish"],
      problems: []
    });
    expect(inspectAuthoringCapabilities({ ...valid, databaseId: "database-2", operations: ["open"] }, "database-1")).toMatchObject({
      ok: false,
      problems: ["database identity mismatch", "authoring operations are incomplete"]
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
