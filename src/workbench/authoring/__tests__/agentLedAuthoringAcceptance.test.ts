import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getLogbookArtifactDetail } from "../../../daemon/db/logbookArtifactRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import { handleMcpLine } from "../../../mcp/protocol.ts";
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
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "acceptance-agent",
      databaseId: getOrCreateDatabaseIdentity(db),
      sessionIds
    });
    const bundle = buildFocusedAgentLedBundle(opened.run, focusedAgentLedCorpus);

    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);
    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    expect(receipt.contractVersion).toBe("workbench-authoring-v3");
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");

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
    expect(allOptionalClaimsHaveVerbatimSupport(db, receipt.optionalArtifacts.map(({ artifactId }) => artifactId)))
      .toBe(true);

    for (const optionalArtifact of receipt.optionalArtifacts) {
      const detail = getLogbookArtifactDetail(db, optionalArtifact.artifactId)!;
      const search = callMcp(db, "search_artifacts", { query: detail.capsule.title });
      expect(search.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ artifactId: optionalArtifact.artifactId })
      ]));
      expect(callMcp(db, "get_artifact", { artifactId: optionalArtifact.artifactId })).toMatchObject({
        artifact: {
          capsule: { artifactId: optionalArtifact.artifactId },
          provenanceSessionIds: optionalArtifact.provenanceSessionIds
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
  receipt: Extract<ReturnType<typeof finishAuthoringRun>, { contractVersion: "workbench-authoring-v3" }>
): string[] {
  return [
    ...receipt.dossierArtifactIds,
    ...receipt.optionalArtifacts.map(({ artifactId }) => artifactId)
  ].map((artifactId) => getLogbookArtifactDetail(db, artifactId)?.capsule.kind ?? "missing");
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
