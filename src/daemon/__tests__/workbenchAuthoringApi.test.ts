import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { WorkbenchAuthoringBundle } from "../../shared/workbenchAuthoring.ts";
import type { DaemonConfig } from "../config.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { getOrCreateDatabaseIdentity } from "../db/schema.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import {
  getWorkbenchAuthoringBodyLimit,
  isWorkbenchAuthoringPath,
  routeWorkbenchAuthoringRequest
} from "../workbenchAuthoringApi.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench authoring HTTP API", () => {
  test("runs the complete daemon-owned authoring lifecycle", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:a");

    const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
    expect(capabilities.body).toMatchObject({
      bundleVersion: "workbench-authoring-v1",
      capability: "artifact_authoring",
      command: expect.any(String),
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      evidencePolicy: "all_canonical_redacted_evidence",
      operations: ["open", "status", "evidence", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      transport: "daemon_http"
    });
    const injected = await routeWorkbenchAuthoringRequest(
      { authoringCommand: "/opt/masthead/bin/mastheadctl", db: daemon.database },
      {
        method: "GET",
        url: new URL("http://127.0.0.1/workbench/authoring/capabilities")
      }
    );
    expect(injected?.body).toMatchObject({ command: "/opt/masthead/bin/mastheadctl" });

    const opened = await postJson(
      baseUrl,
      "/workbench/authoring/runs",
      {
        actorId: "codex",
        databaseId: capabilities.body.databaseId,
        sessionIds: ["session:a"]
      },
      201
    );
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ ok: true, run: { sessionIds: ["session:a"], status: "open" } });
    const runId = opened.body.run.runId as string;

    const status = await getJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}`);
    expect(status.body).toMatchObject({ evidenceStatus: "current", ok: true, run: { runId } });

    const evidence = await getJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence?sessionId=session%3Aa&order=desc&limit=25`
    );
    expect(evidence.body).toMatchObject({ evidenceRevision: opened.body.run.evidenceRevision, sessionId: "session:a" });
    expect(evidence.body.items.length).toBeGreaterThan(0);

    const submitted = await postJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`,
      validBundle(runId, opened.body.run.evidenceRevision, "session:a")
    );
    expect(submitted).toMatchObject({ status: 200, body: { accepted: true, ok: true, run: { status: "ready_to_finish" } } });

    const finished = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {});
    expect(finished).toMatchObject({
      status: 200,
      body: { ok: true, receipt: { resolvedSessionIds: ["session:a"], runId } }
    });

    const retried = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {});
    expect(retried.body.receipt).toEqual(finished.body.receipt);
  });

  test("keeps deterministic revision findings in a successful domain response", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:revision");
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);
    const opened = await postJson(
      baseUrl,
      "/workbench/authoring/runs",
      { actorId: "codex", databaseId, sessionIds: ["session:revision"] },
      201
    );
    const runId = opened.body.run.runId as string;

    const submitted = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`, {
      artifacts: [],
      bundleVersion: "workbench-authoring-v1",
      contributions: [],
      evidenceRevision: opened.body.run.evidenceRevision,
      notApplicable: [],
      padding: "x".repeat(1_100_000),
      runId,
      sessionPackages: []
    });

    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ accepted: false, ok: true, run: { status: "needs_revision" } });
    expect(submitted.body.findings.length).toBeGreaterThan(0);
  });

  test("maps malformed, missing, identity, and state failures to transport statuses", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:errors");

    expect((await postJson(baseUrl, "/workbench/authoring/runs", {}, 400)).body).toMatchObject({
      ok: false,
      error: { code: "invalid_request" }
    });
    expect((await postRaw(baseUrl, "/workbench/authoring/runs", "{", 400)).body).toMatchObject({
      ok: false,
      error: { code: "invalid_json" }
    });
    expect(
      (
        await postJson(
          baseUrl,
          "/workbench/authoring/runs",
          { actorId: "codex", databaseId: "wrong", sessionIds: ["session:errors"] },
          409
        )
      ).body
    ).toMatchObject({ ok: false, error: { code: "database_identity_mismatch" } });
    expect(
      (
        await postJson(
          baseUrl,
          "/workbench/authoring/runs",
          { actorId: "codex", databaseId: getOrCreateDatabaseIdentity(daemon.database), sessionIds: ["session:missing"] },
          404
        )
      ).body
    ).toMatchObject({ ok: false, error: { code: "session_not_found" } });
    expect((await getJson(baseUrl, "/workbench/authoring/runs/missing", 404)).body).toMatchObject({
      ok: false,
      error: { code: "authoring_run_not_found" }
    });

    const databaseId = getOrCreateDatabaseIdentity(daemon.database);
    const opened = await postJson(
      baseUrl,
      "/workbench/authoring/runs",
      { actorId: "codex", databaseId, sessionIds: ["session:errors"] },
      201
    );
    expect(
      (
        await postJson(
          baseUrl,
          `/workbench/authoring/runs/${encodeURIComponent(opened.body.run.runId)}/finish`,
          {},
          409
        )
      ).body
    ).toMatchObject({ ok: false, error: { code: "authoring_run_not_ready" } });

    seedAuthoringSession(daemon, "session:no-evidence");
    for (const table of ["messages", "tool_results", "tool_calls", "file_effects"]) {
      daemon.database.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run("session:no-evidence");
    }
    expect(
      (
        await postJson(
          baseUrl,
          "/workbench/authoring/runs",
          { actorId: "codex", databaseId, sessionIds: ["session:no-evidence"] },
          409
        )
      ).body
    ).toMatchObject({ ok: false, error: { code: "missing_canonical_evidence" } });
  });

  test("matches only authoring routes and gives submit a five MiB body budget", () => {
    expect(isWorkbenchAuthoringPath("/workbench/authoring/capabilities")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/runs")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/runs/run%3A1/evidence")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/sessions")).toBe(false);
    expect(getWorkbenchAuthoringBodyLimit("/workbench/authoring/runs/run%3A1/submit", 1024)).toBe(5 * 1024 * 1024);
    expect(getWorkbenchAuthoringBodyLimit("/workbench/authoring/runs", 1024)).toBe(1024);
  });
});

async function startTestDaemon(): Promise<{ baseUrl: string; daemon: MastheadDaemon }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-authoring-api-"));
  tempDirs.push(tempDir);
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    backgroundHydrationEnabled: false,
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson")
  } satisfies DaemonConfig);
  daemons.push(daemon);
  const baseUrl = await new Promise<string>((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(daemon.server.address() as AddressInfo).port}`);
    });
  });
  return { baseUrl, daemon };
}

function seedAuthoringSession(daemon: MastheadDaemon, sessionId: string): void {
  seedSession(daemon.database, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: `Authoring ${sessionId}`
  });
}

function validBundle(runId: string, evidenceRevision: string, sessionId: string): WorkbenchAuthoringBundle {
  const evidenceRef = `message:${sessionId}:message`;
  const missingEvidence = ["Only one user-authored message is available for this session."];
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: (["runbook", "adr", "incident_timeline"] as const).map((kind) => ({
      evidenceRefs: [evidenceRef],
      kind,
      reason: "The reviewed session evidence does not support this optional artifact kind.",
      sessionId
    })),
    runId,
    sessionPackages: [
      {
        dossier: {
          approach: ["Inspect the complete canonical redacted evidence."],
          claimEvidence: [
            { evidenceRefs: [evidenceRef], path: "keyDecisions[0]" },
            { evidenceRefs: [evidenceRef], path: "outcome" },
            { evidenceRefs: [evidenceRef], path: "verification[0]" }
          ],
          commandsAndTools: [],
          confidence: "low",
          context: "A daemon-owned authoring run selected this canonical session.",
          evidenceRefs: [evidenceRef],
          filesTouched: [],
          keyDecisions: ["Keep authoring grounded in canonical redacted evidence."],
          lessonsLearned: ["Sparse evidence must remain explicit."],
          missingEvidence,
          outcome: "The daemon accepted and published a grounded session package.",
          problemStatement: "Exercise the daemon-owned authoring boundary.",
          risksOrGaps: ["Only sparse message coverage is available."],
          title: "Exercise daemon-owned authoring",
          verification: ["The HTTP lifecycle contract passed."]
        },
        enrichment: {
          claimEvidence: [{ evidenceRefs: [evidenceRef], path: "summary" }],
          confidence: "low",
          evidenceRefs: [evidenceRef],
          missingEvidence,
          searchPhrases: ["daemon-owned authoring"],
          summary: "The daemon validated a complete grounded authoring bundle.",
          technologies: ["TypeScript", "SQLite"],
          title: "Exercise daemon-owned authoring",
          topics: ["Workbench", "artifact authoring"]
        },
        sessionId
      }
    ]
  };
}

async function getJson(baseUrl: string, path: string, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(expectedStatus);
  return { body: (await response.json()) as any, status: response.status };
}

async function postJson(baseUrl: string, path: string, body: unknown = {}, expectedStatus = 200) {
  return postRaw(baseUrl, path, JSON.stringify(body), expectedStatus);
}

async function postRaw(baseUrl: string, path: string, body: string, expectedStatus: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    body,
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(expectedStatus);
  return { body: (await response.json()) as any, status: response.status };
}
