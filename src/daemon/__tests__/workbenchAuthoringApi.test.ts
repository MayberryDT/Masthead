import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV3
} from "../../shared/workbenchAuthoring.ts";
import type { DaemonConfig } from "../config.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { getOrCreateDatabaseIdentity } from "../db/schema.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import {
  openAgentLedAuthoringRun,
  openAuthoringRun
} from "../../workbench/authoring/authoringService.ts";
import {
  seedDurableArtifactCorpus
} from "../../workbench/authoring/__fixtures__/durableArtifactCorpus.ts";
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
  test("advertises V3 capabilities and preserves historical run reads", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:a");

    const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
    expect(capabilities.body).toMatchObject({
      bundleVersion: "workbench-authoring-v3",
      capability: "artifact_authoring",
      command: expect.any(String),
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      evidencePolicy: "selected_session_canonical_evidence",
      maxSessionsPerRun: 12,
      operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
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
    const blankCommand = await routeWorkbenchAuthoringRequest(
      { authoringCommand: "   ", db: daemon.database },
      {
        method: "GET",
        url: new URL("http://127.0.0.1/workbench/authoring/capabilities")
      }
    );
    expect(blankCommand?.body).toMatchObject({ command: "mastheadctl" });
    const previousCommand = process.env.MASTHEAD_CLI_COMMAND;
    process.env.MASTHEAD_CLI_COMMAND = "   ";
    try {
      expect((await getJson(baseUrl, "/workbench/authoring/capabilities")).body).toMatchObject({
        command: "mastheadctl"
      });
    } finally {
      if (previousCommand === undefined) delete process.env.MASTHEAD_CLI_COMMAND;
      else process.env.MASTHEAD_CLI_COMMAND = previousCommand;
    }

    const opened = openLegacyRun(daemon, "session:a", "codex");
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
      validBundle(runId, opened.body.run.evidenceRevision, "session:a"),
      409
    );
    expect(submitted.body).toMatchObject({ error: { code: "authoring_contract_audit_only" }, ok: false });

    const finished = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {}, 409);
    expect(finished.body).toMatchObject({ error: { code: "authoring_contract_audit_only" }, ok: false });
  });

  test("exposes advisory suggestions and canonical context for selected sessions", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedDurableArtifactCorpus(daemon.database);
    const sessionIds = ["session:oauth-fixed", "session:migration-fixed"];
    const normalizedSessionIds = [...sessionIds].sort();

    const suggestions = await postJson(baseUrl, "/workbench/authoring/suggestions", { sessionIds });
    expect(suggestions.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ advisory: true })])
    );

    const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds
    }, 201);
    expect(opened.body.run).toMatchObject({
      contractVersion: "workbench-authoring-v3",
      sessionIds: normalizedSessionIds
    });
    expect(opened.body.run).not.toHaveProperty("candidateId");

    const context = await getJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(opened.body.run.runId)}/context`
    );
    expect(context.body).toMatchObject({
      evidenceRevision: opened.body.run.evidenceRevision,
      ok: true,
      runId: opened.body.run.runId,
      sessions: normalizedSessionIds.map((sessionId) => ({ sessionId })),
      suggestions: expect.arrayContaining([expect.objectContaining({ advisory: true })])
    });
    expect(context.body.sessions.every((entry: any) => entry.dossier)).toBe(true);
  });

  test("submits and finishes a V3 selection through HTTP", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:v3");
    const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds: ["session:v3"]
    }, 201);
    const runId = opened.body.run.runId as string;
    const bundle = validV3Bundle(runId, opened.body.run.evidenceRevision, "session:v3");

    const submitted = await postJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`,
      bundle
    );
    expect(submitted.body).toMatchObject({ accepted: true, ok: true, run: { status: "ready_to_finish" } });

    const finished = await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`);
    expect(finished.body).toMatchObject({
      ok: true,
      receipt: {
        contractVersion: "workbench-authoring-v3",
        optionalArtifacts: [],
        resolvedSessionIds: ["session:v3"],
        runId
      }
    });
    expect((await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`)).body)
      .toEqual(finished.body);
  });

  test("refuses to finish a raw session without current agent enrichment", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:raw-finish");
    const opened = await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds: ["session:raw-finish"]
    }, 201);
    const runId = opened.body.run.runId as string;
    const bundle = validV3Bundle(runId, opened.body.run.evidenceRevision, "session:raw-finish");
    await postJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`, bundle);

    daemon.database
      .prepare("UPDATE workbench_authoring_runs SET bundle_json = ? WHERE run_id = ?")
      .run(JSON.stringify({ ...bundle, sessionEnrichments: [] }), runId);

    const finished = await postJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`,
      {},
      409
    );
    expect(finished.body.error.code).toBe("session_enrichment_required");

    const logbook = await getJson(baseUrl, "/logbook/artifacts?q=raw%20finish");
    expect(logbook.body.artifacts).toHaveLength(0);
  });

  test("rejects candidate-based and oversized V3 run opens", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:a");
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);

    expect((await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      candidateId: "candidate:legacy",
      databaseId,
      sessionIds: ["session:a"]
    }, 400)).body).toMatchObject({ error: { code: "candidate_id_not_allowed" }, ok: false });

    expect((await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      databaseId,
      sessionIds: Array.from({ length: 13 }, (_, index) => `session:${index}`)
    }, 400)).body).toMatchObject({ error: { code: "authoring_session_count_invalid" }, ok: false });

    expect((await postJson(baseUrl, "/workbench/authoring/runs", {
      actorId: "agent:test",
      databaseId,
      sessionIds: Array.from({ length: 13 }, () => "session:a")
    }, 400)).body).toMatchObject({ error: { code: "authoring_session_count_invalid" }, ok: false });
  });

  test("keeps historical submissions audit-only", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:revision");
    const opened = openLegacyRun(daemon, "session:revision", "codex");
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
    }, 409);

    expect(submitted.body).toMatchObject({ error: { code: "authoring_contract_audit_only" }, ok: false });
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
    const opened = openLegacyRun(daemon, "session:errors", "codex");
    expect(
      (
        await postJson(
          baseUrl,
          `/workbench/authoring/runs/${encodeURIComponent(opened.body.run.runId)}/finish`,
          {},
          409
        )
      ).body
    ).toMatchObject({ ok: false, error: { code: "authoring_contract_audit_only" } });

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
    expect(isWorkbenchAuthoringPath("/workbench/authoring/suggestions")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/runs")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/runs/run%3A1/evidence")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/runs/run%3A1/context")).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/candidates")).toBe(false);
    expect(isWorkbenchAuthoringPath("/workbench/sessions")).toBe(false);
    expect(getWorkbenchAuthoringBodyLimit("/workbench/authoring/runs/run%3A1/submit", 1024)).toBe(5 * 1024 * 1024);
    expect(getWorkbenchAuthoringBodyLimit("/workbench/authoring/runs", 1024)).toBe(1024);
  });

  test("returns structured body-limit errors without destroying the response socket", async () => {
    const { baseUrl } = await startTestDaemon();

    const oversizedOpen = await postChunked(
      baseUrl,
      "/workbench/authoring/runs",
      ["{\"padding\":\"", "x".repeat(1_048_576), "\"}"],
      400
    );
    expect(oversizedOpen.body).toEqual({
      error: {
        code: "request_body_too_large",
        message: "Request body exceeds 1048576 bytes."
      },
      ok: false
    });

    const oversizedSubmit = await postRaw(
      baseUrl,
      "/workbench/authoring/runs/missing/submit",
      JSON.stringify({ padding: "x".repeat(5 * 1024 * 1024) }),
      400
    );
    expect(oversizedSubmit.body).toEqual({
      error: {
        code: "request_body_too_large",
        message: "Request body exceeds 5242880 bytes."
      },
      ok: false
    });

    const unrelated = await postRaw(
      baseUrl,
      "/settings/llm-provider",
      JSON.stringify({ padding: "x".repeat(1_048_576) }),
      400
    );
    expect(unrelated.body).toMatchObject({ ok: false, error: "Request body exceeds 1048576 bytes." });
    await getJson(baseUrl, "/health");
  });

  test("returns sanitized 500 responses for corrupted run invariants and unexpected adapter errors", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:corrupted");
    const opened = openAgentLedAuthoringRun(daemon.database, {
      actorId: "codex",
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds: ["session:corrupted"]
    });
    const runId = opened.run.runId;
    daemon.database
      .prepare("UPDATE workbench_authoring_runs SET status = 'ready_to_finish', bundle_json = NULL WHERE run_id = ?")
      .run(runId);

    const corrupted = await postJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`,
      {},
      500
    );
    expect(corrupted.body).toEqual({
      error: { code: "authoring_internal_error", message: "Workbench authoring request failed" },
      ok: false
    });
    expect(JSON.stringify(corrupted.body)).not.toContain("authoring_run_bundle_missing");
    expect(JSON.stringify(corrupted.body)).not.toContain(runId);

    const unexpected = await routeWorkbenchAuthoringRequest(
      {
        authoringCommand: "mastheadctl",
        db: {
          prepare() {
            throw new Error("secret database invariant detail");
          }
        } as unknown as MastheadDatabase
      },
      {
        method: "GET",
        url: new URL("http://127.0.0.1/workbench/authoring/capabilities")
      }
    );
    expect(unexpected).toEqual({
      body: {
        error: { code: "authoring_internal_error", message: "Workbench authoring request failed" },
        ok: false
      },
      status: 500
    });
    expect(JSON.stringify(unexpected)).not.toContain("secret database invariant detail");
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

function openLegacyRun(daemon: MastheadDaemon, sessionId: string, actorId: string) {
  return {
    body: openAuthoringRun(daemon.database, {
      actorId,
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds: [sessionId]
    }),
    status: 201
  };
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

function validV3Bundle(
  runId: string,
  evidenceRevision: string,
  sessionId: string
): WorkbenchAuthoringBundleV3 {
  const evidenceRef = {
    id: `message:${sessionId}:message`,
    kind: "event" as const,
    observedAt: "2026-07-10T12:00:00.000Z",
    source: "canonical"
  };
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision,
    runId,
    sessionEnrichments: [{
      enrichment: {
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], openQuestions: [] },
          decisions: ["Publish only after enrichment is current."],
          evidenceRefs: [evidenceRef],
          keyWork: ["Applied grounded durable enrichment before dossier rendering."],
          outcome: "Published an enriched canonical dossier atomically.",
          verification: {
            commands: [],
            evidenceRefs: [evidenceRef],
            failures: [],
            status: "unknown",
            summary: "Canonical message evidence supports the enrichment."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "low",
          evidenceRefs: [evidenceRef],
          state: "completed",
          text: "Agent-enriched summary grounded in the selected canonical evidence."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "low",
          evidenceRefs: [evidenceRef],
          text: "Agent-enriched title"
        },
        version: "session-capsule-v4"
      },
      sessionId
    }]
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

async function postChunked(baseUrl: string, path: string, chunks: string[], expectedStatus: number) {
  return new Promise<{ body: any; status: number }>((resolve, reject) => {
    const request = httpRequest(
      new URL(path, baseUrl),
      {
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST"
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.once("error", reject);
        response.once("end", () => {
          try {
            expect(response.statusCode).toBe(expectedStatus);
            resolve({ body: JSON.parse(body) as any, status: response.statusCode ?? 0 });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.once("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}
