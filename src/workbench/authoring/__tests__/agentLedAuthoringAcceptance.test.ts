import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  getLogbookArtifactDetail,
  searchLogbookArtifacts
} from "../../../daemon/db/logbookArtifactRepository.ts";
import { getSessionDossier } from "../../../daemon/db/sessionDossierRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import { routeWorkbenchAuthoringRequest } from "../../../daemon/workbenchAuthoringApi.ts";
import { handleMcpLine } from "../../../mcp/protocol.ts";
import type { WorkbenchAuthoringReceiptV3, WorkbenchAuthoringRunDto } from "../../../shared/workbenchAuthoring.ts";
import { buildWorkbenchHandoff } from "../../../ui/workbench/workbenchHandoff.ts";
import {
  buildFocusedAgentLedBundle,
  focusedAgentLedCorpus,
  misleadingSuggestionSession,
  seedFocusedAgentLedCorpus
} from "../__fixtures__/durableArtifactCorpus.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import {
  finishAuthoringRun,
  openAgentLedAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("focused agent-led authoring acceptance", () => {
  test("enriches four sessions and publishes agent-chosen artifacts through Logbook and MCP", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, focusedAgentLedCorpus);
    const sessionIds = focusedAgentLedCorpus.map(({ id }) => id);
    const databaseId = getOrCreateDatabaseIdentity(db);
    const handoff = buildWorkbenchHandoff({
      authoringCommand: "/opt/masthead/bin/mastheadctl",
      databaseId,
      sessionIds,
      sessions: focusedAgentLedCorpus.map((session) => ({
        bugFixTraceStatus: "unknown",
        lastActivityAt: session.evidence.at(-1)!.observedAt,
        lifecycle: "ended",
        nextAction: "enrich",
        publicationStatus: "publish_path",
        qualityStatus: "passed",
        runtime: "codex",
        sessionDossierStatus: "missing",
        sessionEnrichmentStatus: "missing",
        sessionId: session.id,
        title: session.title,
        transcriptStatus: "imported"
      }))
    });
    const machineRequest = JSON.parse(handoff.split("\n").find((line) => line.startsWith("{")) ?? "{}") as {
      bundleVersion?: string;
      sessionIds?: string[];
    };
    expect(machineRequest).toMatchObject({ bundleVersion: "workbench-authoring-v3", sessionIds });

    const originals = new Map(sessionIds.map((sessionId) => [sessionId, getSessionDossier(db, sessionId)!]));
    const openedResponse = await authoringRoute(db, "POST", "/workbench/authoring/runs", {
      actorId: "acceptance-agent",
      databaseId,
      sessionIds: machineRequest.sessionIds
    });
    expect(openedResponse.status).toBe(201);
    const opened = (openedResponse.body as { run: WorkbenchAuthoringRunDto }).run;
    const bundle = buildFocusedAgentLedBundle(opened, focusedAgentLedCorpus);

    const submittedResponse = await authoringRoute(
      db,
      "POST",
      `/workbench/authoring/runs/${encodeURIComponent(opened.runId)}/submit`,
      bundle
    );
    const submitted = submittedResponse.body as ReturnType<typeof submitAuthoringBundle>;
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);
    const finishedResponse = await authoringRoute(
      db,
      "POST",
      `/workbench/authoring/runs/${encodeURIComponent(opened.runId)}/finish`,
      {}
    );
    const receipt = (finishedResponse.body as { receipt: WorkbenchAuthoringReceiptV3 }).receipt;

    expect(receipt.dossierArtifactIds).toHaveLength(4);
    expect(receipt.optionalArtifacts.map((item) => item.kind).sort()).toEqual([
      "adr",
      "incident_timeline",
      "runbook"
    ]);
    expect(logbookKinds(db, receipt)).toEqual([
      "session_dossier",
      "session_dossier",
      "session_dossier",
      "session_dossier",
      "runbook",
      "adr",
      "incident_timeline"
    ]);
    expect(allDossiersHaveCurrentEnrichment(db, receipt.dossierArtifactIds)).toBe(true);
    expect(allDossiersPreserveCanonicalShape(db, receipt, originals)).toBe(true);
    expect(allOptionalClaimsHaveVerbatimSupport(db, receipt.optionalArtifacts.map(({ artifactId }) => artifactId)))
      .toBe(true);

    const publishedArtifactIds = [
      ...receipt.dossierArtifactIds,
      ...receipt.optionalArtifacts.map(({ artifactId }) => artifactId)
    ];
    for (const artifactId of publishedArtifactIds) {
      const detail = getLogbookArtifactDetail(db, artifactId)!;
      const search = callMcp(db, "search_artifacts", { query: detail.capsule.title });
      expect(search.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ artifactId })
      ]));
      expect(callMcp(db, "get_artifact", { artifactId })).toMatchObject({
        artifact: {
          capsule: { artifactId },
          provenanceSessionIds: detail.provenanceSessionIds
        }
      });
    }
    db.close();
  });

  test("publishes grounded agent judgment when detector suggestions are absent", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    expect(discoverArtifactCandidates(db, [misleadingSuggestionSession.id])).toEqual([]);
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "acceptance-agent",
      databaseId: getOrCreateDatabaseIdentity(db),
      sessionIds: [misleadingSuggestionSession.id]
    });
    const bundle = buildFocusedAgentLedBundle(opened.run, [misleadingSuggestionSession], ["adr"]);
    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");
    expect(receipt.optionalArtifacts.map(({ kind }) => kind)).toEqual(["adr"]);
    expect(getLogbookArtifactDetail(db, receipt.optionalArtifacts[0]!.artifactId)).toMatchObject({
      capsule: { kind: "adr" },
      provenanceSessionIds: [misleadingSuggestionSession.id]
    });
    db.close();
  });
});

async function openFixtureDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-agent-led-acceptance-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function logbookKinds(
  db: MastheadDatabase,
  receipt: WorkbenchAuthoringReceiptV3
): string[] {
  const expectedOrder = [
    ...receipt.dossierArtifactIds,
    ...receipt.optionalArtifacts.map(({ artifactId }) => artifactId)
  ];
  const indexed = searchLogbookArtifacts(db, { limit: 50 });
  if (indexed.total !== expectedOrder.length) return indexed.artifacts.map(({ kind }) => kind);
  const indexedById = new Map(indexed.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  return expectedOrder.map((artifactId) => indexedById.get(artifactId)?.kind ?? "missing");
}

function allDossiersPreserveCanonicalShape(
  db: MastheadDatabase,
  receipt: WorkbenchAuthoringReceiptV3,
  originals: Map<string, NonNullable<ReturnType<typeof getSessionDossier>>>
): boolean {
  return receipt.dossierArtifactIds.every((artifactId) => {
    const detail = getLogbookArtifactDetail(db, artifactId);
    const sessionId = detail?.provenanceSessionIds[0];
    const original = sessionId ? originals.get(sessionId) : undefined;
    if (!detail || !sessionId || !original) return false;
    const current = getSessionDossier(db, sessionId);
    if (!current) return false;
    const { artifacts: _currentArtifacts, ...currentBody } = current;
    const { capturedAt: _capturedAt, snapshotVersion: _snapshotVersion, ...publishedBody } = detail.body as Record<string, unknown>;
    const originalSectionKeys = Object.keys(original).filter((key) => key !== "artifacts");
    const normalizedCurrent = neutralizePublicationState(JSON.parse(JSON.stringify(currentBody)) as Record<string, unknown>);
    const normalizedPublished = neutralizePublicationState(structuredClone(publishedBody));
    const mismatched = originalSectionKeys.filter((key) =>
      !Object.hasOwn(normalizedPublished, key) || !isDeepStrictEqual(normalizedPublished[key], normalizedCurrent[key])
    );
    if (mismatched.length > 0) throw new Error(`dossier_shape_mismatch:${sessionId}:${mismatched.join(",")}`);
    return true;
  });
}

function neutralizePublicationState(body: Record<string, unknown>): Record<string, unknown> {
  const reuse = body.reuse as Record<string, unknown> | undefined;
  if (!reuse) return body;
  delete reuse.mcpIncluded;
  if (typeof reuse.copyableContext === "string") {
    reuse.copyableContext = reuse.copyableContext.replace(
      /\nAgent retrieval: (?:included|excluded)$/u,
      "\nAgent retrieval: publication-state"
    );
  }
  return body;
}

function allDossiersHaveCurrentEnrichment(db: MastheadDatabase, artifactIds: string[]): boolean {
  return artifactIds.every((artifactId) => {
    const body = getLogbookArtifactDetail(db, artifactId)?.body as Record<string, unknown> | undefined;
    const durableEnrichment = body?.durableEnrichment as Record<string, unknown> | undefined;
    const enrichment = body?.enrichment as Record<string, unknown> | undefined;
    return durableEnrichment?.version === "session-capsule-v4" && enrichment?.status === "current";
  });
}

function allOptionalClaimsHaveVerbatimSupport(db: MastheadDatabase, artifactIds: string[]): boolean {
  return artifactIds.every((artifactId) => {
    const detail = getLogbookArtifactDetail(db, artifactId);
    const body = detail?.body as { claimSupport?: Array<{ evidenceRef: string; excerpt: string }> } | undefined;
    if (!detail || !body?.claimSupport?.length) return false;
    return body.claimSupport.every(({ evidenceRef, excerpt }) =>
      detail.evidenceRefs.includes(evidenceRef)
      && focusedAgentLedCorpus.some(({ evidence }) =>
        evidence.some((item) => item.id === evidenceRef && item.text.includes(excerpt)))
    );
  });
}

function callMcp(db: MastheadDatabase, tool: string, args: Record<string, unknown>): Record<string, any> {
  const output = handleMcpLine(db, JSON.stringify({ arguments: args, id: 1, tool }));
  const response = JSON.parse(output ?? "{}") as { result?: Record<string, any> };
  if (!response.result) throw new Error(`mcp_call_failed:${tool}`);
  return response.result;
}

async function authoringRoute(
  db: MastheadDatabase,
  method: string,
  path: string,
  body?: unknown
) {
  const response = await routeWorkbenchAuthoringRequest(
    { authoringCommand: "/opt/masthead/bin/mastheadctl", db },
    { body, method, url: new URL(path, "http://127.0.0.1") }
  );
  if (!response) throw new Error(`authoring_route_missing:${path}`);
  return response;
}
