import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../../daemon/config.ts";
import { applySessionArtifact, publishSessionArtifact } from "../../daemon/db/sessionArtifactRepository.ts";
import { markWorkbenchPublished } from "../../daemon/db/workbenchPipelineRepository.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import { buildSessionFacts } from "../sessionFacts.ts";
import { fingerprintSessionFacts } from "../sessionCompiler.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("production enrichment integration", () => {
  test("live ingestion persists reusable enrichment while Logbook search returns only a published artifact", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/ingest", hookPayload("start", "session_started", { summary: "OAuth callback routing" }));
    await postJson(baseUrl, "/ingest", hookPayload("question", "user_question", { message: "Fix OAuth callback routing." }));
    await postJson(baseUrl, "/ingest", hookPayload("stop", "session_completed", { summary: "OAuth callback routing now has tests." }));

    await waitFor(() => {
      const rows = daemon.database
        .prepare("SELECT enrichment_kind AS kind, status FROM session_enrichments WHERE status = 'current' ORDER BY enrichment_kind")
        .all() as Array<{ kind: string; status: string }>;
      expect(rows).toEqual([
        { kind: "live_summary", status: "current" },
        { kind: "search_projection", status: "current" },
        { kind: "session_capsule", status: "current" }
      ]);
    });
    publishSourceSession(daemon, "production-enrichment", "OAuth callback routing");

    const logbook = await getJson(baseUrl, "/logbook/search?q=OAuth");
    expect(logbook.artifacts[0]).toMatchObject({ kind: "session_dossier", title: "OAuth callback routing" });
    expect(logbook).not.toHaveProperty("sessions");

    const projection = await getJson(baseUrl, "/projection?expandedSessionId=production-enrichment");
    expect(projection.projection.cards[0].headlineInput.facts.recentTranscriptMessages).toEqual(
      expect.arrayContaining(["OAuth callback routing now has tests."])
    );
    expect(projection.projection.cards[0].headline.headline).toContain("OAuth callback routing");
    expect(projection.projection.cards[0].headline.headline).not.toContain("{");
    expect(projection.projection.cards[0].headline.source).toBe("offline");
  });

  test("live ingestion refreshes stale running-session enrichment without projection side effects", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/ingest", hookPayload("refresh-start", "session_started", { title: "Claude Code session" }));
    await postJson(baseUrl, "/ingest", hookPayload("refresh-question", "user_question", { message: "Investigate Board headline refresh." }));

    await waitFor(() => {
      expect(sourceSessionMessageCount(daemon, "production-enrichment")).toBe(2);
      expect(currentCapsuleFingerprint(daemon, "production-enrichment")).toBe(currentFactsFingerprint(daemon, "production-enrichment"));
    });
    const before = currentCapsuleFingerprint(daemon, "production-enrichment");

    await getJson(baseUrl, "/projection?expandedSessionId=production-enrichment");
    expect(currentCapsuleFingerprint(daemon, "production-enrichment")).toBe(before);

    await postJson(
      baseUrl,
      "/ingest",
      hookPayload("refresh-update", "user_question", {
        message: "Board refresh headlines now describe active import work.",
        timestamp: "2026-06-25T12:02:00.000Z"
      })
    );

    await waitFor(() => {
      expect(sourceSessionMessageCount(daemon, "production-enrichment")).toBe(3);
      const expected = currentFactsFingerprint(daemon, "production-enrichment");
      expect(expected).not.toBe(before);
      expect(currentCapsuleFingerprint(daemon, "production-enrichment")).toBe(expected);
    });
  });
});

function publishSourceSession(daemon: MastheadDaemon, sourceSessionId: string, title: string): void {
  const row = daemon.database
    .prepare("SELECT session_id AS sessionId FROM sessions WHERE source_session_id = ? AND deleted_at IS NULL")
    .get(sourceSessionId) as { sessionId: string } | undefined;
  expect(row?.sessionId).toBeTruthy();
  markWorkbenchPublished(daemon.database, {
    actor: { kind: "system", id: "test" },
    publishedVia: "test",
    sessionId: row!.sessionId
  });
  const artifact = applySessionArtifact(daemon.database, {
    artifactKind: "session_dossier",
    confidence: "high",
    content: { problemStatement: title },
    contentFingerprint: `test:${sourceSessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    projectLabel: "Masthead",
    schemaVersion: "session-dossier-v1",
    sessionId: row!.sessionId,
    summary: title,
    title,
    validation: { ok: true }
  });
  publishSessionArtifact(daemon.database, artifact.artifactId);
}

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-production-enrichment-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
}

function hookPayload(providerEventId: string, event: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    provider_event_id: `enrichment-${providerEventId}`,
    event,
    session_id: "production-enrichment",
    timestamp: providerEventId === "start" ? "2026-06-25T12:00:00.000Z" : "2026-06-25T12:01:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    ...payload
  };
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Record<string, any>> {
  const requestPath = path === "/ingest" ? "/ingest?runtime=claude_code" : path;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, any>>;
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

function currentCapsuleFingerprint(daemon: MastheadDaemon, sourceSessionId: string): string | undefined {
  const row = daemon.database
    .prepare(
      `SELECT session_enrichments.content_fingerprint AS fingerprint
      FROM session_enrichments
      JOIN sessions ON sessions.session_id = session_enrichments.session_id
      WHERE sessions.source_session_id = ?
        AND session_enrichments.enrichment_kind = 'session_capsule'
        AND session_enrichments.status = 'current'
      ORDER BY session_enrichments.generated_at DESC
      LIMIT 1`
    )
    .get(sourceSessionId) as { fingerprint: string } | undefined;
  return row?.fingerprint;
}

function currentFactsFingerprint(daemon: MastheadDaemon, sourceSessionId: string): string | undefined {
  const session = daemon.database
    .prepare("SELECT session_id AS sessionId FROM sessions WHERE source_session_id = ? AND deleted_at IS NULL")
    .get(sourceSessionId) as { sessionId: string } | undefined;
  return session ? fingerprintSessionFacts(buildSessionFacts(daemon.database, session.sessionId)) : undefined;
}

function sourceSessionMessageCount(daemon: MastheadDaemon, sourceSessionId: string): number {
  const row = daemon.database
    .prepare(
      `SELECT COUNT(*) AS count
      FROM messages
      JOIN sessions ON sessions.session_id = messages.session_id
      WHERE sessions.source_session_id = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(sourceSessionId) as { count: number };
  return row.count;
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1200;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assertion();
  throw lastError;
}
