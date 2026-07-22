import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { markSessionCompileReady, seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase } from "../db/sqlite.ts";
import {
  isWorkbenchAuthoringV5Path,
  routeWorkbenchAuthoringV5Request,
  workbenchAuthoringV5Capabilities
} from "../workbenchAuthoringV5Api.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Workbench authoring V5 HTTP API", () => {
  test("advertises V5 and returns the thick bootstrap behind the V5 namespace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-authoring-v5-api-"));
    tempDirs.push(directory);
    const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
    migrateDatabase(db);
    const identity = {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest: join(directory, "masthead-instance.json")
    };
    const context = { authoringCommand: "/opt/masthead/bin/mastheadctl", db, identity };
    const sessionIds = Array.from({ length: 5 }, (_, index) => `session:v5-api:${index}`);
    sessionIds.forEach((sessionId) => {
      seedSession(db, { lifecycle: "completed", model: "gpt-5.6-sol", project: "Masthead", sessionId, title: sessionId });
      markSessionCompileReady(db, sessionId);
    });

    expect(workbenchAuthoringV5Capabilities(context)).toMatchObject({
      bundleVersion: "workbench-authoring-v5",
      minimumSessionsPerPack: 5,
      maximumSessionsPerPack: 12,
      operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"]
    });
    expect(isWorkbenchAuthoringV5Path("/workbench/authoring/v5/requests")).toBe(true);

    const created = routeWorkbenchAuthoringV5Request(context, {
      body: { expectedIdentity: identity, sessionIds },
      method: "POST",
      url: new URL("http://127.0.0.1/workbench/authoring/v5/requests")
    });
    expect(created?.status).toBe(201);
    const createdBody = created?.body as any;
    expect(createdBody.handoff).toEqual({
      requestId: createdBody.request.requestId,
      startCommand: `/opt/masthead/bin/mastheadctl workbench author bootstrap --request '${createdBody.request.requestId}' --json`
    });

    const bootstrap = routeWorkbenchAuthoringV5Request(context, {
      method: "GET",
      url: new URL(`http://127.0.0.1/workbench/authoring/v5/requests/${encodeURIComponent(createdBody.request.requestId)}/bootstrap`)
    });
    expect(bootstrap?.body).toMatchObject({
      contractVersion: "workbench-authoring-v5",
      instanceIdentity: identity,
      packPolicy: { fixedAtRequestCreation: true, opportunityJoinRequired: false },
      skillContract: { owner: "agent", scaffoldWritesProse: false },
      nextAction: { kind: "start" }
    });
    db.close();
  });
});
