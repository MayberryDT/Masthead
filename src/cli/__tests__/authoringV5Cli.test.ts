import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WORKBENCH_AUTHORING_V5_SAVE_BODY_LIMIT_BYTES } from "../../shared/workbenchAuthoringV5.ts";
import { runMastheadCli } from "../mastheadctl.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("mastheadctl workbench-authoring-v5", () => {
  test.each([
    ["review", ["review", "--assignment", "assignment:legacy"]],
    ["assignment inspect", ["inspect", "--assignment", "assignment:legacy"]],
    ["legacy request start", ["start", "--request", "request:legacy"]]
  ])("retires the %s mutation before network access", async (_label, args) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runMastheadCli(["workbench", "author", ...args, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "authoring_contract_retired" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("routes bootstrap, claim, inspect, scaffold, save, finish, status, and receipt", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-cli-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    const command = join(instanceDir, "bin", "mastheadctl");
    const identity = {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest
    };
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: identity.instanceId,
      baseUrl: identity.baseUrl,
      databaseId: identity.databaseId,
      buildSha: identity.buildSha,
      pid: 12345,
      instanceDir,
      updatedAt: "2026-07-22T12:00:00.000Z"
    }));
    const requestId = "authoring-v5-request:test";
    const packId = "authoring-v5-pack:test";
    const scaffoldFile = join(instanceDir, "pack.json");
    const requests: Array<{ method: string; pathname: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: String(init?.method), pathname: url.pathname });
      if (url.pathname === "/workbench/authoring/capabilities") {
        return response({
          ...identity,
          bundleVersion: "workbench-authoring-v5",
          capability: "artifact_authoring",
          command,
          maximumSessionsPerPack: 12,
          minimumSessionsPerPack: 5,
          operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
          policyVersion: "workbench-authoring-v5",
          protocol: "masthead.workbench.authoring/v1"
        });
      }
      if (url.pathname.endsWith("/receipt")) {
        return response({ requestId, status: "completed", receipt: { requestId } });
      }
      if (url.pathname.endsWith("/scaffold")) {
        return response({
          packId,
          draft: {
            bundleVersion: "workbench-authoring-v5",
            packId,
            evidenceRevision: "sha256:test",
            sessions: [],
            optionalConsiderations: [],
            optionalArtifacts: []
          },
          nextAction: { kind: "save", reason: "Save.", command: `${command} workbench author save --pack '${packId}' --file '${packId}.json' --json` }
        });
      }
      return response({ nextAction: { kind: "complete", reason: "Done.", command: "" } });
    }));

    const env = { MASTHEAD_INSTANCE_MANIFEST: instanceManifest };
    for (const args of [
      ["bootstrap", "--request", requestId],
      ["claim", "--request", requestId],
      ["inspect", "--pack", packId],
      ["scaffold", "--pack", packId, "--file", scaffoldFile],
      ["save", "--pack", packId, "--file", scaffoldFile],
      ["finish", "--pack", packId],
      ["status", "--request", requestId],
      ["receipt", "--request", requestId]
    ]) {
      const result = await runMastheadCli(["workbench", "author", ...args, "--json"], { env });
      expect(result.exitCode, `${args[0]}: ${result.stderr}`).toBe(0);
    }

    expect(JSON.parse(await readFile(scaffoldFile, "utf8"))).toMatchObject({ bundleVersion: "workbench-authoring-v5", packId });
    expect(requests.filter(({ pathname }) => pathname !== "/workbench/authoring/capabilities")).toEqual([
      { method: "GET", pathname: `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/bootstrap` },
      { method: "POST", pathname: `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/start` },
      { method: "GET", pathname: `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/inspect` },
      { method: "GET", pathname: `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/scaffold` },
      { method: "POST", pathname: `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/draft` },
      { method: "POST", pathname: `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/finish` },
      { method: "GET", pathname: `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}` },
      { method: "GET", pathname: `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/receipt` }
    ]);
  });

  test("saves a small authored projection when the local scaffold exceeds the V5 HTTP limit", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-large-cli-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    const command = join(instanceDir, "bin", "mastheadctl");
    const packId = "authoring-v5-pack:large";
    const scaffoldFile = join(instanceDir, "large-pack.json");
    const identity = {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest
    };
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: identity.instanceId,
      baseUrl: identity.baseUrl,
      databaseId: identity.databaseId,
      buildSha: identity.buildSha,
      pid: 12345,
      instanceDir,
      updatedAt: "2026-07-22T12:00:00.000Z"
    }));
    const evidenceRef = "message:huge:0";
    const draft = {
      bundleVersion: "workbench-authoring-v5",
      packId,
      evidenceRevision: "sha256:large",
      sessions: Array.from({ length: 12 }, (_, index) => {
        const ref = `message:huge:${index}`;
        return {
          sessionId: `session:large:${index}`,
          fields: {
            decisions: [],
            description: "",
            evidenceRefs: { description: [], keyWork: [], outcome: [], purpose: [], title: [], verification: [] },
            keyWork: [],
            keywords: [],
            outcome: "",
            purpose: "",
            title: "",
            verification: { status: "unknown", summary: "" }
          },
          evidenceCatalog: [{
            id: ref,
            itemId: ref,
            kind: "message",
            observedAt: "2026-07-22T12:00:00.000Z",
            role: "user",
            source: "canonical",
            text: index === 0 ? "e".repeat(5 * 1024 * 1024 + 64 * 1024) : `Evidence ${index}`
          }]
        };
      }),
      optionalConsiderations: [],
      optionalArtifacts: []
    };
    let saveBody = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/workbench/authoring/capabilities") {
        return response({
          ...identity,
          bundleVersion: "workbench-authoring-v5",
          capability: "artifact_authoring",
          command,
          maximumSessionsPerPack: 12,
          minimumSessionsPerPack: 5,
          operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
          policyVersion: "workbench-authoring-v5",
          protocol: "masthead.workbench.authoring/v1"
        });
      }
      if (url.pathname.endsWith("/scaffold")) {
        return response({
          packId,
          draft,
          nextAction: { kind: "save", reason: "Save.", command: `${command} workbench author save --pack '${packId}' --file '${packId}.json' --json` }
        });
      }
      if (url.pathname.endsWith("/draft")) {
        saveBody = String(init?.body ?? "");
        if (Buffer.byteLength(saveBody) > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({
            error: { code: "request_body_too_large", message: "Request body exceeds 5242880 bytes." },
            ok: false
          }), { headers: { "content-type": "application/json" }, status: 400 });
        }
        return response({ nextAction: { kind: "finish", reason: "Finish.", command: "" } });
      }
      throw new Error(`unexpected_request:${url.pathname}`);
    }));

    const env = { MASTHEAD_INSTANCE_MANIFEST: instanceManifest };
    const scaffoldResult = await runMastheadCli([
      "workbench", "author", "scaffold", "--pack", packId, "--file", scaffoldFile, "--json"
    ], { env });
    expect(scaffoldResult.exitCode).toBe(0);
    const scaffoldBytes = Buffer.byteLength(await readFile(scaffoldFile));
    expect(scaffoldBytes).toBeGreaterThan(5 * 1024 * 1024);

    const authored = JSON.parse(await readFile(scaffoldFile, "utf8"));
    authored.sessions.forEach((session: any, index: number) => {
      const ref = `message:huge:${index}`;
      session.fields = {
        decisions: [],
        description: `Fixed the OAuth callback for session ${index + 1} while retaining signed state validation.`,
        evidenceRefs: {
          description: [ref], keyWork: [ref], outcome: [ref],
          purpose: [ref], title: [ref], verification: [ref]
        },
        keyWork: ["Updated and tested the callback handler."],
        keywords: ["oauth", "callback", "signed-state"],
        outcome: "Authenticated users can complete the callback safely.",
        purpose: "Repair the OAuth callback.",
        title: `Repair OAuth callback state handling ${index + 1}`,
        verification: { status: "passed", summary: "The callback regression test passed." }
      };
    });
    authored.optionalConsiderations = [{
      decision: "no",
      evidenceRef,
      kind: "runbook",
      reason: "The evidence covers a one-off callback repair rather than a reusable operating procedure."
    }];
    await writeFile(scaffoldFile, `${JSON.stringify(authored, null, 2)}\n`);

    const saveResult = await runMastheadCli([
      "workbench", "author", "save", "--pack", packId, "--file", scaffoldFile, "--json"
    ], { env });

    expect(saveResult.exitCode, saveResult.stderr).toBe(0);
    expect(Buffer.byteLength(saveBody)).toBeLessThan(WORKBENCH_AUTHORING_V5_SAVE_BODY_LIMIT_BYTES);
    expect((JSON.parse(saveBody) as any).draft.sessions[0]).not.toHaveProperty("evidenceCatalog");
  });

  test("returns the stable bundle error when a same-version scaffold has no sessions", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-invalid-cli-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    const draftFile = join(instanceDir, "invalid-pack.json");
    const identity = {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest
    };
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      ...identity,
      pid: 12345,
      instanceDir,
      updatedAt: "2026-07-22T12:00:00.000Z"
    }));
    await writeFile(draftFile, JSON.stringify({ bundleVersion: "workbench-authoring-v5" }));
    vi.stubGlobal("fetch", vi.fn(async () => response({
      ...identity,
      bundleVersion: "workbench-authoring-v5",
      capability: "artifact_authoring",
      command: join(instanceDir, "bin", "mastheadctl"),
      maximumSessionsPerPack: 12,
      minimumSessionsPerPack: 5,
      operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
      policyVersion: "workbench-authoring-v5",
      protocol: "masthead.workbench.authoring/v1"
    })));

    const result = await runMastheadCli([
      "workbench", "author", "save", "--pack", "authoring-v5-pack:invalid", "--file", draftFile, "--json"
    ], { env: { MASTHEAD_INSTANCE_MANIFEST: instanceManifest } });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "invalid_workbench_authoring_v5_bundle" } });
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status: 200 });
}
