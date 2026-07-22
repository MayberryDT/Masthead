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
  test("returns a read-only opportunity-linked optional artifact scaffold", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:scaffold-opportunity");
    const evidenceRef = "message:session:scaffold-opportunity:seed-user";
    vi.spyOn(advisorySuggestions, "getArtifactSuggestions").mockReturnValue([{
      advisory: true,
      evidenceRefs: [evidenceRef],
      kind: "adr",
      provenanceSessionIds: ["session:scaffold-opportunity"],
      signatureKey: "signature:scaffold-opportunity",
      suggestionId: "suggestion:scaffold-opportunity",
      summary: "A durable decision with alternatives and consequences."
    }]);
    const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
    const expectedIdentity = authoringIdentity(capabilities.body);
    const created = await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity,
      sessionIds: ["session:scaffold-opportunity"]
    }, 201);
    const started = await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(created.body.request.requestId as string)}/start`,
      { expectedIdentity }
    );
    const assignmentId = started.body.assignment.assignmentId as string;
    const changesBefore = totalChanges(daemon.database);

    const scaffolded = await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/scaffold`
    );

    expect(totalChanges(daemon.database)).toBe(changesBefore);
    expect(scaffolded.body.draft).toMatchObject({
      artifacts: [{
        draftId: expect.stringMatching(/^guided-artifact-draft:/),
        kind: "adr",
        provenanceSessionIds: ["session:scaffold-opportunity"],
        seedSessionId: "session:scaffold-opportunity",
        output: {
          alternatives: ["REPLACE_WITH_ALTERNATIVE_ACTUALLY_CONSIDERED"],
          claimSupport: expect.any(Array),
          decision: "REPLACE_WITH_DURABLE_DECISION",
          provenanceSessionIds: ["session:scaffold-opportunity"]
        }
      }],
      opportunityDispositions: [{
        artifactDraftId: expect.stringMatching(/^guided-artifact-draft:/),
        artifactKind: "adr",
        disposition: "authored",
        evidenceRefs: [evidenceRef]
      }]
    });
    expect(scaffolded.body.draft.opportunityDispositions[0].artifactDraftId)
      .toBe(scaffolded.body.draft.artifacts[0].draftId);
  });

  test("exposes the exact V4 contract and guided request flow", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:guided");

    const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
    expect(capabilities.body).toEqual({
      baseUrl,
      buildSha: "development",
      bundleVersion: "workbench-authoring-v4",
      canarySessions: 3,
      capability: "artifact_authoring",
      command: expect.any(String),
      databaseId: getOrCreateDatabaseIdentity(daemon.database),
      instanceId: expect.any(String),
      instanceManifest: expect.stringMatching(/masthead-instance\.json$/),
      maxSessionsPerAssignment: 12,
      operations: ["start", "inspect", "scaffold", "save", "review", "finish"],
      policyVersion: "guided-authoring-v1",
      protocol: "masthead.workbench.authoring/v1"
    });
    const expectedIdentity = authoringIdentity(capabilities.body);
    const created = await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity,
      sessionIds: ["session:guided"]
    }, 201);
    expect(created.body).toMatchObject({
      nextAction: { kind: "claim_next" },
      request: { creationInstanceId: expectedIdentity.instanceId, sessionCount: 1 }
    });
    const requestId = created.body.request.requestId as string;
    expect((await getJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}`)).body)
      .toMatchObject({ requestId, creationInstanceId: expectedIdentity.instanceId });

    const started = await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`,
      { expectedIdentity }
    );
    expect(started.body).toMatchObject({ nextAction: { kind: "inspect" } });
    const assignmentId = started.body.assignment.assignmentId as string;
    const inspected = await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/inspect`,
      200,
      authoringHeaders(expectedIdentity)
    );
    expect(inspected.body).toMatchObject({ assignmentId, progressRecorded: true, nextAction: expect.any(Object) });

    const changesBeforeScaffold = totalChanges(daemon.database);
    const scaffolded = await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/scaffold`
    );
    expect(scaffolded.body).toMatchObject({
      assignmentId,
      bundleSchema: { title: "GuidedAuthoringBundleV4" },
      draft: { assignmentId, evidenceRevision: started.body.assignment.evidenceRevision, sessionEnrichments: [{ sessionId: "session:guided" }] },
      nextAction: { kind: "save" }
    });
    expect(totalChanges(daemon.database)).toBe(changesBeforeScaffold);
    const canonicalEvidence = (inspected.body.evidence.items as SessionTranscriptItem[])
      .find(({ kind }) => kind === "message");
    if (!canonicalEvidence) throw new Error("expected_seeded_message_evidence");
    const draft = authorGuidedScaffold(
      scaffolded.body.draft as GuidedAuthoringBundleV4,
      canonicalEvidence
    );
    vi.spyOn(guidedQuality, "validateGuidedAuthoringDraft").mockReturnValue({ accepted: true, findings: [] });
    expect((await postJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/draft`,
      { draft, expectedIdentity }
    )).body).toMatchObject({ assignmentId, nextAction: { kind: "await_operator" }, status: "staged_canary" });
    expect((await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/review`
    )).body).toMatchObject({ assignmentId, draftRevision: 1, nextAction: { kind: "await_operator" } });
    expect((await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`,
      { expectedIdentity }
    )).body).toMatchObject({ assignment: { assignmentId }, nextAction: { kind: "await_operator" } });
    expect((await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/inspect`,
      409,
      authoringHeaders(expectedIdentity)
    )).body).toMatchObject({ error: { code: "guided_assignment_not_inspectable" }, ok: false });
    expect((await getJson(baseUrl, "/workbench/authoring/canaries/pending")).body)
      .toEqual([expect.objectContaining({ assignmentId, draftRevision: 1 })]);

    expect((await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(requestId)}/canary-decision`,
      {
        assignmentId,
        decision: "approved",
        draftRevision: 1,
        evidenceRevision: draft.evidenceRevision,
        expectedIdentity,
        notes: "Grounded canary review.",
        reviewedBy: "operator:test"
      }
    )).body).toMatchObject({ assignmentId, nextAction: { kind: "finish" } });
    expect((await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`,
      { expectedIdentity }
    )).body).toMatchObject({ assignment: { assignmentId }, nextAction: { kind: "finish" } });
    expect((await getJson(baseUrl, "/workbench/authoring/canaries/pending")).body).toEqual([]);
    expect((await postJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/finish`,
      { expectedIdentity }
    )).body).toMatchObject({
      nextAction: { kind: "complete" },
      receipt: { assignmentId, publicationInstanceId: expectedIdentity.instanceId, requestId }
    });
    expect((await postJson(
      baseUrl,
      `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`,
      { expectedIdentity }
    )).body).toMatchObject({ assignment: { assignmentId }, nextAction: { kind: "complete" } });
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

  test("rejects swapped identity with zero writes and preserves stable restart binding", async () => {
    const { daemon } = await startTestDaemon();
    seedAuthoringSession(daemon, "session:identity");
    const manifestPath = join(tempDirs[0]!, "masthead-instance.json");
    const original = identityFromManifest(daemon.instanceIdentity(), manifestPath);
    const context = { authoringCommand: join(tempDirs[0]!, "bin", "mastheadctl"), db: daemon.database };
    const before = totalChanges(daemon.database);
    const rejected = await routeWorkbenchAuthoringRequest(
      { ...context, identity: original },
      {
        body: { expectedIdentity: { ...original, instanceId: "instance:swapped" }, sessionIds: ["session:identity"] },
        method: "POST",
        url: new URL("http://127.0.0.1/workbench/authoring/requests")
      }
    );
    expect(rejected).toMatchObject({ status: 409, body: { error: { code: "instance_identity_mismatch" } } });
    expect(totalChanges(daemon.database)).toBe(before);

    const created = await routeWorkbenchAuthoringRequest(
      { ...context, identity: original },
      {
        body: { expectedIdentity: original, sessionIds: ["session:identity"] },
        method: "POST",
        url: new URL("http://127.0.0.1/workbench/authoring/requests")
      }
    );
    const request = (created?.body as any).request;
    const restarted = { ...original, instanceId: "instance:after-restart" };
    expect(await routeWorkbenchAuthoringRequest(
      { ...context, identity: restarted },
      {
        body: { expectedIdentity: restarted },
        method: "POST",
        url: new URL(`http://127.0.0.1/workbench/authoring/requests/${encodeURIComponent(request.requestId)}/start`)
      }
    )).toMatchObject({ status: 200, body: { nextAction: { kind: "inspect" } } });
    expect((daemon.database.prepare(
      "SELECT creation_instance_id AS creationInstanceId FROM guided_authoring_requests WHERE request_id = ?"
    ).get(request.requestId) as { creationInstanceId: string }).creationInstanceId).toBe(original.instanceId);
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
      "/workbench/authoring/assignments/assignment%3Aone/finish"
    ]) expect(isWorkbenchAuthoringPath(pathname)).toBe(true);
    expect(isWorkbenchAuthoringPath("/workbench/authoring/candidates")).toBe(false);
    expect(getWorkbenchAuthoringBodyLimit(
      "/workbench/authoring/assignments/assignment%3Aone/draft", 1024
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
    }, 400)).body).toMatchObject({ error: { code: "authoring_session_id_duplicate" }, ok: false });
    expect((await postJson(baseUrl, "/workbench/authoring/requests", {
      expectedIdentity: { ...identity, instanceManifest: "relative/manifest.json" },
      sessionIds: ["session:invalid"]
    }, 400)).body).toMatchObject({ error: { code: "invalid_request" }, ok: false });
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
      { method: "GET", url: new URL("http://127.0.0.1/workbench/authoring/canaries/pending") }
    );
    expect(unexpected).toEqual({
      body: { error: { code: "authoring_internal_error", message: "Workbench authoring request failed" }, ok: false },
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
