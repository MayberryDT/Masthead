import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GUIDED_AUTHORING_IDENTITY_HEADERS } from "../../shared/guidedAuthoring.ts";
import type { GuidedAuthoringBundleV4 } from "../../shared/guidedAuthoring.ts";
import { identityFromManifest } from "../../shared/instanceIdentity.ts";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript.ts";
import type { DaemonConfig } from "../config.ts";
import { markSessionCompileReady, seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { createGuidedAuthoringRequest } from "../db/guidedAuthoringRepository.ts";
import { getOrCreateDatabaseIdentity } from "../db/schema.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { openAuthoringRun } from "../../workbench/authoring/authoringService.ts";
import * as guidedQuality from "../../workbench/authoring/guidedAuthoringQuality.ts";
import * as advisorySuggestions from "../../workbench/authoring/advisorySuggestions.ts";
import {
  getWorkbenchAuthoringBodyLimit,
  isWorkbenchAuthoringPath,
  routeWorkbenchAuthoringRequest
} from "../workbenchAuthoringApi.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench authoring HTTP API", () => {
  test("retires legacy request creation without writing a duplicate V5 state machine", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:legacy-create-retired");
    const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
    const before = totalChanges(daemon.database);

    expect((await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity: authoringIdentity(capabilities.body),
      sessionIds: ["session:legacy-create-retired"]
    }, 409)).body).toMatchObject({ error: { code: "authoring_contract_retired" }, ok: false });
    expect(totalChanges(daemon.database)).toBe(before);
    expect(daemon.database.prepare("SELECT COUNT(*) AS count FROM guided_authoring_requests").get())
      .toEqual({ count: 0 });
    expect(daemon.database.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_v5_requests").get())
      .toEqual({ count: 0 });
  });

  test("keeps V4 guided requests readable while every guided mutation fails closed", async () => {
    const { daemon, tempDir } = await createTestDaemon();
    seedAuthoringSession(daemon, "session:retired-v4");
    const identity = identityFromManifest(daemon.instanceIdentity(), join(tempDir, "masthead-instance.json"));
    const request = createGuidedAuthoringRequest(daemon.database, {
      actorId: "codex",
      assignments: [{
        assignmentId: "assignment:retired-v4:0",
        canary: true,
        evidenceRevision: "evidence:retired-v4:0",
        opportunityIds: [],
        ordinal: 0,
        sessionIds: ["session:retired-v4"]
      }],
      contractVersion: "workbench-authoring-v4",
      identity: {
        baseUrl: identity.baseUrl,
        buildSha: identity.buildSha,
        creationInstanceId: identity.instanceId,
        databaseId: identity.databaseId,
        instanceManifest: identity.instanceManifest
      },
      opportunities: [],
      policyVersion: "guided-authoring-v1",
      requestId: "request:retired-v4",
      sessions: [{ ordinal: 0, sessionId: "session:retired-v4" }]
    });
    const context = {
      authoringCommand: join(tempDir, "bin", "mastheadctl"),
      db: daemon.database,
      identity
    };
    const before = totalChanges(daemon.database);
    const encodedRequest = encodeURIComponent(request.requestId);
    const encodedAssignment = encodeURIComponent(request.currentAssignmentId!);

    expect(await routeWorkbenchAuthoringRequest(context, {
      method: "GET",
      url: new URL(`http://127.0.0.1/workbench/authoring/requests/${encodedRequest}`)
    })).toMatchObject({
      body: { canaryAssignmentId: "assignment:retired-v4:0", contractVersion: "workbench-authoring-v4" },
      status: 200
    });

    const scaffolded = await routeWorkbenchAuthoringRequest(context, {
      method: "GET",
      url: new URL(`http://127.0.0.1/workbench/authoring/assignments/${encodedAssignment}/scaffold`)
    });
    expect(scaffolded).toMatchObject({ status: 200 });
    const draft = (scaffolded?.body as { draft: GuidedAuthoringBundleV4 }).draft;
    const mutations = [
      () => routeWorkbenchAuthoringRequest(context, {
        body: { expectedIdentity: identity },
        method: "POST",
        url: new URL(`http://127.0.0.1/workbench/authoring/requests/${encodedRequest}/start`)
      }),
      () => routeWorkbenchAuthoringRequest(context, {
        headers: authoringHeaders(identity),
        method: "GET",
        url: new URL(`http://127.0.0.1/workbench/authoring/assignments/${encodedAssignment}/inspect`)
      }),
      () => routeWorkbenchAuthoringRequest(context, {
        body: { draft, expectedIdentity: identity },
        method: "POST",
        url: new URL(`http://127.0.0.1/workbench/authoring/assignments/${encodedAssignment}/draft`)
      }),
      () => routeWorkbenchAuthoringRequest(context, {
        body: {
          assignmentId: request.currentAssignmentId,
          decision: "approved",
          draftRevision: 1,
          evidenceRevision: draft.evidenceRevision,
          expectedIdentity: identity,
          notes: "Retired V4 review must not write.",
          reviewedBy: "operator:test"
        },
        method: "POST",
        url: new URL(`http://127.0.0.1/workbench/authoring/requests/${encodedRequest}/canary-decision`)
      }),
      () => routeWorkbenchAuthoringRequest(context, {
        body: { expectedIdentity: identity },
        method: "POST",
        url: new URL(`http://127.0.0.1/workbench/authoring/assignments/${encodedAssignment}/finish`)
      })
    ];
    for (const mutate of mutations) {
      const result = await mutate();
      expect(result).toMatchObject({
        body: { error: { code: "authoring_contract_retired" }, ok: false },
        status: 409
      });
      expect(totalChanges(daemon.database)).toBe(before);
    }
  });

  test("retires every legacy mutation before writes while retaining audit reads", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:audit");
    const opened = openAuthoringRun(daemon.database, {
      actorId: "codex",
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      sessionIds: ["session:audit"]
    });
    const runId = opened.run.runId;
    const before = totalChanges(daemon.database);
    for (const [path, body] of [
      ["/workbench/authoring/suggestions", { sessionIds: ["session:audit"] }],
      ["/workbench/authoring/runs", { actorId: "codex", sessionIds: ["session:audit"] }],
      [`/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`, {}],
      [`/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {}]
    ] as const) {
      expect((await postJson(baseUrl, path, body, 409)).body).toMatchObject({
        error: { code: "authoring_contract_retired" }, ok: false
      });
    }
    expect(totalChanges(daemon.database)).toBe(before);
    expect((await getJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}`)).body)
      .toMatchObject({ run: { runId } });
    expect((await getJson(baseUrl, `/workbench/authoring/runs/${encodeURIComponent(runId)}/context`)).body)
      .toMatchObject({ runId });
    expect((await getJson(
      baseUrl,
      `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence?sessionId=session%3Aaudit`
    )).body).toMatchObject({ sessionId: "session:audit" });
  });

  test("matches every guided route and applies method-aware body limits", () => {
    for (const pathname of [
      "/workbench/authoring/requests",
      "/workbench/authoring/requests/request%3Aone",
      "/workbench/authoring/canaries/pending",
      "/workbench/authoring/requests/request%3Aone/start",
      "/workbench/authoring/assignments/assignment%3Aone/inspect",
      "/workbench/authoring/assignments/assignment%3Aone/scaffold",
      "/workbench/authoring/assignments/assignment%3Aone/draft",
      "/workbench/authoring/assignments/assignment%3Aone/review",
      "/workbench/authoring/requests/request%3Aone/canary-decision",
      "/workbench/authoring/assignments/assignment%3Aone/finish",
      "/workbench/authoring/v5/requests",
      "/workbench/authoring/v5/requests/authoring-v5-request%3Aone/bootstrap",
      "/workbench/authoring/v5/packs/authoring-v5-pack%3Aone/inspect",
      "/workbench/authoring/v5/packs/authoring-v5-pack%3Aone/scaffold",
      "/workbench/authoring/v5/packs/authoring-v5-pack%3Aone/draft",
      "/workbench/authoring/v5/packs/authoring-v5-pack%3Aone/finish"
    ]) expect(isWorkbenchAuthoringPath(pathname)).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/candidates")).toBe(false);
    expect(getWorkbenchAuthoringBodyLimit(
      "/workbench/authoring/assignments/assignment%3Aone/draft", 1024
    )).toBe(5 * 1024 * 1024);
    expect(getWorkbenchAuthoringBodyLimit(
      "/workbench/authoring/v5/packs/authoring-v5-pack%3Aone/draft", 1024
    )).toBe(5 * 1024 * 1024);
    expect(getWorkbenchAuthoringBodyLimit("/workbench/authoring/requests", 1024)).toBe(1024);
  });

  test("maps malformed and oversized guided requests to stable transport errors", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:invalid");
    const identity = authoringIdentity((await getJson(baseUrl, "/workbench/authoring/capabilities")).body);
    expect((await postRaw(baseUrl, "/workbench/authoring/requests", "{", 400)).body)
      .toMatchObject({ error: { code: "invalid_json" }, ok: false });
    expect((await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity: identity,
      sessionIds: ["session:invalid", "session:invalid"]
    }, 409)).body).toMatchObject({ error: { code: "authoring_contract_retired" }, ok: false });
    expect((await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity: { ...identity, instanceManifest: "relative/manifest.json" },
      sessionIds: ["session:invalid"]
    }, 409)).body).toMatchObject({ error: { code: "authoring_contract_retired" }, ok: false });
    expect((await postRaw(
      baseUrl,
      "/workbench/authoring/assignments/missing/draft",
      JSON.stringify({ padding: "x".repeat(5 * 1024 * 1024) }),
      400
    )).body).toMatchObject({ error: { code: "request_body_too_large" }, ok: false });

    const unexpected = await routeWorkbenchAuthoringRequest(
      {
        authoringCommand: "/opt/masthead/bin/mastheadctl",
        identity: {
          baseUrl: "http://127.0.0.1:17373",
          buildSha: "development",
          databaseId: "database:test",
          instanceId: "instance:test",
          instanceManifest: "/tmp/masthead/masthead-instance.json"
        },
        db: { prepare() { throw new Error("secret database invariant detail"); } } as unknown as MastheadDatabase
      },
      { method: "GET", url: new URL("http://127.0.0.1/workbench/authoring/requests/request%3Ainternal-error") }
    );
    expect(unexpected).toEqual({
      body: { error: { code: "authoring_internal_error", message: "Workbench authoring request failed" }, ok: false },
      status: 500
    });
    expect(JSON.stringify(unexpected)).not.toContain("secret database invariant detail");
  });
});

async function createTestDaemon(): Promise<{ daemon: MastheadDaemon; tempDir: string }> {
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
  return { daemon, tempDir };
}

async function startTestDaemon(): Promise<{ baseUrl: string; daemon: MastheadDaemon }> {
  const { daemon } = await createTestDaemon();
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
  markSessionCompileReady(daemon.database, sessionId);
}

function totalChanges(db: MastheadDatabase): number {
  return Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
}

function authoringIdentity(capabilities: any) {
  return {
    baseUrl: capabilities.baseUrl as string,
    buildSha: capabilities.buildSha as string,
    databaseId: capabilities.databaseId as string,
    instanceId: capabilities.instanceId as string,
    instanceManifest: capabilities.instanceManifest as string
  };
}

function authoringHeaders(identity: ReturnType<typeof authoringIdentity>): Record<string, string> {
  return {
    [GUIDED_AUTHORING_IDENTITY_HEADERS.baseUrl]: identity.baseUrl,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.databaseId]: identity.databaseId,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.buildSha]: identity.buildSha,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.instanceManifest]: identity.instanceManifest,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.instanceId]: identity.instanceId
  };
}

function authorGuidedScaffold(
  draft: GuidedAuthoringBundleV4,
  evidence: SessionTranscriptItem
): GuidedAuthoringBundleV4 {
  if (evidence.kind !== "message") throw new Error("expected_seeded_message_evidence");
  const canonicalRef = {
    id: evidence.itemId,
    kind: "event" as const,
    observedAt: evidence.observedAt,
    source: "canonical" as const
  };
  const enrichment = draft.sessionEnrichments[0];
  if (!enrichment) throw new Error("expected_guided_session_scaffold");
  for (const support of enrichment.claimSupport) {
    support.evidenceRef = evidence.itemId;
    support.excerpt = evidence.text;
  }
  enrichment.enrichment.sessionTitle = {
    ...enrichment.enrichment.sessionTitle,
    text: "Author the seeded guided session",
    evidenceRefs: [canonicalRef]
  };
  enrichment.enrichment.sessionSummary = {
    ...enrichment.enrichment.sessionSummary,
    text: "Prepared the seeded guided session for publication.",
    state: "completed",
    evidenceRefs: [canonicalRef]
  };
  enrichment.enrichment.sessionDossier = {
    ...enrichment.enrichment.sessionDossier,
    purpose: "Exercise the exact guided request and publication contract.",
    outcome: "Prepared the seeded guided session for publication.",
    keyWork: ["Inspected the seeded canonical session evidence."],
    warnings: ["Verification not run."],
    evidenceRefs: [canonicalRef],
    verification: {
      ...enrichment.enrichment.sessionDossier.verification,
      status: "unknown",
      summary: "Verification not run.",
      evidenceRefs: [canonicalRef]
    }
  };
  return draft;
}

function validGuidedDraft(input: {
  assignmentId: string;
  evidenceRef: string;
  evidenceRevision: string;
  sessionId: string;
}) {
  const evidence = {
    id: input.evidenceRef,
    kind: "event" as const,
    observedAt: "2026-07-10T12:00:00.000Z",
    source: "canonical" as const
  };
  return {
    artifacts: [],
    assignmentId: input.assignmentId,
    bundleVersion: "workbench-authoring-v4" as const,
    evidenceRevision: input.evidenceRevision,
    opportunityDispositions: [],
    sessionEnrichments: [{
      claimSupport: [{
        evidenceRef: input.evidenceRef,
        excerpt: `Authoring ${input.sessionId}`,
        path: "/sessionTitle/text",
        supportKind: "reuse" as const
      }],
      enrichment: {
        keywords: ["guided authoring", "canonical evidence", "draft preparation"],
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], openQuestions: [] },
          decisions: ["Keep authoring grounded in canonical evidence."],
          evidenceRefs: [evidence],
          keyWork: ["Inspected the complete canonical evidence."],
          outcome: "Prepared a grounded authoring draft.",
          verification: {
            commands: [], evidenceRefs: [evidence], failures: [], status: "unknown" as const,
            summary: "Canonical evidence was inspected."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "low" as const, evidenceRefs: [evidence], state: "completed" as const,
          text: "Prepared a grounded authoring draft from canonical evidence."
        },
        sessionTitle: {
          basis: "dominant_work" as const, confidence: "low" as const, evidenceRefs: [evidence],
          text: "Guided authoring draft"
        },
        version: "session-capsule-v4" as const
      },
      sessionId: input.sessionId
    }]
  };
}

async function getJson(
  baseUrl: string,
  path: string,
  expectedStatus = 200,
  headers: Record<string, string> = {}
) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json", ...headers } });
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
