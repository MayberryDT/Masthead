import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { markSessionCompileReady, seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type { WorkbenchAuthoringV5Draft } from "../../../shared/workbenchAuthoringV5.ts";
import {
  bootstrapWorkbenchAuthoringV5Request,
  buildWorkbenchAuthoringV5Scaffold,
  createWorkbenchAuthoringV5Request,
  finishWorkbenchAuthoringV5Pack,
  getWorkbenchAuthoringV5RequestStatus,
  inspectWorkbenchAuthoringV5Pack,
  saveWorkbenchAuthoringV5Draft,
  startWorkbenchAuthoringV5Pack
} from "../workbenchAuthoringV5Service.ts";
import * as workbenchAuthoringV5Quality from "../workbenchAuthoringV5Quality.ts";

const tempDirs: string[] = [];
const identity = {
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  databaseId: "database:test",
  instanceId: "instance:test",
  instanceManifest: "/tmp/masthead-instance.json"
};
const command = "/opt/masthead/bin/mastheadctl";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("workbench-authoring-v5 loop", () => {
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
      packPolicy: { fullSelectionRequired: true, maximumSessions: 12, minimumSessions: 5 },
      rejectRules: { behavior: "flag_and_continue" },
      skillContract: { owner: "agent", scaffoldWritesProse: false },
      nextAction: { kind: "start" }
    });

    let expectedPublished = 0;
    let expectedRejected = 0;
    let expectedSoftFlagged = 0;
    vi.spyOn(workbenchAuthoringV5Quality, "classifyWorkbenchAuthoringV5Session").mockImplementation((session) => {
      if (session.fields.verification.status === "missing") {
        return { sessionId: session.sessionId, disposition: "soft_flag", findings: [{ code: "fixture_soft", message: "Fixture soft flag." }] };
      }
      return { sessionId: session.sessionId, disposition: "publishable", findings: [] };
    });
    for (let packIndex = 0; packIndex < 2; packIndex += 1) {
      const started = startWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        requestId: created.request.requestId
      });
      if (!("pack" in started)) throw new Error("expected_active_pack");
      const packId = started.pack.packId;

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
      authored.sessions[1]!.fields.verification = { status: "missing", summary: "Verification was not run." };
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
      const retried = finishWorkbenchAuthoringV5Pack(db, {
        command,
        currentIdentity: identity,
        expectedIdentity: identity,
        packId
      });
      expect(retried).toEqual(finished);
      expectedPublished += authored.sessions.length - 1;
      expectedRejected += 1;
      expectedSoftFlagged += 1;
    }

    const status = getWorkbenchAuthoringV5RequestStatus(db, {
      command,
      requestId: created.request.requestId
    });
    expect(status.nextAction).toMatchObject({ kind: "complete", command: "" });
    expect(status.receipt).toMatchObject({
      receiptVersion: "workbench-authoring-v5-request-receipt-v1",
      requestId: created.request.requestId,
      counts: {
        attempted: 13,
        consideredNo: 0,
        optionalPublished: 0,
        published: expectedPublished,
        rejected: expectedRejected,
        softFlagged: expectedSoftFlagged
      }
    });
    expect(bootstrapWorkbenchAuthoringV5Request(db, {
      command,
      requestId: created.request.requestId
    })).toMatchObject({ receipt: status.receipt, nextAction: { kind: "complete" } });
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
  return authored;
}

async function testDatabase(): Promise<MastheadDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-"));
  tempDirs.push(directory);
  const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
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
