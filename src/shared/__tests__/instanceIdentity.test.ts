import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GuidedAuthoringIdentityError,
  assertGuidedAuthoringExpectedIdentity,
  assertStableGuidedRequestBinding,
  canonicalInstancePaths,
  acquireMastheadInstanceManifestGuard,
  identityFromCapabilities,
  removeOwnedMastheadInstanceManifest,
  writeMastheadInstanceManifestAtomic,
  type GuidedAuthoringExpectedIdentity
} from "../instanceIdentity";

const identity = (instanceId = "instance:current"): GuidedAuthoringExpectedIdentity => ({
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  databaseId: "database:test",
  instanceId,
  instanceManifest: "/state/masthead/masthead-instance.json"
});

describe("Masthead instance identity", () => {
  test("extracts current identity from V4 capabilities", () => {
    expect(identityFromCapabilities({
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
    })).toEqual(identity("instance:test"));
  });

  test("resolves canonical per-instance manifest and launcher paths", () => {
    expect(canonicalInstancePaths("/state/masthead-production", "linux")).toEqual({
      instanceDir: "/state/masthead-production",
      instanceManifest: "/state/masthead-production/masthead-instance.json",
      launcherPath: "/state/masthead-production/bin/mastheadctl"
    });
    expect(canonicalInstancePaths("C:\\state\\masthead-dev", "win32")).toEqual({
      instanceDir: "C:\\state\\masthead-dev",
      instanceManifest: "C:\\state\\masthead-dev\\masthead-instance.json",
      launcherPath: "C:\\state\\masthead-dev\\bin\\mastheadctl.cmd"
    });
  });

  test.each([
    ["baseUrl", "base_url_identity_mismatch"],
    ["databaseId", "database_identity_mismatch"],
    ["buildSha", "build_identity_mismatch"],
    ["instanceManifest", "manifest_identity_mismatch"],
    ["instanceId", "instance_identity_mismatch"]
  ] as const)("rejects a mismatched %s", (field, code) => {
    const expected = identity();
    const actual = {
      ...expected,
      [field]: field === "baseUrl" ? "http://127.0.0.1:17374" : `${expected[field]}:other`
    };
    expect(() => assertGuidedAuthoringExpectedIdentity(actual, expected)).toThrow(
      expect.objectContaining({ code })
    );
  });

  test("allows a new daemon nonce only when the persisted request binding is otherwise stable", () => {
    const request = {
      ...identity("instance:old"),
      creationInstanceId: "instance:old"
    };
    expect(() => assertStableGuidedRequestBinding(request, identity("instance:new"))).not.toThrow();
    expect(request.creationInstanceId).toBe("instance:old");
  });

  test("rejects a stable request binding when a durable field changes", () => {
    expect(() => assertStableGuidedRequestBinding({
      ...identity("instance:old"),
      creationInstanceId: "instance:old"
    }, {
      ...identity("instance:new"),
      databaseId: "database:other"
    })).toThrow(expect.objectContaining({ code: "database_identity_mismatch" }));
  });

  test("removes only the manifest owned by the closing daemon nonce", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-instance-cleanup-"));
    const path = join(instanceDir, "masthead-instance.json");
    try {
      await writeMastheadInstanceManifestAtomic(path, {
        schemaVersion: 1,
        instanceId: "instance:new",
        baseUrl: "http://127.0.0.1:17373",
        databaseId: "database:test",
        buildSha: "build:test",
        pid: 12345,
        instanceDir,
        updatedAt: new Date().toISOString()
      });
      await expect(removeOwnedMastheadInstanceManifest(path, "instance:old")).resolves.toBe(false);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ instanceId: "instance:new" });
      await expect(removeOwnedMastheadInstanceManifest(path, "instance:new")).resolves.toBe(true);
    } finally {
      await rm(instanceDir, { force: true, recursive: true });
    }
  });

  test("holds an exclusive manifest writer guard through owned cleanup and recovers a stale owner", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-instance-guard-"));
    try {
      const old = await acquireMastheadInstanceManifestGuard({
        instanceDir,
        instanceId: "instance:old",
        pid: 100,
        startedAt: "2026-07-19T12:00:00.000Z",
        isProcessAlive: () => true
      });
      const manifestPath = join(instanceDir, "masthead-instance.json");
      await writeMastheadInstanceManifestAtomic(manifestPath, {
        schemaVersion: 1,
        instanceId: "instance:old",
        baseUrl: "http://127.0.0.1:17373",
        databaseId: "database:test",
        buildSha: "build:test",
        pid: 100,
        instanceDir,
        updatedAt: "2026-07-19T12:00:00.000Z"
      });
      await expect(acquireMastheadInstanceManifestGuard({
        instanceDir,
        instanceId: "instance:new",
        pid: 200,
        startedAt: "2026-07-19T12:01:00.000Z",
        isProcessAlive: () => true
      })).rejects.toThrow("instance_manifest_writer_active");
      await removeOwnedMastheadInstanceManifest(manifestPath, "instance:old");
      await old.release();
      const replacement = await acquireMastheadInstanceManifestGuard({
        instanceDir,
        instanceId: "instance:new",
        pid: 200,
        startedAt: "2026-07-19T12:01:00.000Z",
        isProcessAlive: () => false
      });
      await replacement.release();
      const recovered = await acquireMastheadInstanceManifestGuard({
        instanceDir,
        instanceId: "instance:recovered",
        pid: 400,
        startedAt: "2026-07-19T12:02:00.000Z",
        isProcessAlive: () => false
      });
      await recovered.release();
    } finally {
      await rm(instanceDir, { force: true, recursive: true });
    }
  });

  test("allows only one contender to recover a stale manifest writer guard", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-instance-guard-race-"));
    try {
      const stale = await acquireMastheadInstanceManifestGuard({
        instanceDir,
        instanceId: "instance:stale",
        pid: 300,
        startedAt: "2026-07-19T11:00:00.000Z",
        isProcessAlive: () => false
      });
      await stale.release();
      const contenders = await Promise.allSettled([
        acquireMastheadInstanceManifestGuard({
          instanceDir,
          instanceId: "instance:first",
          pid: 400,
          startedAt: "2026-07-19T12:02:00.000Z",
          isProcessAlive: (pid) => pid !== 300
        }),
        acquireMastheadInstanceManifestGuard({
          instanceDir,
          instanceId: "instance:second",
          pid: 500,
          startedAt: "2026-07-19T12:02:00.000Z",
          isProcessAlive: (pid) => pid !== 300
        })
      ]);
      const winners = contenders.filter((result) => result.status === "fulfilled");
      const losers = contenders.filter((result) => result.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as PromiseRejectedResult).reason).toHaveProperty("message", expect.stringContaining("instance_manifest_writer_active"));
      await (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireMastheadInstanceManifestGuard>>>).value.release();
    } finally {
      await rm(instanceDir, { force: true, recursive: true });
    }
  });
});
