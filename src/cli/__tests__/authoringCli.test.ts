import { access, copyFile, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import { acquireDatabaseWriterLock, acquireLegacyDataDirectoryGuard } from "../../core/daemonOwnership.ts";
import type { DaemonConfig } from "../../daemon/config.ts";
import { markSessionCompileReady, seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateTestDatabaseThrough } from "../../daemon/db/__tests__/schemaTestHelpers.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { runMastheadCli } from "../mastheadctl.ts";
import { MastheadAuthoringClient } from "../authoringClient.ts";
import { openAuthoringRun } from "../../workbench/authoring/authoringService.ts";
import { fingerprintWorkbenchOutput } from "../../workbench/applyArtifact.ts";
import {
  seedDurableArtifactCorpus
} from "../../workbench/authoring/__fixtures__/durableArtifactCorpus.ts";
import {
  restoreFailedV1RecoveryBackupInsideExclusiveMaintenance,
  withExclusiveDatabaseMaintenance
} from "../../daemon/databaseBackup.ts";
import * as sessionArtifactRepository from "../../daemon/db/sessionArtifactRepository.ts";

const tempDirs: string[] = [];
const suiteTempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];
const execFileAsync = promisify(execFile);
let exactCliRecoveryTemplatePromise: Promise<ExactCliRecoveryTemplate> | undefined;
const SMALL_RECOVERY_AUDIT_HASH = "b".repeat(64);
const SMALL_ALTERED_RECOVERY_AUDIT_HASH = "c".repeat(64);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status: 200 });
}

function validCliV3Bundle(runId: string, evidenceRevision: string, sessionId: string) {
  const evidenceRef = {
    id: `message:${sessionId}:message`,
    kind: "event",
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
        keywords: ["canonical dossier", "atomic publication"],
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

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

afterAll(async () => {
  await Promise.all(suiteTempDirs.map((path) => rm(path, { force: true, recursive: true })));
  suiteTempDirs.length = 0;
});

describe("mastheadctl daemon-owned Workbench authoring", () => {
  test("runs the nested guided workflow with exact JSON DTOs and identity-bound mutations", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-guided-cli-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    const expectedIdentity = {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:current",
      instanceManifest
    };
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: expectedIdentity.instanceId,
      baseUrl: expectedIdentity.baseUrl,
      databaseId: expectedIdentity.databaseId,
      buildSha: expectedIdentity.buildSha,
      pid: 12345,
      instanceDir,
      updatedAt: new Date().toISOString()
    }));
    const nextAction = {
      command: `${join(instanceDir, "bin", "mastheadctl")} workbench author inspect --assignment assignment:one --json`,
      kind: "inspect",
      reason: "Read the canonical evidence."
    };
    const responseDto = {
      assignment: { assignmentId: "assignment:one", sessionIds: ["session:a"] },
      authoringContract: {
        bundleSchema: { description: "SCHEMA_SENTINEL".repeat(5_000) },
        scaffoldCommand: "mastheadctl workbench author scaffold --assignment assignment:one --file draft.json --json",
        rule: "Use the daemon scaffold and preserve exact evidence support."
      },
      editorialBrief: {
        evidenceQuestions: ["What concrete work was performed?"],
        objective: "Produce grounded reusable knowledge.",
        opportunities: [{ opportunityId: "opportunity:a", suggestedKind: "adr" }],
        rubrics: { adr: ["durable decision"] },
        sessions: [{ dossierSentinel: "FULL_DOSSIER_SENTINEL".repeat(5_000) }]
      },
      nextAction
    };
    const requests: Array<{ body?: unknown; headers: Headers; method: string; pathname: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        headers: new Headers(init?.headers),
        method: String(init?.method),
        pathname: url.pathname
      });
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          capability: "artifact_authoring",
          protocol: "masthead.workbench.authoring/v1",
          bundleVersion: "workbench-authoring-v4",
          policyVersion: "guided-authoring-v1",
          command: join(instanceDir, "bin", "mastheadctl"),
          ...expectedIdentity,
          maxSessionsPerAssignment: 12,
          canarySessions: 3,
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
        });
      }
      return jsonResponse(responseDto);
    }));

    const result = await runMastheadCli(
      ["workbench", "author", "start", "--request", "request:one", "--json"],
      { env: { MASTHEAD_INSTANCE_MANIFEST: instanceManifest } }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      assignment: responseDto.assignment,
      authoringContract: {
        scaffoldCommand: responseDto.authoringContract.scaffoldCommand,
        rule: responseDto.authoringContract.rule
      },
      editorialBrief: {
        evidenceQuestions: responseDto.editorialBrief.evidenceQuestions,
        objective: responseDto.editorialBrief.objective,
        opportunities: responseDto.editorialBrief.opportunities,
        rubrics: responseDto.editorialBrief.rubrics
      },
      nextAction
    });
    expect(result.stdout).not.toContain("SCHEMA_SENTINEL");
    expect(result.stdout).not.toContain("FULL_DOSSIER_SENTINEL");
    expect(result.stdout.length).toBeLessThan(5_000);
    expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([
      "GET /workbench/authoring/capabilities",
      "POST /workbench/authoring/requests/request%3Aone/start"
    ]);
    expect(requests[1]?.body).toEqual({ expectedIdentity });
    expect(Object.keys(responseDto).filter((key) => key === "nextAction")).toHaveLength(1);
  });

  test("sends all five canonical identity headers for progress-recording inspect", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-guided-inspect-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: "instance:inspect",
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "build:test",
      pid: 12345,
      instanceDir,
      updatedAt: new Date().toISOString()
    }));
    let inspectHeaders: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          capability: "artifact_authoring",
          protocol: "masthead.workbench.authoring/v1",
          bundleVersion: "workbench-authoring-v4",
          policyVersion: "guided-authoring-v1",
          command: join(instanceDir, "bin", "mastheadctl"),
          baseUrl: "http://127.0.0.1:17373",
          databaseId: "database:test",
          buildSha: "build:test",
          instanceManifest,
          instanceId: "instance:inspect",
          maxSessionsPerAssignment: 12,
          canarySessions: 3,
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
        });
      }
      inspectHeaders = new Headers(init?.headers);
      return jsonResponse({
        assignmentId: "assignment:one",
        nextAction: { kind: "save", reason: "Evidence is complete.", command: "mastheadctl workbench author save" }
      });
    }));

    const result = await runMastheadCli(
      ["workbench", "author", "inspect", "--assignment", "assignment:one", "--json"],
      { env: { MASTHEAD_INSTANCE_MANIFEST: instanceManifest } }
    );

    expect(result.exitCode).toBe(0);
    expect(Object.fromEntries([
      "x-masthead-authoring-base-url",
      "x-masthead-authoring-database-id",
      "x-masthead-authoring-build-sha",
      "x-masthead-authoring-instance-manifest",
      "x-masthead-authoring-instance-id"
    ].map((name) => [name, inspectHeaders?.get(name)]))).toEqual({
      "x-masthead-authoring-base-url": "http://127.0.0.1:17373",
      "x-masthead-authoring-database-id": "database:test",
      "x-masthead-authoring-build-sha": "build:test",
      "x-masthead-authoring-instance-manifest": instanceManifest,
      "x-masthead-authoring-instance-id": "instance:inspect"
    });
  });

  test("round-trips the paginated inspect next action with its session and cursor", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-guided-inspect-page-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: "instance:inspect-page",
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "build:test",
      pid: 12345,
      instanceDir,
      updatedAt: new Date().toISOString()
    }));
    const requestedUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requestedUrls.push(url);
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          capability: "artifact_authoring", protocol: "masthead.workbench.authoring/v1",
          bundleVersion: "workbench-authoring-v4", policyVersion: "guided-authoring-v1",
          command: join(instanceDir, "bin", "mastheadctl"), baseUrl: "http://127.0.0.1:17373",
          databaseId: "database:test", buildSha: "build:test", instanceManifest,
          instanceId: "instance:inspect-page", maxSessionsPerAssignment: 12, canarySessions: 3,
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
        });
      }
      return jsonResponse({
        assignmentId: "assignment:one",
        authoringContract: {
          bundleSchema: { description: "REPEATED_SCHEMA_SENTINEL".repeat(5_000) },
          scaffoldCommand: "mastheadctl workbench author scaffold --assignment assignment:one --file draft.json --json",
          rule: "Use the daemon scaffold."
        },
        evidence: { items: [{ itemId: "message:a", text: "Canonical evidence." }] },
        nextAction: {
          kind: "inspect",
          reason: "Session session:a still has unread canonical evidence.",
          command: `${join(instanceDir, "bin", "mastheadctl")} workbench author inspect --assignment assignment:one --session session:a --cursor 100 --json`
        }
      });
    }));

    const result = await runMastheadCli([
      "workbench", "author", "inspect", "--assignment", "assignment:one",
      "--session", "session:a", "--cursor", "100", "--json"
    ], { env: { MASTHEAD_INSTANCE_MANIFEST: instanceManifest } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("REPEATED_SCHEMA_SENTINEL");
    expect(result.stdout.length).toBeLessThan(5_000);
    expect(JSON.parse(result.stdout).authoringContract).toEqual({
      scaffoldCommand: "mastheadctl workbench author scaffold --assignment assignment:one --file draft.json --json",
      rule: "Use the daemon scaffold."
    });
    expect(JSON.parse(result.stdout).evidence.items).toHaveLength(1);
    expect(requestedUrls[1]?.pathname).toBe("/workbench/authoring/assignments/assignment%3Aone/inspect");
    expect(requestedUrls[1]?.searchParams.get("sessionId")).toBe("session:a");
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe("100");
  });

  test("prints only the returned next-action reason and command in human mode", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-guided-human-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: "instance:human",
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "build:test",
      pid: 12345,
      instanceDir,
      updatedAt: new Date().toISOString()
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          capability: "artifact_authoring", protocol: "masthead.workbench.authoring/v1",
          bundleVersion: "workbench-authoring-v4", policyVersion: "guided-authoring-v1",
          command: join(instanceDir, "bin", "mastheadctl"), baseUrl: "http://127.0.0.1:17373",
          databaseId: "database:test", buildSha: "build:test", instanceManifest,
          instanceId: "instance:human", maxSessionsPerAssignment: 12, canarySessions: 3,
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
        });
      }
      return jsonResponse({
        assignmentId: "assignment:one",
        nextAction: { kind: "inspect", reason: "Read every evidence page.", command: "mastheadctl workbench author inspect --assignment assignment:one --json" }
      });
    }));

    const result = await runMastheadCli(
      ["workbench", "author", "start", "--request", "request:one"],
      { env: { MASTHEAD_INSTANCE_MANIFEST: instanceManifest } }
    );
    expect(result.stdout).toBe("Read every evidence page.\nmastheadctl workbench author inspect --assignment assignment:one --json\n");
  });

  test("loads a V4 save file and routes save, review, and finish by one assignment", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-guided-routes-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    await writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1, instanceId: "instance:routes", baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test", buildSha: "build:test", pid: 12345, instanceDir,
      updatedAt: new Date().toISOString()
    }));
    const bundle = {
      artifacts: [], assignmentId: "assignment:one", bundleVersion: "workbench-authoring-v4",
      evidenceRevision: "evidence:v4:one", opportunityDispositions: [],
      sessionEnrichments: [{
        sessionId: "session:a",
        claimSupport: [{
          evidenceRef: "message:a:1", excerpt: "The implementation produces reusable evidence-backed knowledge.",
          path: "/sessionSummary/text", supportKind: "outcome"
        }],
        enrichment: {
          keywords: ["guided authoring", "instance-bound workflow", "focused verification"],
          version: "session-capsule-v4",
          sessionTitle: { text: "Guided authoring", basis: "dominant_work", confidence: "high", evidenceRefs: [] },
          sessionSummary: { text: "Implemented guided authoring.", state: "completed", confidence: "high", evidenceRefs: [] },
          sessionDossier: {
            purpose: "Implement guided authoring.", outcome: "Guided authoring is available.",
            keyWork: ["Added an instance-bound command workflow."], decisions: [], blockers: [], warnings: [], evidenceRefs: [],
            verification: { status: "passed", summary: "Focused tests passed.", commands: [], failures: [], evidenceRefs: [] },
            continuation: { openQuestions: [], constraints: [] }
          }
        }
      }]
    };
    const bundlePath = join(instanceDir, "draft.json");
    await writeFile(bundlePath, JSON.stringify(bundle));
    const saveResponse = {
      assignmentId: "assignment:one",
      requestId: "request:one",
      status: "needs_revision",
      evidenceRevision: "evidence:v4:one",
      draftRevision: 2,
      draft: bundle,
      findings: [{
        code: "missing_session_claim_support",
        message: "Claim-bearing session field requires one valid change support.",
        path: "/sessionEnrichments/0/enrichment/sessionDossier/keyWork/0",
        severity: "error"
      }],
      editorialQuestions: ["What changed?"],
      coverage: [{
        sessionId: "session:a", evidenceRevision: "evidence:v4:one",
        accessedItems: 3, totalItems: 3, complete: true
      }],
      operatorReviews: [],
      nextAction: { kind: "revise", reason: "Resolve the structured finding.", command: "save" }
    };
    const calls: Array<{ body?: unknown; method: string; pathname: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      calls.push({
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        method: String(init?.method), pathname
      });
      if (pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          capability: "artifact_authoring", protocol: "masthead.workbench.authoring/v1",
          bundleVersion: "workbench-authoring-v4", policyVersion: "guided-authoring-v1",
          command: join(instanceDir, "bin", "mastheadctl"), baseUrl: "http://127.0.0.1:17373",
          databaseId: "database:test", buildSha: "build:test", instanceManifest,
          instanceId: "instance:routes", maxSessionsPerAssignment: 12, canarySessions: 3,
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
        });
      }
      if (pathname.endsWith("/draft")) return jsonResponse(saveResponse);
      if (pathname.endsWith("/review")) return jsonResponse({
        ...saveResponse,
        nextAction: { kind: "finish", reason: "Ready.", command: "finish" }
      });
      return jsonResponse({ assignmentId: "assignment:one", nextAction: { kind: "finish", reason: "Ready.", command: "finish" } });
    }));
    const env = { MASTHEAD_INSTANCE_MANIFEST: instanceManifest };

    const results = [];
    for (const args of [
      ["workbench", "author", "save", "--assignment", "assignment:one", "--file", bundlePath, "--json"],
      ["workbench", "author", "review", "--assignment", "assignment:one", "--json"],
      ["workbench", "author", "finish", "--assignment", "assignment:one", "--json"]
    ]) {
      const result = await runMastheadCli(args, { env });
      expect(result.exitCode).toBe(0);
      results.push(result);
    }

    expect(JSON.parse(results[0]!.stdout)).toEqual({
      assignmentId: saveResponse.assignmentId,
      requestId: saveResponse.requestId,
      status: saveResponse.status,
      evidenceRevision: saveResponse.evidenceRevision,
      draftRevision: saveResponse.draftRevision,
      findings: saveResponse.findings,
      editorialQuestions: saveResponse.editorialQuestions,
      coverage: saveResponse.coverage,
      operatorReviews: saveResponse.operatorReviews,
      nextAction: saveResponse.nextAction
    });
    expect(JSON.parse(results[1]!.stdout)).not.toHaveProperty("draft");
    expect(JSON.parse(results[1]!.stdout)).toMatchObject({
      assignmentId: "assignment:one",
      draftRevision: 2,
      findings: saveResponse.findings,
      nextAction: { kind: "finish" }
    });

    expect(calls.filter(({ pathname }) => pathname !== "/workbench/authoring/capabilities").map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([
      "POST /workbench/authoring/assignments/assignment%3Aone/draft",
      "GET /workbench/authoring/assignments/assignment%3Aone/review",
      "POST /workbench/authoring/assignments/assignment%3Aone/finish"
    ]);
    expect(calls.find(({ pathname }) => pathname.endsWith("/draft"))?.body).toMatchObject({ draft: bundle, expectedIdentity: { instanceId: "instance:routes" } });
    expect(calls.find(({ pathname }) => pathname.endsWith("/finish"))?.body).toMatchObject({ expectedIdentity: { instanceId: "instance:routes" } });
  });

  test("returns a structured error for a schema-invalid V4 save file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-invalid-draft-"));
    tempDirs.push(tempDir);
    const bundlePath = join(tempDir, "draft.json");
    await writeFile(bundlePath, JSON.stringify({
      artifacts: [],
      assignmentId: "assignment:one",
      bundleVersion: "workbench-authoring-v4",
      evidenceRevision: "evidence:v4:one",
      opportunityDispositions: [],
      sessionEnrichments: []
    }));

    const result = await runMastheadCli([
      "workbench", "author", "save", "--assignment", "assignment:one", "--file", bundlePath, "--json"
    ], { env: {} });

    expect(result).toMatchObject({ exitCode: 1, stdout: "" });
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "invalid_guided_authoring_bundle",
        message: `Invalid guided authoring V4 bundle at sessionEnrichments in ${bundlePath}`,
        path: "sessionEnrichments",
        findings: [{
          code: "invalid_guided_authoring_bundle",
          message: "The bundle does not match the V4 schema at sessionEnrichments.",
          path: "sessionEnrichments",
          severity: "error"
        }],
        nextAction: {
          command: `mastheadctl workbench author save --assignment 'assignment:one' --file '${bundlePath}' --json`,
          kind: "revise",
          reason: "Edit the invalid field at sessionEnrichments in the existing V4 draft, then re-save the same file."
        }
      },
      ok: false
    });
    expect(result.stderr).not.toContain(".scaffold.json");
  });

  test("regenerates a scaffold only when the local bundle version is unsupported", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-unsupported-draft-"));
    tempDirs.push(tempDir);
    const bundlePath = join(tempDir, "draft.json");
    await writeFile(bundlePath, JSON.stringify({
      artifacts: [],
      assignmentId: "assignment:one",
      bundleVersion: "workbench-authoring-v3",
      evidenceRevision: "evidence:v3:one",
      opportunityDispositions: [],
      sessionEnrichments: []
    }));

    const result = await runMastheadCli([
      "workbench", "author", "save", "--assignment", "assignment:one", "--file", bundlePath, "--json"
    ], { env: {} });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "invalid_guided_authoring_bundle",
        path: "bundleVersion",
        nextAction: {
          command: `mastheadctl workbench author scaffold --assignment 'assignment:one' --file '${bundlePath}.scaffold.json' --json`,
          kind: "scaffold",
          reason: "Regenerate the daemon-owned V4 draft scaffold, then edit only its authored content and evidence support."
        }
      },
      ok: false
    });
  });

  test("writes a daemon-owned schema-valid V4 scaffold without repository knowledge", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-scaffold-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "draft.json");
    const draftId = "guided-artifact-draft:deterministic";
    const draft = {
      artifacts: [{
        draftId,
        kind: "adr",
        output: {
          affectedPaths: [],
          alternatives: ["REPLACE_WITH_ALTERNATIVE_ACTUALLY_CONSIDERED"],
          claimSupport: [{
            evidenceRef: "evidence:opportunity",
            excerpt: "REPLACE_WITH_EXACT_CANONICAL_EVIDENCE_EXCERPT",
            path: "decision",
            supportKind: "decision"
          }],
          confidence: "low",
          consequences: ["REPLACE_WITH_CONSEQUENCE_AND_REVERSAL_CONDITION"],
          context: "REPLACE_WITH_DECISION_CONTEXT",
          decision: "REPLACE_WITH_DURABLE_DECISION",
          evidenceRefs: ["evidence:opportunity"],
          missingEvidence: ["REPLACE_WITH_ANY_MISSING_EVIDENCE_BOUNDARY"],
          provenanceSessionIds: ["session:a"],
          status: "REPLACE_WITH_DECISION_STATUS",
          supersedes: [],
          title: "REPLACE_WITH_SPECIFIC_ARTIFACT_TITLE"
        },
        provenanceSessionIds: ["session:a"],
        seedSessionId: "session:a"
      }],
      assignmentId: "assignment:one", bundleVersion: "workbench-authoring-v4",
      evidenceRevision: "evidence:one", opportunityDispositions: [{
        artifactDraftId: draftId,
        artifactKind: "adr",
        disposition: "authored",
        evidenceRefs: ["evidence:opportunity"],
        opportunityId: "opportunity:one",
        rationale: "REPLACE_WITH_EVIDENCE_BACKED_DISPOSITION_RATIONALE"
      }],
      sessionEnrichments: [{
        sessionId: "session:a",
        enrichment: {
          keywords: [],
          version: "session-capsule-v4",
          sessionTitle: { text: "REPLACE", basis: "dominant_work", confidence: "low", evidenceRefs: [] },
          sessionSummary: { text: "REPLACE", state: "unknown", confidence: "low", evidenceRefs: [] },
          sessionDossier: {
            purpose: "REPLACE", outcome: "REPLACE", keyWork: ["REPLACE"], decisions: [], blockers: [], warnings: [], evidenceRefs: [],
            verification: { status: "unknown", summary: "REPLACE", commands: [], failures: [], evidenceRefs: [] },
            continuation: { openQuestions: [], constraints: [] }
          }
        },
        claimSupport: [{ path: "/sessionSummary/text", supportKind: "outcome", evidenceRef: "REPLACE_EVIDENCE_REF", excerpt: "REPLACE_EXACT_EXCERPT" }]
      }]
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).pathname).toBe("/workbench/authoring/assignments/assignment%3Aone/scaffold");
      return jsonResponse({
        assignmentId: "assignment:one", bundleSchema: { title: "GuidedAuthoringBundleV4", type: "object" }, draft,
        nextAction: { kind: "save", reason: "Author content and support, then save.", command: `mastheadctl workbench author save --assignment assignment:one --file ${file} --json` }
      });
    }));
    const result = await runMastheadCli(["workbench", "author", "scaffold", "--assignment", "assignment:one", "--file", file, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(draft);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      artifacts: [{ draftId, kind: "adr" }],
      opportunityDispositions: [{ artifactDraftId: draftId, artifactKind: "adr" }]
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ assignmentId: "assignment:one", file, nextAction: { kind: "save" } });
    expect(JSON.parse(result.stdout)).not.toHaveProperty("bundleSchema");
    expect(JSON.parse(result.stdout)).not.toHaveProperty("draft");
    expect(JSON.parse(result.stdout)).toMatchObject({
      draftSummary: { artifactCount: 1, opportunityDispositionCount: 1, sessionEnrichmentCount: 1 }
    });
    expect(JSON.parse(result.stdout).nextAction.command).toBe(
      `mastheadctl workbench author save --assignment assignment:one --file '${file}' --json`
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    await expect(runMastheadCli([
      "workbench", "author", "scaffold", "--assignment", "assignment:one", "--file", file, "--json"
    ])).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(draft);
  });

  test("reloads the instance manifest before each guided mutation and accepts a safe daemon nonce change", async () => {
    const instanceDir = await mkdtemp(join(tmpdir(), "masthead-cli-instance-"));
    tempDirs.push(instanceDir);
    const instanceManifest = join(instanceDir, "masthead-instance.json");
    let instanceId = "instance:old";
    const writeManifest = () => writeFile(instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId,
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "build:test",
      pid: 12345,
      instanceDir,
      updatedAt: new Date().toISOString()
    }));
    await writeManifest();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method}:${url.pathname}:${instanceId}`);
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse({
          baseUrl: "http://127.0.0.1:17373",
          buildSha: "build:test",
          bundleVersion: "workbench-authoring-v4",
          capability: "artifact_authoring",
          command: join(instanceDir, "bin", "mastheadctl"),
          databaseId: "database:test",
          instanceId,
          instanceManifest,
          maxSessionsPerAssignment: 12,
          canarySessions: 3,
          policyVersion: "guided-authoring-v1",
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"],
          protocol: "masthead.workbench.authoring/v1",
        });
      }
      return jsonResponse([]);
    }));
    const client = new MastheadAuthoringClient({ instanceManifest });
    await client.capabilities();
    instanceId = "instance:new";
    await writeManifest();
    await client.guidedStart("request:one");
    expect(calls).toEqual([
      "GET:/workbench/authoring/capabilities:instance:old",
      "GET:/workbench/authoring/capabilities:instance:new",
      "POST:/workbench/authoring/requests/request%3Aone/start:instance:new"
    ]);
  });

  test.each(["suggestions", "open", "submit", "finish"])(
    "retires and does not dispatch the legacy %s mutation",
    async (command) => {
      const result = await runMastheadCli(["workbench", command, "--json"], {
        env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" }
      });
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "authoring_contract_retired" } });
    }
  );

  test("advertises only daemon authoring commands plus explicit wipe maintenance", async () => {
    const top = await runMastheadCli(["--help"], { env: {} });
    expect(top.stdout).toContain("mastheadctl workbench");
    expect(top.stdout).toContain("workbench author start");

    const result = await runMastheadCli(["workbench", "--help"], { env: {} });
    for (const command of [
      "author start", "author inspect", "author save", "author review", "author finish",
      "capabilities", "status", "context", "evidence",
      "audit-v1-generation", "prepare-v1-recovery", "invalidate-v1-generation", "restore-v1-recovery",
      "audit-v3-template-generation", "prepare-v3-template-recovery",
      "invalidate-v3-template-generation", "restore-v3-template-recovery",
      "wipe-published"
    ]) {
      expect(result.stdout).toContain(`workbench ${command}`);
    }
    for (const retired of ["suggestions", "open", "submit", "finish"]) {
      expect(result.stdout).not.toContain(`workbench ${retired} `);
    }
    for (const removed of ["candidates", "--candidate", "queue", "next", "apply", "publish", "not-applicable", "batch"]) {
      expect(result.stdout).not.toContain(`workbench ${removed}`);
    }
  });

  test("uses daemon-owned commands without --db and preserves historical run reads", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:a",
      title: "CLI authoring session"
    });
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);
    const env = { MASTHEAD_DAEMON_URL: baseUrl };

    const capabilities = await runMastheadCli(["workbench", "capabilities", "--json"], { env });
    expect(capabilities.exitCode).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      ok: true,
      capability: "artifact_authoring",
      databaseId
    });

    const openedBody = openAuthoringRun(daemon.database, {
      actorId: "mastheadctl",
      databaseId,
      sessionIds: ["session:a"]
    });
    expect(openedBody).toMatchObject({ ok: true, run: { sessionIds: ["session:a"], status: "open" } });
    const runId = openedBody.run.runId as string;

    const status = await runMastheadCli(["workbench", "status", "--run", runId, "--json"], { env });
    expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, evidenceStatus: "current", run: { runId } });

    const evidence = await runMastheadCli(
      [
        "workbench",
        "evidence",
        "--run",
        runId,
        "--session",
        "session:a",
        "--limit",
        "25",
        "--order",
        "desc",
        "--kind",
        "all",
        "--json"
      ],
      { env }
    );
    expect(JSON.parse(evidence.stdout)).toMatchObject({ ok: true, sessionId: "session:a" });

    const tempDir = await makeTempDir("masthead-cli-bundle-");
    const bundlePath = join(tempDir, "bundle.json");
    await writeFile(
      bundlePath,
      JSON.stringify({
        artifacts: [],
        bundleVersion: "workbench-authoring-v1",
        contributions: [],
        evidenceRevision: openedBody.run.evidenceRevision,
        notApplicable: [],
        runId,
        sessionPackages: []
      }),
      "utf8"
    );
    const submitted = await runMastheadCli(
      ["workbench", "submit", "--run", runId, "--file", bundlePath, "--json"],
      { env }
    );
    expect(submitted.exitCode).toBe(1);
    expect(JSON.parse(submitted.stderr)).toMatchObject({ error: { code: "authoring_contract_retired" } });

    const finish = await runMastheadCli(["workbench", "finish", "--run", runId, "--json"], { env });
    expect(finish.exitCode).toBe(1);
    expect(JSON.parse(finish.stderr)).toMatchObject({
      ok: false,
      error: { code: "authoring_contract_retired" }
    });
  });

  test("does not expose a session or multiple-ID guided authoring surface", async () => {
    const result = await runMastheadCli(
      ["workbench", "author", "start", "--request", "request:one", "--request", "request:two", "--session", "session:a", "--json"],
      { env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" } }
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" }
    });
  });

  test("returns structured daemon and argument failures", async () => {
    const unavailable = await runMastheadCli(["workbench", "capabilities", "--json"], {
      env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" }
    });
    expect(unavailable.exitCode).toBe(1);
    expect(JSON.parse(unavailable.stderr)).toMatchObject({ ok: false, error: { code: "daemon_unavailable" } });

    const missing = await runMastheadCli(["workbench", "status", "--json"], { env: {} });
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ ok: false, error: { code: "missing_argument" } });
  });

  test("rejects session arguments outside progress-recording inspect before network access", async () => {
    const result = await runMastheadCli(
      ["workbench", "author", "start", "--request", "request:one", "--session", "session:a", "--json"],
      { env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" } }
    );
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "invalid_argument" } });
  });

  test.each([
    { args: ["workbench", "author", "start", "--request", "--json"], option: "--request" },
    { args: ["workbench", "author", "inspect", "--assignment", "--json"], option: "--assignment" },
    { args: ["workbench", "author", "inspect", "--assignment", "assignment:one", "--session", "--json"], option: "--session" },
    { args: ["workbench", "author", "inspect", "--assignment", "assignment:one", "--cursor", "--json"], option: "--cursor" },
    { args: ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "--json"], option: "--file" },
    { args: ["workbench", "author", "review", "--assignment", "--json"], option: "--assignment" },
    { args: ["workbench", "author", "finish", "--assignment", "--json"], option: "--assignment" },
    { args: ["workbench", "status", "--run", "--json"], option: "--run" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "--json"], option: "--session" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--cursor", "--json"], option: "--cursor" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--limit", "--json"], option: "--limit" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--order", "--json"], option: "--order" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--kind", "--json"], option: "--kind" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--query", "--json"], option: "--query" }
  ])("rejects valueless $option before network or filesystem access", async ({ args, option }) => {
    const result = await runMastheadCli(args, {
      env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "missing_argument", message: `Missing value for option: ${option}` },
      ok: false
    });
  });

  test("normalizes a blank daemon URL to the default connector", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          bundleVersion: "workbench-authoring-v4",
          capability: "artifact_authoring",
          command: "/tmp/masthead/bin/mastheadctl",
          baseUrl: "http://127.0.0.1:17373",
          buildSha: "development",
          databaseId: "database",
          policyVersion: "guided-authoring-v1",
          maxSessionsPerAssignment: 12,
          canarySessions: 3,
          instanceId: "instance:test",
          instanceManifest: "/tmp/masthead/masthead-instance.json",
          operations: ["start", "inspect", "scaffold", "save", "review", "finish"],
          protocol: "masthead.workbench.authoring/v1",
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );

    const result = await runMastheadCli(["workbench", "capabilities", "--json"], {
      env: { MASTHEAD_DAEMON_URL: "   " }
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/workbench/authoring/capabilities",
      expect.any(Object)
    );
  });

  test("catches unexpected failures at the executable boundary", async () => {
    const binPath = join(process.cwd(), "dist", "daemon", "src", "cli", "mastheadctl.js");
    let failure: { code: number; stderr: string; stdout: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [binPath, "workbench", "author", "save", "--assignment", "missing", "--file", "/definitely/missing/bundle.json", "--json"],
        { env: process.env }
      );
    } catch (error) {
      failure = error as { code: number; stderr: string; stdout: string };
    }

    expect(failure?.code).toBe(1);
    expect(failure?.stdout).toBe("");
    expect(JSON.parse(failure?.stderr ?? "")).toMatchObject({
      ok: false,
      error: { code: "unhandled_cli_error" }
    });
  });

  test("keeps the normal authoring startup path free of SQLite imports", async () => {
    const sourceRoot = join(process.cwd(), "src", "cli");
    for (const file of ["mastheadctl.ts", "workbench.ts", "authoringClient.ts", "guidedAuthoring.ts"]) {
      const source = await readFile(join(sourceRoot, file), "utf8");
      expect(source).not.toMatch(/daemon\/db\/(?:sqlite|schema|workbench|sessionArtifact)/);
    }
  });

  test.each([
    "db-path",
    "schema",
    "instructions",
    "validate",
    "apply",
    "artifacts",
    "publish",
    "na",
    "not-applicable",
    "provenance-candidates",
    "enroll",
    "claim",
    "release",
    "activity",
    "not-added",
    "transcript",
    "quality",
    "batch",
    "queue",
    "next"
  ])("rejects removed direct-database command %s before opening SQLite", async (command) => {
    const tempDir = await makeTempDir("masthead-cli-removed-");
    const databasePath = join(tempDir, "must-not-be-created.sqlite");

    const result = await runMastheadCli(
      ["workbench", command, "--db", databasePath, "--json"],
      { env: {} }
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "unknown_command", message: `Unknown workbench command: ${command}` },
      ok: false
    });
    await expect(stat(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not import the legacy direct-SQLite Workbench stack", async () => {
    const sourceRoot = join(process.cwd(), "src", "cli");
    const source = await readFile(join(sourceRoot, "workbench.ts"), "utf8");
    expect(source).not.toContain("workbenchLegacy");
    await expect(stat(join(sourceRoot, "workbenchLegacy.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cannot mutate SQLite through removed apply, publish, or not-applicable commands", async () => {
    const tempDir = await makeTempDir("masthead-cli-no-direct-writes-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const outputPath = join(tempDir, "enrichment.json");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:boundary",
      title: "Authoring boundary"
    });
    const before = authoringOutputCounts(db);
    db.close();
    await writeFile(
      outputPath,
      JSON.stringify({
        confidence: "medium",
        evidenceRefs: ["message:session:boundary:message"],
        missingEvidence: [],
        searchPhrases: ["authoring boundary"],
        summary: "This must not be written directly.",
        technologies: ["TypeScript"],
        title: "Forbidden direct authoring",
        topics: ["Workbench"]
      }),
      "utf8"
    );

    const removedCommands = [
      ["apply", "--kind", "session_enrichment", "--session", "session:boundary", "--file", outputPath],
      ["publish", "--session", "session:boundary"],
      ["not-applicable", "--kind", "runbook", "--session", "session:boundary", "--reason", "not_needed"]
    ];
    for (const command of removedCommands) {
      const result = await runMastheadCli(
        ["workbench", ...command, "--db", databasePath, "--json"],
        { env: {} }
      );
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: "unknown_command" },
        ok: false
      });
    }

    const afterDb = await openMastheadDatabase(databasePath);
    expect(authoringOutputCounts(afterDb)).toEqual(before);
    afterDb.close();
  });

  test("preserves wipe-published as an explicit direct-database maintenance command", async () => {
    const tempDir = await makeTempDir("masthead-cli-wipe-");
    const dbPath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(dbPath);
    migrateDatabase(db);
    db.close();

    const confirmation = await runMastheadCli(
      ["workbench", "wipe-published", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(confirmation.exitCode).toBe(1);
    expect(JSON.parse(confirmation.stderr)).toMatchObject({ ok: false, error: { code: "missing_argument" } });

    const wiped = await runMastheadCli(
      ["workbench", "wipe-published", "--db", dbPath, "--confirm", "--json"],
      { env: {} }
    );
    expect(wiped.exitCode).toBe(0);
    expect(JSON.parse(wiped.stdout)).toMatchObject({ ok: true });
  });
  test("keeps failed V1 recovery audit and prepare dry for the exact historical population", async () => {
    const { dbPath, tempDir } = await makeExactCliRecoveryFixture("masthead-cli-v1-audit-prepare-");

    const audited = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(audited.exitCode).toBe(0);
    const audit = JSON.parse(audited.stdout).audit as { auditHash: string; dossiers: number };
    expect(audit).toMatchObject({ dossiers: 1_283, auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });

    const prepared = await runMastheadCli(
      ["workbench", "prepare-v1-recovery", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      audit: { auditHash: audit.auditHash, dossiers: 1_283 },
      backup: { integrityResult: "ok", sizeBytes: expect.any(Number) },
      ok: true
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });

    const preparedAgain = await runMastheadCli(
      ["workbench", "prepare-v1-recovery", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(preparedAgain.exitCode).toBe(0);
    expect(JSON.parse(preparedAgain.stdout)).toMatchObject({
      audit: { auditHash: audit.auditHash, dossiers: 1_283 },
      backup: { integrityResult: "ok", sizeBytes: expect.any(Number) },
      ok: true
    });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });
  }, 120_000);

  test("requires exact recovery arguments before opening the population", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-arguments-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);

    const missingHash = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingHash.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });

    const missingConfirmation = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingConfirmation.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });

    for (const omitted of ["backup", "auditHash", "confirmation"] as const) {
      const restoreArgs = ["workbench", "restore-v1-recovery", "--db", dbPath];
      if (omitted !== "backup") restoreArgs.push("--backup", backupPath);
      if (omitted !== "auditHash") restoreArgs.push("--audit-hash", auditHash);
      if (omitted !== "confirmation") restoreArgs.push("--confirm");
      restoreArgs.push("--json");
      const refused = await runMastheadCli(restoreArgs, { env: {} });
      expect(JSON.parse(refused.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    }

    const v3Audit = await runMastheadCli(
      ["workbench", "audit-v3-template-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(JSON.parse(v3Audit.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    const v3Prepare = await runMastheadCli(
      ["workbench", "prepare-v3-template-recovery", "--db", dbPath, "--incident-contract", "incident.json", "--json"],
      { env: {} }
    );
    expect(JSON.parse(v3Prepare.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    for (const command of ["invalidate-v3-template-generation", "restore-v3-template-recovery"]) {
      const missingReceipt = await runMastheadCli(["workbench", command, "--db", dbPath, "--confirm", "--json"], { env: {} });
      expect(JSON.parse(missingReceipt.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
      const missingConfirm = await runMastheadCli(
        ["workbench", command, "--db", dbPath, "--prepared-receipt", "prepared.json", "--json"],
        { env: {} }
      );
      expect(JSON.parse(missingConfirm.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    }
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("refuses recovery paths and sidecars before auditing population rows", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-paths-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);

    await writeFile(`${dbPath}-wal`, "");
    const nonSelfContainedAudit = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(nonSelfContainedAudit.exitCode).toBe(1);
    expect(JSON.parse(nonSelfContainedAudit.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "v1_recovery_audit_database_not_self_contained:wal" },
      ok: false
    });
    await rm(`${dbPath}-wal`);

    const missingPreparedBackup = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingPreparedBackup.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_path_invalid") },
      ok: false
    });

    await copyFile(dbPath, backupPath);
    await writeFile(`${backupPath}-wal`, "");
    const invalidationSidecar = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(invalidationSidecar.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_sidecar_present") },
      ok: false
    });
    await rm(`${backupPath}-wal`);

    const activeBytes = await readFile(dbPath);
    const backupBytes = await readFile(backupPath);
    const backupSidecars = ["-wal", "-shm", "-journal"].map((suffix) => `${backupPath}${suffix}`);
    for (const sidecarPath of backupSidecars) await writeFile(sidecarPath, "");
    const restoreSidecar = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(restoreSidecar.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_restore_backup_sidecar_present") },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(activeBytes);
    expect(await readFile(backupPath)).toEqual(backupBytes);
    for (const sidecarPath of backupSidecars) expect(await readFile(sidecarPath)).toEqual(Buffer.alloc(0));
    await Promise.all(backupSidecars.map((sidecarPath) => rm(sidecarPath)));

    const outside = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath,
        "--backup", join(tempDir, "outside.backup-current"),
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(outside.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });

    const heldBackupPath = join(tempDir, "held-backup.sqlite");
    await rename(backupPath, heldBackupPath);
    await symlink(heldBackupPath, backupPath, "file");
    const symlinked = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(symlinked.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(await readFile(dbPath)).toEqual(activeBytes);
  });

  test("refuses recovery while another database owner is active", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-ownership-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);
    await copyFile(dbPath, backupPath);

    const writerLease = await acquireDatabaseWriterLock(dbPath);
    try {
      const leased = await runMastheadCli(
        [
          "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
          "--audit-hash", auditHash, "--confirm", "--json"
        ],
        { env: {} }
      );
      expect(JSON.parse(leased.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    } finally {
      await writerLease.release();
    }

    const legacyGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      const guarded = await runMastheadCli(
        ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
        { env: {} }
      );
      expect(JSON.parse(guarded.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    } finally {
      await legacyGuard.release();
    }

    const staleSentinelPath = join(tempDir, "runtime", "database.lock");
    const staleSentinel = JSON.stringify({ createdAt: "2026-07-01T00:00:00.000Z", pid: 999_999_999, token: "stale" });
    await writeFile(staleSentinelPath, staleSentinel, "utf8");
    const staleGuard = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(staleGuard.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(await readFile(staleSentinelPath, "utf8")).toBe(staleSentinel);
    await rm(staleSentinelPath);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("rejects malformed invalidation hashes before auditing population rows", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-invalidation-hash-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    await createNormalizedCliBackup(dbPath, backupPath);

    const refused = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", "not-sha256", "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_recovery_audit_hash_invalid" },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("refuses an altered non-exact V1 population with the smallest generation", async () => {
    const { dbPath } = await makeSmallCliRecoveryFixture("masthead-cli-v1-invalidation-population-");

    const refused = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", "a".repeat(64), "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_generation_not_exact:1:1283" },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a small recovery backup has another database identity", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-invalidation-identity-"
    );
    const backup = new DatabaseSync(backupPath);
    backup.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(JSON.stringify({ databaseId: "wrong-database-id" }));
    backup.close();

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_identity_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a small prepared backup population changes", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-invalidation-backup-population-"
    );
    const backup = new DatabaseSync(backupPath);
    backup.prepare(
      "UPDATE workbench_session_state SET adr_status = 'required' WHERE session_id = 'session:cli-failed:0000'"
    ).run();
    backup.close();

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_audit_hash_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a valid requested hash differs from the small audit", async () => {
    useSmallCliRecoveryAudit();
    const { dbPath } = await makeSmallCliRecoveryFixture("masthead-cli-v1-invalidation-valid-hash-");

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", "0".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_active_audit_hash_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("invalidates the exact generation while preserving its verified backup", async () => {
    const { auditHash, backupPath, databaseId, dbPath, tempDir } = await makeExactCliRecoveryFixture(
      "masthead-cli-v1-invalidation-success-",
      { backup: true }
    );

    const invalidated = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(invalidated.exitCode).toBe(0);
    expect(JSON.parse(invalidated.stdout)).toMatchObject({
      ok: true,
      receipt: {
        artifactsInvalidated: 1_283,
        auditHash,
        recoveryBackup: {
          artifacts: 1_283,
          auditHash,
          backupPath,
          backupPreserved: true,
          databaseId,
          device: expect.stringMatching(/^\d+$/u),
          inode: expect.stringMatching(/^\d+$/u),
          integrityResult: "ok",
          runs: 66,
          sessions: 1_283,
          sizeBytes: expect.any(Number)
        },
        sessionsReset: 1_283
      }
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    const verified = new DatabaseSync(dbPath, { readOnly: true });
    expect(verified.prepare(
      "SELECT adr_status AS adrStatus, session_dossier_status AS dossierStatus FROM workbench_session_state WHERE session_id = 'session:cli-failed:0000'"
    ).get()).toEqual({ adrStatus: "unknown", dossierStatus: "missing" });
    verified.close();
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${backupPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("refuses restore before population audit for invalid hash, missing identity, or corrupt bytes", async () => {
    const { databaseId, dbPath, tempDir } = await makeEmptyCliRecoveryFixture(
      "masthead-cli-v1-restore-verification-"
    );
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    await createNormalizedCliBackup(dbPath, backupPath);
    const activeBytes = await readFile(dbPath);

    const invalidHash = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "not-sha256", "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(invalidHash.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_recovery_audit_hash_invalid" },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(activeBytes);

    const active = new DatabaseSync(dbPath);
    active.prepare("DELETE FROM app_settings WHERE setting_key = 'database_identity'").run();
    active.close();
    const missingIdentityBytes = await readFile(dbPath);
    const missingIdentity = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "a".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(missingIdentity.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "database_backup_identity_missing" },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(missingIdentityBytes);

    const resetIdentity = new DatabaseSync(dbPath);
    resetIdentity.prepare(
      "INSERT INTO app_settings (setting_key, setting_json, updated_at) VALUES ('database_identity', ?, ?)"
    ).run(JSON.stringify({ databaseId }), "2026-07-19T12:00:00.000Z");
    resetIdentity.close();
    await writeFile(backupPath, "not a sqlite database", "utf8");
    const corrupt = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "a".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(corrupt.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("keeps active and backup bytes unchanged when restore fails before promotion", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath, tempDir } = await makeSmallCliRecoveryFixture("masthead-cli-v1-restore-rollback-");
    clearCliPublishedRecoveryState(dbPath);
    const activeBytes = await readFile(dbPath);
    const backupBytes = await readFile(backupPath);

    await expect(
      withExclusiveDatabaseMaintenance(dbPath, (ownership) =>
        restoreFailedV1RecoveryBackupInsideExclusiveMaintenance(
          dbPath,
          backupPath,
          SMALL_RECOVERY_AUDIT_HASH,
          ownership,
          {
            onBoundary(boundary) {
              if (boundary === "before_promotion") throw new Error("injected:before_promotion");
            }
          }
        )
      )
    ).rejects.toThrow("injected:before_promotion");
    expect(await readFile(dbPath)).toEqual(activeBytes);
    expect(await readFile(backupPath)).toEqual(backupBytes);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });
    expect((await readdir(tempDir)).some((name) => name.includes("restore-stage"))).toBe(false);
  });

  test("restores a verified failed generation from the preserved sibling backup", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, databaseId, dbPath, tempDir } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-restore-success-"
    );
    clearCliPublishedRecoveryState(dbPath);

    const backup = new DatabaseSync(backupPath);
    const originalIdentity = backup.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string };
    backup.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(JSON.stringify({ databaseId: "wrong-database-id" }));
    backup.close();
    const wrongIdentity = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongIdentity.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });

    const resetIdentity = new DatabaseSync(backupPath);
    resetIdentity.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(originalIdentity.value);
    resetIdentity.close();
    const wrongHash = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "0".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongHash.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });

    for (const suffix of ["-wal", "-shm", "-journal"]) await writeFile(`${dbPath}${suffix}`, "");

    const restored = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(restored.exitCode).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({
      databasePath: dbPath,
      ok: true,
      receipt: {
        artifactsRestored: 1,
        auditHash: SMALL_RECOVERY_AUDIT_HASH,
        backupPath,
        backupPreserved: true,
        databaseId,
        integrityResult: "ok",
        runsRestored: 1,
        sessionsRestored: 1
      }
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${dbPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("audits the exact failed V1 generation through the CLI on schema 21", async () => {
    const tempDir = await makeTempDir("masthead-cli-v1-schema21-audit-");
    const dbPath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(dbPath);
    migrateTestDatabaseThrough(db, 21);
    getOrCreateDatabaseIdentity(db);
    seedCliFailedV1Generation(db, { schema21: true });
    db.close();

    const audited = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );

    expect(audited.exitCode).toBe(0);
    expect(JSON.parse(audited.stdout)).toMatchObject({
      audit: {
        auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contractVersion: "workbench-authoring-v1",
        dossiers: 1_283,
        totalRuns: 66,
        totalSessions: 1_283
      },
      databasePath: dbPath,
      ok: true
    });
  }, 120_000);
});

type ExactCliRecoveryTemplate = {
  auditHash: string;
  databaseId: string;
  databasePath: string;
};

function useSmallCliRecoveryAudit(): void {
  const realAudit = sessionArtifactRepository.auditFailedV1Generation;
  vi.spyOn(sessionArtifactRepository, "auditFailedV1Generation").mockImplementation((database) => {
    const artifacts = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM session_artifacts"
    ).get() as { count: number }).count);
    if (artifacts !== 1) return realAudit(database);
    const alteredPopulation = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM workbench_session_state WHERE adr_status = 'required'"
    ).get() as { count: number }).count) > 0;
    return {
      actorId: "failed-agent",
      adrs: 0,
      auditHash: alteredPopulation ? SMALL_ALTERED_RECOVERY_AUDIT_HASH : SMALL_RECOVERY_AUDIT_HASH,
      contractVersion: "workbench-authoring-v1",
      counts: {
        byKind: { session_dossier: 1 },
        byRun: { "run:cli-failed-v1:000": 1 },
        bySession: { "session:cli-failed:0000": 1 },
        byStatus: { "current/published": 1 }
      },
      createdBy: ["workbench_authoring:failed-agent"],
      dossiers: 1,
      generationFingerprint: "small-recovery-generation",
      generationWindow: { from: "2026-07-11T08:00:00.000Z", to: "2026-07-11T09:00:00.000Z" },
      incidentTimelines: 0,
      publicationWindow: { from: "2026-07-11T08:30:00.000Z", to: "2026-07-11T08:30:00.000Z" },
      runbooks: 0,
      schemaVersions: ["session_dossier-v2"],
      templateFingerprint: "small-recovery-template",
      totalArtifacts: 1,
      totalRuns: 1,
      totalSessions: 1
    };
  });
}

async function exactCliRecoveryTemplate(): Promise<ExactCliRecoveryTemplate> {
  exactCliRecoveryTemplatePromise ??= (async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-v1-template-"));
    suiteTempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const database = await openMastheadDatabase(databasePath);
    migrateDatabase(database);
    const databaseId = getOrCreateDatabaseIdentity(database);
    seedCliFailedV1Generation(database);
    const auditHash = sessionArtifactRepository.auditFailedV1Generation(database).auditHash;
    database.close();
    return { auditHash, databaseId, databasePath };
  })();
  return exactCliRecoveryTemplatePromise;
}

async function makeExactCliRecoveryFixture(
  prefix: string,
  options: { backup?: boolean } = {}
): Promise<{
  auditHash: string;
  backupPath: string;
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const template = await exactCliRecoveryTemplate();
  const tempDir = await makeTempDir(prefix);
  const dbPath = join(tempDir, "masthead.sqlite");
  const backupPath = join(tempDir, "masthead.sqlite.backup-current");
  await copyFile(template.databasePath, dbPath);
  if (options.backup) await createNormalizedCliBackup(dbPath, backupPath);
  return {
    auditHash: template.auditHash,
    backupPath,
    databaseId: template.databaseId,
    dbPath,
    tempDir
  };
}

async function makeEmptyCliRecoveryFixture(prefix: string): Promise<{
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const tempDir = await makeTempDir(prefix);
  const dbPath = join(tempDir, "masthead.sqlite");
  const database = await openMastheadDatabase(dbPath);
  migrateDatabase(database);
  const databaseId = getOrCreateDatabaseIdentity(database);
  database.close();
  return { databaseId, dbPath, tempDir };
}

async function makeSmallCliRecoveryFixture(prefix: string): Promise<{
  backupPath: string;
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const { databaseId, dbPath, tempDir } = await makeEmptyCliRecoveryFixture(prefix);
  const database = await openMastheadDatabase(dbPath);
  seedCliFailedV1Generation(database, { dossierCount: 1 });
  database.close();
  const backupPath = join(tempDir, "masthead.sqlite.backup-current");
  await createNormalizedCliBackup(dbPath, backupPath);
  return { backupPath, databaseId, dbPath, tempDir };
}

async function createNormalizedCliBackup(databasePath: string, backupPath: string): Promise<void> {
  await copyFile(databasePath, backupPath);
  const backup = new DatabaseSync(backupPath);
  try {
    backup.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    backup.close();
  }
}

function clearCliPublishedRecoveryState(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM session_artifact_search;
      DELETE FROM session_artifact_provenance;
      DELETE FROM session_artifacts;
      UPDATE workbench_session_state
      SET publication_status = 'publish_path',
          next_action = 'create_dossier',
          session_dossier_status = 'missing',
          published_at = NULL;
      PRAGMA foreign_keys = ON;
    `);
  } finally {
    database.close();
  }
}

async function startTestDaemon(): Promise<{ baseUrl: string; daemon: MastheadDaemon }> {
  const tempDir = await makeTempDir("masthead-authoring-cli-");
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

async function makeTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function authoringOutputCounts(db: Awaited<ReturnType<typeof openMastheadDatabase>>) {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    artifacts: count("session_artifacts"),
    authoringRuns: count("workbench_authoring_runs"),
    enrichments: count("session_enrichments"),
    pipelineRows: count("workbench_session_state")
  };
}

function seedCliFailedV1Generation(
  db: Awaited<ReturnType<typeof openMastheadDatabase>>,
  options: { dossierCount?: number; schema21?: boolean } = {}
): void {
  const createdAt = "2026-07-11T08:00:00.000Z";
  const publishedAt = "2026-07-11T08:30:00.000Z";
  const completedAt = "2026-07-11T09:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:cli-failed", "fixture", createdAt, completedAt
  );
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:cli-failed", "codex", "fixture", createdAt, completedAt
  );
  const session = db.prepare(
    `INSERT INTO sessions (session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at) VALUES (?, 'host:cli-failed', 'runtime:cli-failed', ?,
      'ended', ?, 'authoritative', ?, ?)`
  );
  const state = db.prepare(
    `INSERT INTO workbench_session_state (session_id, publication_status, next_action, transcript_status,
      quality_status, session_enrichment_status, session_dossier_status, bug_fix_trace_status,
      runbook_status, adr_status, incident_timeline_status, session_package_status, resolution_status,
      published_at, created_at, updated_at) VALUES (?, 'published', 'none', 'available', 'passed',
      'satisfied', 'satisfied', 'not_applicable', 'not_applicable', 'not_applicable', 'not_applicable',
      'published', 'automatic_resolved', ?, ?, ?)`
  );
  const claim = db.prepare(
    `INSERT INTO workbench_claims (claim_id, session_id, claimed_by, claimed_at, heartbeat_at,
      expires_at, released_at, release_reason) VALUES (?, ?, 'failed-agent', ?, ?, ?, ?, ?)`
  );
  const artifact = db.prepare(
    `INSERT INTO session_artifacts (artifact_id, session_id, artifact_kind, status, content_fingerprint,
      created_at, updated_at, created_by, schema_version, title, content_json, evidence_refs_json,
      validation_json, publication_status, lineage_id, published_at) VALUES (?, ?, 'session_dossier',
      'current', ?, ?, ?, 'workbench_authoring:failed-agent', 'session_dossier-v2', ?, ?, '[]', ?,
      'published', ?, ?)`
  );
  const provenance = db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)");
  const search = db.prepare(
    "INSERT INTO session_artifact_search (artifact_id, title, summary, highlight, project, body) VALUES (?, ?, '', '', '', ?)"
  );
  const runSession = db.prepare(
    "INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal) VALUES (?, ?, ?, ?)"
  );
  const packages: Array<Record<string, unknown>> = [];
  const notApplicable: Array<Record<string, unknown>> = [];
  const publishedArtifactIds: string[] = [];
  const resolvedSessionIds: string[] = [];
  const members: Array<{ claimId: string; sessionId: string }> = [];
  for (let index = 0; index < (options.dossierCount ?? 1_283); index += 1) {
    const suffix = String(index).padStart(4, "0");
    const sessionId = `session:cli-failed:${suffix}`;
    const claimId = `claim:cli-failed:${suffix}`;
    const artifactId = `artifact:cli-failed:${suffix}`;
    const dossier = {
      approach: [
        "Read every canonical evidence item through cursor pagination.",
        "Kept all claims single-session and limited unsupported root-cause or publication assertions."
      ],
      commandsAndTools: [{
        label: "Masthead Workbench evidence reader",
        purpose: "Read the session manifest to completion.",
        status: "completed"
      }],
      filesTouched: [{
        label: "No canonical file effect recorded",
        role: "No file effect was asserted in the reviewed evidence."
      }],
      keyDecisions: ["Keep the package single-provenance and avoid weak multi-session joins."],
      missingEvidence: ["The redacted session record does not independently establish a published artifact or durable root cause."],
      outcome: "The canonical redacted record was fully reviewed; no stronger published outcome is asserted without direct supporting evidence.",
      problemStatement: "Generic problem: review the selected session's canonical evidence.",
      title: `CLI failed dossier ${suffix}`
    };
    session.run(sessionId, sessionId, publishedAt, createdAt, publishedAt);
    state.run(sessionId, publishedAt, createdAt, publishedAt);
    claim.run(claimId, sessionId, createdAt, createdAt, completedAt, index === 0 ? null : completedAt, index === 0 ? null : "authoring_finished");
    artifact.run(
      artifactId, sessionId, fingerprintWorkbenchOutput(dossier), createdAt, publishedAt, dossier.title,
      JSON.stringify(dossier), JSON.stringify({ contract: "workbench-authoring-v1", ok: true, schemaVersion: "session_dossier-v2" }),
      artifactId, publishedAt
    );
    provenance.run(artifactId, sessionId);
    search.run(artifactId, dossier.title, JSON.stringify(dossier));
    packages.push({ dossier, enrichment: {}, sessionId });
    publishedArtifactIds.push(artifactId);
    resolvedSessionIds.push(sessionId);
    members.push({ claimId, sessionId });
    for (const kind of ["runbook", "adr", "incident_timeline"]) {
      notApplicable.push({ evidenceRefs: [], kind, reason: "No reusable output", sessionId });
    }
  }
  const insertRun = db.prepare(options.schema21
    ? `INSERT INTO workbench_authoring_runs (run_id, actor_id, database_id, status, evidence_revision,
        bundle_json, findings_json, receipt_json, created_at, updated_at, completed_at)
       VALUES (?, 'failed-agent', 'fixture-db', 'completed', 'cli-revision', ?, '[]', ?, ?, ?, ?)`
    : `INSERT INTO workbench_authoring_runs (run_id, actor_id, database_id, status, evidence_revision,
        bundle_json, findings_json, receipt_json, created_at, updated_at, completed_at, contract_version,
        candidate_id) VALUES (?, 'failed-agent', 'fixture-db', 'completed', 'cli-revision', ?, '[]', ?, ?, ?, ?,
        'workbench-authoring-v1', NULL)`
  );
  let offset = 0;
  for (let runIndex = 0; offset < packages.length; runIndex += 1) {
    const remaining = packages.length - offset;
    const size = remaining === 3 ? 2 : Math.min(20, remaining);
    const runId = `run:cli-failed-v1:${String(runIndex).padStart(3, "0")}`;
    const runPackages = packages.slice(offset, offset + size);
    const runMembers = members.slice(offset, offset + size);
    const runArtifactIds = publishedArtifactIds.slice(offset, offset + size);
    const runSessionIds = resolvedSessionIds.slice(offset, offset + size);
    const runNotApplicable = notApplicable.filter((decision) =>
      runSessionIds.includes(decision.sessionId as string)
    );
    const bundle = {
      artifacts: [], bundleVersion: "workbench-authoring-v1", contributions: [], evidenceRevision: "cli-revision",
      notApplicable: runNotApplicable, runId, sessionPackages: runPackages
    };
    const receipt = {
      completedAt, contributions: [], notApplicable: runNotApplicable.map(({ kind, sessionId }) => ({ kind, sessionId })),
      publishedArtifactIds: runArtifactIds, resolvedSessionIds: runSessionIds, runId
    };
    insertRun.run(runId, JSON.stringify(bundle), JSON.stringify(receipt), createdAt, completedAt, completedAt);
    runMembers.forEach((member, index) => runSession.run(runId, member.sessionId, member.claimId, index));
    offset += size;
  }
}

function readCliRecoveryCounts(databasePath: string): { artifacts: number; runs: number } {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    return { artifacts: count("session_artifacts"), runs: count("workbench_authoring_runs") };
  } finally {
    db.close();
  }
}
