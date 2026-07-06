import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalSessionId, runtimeIdFor } from "../../shared/sessionIdentity.ts";
import type { DaemonConfig } from "../config.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead daemon startup", () => {
  test("does not create the SQLite database when legacy store initialization fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-startup-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const notDirectory = join(tempDir, "not-a-directory");
    await writeFile(notDirectory, "not a directory", "utf8");

    await expect(
      createMastheadDaemon({
        allowedOrigins: ["http://127.0.0.1:5173"],
        codexHomeDir: tempDir,
        databasePath,
        fixturePath: join(tempDir, "fixture.json"),
        gitRefreshMs: 0,
        host: "127.0.0.1",
        hookTranscriptCatchupEnabled: false,
        llmCopyEnabled: false,
        port: 0,
        storePath: join(notDirectory, "events.ndjson")
      } satisfies DaemonConfig)
    ).rejects.toThrow();
    await expect(access(databasePath)).rejects.toThrow();
  });

  test("previews enrichment rebuilds without writing rows", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:rebuild", title: "Rebuild preview" });
    const before = countRows(daemon, "session_enrichments");
    const baseUrl = await listen(daemon);

    const response = await postJson(baseUrl, "/enrichment/rebuild", { dryRun: true, limit: 1, scope: "recent" });

    expect(response).toMatchObject({
      dryRun: true,
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:rebuild", status: "dry_run" }]
    });
    expect(countRows(daemon, "session_enrichments")).toBe(before);
  });

  test("previews explicit summary and full enrichment rebuilds without writing rows", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:rebuild", title: "Rebuild preview" });
    const before = countRows(daemon, "session_enrichments");
    const baseUrl = await listen(daemon);

    const summary = await postJson(baseUrl, "/enrichment/rebuild", {
      depth: "summary",
      dryRun: true,
      limit: 2,
      scope: "sessionIds",
      sessionIds: ["session:rebuild", "missing"]
    });
    const full = await postJson(baseUrl, "/enrichment/rebuild", {
      depth: "full",
      dryRun: true,
      limit: 2,
      scope: "sessionIds",
      sessionIds: ["session:rebuild", "missing"]
    });

    expect(summary).toMatchObject({
      dryRun: true,
      mode: "deterministic",
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:rebuild", status: "dry_run" }]
    });
    expect(full).toMatchObject({
      dryRun: true,
      mode: "configured",
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:rebuild", status: "dry_run" }]
    });
    expect(countRows(daemon, "session_enrichments")).toBe(before);
  });

  test("summary rebuild writes Logbook projection rows without replacing the full session capsule", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:summary", title: "Summary rebuild title" });
    clearEnrichments(daemon, "session:summary");
    const baseUrl = await listen(daemon);

    const response = await postJson(baseUrl, "/enrichment/rebuild", {
      depth: "summary",
      limit: 1,
      scope: "sessionIds",
      sessionIds: ["session:summary"]
    });

    expect(response).toMatchObject({
      failed: 0,
      mode: "deterministic",
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:summary", status: "succeeded" }],
      succeeded: 1
    });
    expect(enrichmentKinds(daemon, "session:summary")).toEqual(["live_summary", "search_projection"]);
    expect(currentEnrichmentContent(daemon, "session:summary", "live_summary")).toMatchObject({ text: expect.stringContaining("OAuth callback") });
    expect(currentEnrichmentContent(daemon, "session:summary", "search_projection")).toMatchObject({
      searchText: expect.stringContaining("OAuth callback"),
      title: "OAuth callback handling"
    });
  });

  test("full deterministic rebuild writes live summary, search projection, and session capsule", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:full", title: "Full rebuild title" });
    clearEnrichments(daemon, "session:full");
    const baseUrl = await listen(daemon);

    const response = await postJson(baseUrl, "/enrichment/rebuild", {
      depth: "full",
      deterministicOnly: true,
      limit: 1,
      scope: "sessionIds",
      sessionIds: ["session:full"]
    });

    expect(response).toMatchObject({
      failed: 0,
      mode: "deterministic",
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:full", status: "succeeded" }],
      succeeded: 1
    });
    expect(enrichmentKinds(daemon, "session:full")).toEqual(["live_summary", "search_projection", "session_capsule"]);
  });

  test("rejects invalid rebuild limits and missing sessionIds without rebuilding anything", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:invalid", title: "Invalid rebuild" });
    const before = countRows(daemon, "session_enrichments");
    const baseUrl = await listen(daemon);

    await expectPostError(baseUrl, "/enrichment/rebuild", { limit: 0, scope: "recent" }, "invalid_limit");
    await expectPostError(baseUrl, "/enrichment/rebuild", { limit: 1, scope: "sessionIds" }, "missing_sessionIds");
    expect(countRows(daemon, "session_enrichments")).toBe(before);
  });

  test("keeps canonical projection identity distinct for mixed runtimes sharing a source session", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    const sharedSourceSessionId = "source:shared-live-runtime";

    await postJson(
      baseUrl,
      "/ingest?runtime=opencode",
      liveStartedPayload({
        providerEventId: "opencode-shared-source",
        runtime: "opencode",
        sessionId: "opencode-projection-card",
        sourceSessionId: sharedSourceSessionId,
        timestamp: "2026-07-06T12:00:00.000Z",
        title: "OpenCode shared source"
      })
    );
    await postJson(
      baseUrl,
      "/ingest?runtime=omp",
      liveStartedPayload({
        providerEventId: "omp-shared-source",
        runtime: "omp",
        sessionId: "omp-projection-card",
        sourceSessionId: sharedSourceSessionId,
        timestamp: "2026-07-06T12:01:00.000Z",
        title: "OMP shared source"
      })
    );

    const response = await getJson(baseUrl, "/projection");
    const cards = response.projection.cards as ProjectionCard[];
    const opencodeCard = cards.find((card) => card.sessionId === "opencode-projection-card");
    const ompCard = cards.find((card) => card.sessionId === "omp-projection-card");

    expect(opencodeCard).toMatchObject({
      runtime: "opencode",
      sourceSessionId: sharedSourceSessionId
    });
    expect(ompCard).toMatchObject({
      runtime: "omp",
      sourceSessionId: sharedSourceSessionId
    });
    expect(opencodeCard?.canonicalSessionId).toBe(
      canonicalSessionId("host:127.0.0.1", runtimeIdFor("opencode", undefined), sharedSourceSessionId)
    );
    expect(ompCard?.canonicalSessionId).toBe(
      canonicalSessionId("host:127.0.0.1", runtimeIdFor("omp", undefined), sharedSourceSessionId)
    );
    expect(opencodeCard?.canonicalSessionId).not.toBe(ompCard?.canonicalSessionId);
  });
});

type ProjectionCard = {
  canonicalSessionId?: string;
  runtime?: string;
  sessionId: string;
  sourceSessionId?: string;
};

type LiveStartedPayloadInput = {
  providerEventId: string;
  runtime: "opencode" | "omp";
  sessionId: string;
  sourceSessionId: string;
  timestamp: string;
  title: string;
};

function liveStartedPayload(input: LiveStartedPayloadInput): Record<string, unknown> {
  return {
    provider_event_id: input.providerEventId,
    event: "session_start",
    session_id: input.sessionId,
    timestamp: input.timestamp,
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    branch: "agent/canonical-identity",
    project: "Masthead",
    title: input.title,
    runtime: input.runtime,
    sourceSessionId: input.sourceSessionId
  };
}

async function createTestDaemon(): Promise<MastheadDaemon> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-server-"));
  tempDirs.push(tempDir);
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
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
  return daemon;
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

type CountRow = { count: number };
type EnrichmentKind = "live_summary" | "search_projection" | "session_capsule";
type EnrichmentKindRow = { enrichmentKind: EnrichmentKind };
type EnrichmentContentRow = { contentJson: string };

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  const payload = await response.json();
  expect(payload).toBeTypeOf("object");
  return payload as Record<string, unknown>;
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toBeTypeOf("object");
  return payload as Record<string, any>;
}

async function expectPostError(baseUrl: string, path: string, body: Record<string, unknown>, error: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error, ok: false });
}

function countRows(daemon: MastheadDaemon, table: string): number {
  const row = daemon.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
  return row.count;
}

function clearEnrichments(daemon: MastheadDaemon, sessionId: string): void {
  daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run(sessionId);
}

function enrichmentKinds(daemon: MastheadDaemon, sessionId: string): EnrichmentKind[] {
  const rows = daemon.database
    .prepare(
      `SELECT enrichment_kind AS enrichmentKind
      FROM session_enrichments
      WHERE session_id = ? AND status = 'current'
      ORDER BY CASE enrichment_kind
        WHEN 'live_summary' THEN 1
        WHEN 'search_projection' THEN 2
        WHEN 'session_capsule' THEN 3
        ELSE 4
      END`
    )
    .all(sessionId) as EnrichmentKindRow[];
  return rows.map((row) => row.enrichmentKind);
}

function currentEnrichmentContent(daemon: MastheadDaemon, sessionId: string, kind: EnrichmentKind): Record<string, unknown> {
  const row = daemon.database
    .prepare(
      `SELECT content_json AS contentJson
      FROM session_enrichments
      WHERE session_id = ? AND enrichment_kind = ? AND status = 'current'
      ORDER BY generated_at DESC, enrichment_id DESC
      LIMIT 1`
    )
    .get(sessionId, kind) as EnrichmentContentRow;
  const parsed: unknown = JSON.parse(row.contentJson);
  expect(parsed).toBeTypeOf("object");
  return parsed as Record<string, unknown>;
}
