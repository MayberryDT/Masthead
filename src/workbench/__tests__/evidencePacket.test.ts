import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { buildWorkbenchEvidencePacket } from "../evidencePacket.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("buildWorkbenchEvidencePacket", () => {
  test("builds bounded canonical evidence for a session", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Add Workbench CLI"
    });

    const packet = buildWorkbenchEvidencePacket(db, { kind: "session_enrichment", sessionId: "session:abc" });

    expect(packet).toMatchObject({
      packetVersion: "workbench-evidence-v1",
      session: {
        project: "Masthead",
        runtime: "opencode",
        sessionId: "session:abc",
        sourceSessionId: "source-session:abc"
      }
    });
    expect(packet.coverage).toMatchObject({
      fileEffects: 1,
      hasUsableTranscript: true,
      messages: 1,
      toolCalls: 1,
      toolResults: 1
    });
    expect(packet.transcript.length).toBeGreaterThan(0);
    expect(packet.files).toEqual([expect.objectContaining({ path: "auth/callback.ts", ref: "file:session:abc:file" })]);
    expect(packet.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "exec_command", ref: "tool_call:session:abc:tool" })]));
    expect(packet.sourceRefs).toEqual(
      expect.arrayContaining(["message:session:abc:message", "file:session:abc:file", "tool_call:session:abc:tool", "tool_result:session:abc:tool-result"])
    );
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-evidence-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
