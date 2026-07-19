import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GuidedAuthoringIdentityError,
  assertGuidedAuthoringExpectedIdentity,
  assertStableGuidedRequestBinding,
  canonicalInstancePaths,
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
});
