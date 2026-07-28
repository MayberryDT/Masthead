import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import { getLogbookArtifactDetail } from "../../../daemon/db/logbookArtifactRepository.ts";
import { readCurrentSessionEnrichment } from "../../../daemon/db/enrichmentRepository.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import {
  WORKBENCH_AUTHORING_V5_COMPLETE_STOP_RULE,
  WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE,
  toWorkbenchAuthoringV5AuthoredDraft,
  type WorkbenchAuthoringV5Draft
} from "../../../shared/workbenchAuthoringV5.ts";
import {
  bootstrapWorkbenchAuthoringV5Request,
  buildWorkbenchAuthoringV5Scaffold,
  createWorkbenchAuthoringV5Request as acceptWorkbenchAuthoringV5Request,
  finishWorkbenchAuthoringV5Pack,
  getWorkbenchAuthoringV5RequestStatus,
  inspectWorkbenchAuthoringV5Pack,
  prepareWorkbenchAuthoringV5RequestStep,
  saveWorkbenchAuthoringV5Draft,
  startWorkbenchAuthoringV5Pack
} from "../workbenchAuthoringV5Service.ts";
import {
  COMPACTION_BANNER_FIXTURE,
  CRON_BOILERPLATE_FIXTURE,
  PRODUCTION_REMEDIATION_ESCAPE_FIXTURES,
  S7_FALSE_GREEN_FIXTURES,
  UNSUPPORTED_COMPLETION_THRASH_FIXTURE
} from "../__fixtures__/v5QualityFailures.ts";

const tempDirs: string[] = [];
const identity = {
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  databaseId: "database:test",
  instanceId: "instance:test",
  instanceManifest: "/tmp/masthead-instance.json"
};
const command = "/opt/masthead/bin/mastheadctl";
let creationSequence = 0;

function createWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: Omit<Parameters<typeof acceptWorkbenchAuthoringV5Request>[1], "creationToken">
) {
  const creationToken = `service-test:${creationSequence++}`;
  const accepted = acceptWorkbenchAuthoringV5Request(db, { ...input, creationToken });
  while (!prepareWorkbenchAuthoringV5RequestStep(db, accepted.preparation.requestId).done) {
    // Service tests drive the same durable preparation state machine without a daemon coordinator.
  }
  const ready = acceptWorkbenchAuthoringV5Request(db, { ...input, creationToken });
  if (!ready.request || !ready.selection) throw new Error("expected_ready_authoring_request");
  return { ...ready, request: ready.request, selection: ready.selection };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("workbench-authoring-v5 loop", () => {
  test("hard-rejects production-remediation title and description escapes at save", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 6 }, (_, index) => `session:v5:remediation-escape:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    authored.sessions[0]!.fields.title = PRODUCTION_REMEDIATION_ESCAPE_FIXTURES.truncatedRecommendedPluginsTitle;
    authored.sessions[1]!.fields.title = PRODUCTION_REMEDIATION_ESCAPE_FIXTURES.conversationalTitle;
    for (const [index, title] of PRODUCTION_REMEDIATION_ESCAPE_FIXTURES.implementationTitles.entries()) {
      authored.sessions[index + 2]!.fields.title = title;
    }
    authored.sessions[4]!.fields.description = PRODUCTION_REMEDIATION_ESCAPE_FIXTURES.addressedRequestDescription;

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command, currentIdentity: identity, draft: authored, expectedIdentity: identity, packId: started.pack.packId
    });

    expect(saved.outcomes.map(({ disposition }) => disposition)).toEqual([
      "hard_reject", "hard_reject", "hard_reject", "hard_reject", "hard_reject", "publishable"
    ]);
    expect(saved.outcomes.map(({ findings }) => findings.map(({ code }) => code))).toEqual([
      expect.arrayContaining(["protocol_or_compaction_boilerplate"]),
      expect.arrayContaining(["conversational_filler_title"]),
      expect.arrayContaining(["conversational_filler_title"]),
      expect.arrayContaining(["conversational_filler_title"]),
      expect.arrayContaining(["templated_request_echo"]),
      []
    ]);
    db.close();
  });

  test("rejects S7 false-green metadata and filler dossiers while publishing a useful skill-shaped dossier", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 4 }, (_, index) => `session:v5:s7-quality:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    for (const [index, fixture] of [
      S7_FALSE_GREEN_FIXTURES.environmentContext,
      S7_FALSE_GREEN_FIXTURES.agentsContext,
      S7_FALSE_GREEN_FIXTURES.conversationalFiller
    ].entries()) {
      const fields = authored.sessions[index]!.fields;
      fields.title = fixture.title;
      fields.description = fixture.description;
      fields.purpose = fixture.purpose;
      fields.keywords = [...fixture.keywords];
    }
    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command, currentIdentity: identity, draft: authored, expectedIdentity: identity, packId: started.pack.packId
    });
    expect(saved.outcomes.map(({ disposition }) => disposition)).toEqual(["hard_reject", "hard_reject", "hard_reject", "publishable"]);
    expect(saved.outcomes[0]!.findings.map(({ code }) => code)).toContain("context_or_metadata_title");
    expect(saved.outcomes[1]!.findings.map(({ code }) => code)).toContain("templated_request_echo");
    expect(saved.outcomes[2]!.findings.map(({ code }) => code)).toContain("conversational_filler_title");
    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    });
    expect(finished.receipt.counts).toMatchObject({ attempted: 4, published: 1, rejected: 3 });
    expect(getLogbookArtifactDetail(db, finished.receipt.publishedArtifacts[0]!.artifactId)?.capsule.title).toContain("OAuth callback fix");
    const reEnrich = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity,
      reEnrich: true, sessionIds: [sessionIds[3]!]
    });
    expect(reEnrich.selection).toMatchObject({ eligibleSessionCount: 1, excludedSessionCount: 0 });
    db.close();
  });

  test.each([1, 2, 3, 4])("accepts a %i-session final pack", async (sessionCount) => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: sessionCount }, (_, index) => `session:v5:small:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);

    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });

    expect(created.request.packSizes).toEqual([sessionCount]);
    db.close();
  });

  test("completes multiple fixed packs with mixed outcomes and idempotent receipts", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 13 }, (_, index) => `session:v5:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);

    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });

    expect(created.handoff).toEqual({
      requestId: created.request.requestId,
      startCommand: `${command} workbench author bootstrap --request '${created.request.requestId}' --json`
    });
    expect(Object.keys(created.handoff)).toEqual(["requestId", "startCommand"]);
    expect(created.request.packSizes).toHaveLength(2);
    expect(created.request.packSizes.every((size) => size >= 5 && size <= 12)).toBe(true);

    const bootstrap = bootstrapWorkbenchAuthoringV5Request(db, {
      command,
      requestId: created.request.requestId
    });
    expect(bootstrap).toMatchObject({
      contractVersion: "workbench-authoring-v5",
      instanceIdentity: identity,
      optionalPolicy: {
        artifactDraft: "allowed_only_when_yes",
        decisions: ["yes", "no"],
        maximumConsiderationsPerPack: 3,
        minimumConsiderationsPerPack: 1
      },
      packPolicy: { fullSelectionRequired: true, maximumSessions: 12, minimumSessions: 5 },
      rejectRules: { behavior: "flag_and_continue" },
      skillContract: {
        owner: "agent",
        scaffoldWritesProse: false,
        loop: ["start", "inspect", "scaffold", "save", "finish", "claim_next_or_complete"],
        obligation: "Continue until the immutable request-complete receipt is returned. Resume is only crash recovery."
      },
      nextAction: {
        kind: "start",
        progress: {
          packsCompleted: 0,
          packsTotal: 2,
          sessionsAttempted: 0,
          sessionsTotal: 13,
          requestComplete: false
        },
        stopRule: WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE
      }
    });
    expect(bootstrap.skillContract.loop).toContain("claim_next_or_complete");
    expect(bootstrap.nextAction.stopRule).toContain('nextAction.kind === "complete"');
    expect(bootstrap.nextAction.stopRule).toMatch(/request receipt/i);
    expect(bootstrap.nextAction.stopRule).toMatch(/Pack finish is not request completion/i);
    expect(bootstrap.nextAction.stopRule).toMatch(/Immediately run nextAction\.command/i);

    let expectedPublished = 0;
    let expectedRejected = 0;
    let expectedSoftFlagged = 0;
    for (let packIndex = 0; packIndex < 2; packIndex += 1) {
      const started = startWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        requestId: created.request.requestId
      });
      if (!("pack" in started)) throw new Error("expected_active_pack");
      const packId = started.pack.packId;
      expect(started.nextAction).toMatchObject({
        progress: { requestComplete: false, packsTotal: 2, sessionsTotal: 13 },
        stopRule: WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE
      });

      while (true) {
        const inspected = inspectWorkbenchAuthoringV5Pack(db, {
          command,
          currentIdentity: identity,
          expectedIdentity: identity,
          packId
        });
        if (inspected.coverage.every(({ complete }) => complete)) break;
      }

      const scaffold = buildWorkbenchAuthoringV5Scaffold(db, { command, packId });
      expect(scaffold.draft.sessions).toHaveLength(started.pack.sessionIds.length);
      expect(scaffold.draft.sessions.every(({ fields }) => (
        fields.title === "" && fields.description === "" && fields.keywords.length === 0 &&
        fields.purpose === "" && fields.outcome === "" && fields.keyWork.length === 0 &&
        fields.verification.summary === ""
      ))).toBe(true);
      expect(scaffold.draft.sessions.every(({ evidenceCatalog }) => evidenceCatalog.length > 0)).toBe(true);

      const authored = authorDraft(scaffold.draft);
      authored.sessions[0]!.fields.evidenceRefs.title = ["evidence:not-canonical"];
      authored.sessions[1]!.fields.verification = { status: "unknown", summary: "Verification looks okay." };
      const saved = saveWorkbenchAuthoringV5Draft(db, {
        command,
        currentIdentity: identity,
        draft: authored,
        expectedIdentity: identity,
        packId
      });
      expect(saved.outcomes.map(({ disposition }) => disposition)).toEqual([
        "hard_reject",
        "soft_flag",
        ...Array.from({ length: authored.sessions.length - 2 }, () => "publishable" as const)
      ]);
      expect(saved.requestStatus).toBe("active");

      const resumed = startWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        requestId: created.request.requestId
      });
      expect(resumed).toMatchObject({ pack: { packId }, nextAction: { kind: "finish" } });

      const finished = finishWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        packId
      });
      const expectedStartCommand =
        `${command} workbench author start --request '${created.request.requestId}' --json`;
      if (packIndex === 0) {
        // ISSUE-A5: pack finish is not request completion.
        expect(finished.nextAction).toMatchObject({
          kind: "claim_next",
          command: expectedStartCommand,
          progress: { requestComplete: false },
          stopRule: WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE
        });
        expect(finished.nextAction.kind).not.toBe("complete");
        expect(finished.followUp).toEqual({
          kind: "start",
          command: expectedStartCommand,
          reason: expect.stringMatching(/incomplete|next|claim|start/i)
        });
        expect(finished.requestReceipt).toBeUndefined();
        const midStatus = getWorkbenchAuthoringV5RequestStatus(db, {
          command,
          requestId: created.request.requestId
        });
        expect(midStatus).not.toHaveProperty("receipt");
        expect(midStatus.request.status).toBe("active");
        expect(midStatus.nextAction.kind).not.toBe("complete");
      } else {
        expect(finished.nextAction).toMatchObject({
          kind: "complete",
          command: "",
          progress: { requestComplete: true },
          stopRule: WORKBENCH_AUTHORING_V5_COMPLETE_STOP_RULE
        });
        expect(finished.followUp).toBeUndefined();
        expect(finished.requestReceipt).toMatchObject({
          receiptVersion: "workbench-authoring-v5-request-receipt-v1",
          requestId: created.request.requestId
        });
      }
      const retried = finishWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        packId
      });
      expect(retried).toEqual(finished);

      // ISSUE-A5: agent-facing multipack contract — pack finish is not request completion.
      // A1 may later add stopRule/progress on finish/status DTOs; extend these assertions after A1 merges.
      const isLastPack = packIndex === 1;
      if (!isLastPack) {
        expect(finished).not.toHaveProperty("requestReceipt");
        expect(finished.nextAction.kind).toBe("claim_next");
        expect(finished.nextAction.kind).not.toBe("complete");
        expect(finished.nextAction.command).toContain("workbench author start");
        const midStatus = getWorkbenchAuthoringV5RequestStatus(db, {
          command,
          requestId: created.request.requestId
        });
        expect(midStatus).not.toHaveProperty("receipt");
        expect(midStatus.request.status).toBe("active");
        expect(midStatus.nextAction.kind).not.toBe("complete");
        expect(midStatus.nextAction.kind).toBe("start");
      } else {
        expect(finished.requestReceipt).toMatchObject({
          receiptVersion: "workbench-authoring-v5-request-receipt-v1",
          requestId: created.request.requestId
        });
        expect(finished.nextAction.kind).toBe("complete");
        expect(finished.nextAction.command).toBe("");
      }

      expectedPublished += authored.sessions.length - 1;
      expectedRejected += 1;
      expectedSoftFlagged += 1;

      if (packIndex === 0) {
        // After first pack finish: remaining work must force claim_next, not "done".
        expect(finished.nextAction.kind).toBe("claim_next");
        expect(finished.nextAction.progress).toEqual({
          packsCompleted: 1,
          packsTotal: 2,
          sessionsAttempted: started.pack.sessionIds.length,
          sessionsTotal: 13,
          requestComplete: false
        });
        expect(finished.nextAction.stopRule).toBe(WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE);
        expect(finished.nextAction.reason).toMatch(
          new RegExp(
            `Request incomplete \\(${started.pack.sessionIds.length}/13 sessions, 1/2 packs\\)`
          )
        );
        expect(finished.nextAction.reason).toMatch(/Immediately run nextAction\.command/);
        expect(finished.nextAction.reason).toMatch(/Do not report success/);
        expect(finished).not.toHaveProperty("requestReceipt");
      } else {
        expect(finished.nextAction.kind).toBe("complete");
        expect(finished.nextAction.progress).toEqual({
          packsCompleted: 2,
          packsTotal: 2,
          sessionsAttempted: 13,
          sessionsTotal: 13,
          requestComplete: true
        });
        expect(finished.nextAction.stopRule).toBe(WORKBENCH_AUTHORING_V5_COMPLETE_STOP_RULE);
        expect(finished.requestReceipt).toMatchObject({
          receiptVersion: "workbench-authoring-v5-request-receipt-v1",
          requestId: created.request.requestId
        });
      }
    }

    const status = getWorkbenchAuthoringV5RequestStatus(db, {
      command,
      requestId: created.request.requestId
    });
    expect(status.nextAction).toMatchObject({
      kind: "complete",
      command: "",
      progress: { requestComplete: true, packsCompleted: 2, packsTotal: 2, sessionsAttempted: 13, sessionsTotal: 13 },
      stopRule: WORKBENCH_AUTHORING_V5_COMPLETE_STOP_RULE
    });
    expect(status.receipt).toMatchObject({
      receiptVersion: "workbench-authoring-v5-request-receipt-v1",
      requestId: created.request.requestId,
      counts: {
        attempted: 13,
        consideredNo: 2,
        optionalPublished: 0,
        published: expectedPublished,
        rejected: expectedRejected,
        softFlagged: expectedSoftFlagged
      }
    });
    expect(bootstrapWorkbenchAuthoringV5Request(db, {
      command,
      requestId: created.request.requestId
    })).toMatchObject({
      receipt: status.receipt,
      nextAction: {
        kind: "complete",
        progress: { requestComplete: true },
        stopRule: WORKBENCH_AUTHORING_V5_COMPLETE_STOP_RULE
      }
    });
    const activityTypes = (db.prepare(
      "SELECT DISTINCT event_type AS eventType FROM workbench_activity WHERE related_run_id = ? ORDER BY eventType"
    ).all(created.request.requestId) as Array<{ eventType: string }>).map(({ eventType }) => eventType);
    expect(activityTypes).toEqual(expect.arrayContaining([
      "authoring_request_created",
      "authoring_pack_claimed",
      "authoring_session_published",
      "authoring_session_soft_flagged",
      "authoring_session_rejected",
      "authoring_pack_finished",
      "authoring_request_completed"
    ]));
    db.close();
  });

  test("non-final finish embeds followUp start payload without auto-claiming the next pack", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 20 }, (_, index) => `session:v5:followup:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    expect(created.request.packSizes).toEqual([10, 10]);
    const requestId = created.request.requestId;
    const expectedStartCommand =
      `${command} workbench author start --request '${requestId}' --json`;

    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    const packId = started.pack.packId;
    expect(started.pack.ordinal).toBe(0);
    await inspectWholePack(db, packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId }).draft);
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId
    });

    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId
    });

    expect(finished.nextAction).toMatchObject({
      kind: "claim_next",
      command: expectedStartCommand
    });
    expect(finished.followUp).toEqual({
      kind: "start",
      command: expectedStartCommand,
      reason: expect.stringMatching(/incomplete|next fixed pack|do not report success/i)
    });
    expect(finished.followUp!.command).toContain("workbench author start --request");
    expect(finished.followUp!.command).toBe(finished.nextAction.command);
    expect(finished.requestReceipt).toBeUndefined();

    // Explicit start still required — finish only returns the payload.
    const next = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId
    });
    expect(next).toMatchObject({ pack: { ordinal: 1, status: "active" } });
    if (!("pack" in next)) throw new Error("expected_active_pack");
    await inspectWholePack(db, next.pack.packId);
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: next.pack.packId }).draft),
      expectedIdentity: identity,
      packId: next.pack.packId
    });
    const finalFinish = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: next.pack.packId
    });
    expect(finalFinish.nextAction).toMatchObject({ kind: "complete", command: "" });
    expect(finalFinish.followUp).toBeUndefined();
    expect(finalFinish.requestReceipt).toMatchObject({
      receiptVersion: "workbench-authoring-v5-request-receipt-v1",
      requestId
    });
    db.close();
  });

  test("non-final pack finish records authoring_pack_finished with remaining work; final emits request completed", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 20 }, (_, index) => `session:v5:activity-a7:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const requestId = created.request.requestId;

    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft),
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: started.pack.packId
    });

    const midPackFinished = db.prepare(
      `SELECT event_type AS eventType, summary, details_json AS detailsJson
       FROM workbench_activity
       WHERE related_run_id = ? AND event_type = 'authoring_pack_finished'
       ORDER BY event_at ASC LIMIT 1`
    ).get(requestId) as { eventType: string; summary: string; detailsJson: string };
    expect(midPackFinished).toBeTruthy();
    const midDetails = JSON.parse(midPackFinished.detailsJson) as Record<string, unknown>;
    expect(midDetails).toMatchObject({
      requestComplete: false,
      remainingPacks: 1,
      remainingSessions: 10,
      packsCompleted: 1,
      packsTotal: 2,
      sessionsAttempted: 10,
      sessionsTotal: 20
    });
    expect(midPackFinished.summary).toMatch(/pack finished|request (still )?open/i);
    expect(midPackFinished.summary).not.toMatch(/request completed/i);
    expect(typeof midDetails.message === "string" ? midDetails.message : "").toMatch(
      /pack done|request (still )?open|remaining/i
    );
    const midCompleted = db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_activity
       WHERE related_run_id = ? AND event_type = 'authoring_request_completed'`
    ).get(requestId) as { count: number };
    expect(Number(midCompleted.count)).toBe(0);

    const next = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId
    });
    if (!("pack" in next)) throw new Error("expected_active_pack");
    await inspectWholePack(db, next.pack.packId);
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: next.pack.packId }).draft),
      expectedIdentity: identity,
      packId: next.pack.packId
    });
    finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: next.pack.packId
    });

    const finalPackFinished = db.prepare(
      `SELECT event_type AS eventType, summary, details_json AS detailsJson
       FROM workbench_activity
       WHERE related_run_id = ? AND event_type = 'authoring_pack_finished'
       ORDER BY event_at DESC LIMIT 1`
    ).get(requestId) as { eventType: string; summary: string; detailsJson: string };
    const finalDetails = JSON.parse(finalPackFinished.detailsJson) as Record<string, unknown>;
    expect(finalDetails).toMatchObject({
      requestComplete: true,
      remainingPacks: 0,
      remainingSessions: 0,
      packsCompleted: 2,
      packsTotal: 2,
      sessionsAttempted: 20,
      sessionsTotal: 20
    });
    expect(finalPackFinished.summary).toMatch(/pack finished/i);
    const finalCompleted = db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_activity
       WHERE related_run_id = ? AND event_type = 'authoring_request_completed'`
    ).get(requestId) as { count: number };
    expect(Number(finalCompleted.count)).toBeGreaterThan(0);
    db.close();
  });

  test("publishes eight good and one soft-flagged session, rejects one protocol dossier, and releases the next pack", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 20 }, (_, index) => `session:v5:quality:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    expect(created.request.packSizes).toEqual([10, 10]);

    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    const packId = started.pack.packId;
    await inspectWholePack(db, packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId }).draft);
    authored.sessions[8]!.fields.verification = {
      status: "unknown",
      summary: "Verification looks okay."
    };
    authored.sessions[9]!.fields = {
      ...authored.sessions[9]!.fields,
      ...UNSUPPORTED_COMPLETION_THRASH_FIXTURE
    };

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId
    });
    expect(saved.requestStatus).toBe("active");
    expect(saved.outcomes.map(({ disposition }) => disposition)).toEqual([
      ...Array.from({ length: 8 }, () => "publishable" as const),
      "soft_flag",
      "hard_reject"
    ]);

    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId
    });
    expect(finished.receipt.counts).toEqual({
      attempted: 10,
      consideredNo: 1,
      optionalPublished: 0,
      published: 9,
      rejected: 1,
      softFlagged: 1
    });
    // ISSUE-A5: first of two packs — pack receipt only; request is not complete.
    expect(finished).not.toHaveProperty("requestReceipt");
    expect(finished.nextAction).toMatchObject({
      kind: "claim_next",
      command: `${command} workbench author start --request '${created.request.requestId}' --json`,
      progress: {
        packsCompleted: 1,
        packsTotal: 2,
        sessionsAttempted: 10,
        sessionsTotal: 20,
        requestComplete: false
      },
      stopRule: WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE
    });
    expect(finished.nextAction.kind).not.toBe("complete");
    expect(finished.nextAction.reason).toContain("Request incomplete (10/20 sessions, 1/2 packs)");
    expect(finished.nextAction.reason).toContain("Immediately run nextAction.command");
    expect(finished.nextAction.reason).toContain("Do not report success");
    expect(finished.followUp).toEqual({
      kind: "start",
      command: finished.nextAction.command,
      reason: expect.stringMatching(/incomplete|next fixed pack|do not report success/i)
    });
    const midStatus = getWorkbenchAuthoringV5RequestStatus(db, {
      command,
      requestId: created.request.requestId
    });
    expect(midStatus).not.toHaveProperty("receipt");
    expect(midStatus.request.status).toBe("active");
    expect(midStatus.nextAction.kind).not.toBe("complete");
    const next = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    expect(next).toMatchObject({
      pack: { ordinal: 1, status: "active" },
      nextAction: {
        progress: { requestComplete: false, packsCompleted: 1, packsTotal: 2 },
        stopRule: WORKBENCH_AUTHORING_V5_INCOMPLETE_STOP_RULE
      }
    });
    expect(next).not.toHaveProperty("requestReceipt");
    if (!("nextAction" in next)) throw new Error("expected_active_pack");
    expect(next.nextAction.kind).not.toBe("complete");

    const activityTypes = (db.prepare(
      "SELECT event_type AS eventType FROM workbench_activity WHERE related_run_id = ?"
    ).all(created.request.requestId) as Array<{ eventType: string }>).map(({ eventType }) => eventType);
    expect(activityTypes).toEqual(expect.arrayContaining([
      "authoring_session_soft_flagged",
      "authoring_session_rejected"
    ]));
    db.close();
  });

  test("hard-rejects the frozen quality failures and grounds only the six core fields", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 10 }, (_, index) => `session:v5:hard-gates:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    authored.sessions[0]!.fields.title = "";
    authored.sessions[1]!.fields.title = "Recent activity";
    authored.sessions[2]!.fields.title = "Compaction summary for the current authoring pack";
    authored.sessions[3]!.fields.description = COMPACTION_BANNER_FIXTURE;
    authored.sessions[4]!.fields.purpose = CRON_BOILERPLATE_FIXTURE;
    authored.sessions[5]!.fields.keywords = [];
    authored.sessions[6]!.fields.purpose = "Design a PostgreSQL disaster recovery runbook.";
    authored.sessions[7]!.fields.evidenceRefs.outcome = [];
    authored.sessions[8]!.fields.purpose = "Repair authentication redirect state validation.";
    authored.sessions[8]!.fields.verification = {
      status: "missing",
      summary: "Tests were not run; review was static only."
    };
    authored.sessions[9]!.fields.title = "Repair OAuth callback token validation";
    authored.sessions[9]!.fields.decisions = ["Keep the callback state bound to the signed request."];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(saved.outcomes.map(({ disposition }) => disposition)).toEqual([
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "hard_reject",
      "publishable",
      "publishable"
    ]);
    expect(saved.outcomes.map(({ findings }) => findings.map(({ code }) => code))).toEqual([
      expect.arrayContaining(["empty_or_generic_title"]),
      expect.arrayContaining(["empty_or_generic_title"]),
      expect.arrayContaining(["protocol_or_compaction_boilerplate"]),
      expect.arrayContaining(["protocol_or_compaction_boilerplate"]),
      expect.arrayContaining(["protocol_or_compaction_boilerplate"]),
      expect.arrayContaining(["empty_keywords"]),
      expect.arrayContaining(["purpose_not_user_ask"]),
      expect.arrayContaining(["missing_core_field_grounding"]),
      [],
      []
    ]);
    db.close();
  });

  test("soft-flags thin key work while keeping the pack finishable", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:thin-key-work:1", "session:v5:thin-key-work:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    authored.sessions[0]!.fields.keyWork = ["Updated it."];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(saved.outcomes).toMatchObject([
      { disposition: "soft_flag", findings: [{ code: "thin_key_work" }] },
      { disposition: "publishable", findings: [] }
    ]);
    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(finished.receipt.counts).toMatchObject({ published: 2, rejected: 0, softFlagged: 1 });
    db.close();
  });

  test("soft-flags empty key work without turning the missing key-work references into a hard reject", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:empty-key-work:1", "session:v5:empty-key-work:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    authored.sessions[0]!.fields.keyWork = [];
    authored.sessions[0]!.fields.evidenceRefs.keyWork = [];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command, currentIdentity: identity, draft: authored, expectedIdentity: identity, packId: started.pack.packId
    });
    expect(saved.outcomes[0]).toEqual({
      disposition: "soft_flag",
      findings: [{ code: "thin_key_work", message: expect.any(String) }],
      sessionId: sessionIds[0]
    });
    expect(finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    }).receipt.counts).toMatchObject({ published: 2, rejected: 0, softFlagged: 1 });
    db.close();
  });

  test("soft-flags an honest unknown verification boundary without requiring a nonexistent claim reference", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:empty-verification:1", "session:v5:empty-verification:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    authored.sessions[0]!.fields.verification = { status: "unknown", summary: "" };
    authored.sessions[0]!.fields.evidenceRefs.verification = [];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command, currentIdentity: identity, draft: authored, expectedIdentity: identity, packId: started.pack.packId
    });
    expect(saved.outcomes[0]).toEqual({
      disposition: "soft_flag",
      findings: [{ code: "weak_verification", message: expect.any(String) }],
      sessionId: sessionIds[0]
    });
    expect(finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    }).receipt.counts).toMatchObject({ published: 2, rejected: 0, softFlagged: 1 });
    db.close();
  });

  test("rehydrates canonical evidence instead of trusting modified local scaffold content", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:catalog-integrity:1", "session:v5:catalog-integrity:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    authored.sessions[0]!.evidenceCatalog[0]!.text = "Agent-supplied replacement evidence text.";

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: toWorkbenchAuthoringV5AuthoredDraft(authored),
      expectedIdentity: identity,
      packId: started.pack.packId
    });

    expect(saved.outcomes.every(({ disposition }) => disposition === "publishable")).toBe(true);
    const stored = db.prepare(
      "SELECT draft_json AS draftJson FROM workbench_authoring_v5_packs WHERE pack_id = ?"
    ).get(started.pack.packId) as { draftJson: string };
    expect(JSON.parse(stored.draftJson).sessions[0]).not.toHaveProperty("evidenceCatalog");
    db.close();
  });

  test("finishes a previously stored evidence-rich draft through immutable snapshot rehydration", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:legacy-draft:1", "session:v5:legacy-draft:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    const canonicalObservedAt = authored.sessions[0]!.evidenceCatalog[0]!.observedAt;
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: toWorkbenchAuthoringV5AuthoredDraft(authored),
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    const legacyStoredDraft = structuredClone(authored);
    legacyStoredDraft.sessions[0]!.evidenceCatalog[0]!.observedAt = "1900-01-01T00:00:00.000Z";
    legacyStoredDraft.sessions[0]!.evidenceCatalog[0]!.text = "Untrusted persisted evidence replacement.";
    db.prepare("UPDATE workbench_authoring_v5_packs SET draft_json = ? WHERE pack_id = ?").run(
      JSON.stringify(legacyStoredDraft),
      started.pack.packId
    );

    expect(() => finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: { ...identity, buildSha: "build:next" },
      packId: started.pack.packId
    })).toThrow("build_identity_mismatch");
    expect(finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    }).receipt.counts).toMatchObject({ attempted: 2, published: 2 });
    const capsule = readCurrentSessionEnrichment(db, sessionIds[0]!, "session_capsule")?.content as {
      durableEnrichment: DurableSessionEnrichment;
    };
    expect(capsule.durableEnrichment.sessionTitle.evidenceRefs[0]?.observedAt).toBe(canonicalObservedAt);
    db.close();
  });

  test("preserves canonical failed work state instead of inventing completion", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:state:1", "session:v5:state:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    db.prepare("UPDATE sessions SET lifecycle = 'ended', outcome_label = 'failed' WHERE session_id = ?").run(sessionIds[0]);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, { command, packId: started.pack.packId }).draft);
    saveWorkbenchAuthoringV5Draft(db, {
      command, currentIdentity: identity, draft: authored, expectedIdentity: identity, packId: started.pack.packId
    });
    finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    });

    const capsule = readCurrentSessionEnrichment(db, sessionIds[0]!, "session_capsule")?.content as {
      durableEnrichment: DurableSessionEnrichment;
    };
    const enrichment = capsule.durableEnrichment;
    expect(enrichment.sessionSummary.state).toBe("failed");
    db.close();
  });

  test("hard-rejects nonspecific descriptions and fewer than three search keywords", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 9 }, (_, index) => `session:v5:release-bar:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    db.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?").run(
      "Edit the release article for clarity and correct the prose.",
      sessionIds[5]
    );
    db.prepare("UPDATE messages SET text_redacted = ? WHERE session_id = ?").run(
      "Please improve the docs.",
      sessionIds[8]
    );
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    authored.sessions[0]!.fields.description = "";
    authored.sessions[1]!.fields.description = "Updated the code.";
    authored.sessions[2]!.fields.description = "Made some changes.";
    authored.sessions[3]!.fields.keywords = ["oauth"];
    authored.sessions[4]!.fields.keywords = ["oauth", "callback"];
    authored.sessions[8]!.fields.purpose = "Clarify installation instructions for new users.";

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(saved.outcomes).toMatchObject([
      { disposition: "hard_reject", findings: [{ code: "empty_or_generic_description" }] },
      { disposition: "hard_reject", findings: [{ code: "empty_or_generic_description" }] },
      { disposition: "hard_reject", findings: [{ code: "empty_or_generic_description" }] },
      { disposition: "hard_reject", findings: [{ code: "insufficient_keywords" }] },
      { disposition: "hard_reject", findings: [{ code: "insufficient_keywords" }] },
      { disposition: "hard_reject", findings: [{ code: "purpose_not_user_ask" }] },
      { disposition: "publishable", findings: [] },
      { disposition: "publishable", findings: [] },
      { disposition: "publishable", findings: [] }
    ]);
    db.close();
  });

  test("records a grounded optional considered-no without blocking dossier publication", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 5 }, (_, index) => `session:v5:consider-no:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    const submitted = authored as unknown as WorkbenchAuthoringV5Draft & {
      optionalConsiderations: Array<{
        kind: "runbook";
        decision: "no";
        reason: string;
        evidenceRef: string;
      }>;
    };
    submitted.optionalConsiderations = [{
      decision: "no",
      evidenceRef: authored.sessions[0]!.evidenceCatalog[0]!.id,
      kind: "runbook",
      reason: "The evidence describes a one-off callback repair rather than a reusable operating procedure."
    }];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: submitted,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(saved.outcomes.every(({ disposition }) => disposition === "publishable")).toBe(true);
    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(finished.receipt.counts).toMatchObject({
      attempted: 5,
      consideredNo: 1,
      optionalPublished: 0,
      published: 5,
      rejected: 0
    });
    expect(finished.requestReceipt?.counts).toMatchObject({ consideredNo: 1, optionalPublished: 0 });
    const consideredNoActivity = db.prepare(
      "SELECT details_json AS detailsJson FROM workbench_activity WHERE related_run_id = ? AND event_type = ?"
    ).get(created.request.requestId, "authoring_optional_considered_no") as { detailsJson: string } | undefined;
    expect(JSON.parse(consideredNoActivity?.detailsJson ?? "{}")).toMatchObject({
      decision: "no",
      kind: "runbook",
      reason: submitted.optionalConsiderations[0]!.reason
    });
    db.close();
  });

  test("rolls back every publication effect when finish fails and remains safely retryable", async () => {
    const db = await testDatabase();
    const sessionIds = ["session:v5:atomic:1", "session:v5:atomic:2"];
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test", command, currentIdentity: identity, expectedIdentity: identity, sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: toWorkbenchAuthoringV5AuthoredDraft(authored),
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    const artifactsBefore = db.prepare(
      "SELECT COUNT(*) AS count FROM session_artifacts WHERE session_id IN (?, ?)"
    ).get(...sessionIds) as { count: number };
    db.exec(`CREATE TRIGGER fail_v5_finish_activity
      BEFORE INSERT ON workbench_activity
      WHEN NEW.event_type = 'authoring_pack_finished' AND NEW.session_id = '${sessionIds[1]}'
      BEGIN SELECT RAISE(ABORT, 'forced_finish_failure'); END;`);

    expect(() => finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    })).toThrow("forced_finish_failure");

    expect(db.prepare(
      "SELECT status, receipt_json AS receiptJson FROM workbench_authoring_v5_packs WHERE pack_id = ?"
    ).get(started.pack.packId)).toEqual({ receiptJson: null, status: "saved" });
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM session_artifacts WHERE session_id IN (?, ?)"
    ).get(...sessionIds)).toEqual(artifactsBefore);
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_activity
       WHERE related_run_id = ? AND event_type IN ('authoring_session_published', 'authoring_pack_finished')`
    ).get(created.request.requestId)).toEqual({ count: 0 });

    db.exec("DROP TRIGGER fail_v5_finish_activity;");
    expect(finishWorkbenchAuthoringV5Pack(db, {
      command, currentIdentity: identity, expectedIdentity: identity, packId: started.pack.packId
    }).receipt.counts).toMatchObject({ attempted: 2, published: 2 });
    db.close();
  });

  test("publishes mixed-kind optional artifacts attached to grounded considered-yes decisions", async () => {
    const db = await testDatabase();
    const sessionIds = Array.from({ length: 5 }, (_, index) => `session:v5:consider-yes:${index + 1}`);
    for (const sessionId of sessionIds) seedCompileReadySession(db, sessionId);
    const created = createWorkbenchAuthoringV5Request(db, {
      actorId: "agent:test",
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      sessionIds
    });
    const started = startWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      requestId: created.request.requestId
    });
    if (!("pack" in started)) throw new Error("expected_active_pack");
    await inspectWholePack(db, started.pack.packId);
    const authored = authorDraft(buildWorkbenchAuthoringV5Scaffold(db, {
      command,
      packId: started.pack.packId
    }).draft);
    const firstSeed = authored.sessions[0]!;
    const secondSeed = authored.sessions[1]!;
    const evidenceRef = firstSeed.evidenceCatalog[0]!.id;
    authored.optionalConsiderations = [
      {
        decision: "yes",
        evidenceRef,
        kind: "runbook",
        reason: "The callback recovery steps form a reusable procedure with an explicit verification boundary."
      },
      {
        decision: "yes",
        evidenceRef: secondSeed.evidenceCatalog[0]!.id,
        kind: "adr",
        reason: "The evidence records a durable callback-state decision with alternatives and consequences."
      }
    ];
    authored.optionalArtifacts = [
      optionalRunbook(firstSeed.sessionId, evidenceRef),
      optionalAdr(secondSeed.sessionId, secondSeed.evidenceCatalog[0]!.id)
    ];

    const saved = saveWorkbenchAuthoringV5Draft(db, {
      command,
      currentIdentity: identity,
      draft: authored,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(saved.outcomes.every(({ disposition }) => disposition === "publishable")).toBe(true);
    const finished = finishWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId: started.pack.packId
    });
    expect(finished.receipt.counts).toMatchObject({ consideredNo: 0, optionalPublished: 2, published: 5 });
    expect(finished.receipt.optionalArtifacts).toHaveLength(2);
    expect(finished.receipt.optionalArtifacts.map(({ kind }) => kind).sort()).toEqual(["adr", "runbook"]);
    for (const artifact of finished.receipt.optionalArtifacts) {
      expect(getLogbookArtifactDetail(db, artifact.artifactId)).toMatchObject({
        capsule: { kind: artifact.kind },
        publicationStatus: "published"
      });
    }
    const optionalActivity = db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_activity WHERE related_run_id = ? AND event_type = ?"
    ).get(created.request.requestId, "authoring_optional_artifact_published") as { count: number };
    expect(optionalActivity.count).toBe(2);
    db.close();
  });
});

function authorDraft(draft: WorkbenchAuthoringV5Draft): WorkbenchAuthoringV5Draft {
  const authored = structuredClone(draft);
  authored.sessions.forEach((session, index) => {
    const evidenceRef = session.evidenceCatalog[0]!.id;
    session.fields = {
      decisions: [],
      description: `Implemented the OAuth callback flow for session ${index + 1}.`,
      evidenceRefs: {
        description: [evidenceRef],
        keyWork: [evidenceRef],
        outcome: [evidenceRef],
        purpose: [evidenceRef],
        title: [evidenceRef],
        verification: [evidenceRef]
      },
      keyWork: ["Updated the callback handler."],
      keywords: ["oauth", "callback", `pack-session-${index + 1}`],
      outcome: "The callback now returns authenticated users safely.",
      purpose: "Fix the OAuth authentication callback.",
      title: `OAuth callback fix ${index + 1}`,
      verification: { status: "passed", summary: "The callback test passed." }
    };
  });
  authored.optionalConsiderations = [{
    decision: "no",
    evidenceRef: authored.sessions[0]!.evidenceCatalog[0]!.id,
    kind: "runbook",
    reason: "The pack contains session-specific callback work rather than a reusable operating procedure."
  }];
  return authored;
}

function optionalRunbook(
  sessionId: string,
  evidenceRef: string
): WorkbenchAuthoringV5Draft["optionalArtifacts"][number] {
  return {
    draftId: `optional-runbook:${sessionId}`,
    kind: "runbook",
    output: {
      changedFiles: ["auth/callback.ts"],
      commands: ["npm test"],
      confidence: "medium",
      deadEnds: [],
      environmentRequirements: ["Node.js"],
      evidenceRefs: [evidenceRef],
      fixSteps: ["Update the callback handler while preserving signed state validation."],
      missingEvidence: [],
      preconditions: ["The OAuth callback rejects a valid signed state."],
      preventionNotes: ["Keep callback regression coverage around signed state handling."],
      problemSignature: {
        affectedScope: "OAuth callback authentication",
        errorStrings: [],
        symptoms: ["Authenticated users cannot complete the callback flow."]
      },
      provenanceSessionIds: [sessionId],
      reproSteps: ["Run the callback regression test against a valid signed state."],
      risksOrGaps: [],
      rootCause: "The callback handler did not preserve the validated state transition.",
      title: "Repair and verify OAuth callback state handling",
      validationChecks: ["The callback regression test passes for valid signed state."]
    },
    provenanceSessionIds: [sessionId],
    seedSessionId: sessionId
  };
}

function optionalAdr(
  sessionId: string,
  evidenceRef: string
): WorkbenchAuthoringV5Draft["optionalArtifacts"][number] {
  return {
    draftId: `optional-adr:${sessionId}`,
    kind: "adr",
    output: {
      alternatives: ["Allow callback state to remain implicit."],
      confidence: "medium",
      consequences: ["Callback state transitions remain explicit and testable."],
      context: "The callback flow needs a durable rule for preserving validated request state.",
      decision: "Keep callback state bound to the signed request through token exchange.",
      evidenceRefs: [evidenceRef],
      missingEvidence: [],
      provenanceSessionIds: [sessionId],
      status: "accepted",
      title: "Preserve signed callback state through token exchange"
    },
    provenanceSessionIds: [sessionId],
    seedSessionId: sessionId
  };
}

async function testDatabase(): Promise<MastheadDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-"));
  tempDirs.push(directory);
  const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

async function inspectWholePack(db: MastheadDatabase, packId: string): Promise<void> {
  while (true) {
    const inspected = inspectWorkbenchAuthoringV5Pack(db, {
      command,
      currentIdentity: identity,
      expectedIdentity: identity,
      packId
    });
    if (inspected.coverage.every(({ complete }) => complete)) return;
  }
}

function seedCompileReadySession(db: MastheadDatabase, sessionId: string): void {
  seedSession(db, {
    lifecycle: "completed",
    model: "gpt-5.6-sol",
    project: "Masthead",
    sessionId,
    title: `V5 authoring ${sessionId}`
  });
  markSessionCompileReady(db, sessionId);
}
