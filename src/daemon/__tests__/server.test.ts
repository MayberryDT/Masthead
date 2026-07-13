import { access, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalSessionId, runtimeIdFor } from "../../shared/sessionIdentity.ts";
import type { DaemonConfig } from "../config.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../db/schema.ts";
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
  test("migration backup includes committed rows that exist only in the WAL", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-migration-backup-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const source = new DatabaseSync(databasePath);
    try {
      source.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      migrateDatabase(source);
      source.prepare("PRAGMA wal_checkpoint(TRUNCATE);").all();
      source.exec("BEGIN IMMEDIATE;");
      source.prepare("DELETE FROM schema_migrations WHERE version = 7").run();
      source.prepare(
        "INSERT INTO app_settings (setting_key, setting_json, updated_at) VALUES (?, ?, ?)"
      ).run("migration_backup_wal_marker", JSON.stringify({ durable: true }), "2026-07-13T12:00:00.000Z");
      source.exec("COMMIT;");
      expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0);
      await writeFile(`${databasePath}.backup-old`, "stale migration snapshot", "utf8");

      const daemon = await createMastheadDaemon({
        allowedOrigins: ["http://127.0.0.1:5173"],
        backgroundHydrationEnabled: false,
        codexHomeDir: tempDir,
        databasePath,
        fixturePath: join(tempDir, "fixture.json"),
        gitRefreshMs: 0,
        host: "127.0.0.1",
        hookTranscriptCatchupEnabled: false,
        llmCopyEnabled: false,
        port: 0,
        storePath: join(tempDir, "events.ndjson")
      } satisfies DaemonConfig);
      daemons.push(daemon);

      const backups = (await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"));
      expect(backups).toHaveLength(1);
      const backupPath = join(tempDir, backups[0]!);
      const backup = new DatabaseSync(backupPath, { readOnly: true });
      try {
        expect(
          backup.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = ?")
            .get("migration_backup_wal_marker")
        ).toEqual({ value: JSON.stringify({ durable: true }) });
        expect(backup.prepare("PRAGMA integrity_check;").get()).toEqual({ integrity_check: "ok" });
      } finally {
        backup.close();
      }
      for (const suffix of ["-journal", "-shm", "-wal"]) {
        await expect(access(`${backupPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      source.close();
    }
  });

  test("source setup reads do not persist derived snapshots", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);

    expect((await fetch(`${baseUrl}/sources/setup`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/sources/setup`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/sources/advanced`)).status).toBe(200);

    expect(countRows(daemon, "source_setup_state")).toBe(0);
  });

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

  test("updates source policies when the source id path segment is URL encoded", async () => {
    const daemon = await createTestDaemon();
    const sourceId = "opencode:encoded-source";
    const now = "2026-07-09T12:00:00.000Z";
    daemon.database
      .prepare(
        `INSERT INTO ingest_sources (
          source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(sourceId, "opencode", "jsonl", "/tmp/encoded-source.jsonl", "heuristic", now, now);
    const baseUrl = await listen(daemon);

    const response = await fetch(`${baseUrl}/sources/${encodeURIComponent(sourceId)}/policies`, {
      body: JSON.stringify({ enabled: true, policyKind: "transcript_import" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "PUT"
    });

    expect(response.status).toBe(202);
    expect(
      daemon.database
        .prepare("SELECT enabled FROM source_policies WHERE source_id = ? AND policy_kind = 'transcript_import'")
        .get(sourceId)
    ).toEqual({ enabled: 1 });
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

  test("keeps Herdr observer evidence out of public projection cards and running counts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-herdr-"));
    tempDirs.push(tempDir);
    await writeTestHerdrFiles(tempDir, [
      "2026-07-07T12:00:00.000Z INFO workspace=\"w3\" pane=\"3\" focused cwd=\"/workspace/masthead\"",
      "2026-07-07T12:00:01.000Z INFO herdr::pane: agent changed pane=\"3\" previous_agent=None agent=Some(Codex) process=codex pgid=Some(3000)",
      "2026-07-07T12:00:02.000Z INFO workspace=\"w5\" pane=\"5\" focused cwd=\"/workspace/grok-project\"",
      "2026-07-07T12:00:03.000Z INFO herdr::pane: agent changed pane=\"5\" previous_agent=None agent=Some(Grok) process=grok pgid=Some(5000)"
    ]);
    const daemon = await createTestDaemon(tempDir);
    const baseUrl = await listen(daemon);
    const sessionRowsBeforeProjection = countRows(daemon, "sessions");

    const response = await getJson(baseUrl, "/projection");
    const cards = projectionCards(response);

    expect(cards.map((card) => card.sessionId)).not.toEqual(expect.arrayContaining(["observer:herdr:pane:3", "observer:herdr:pane:5"]));
    expect(cards.some((card) => card.sessionId.startsWith("observer:herdr:"))).toBe(false);
    expect(response.projection.summary).toMatchObject({ active: 0, running: 0 });
    expect(response.projection.lanes.find((lane: { laneId: string }) => lane.laneId === "running")).toMatchObject({
      count: 0,
      sessionIds: []
    });
    expect(countRows(daemon, "sessions")).toBe(sessionRowsBeforeProjection);
  });

  test("overlays DB usage on projection cards and lets DB totals override stale hook totals", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    const sourceSessionId = "source:usage-overlay";
    const sessionId = canonicalSessionId("host:127.0.0.1", runtimeIdFor("opencode", undefined), sourceSessionId);

    await postJson(
      baseUrl,
      "/ingest?runtime=opencode",
      liveStartedPayload({
        payload: {
          model: "stale-hook-model",
          provider: "stale-hook-provider",
          totalTokens: 12
        },
        providerEventId: "usage-overlay-start",
        runtime: "opencode",
        sessionId: "usage-overlay-card",
        sourceSessionId,
        timestamp: "2026-07-06T11:00:00.000Z",
        title: "Usage overlay source"
      })
    );
    insertProjectionSession(daemon, {
      runtime: "opencode",
      sessionId,
      sourceSessionId,
      timestamp: "2026-07-06T11:00:00.000Z",
      title: "Usage overlay source"
    });
    insertProjectionUsage(daemon, {
      model: "db-authoritative-model",
      observedAt: "2026-07-06T11:03:00.000Z",
      provider: "db-authoritative-provider",
      sessionId,
      totalTokens: 3210,
      usageId: "usage-overlay-db"
    });

    const response = await getJson(baseUrl, "/projection");
    const cards = projectionCards(response);
    const card = cards.find((candidate) => candidate.sessionId === "usage-overlay-card");

    expect(card).toMatchObject({
      canonicalSessionId: sessionId,
      model: "db-authoritative-model",
      provider: "db-authoritative-provider",
      totalTokens: 3210
    });
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
    const opencodeCanonicalSessionId = canonicalSessionId("host:127.0.0.1", runtimeIdFor("opencode", undefined), sharedSourceSessionId);
    const ompCanonicalSessionId = canonicalSessionId("host:127.0.0.1", runtimeIdFor("omp", undefined), sharedSourceSessionId);
    insertProjectionSession(daemon, {
      runtime: "opencode",
      sessionId: opencodeCanonicalSessionId,
      sourceSessionId: sharedSourceSessionId,
      timestamp: "2026-07-06T12:00:00.000Z",
      title: "OpenCode shared source"
    });
    insertProjectionSession(daemon, {
      runtime: "omp",
      sessionId: ompCanonicalSessionId,
      sourceSessionId: sharedSourceSessionId,
      timestamp: "2026-07-06T12:01:00.000Z",
      title: "OMP shared source"
    });
    insertProjectionUsage(daemon, {
      model: "opencode-db-model",
      observedAt: "2026-07-06T12:02:00.000Z",
      provider: "openai",
      sessionId: opencodeCanonicalSessionId,
      totalTokens: 111,
      usageId: "opencode-shared-source-usage"
    });
    insertProjectionUsage(daemon, {
      model: "omp-db-model",
      observedAt: "2026-07-06T12:03:00.000Z",
      provider: "ollama",
      sessionId: ompCanonicalSessionId,
      totalTokens: 222,
      usageId: "omp-shared-source-usage"
    });


    const response = await getJson(baseUrl, "/projection");
    const cards = projectionCards(response);
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
    expect(opencodeCard).toMatchObject({
      model: "opencode-db-model",
      provider: "openai",
      totalTokens: 111
    });
    expect(ompCard).toMatchObject({
      model: "omp-db-model",
      provider: "ollama",
      totalTokens: 222
    });
  });
});

type ProjectionCard = {
  canonicalSessionId?: string;
  model?: string;
  provider?: string;
  runtime?: string;
  sessionId: string;
  sourceSessionId?: string;
  totalTokens?: number;
};

type LiveStartedPayloadInput = {
  payload?: Record<string, unknown>;
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
    sourceSessionId: input.sourceSessionId,
    ...input.payload
  };
}

async function createTestDaemon(existingHomeDir?: string): Promise<MastheadDaemon> {
  const tempDir = existingHomeDir ?? (await mkdtemp(join(tmpdir(), "masthead-daemon-server-")));
  if (!existingHomeDir) tempDirs.push(tempDir);
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

async function writeTestHerdrFiles(homeDir: string, lines: string[]): Promise<void> {
  await mkdir(join(homeDir, ".config/herdr"), { recursive: true });
  await writeFile(join(homeDir, ".config/herdr/herdr-server.log"), `${lines.join("\n")}\n`);
  await writeFile(join(homeDir, ".config/herdr/session.json"), "{\"workspaces\":[]}\n");
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

function projectionCards(payload: Record<string, unknown>): ProjectionCard[] {
  const projection = payload.projection;
  if (!projection || typeof projection !== "object" || !("cards" in projection) || !Array.isArray(projection.cards)) {
    throw new Error("Projection response did not include cards.");
  }
  const cards: ProjectionCard[] = [];
  for (const card of projection.cards) {
    if (!isProjectionCard(card)) {
      throw new Error("Projection response included a malformed card.");
    }
    cards.push(card);
  }
  return cards;
}

function isProjectionCard(value: unknown): value is ProjectionCard {
  return Boolean(value && typeof value === "object" && "sessionId" in value && typeof value.sessionId === "string");
}

type ProjectionRuntime = "opencode" | "omp";

function insertProjectionSession(
  daemon: MastheadDaemon,
  input: { runtime: ProjectionRuntime; sessionId: string; sourceSessionId: string; timestamp: string; title: string }
): void {
  const runtimeId = runtimeIdFor(input.runtime, undefined);
  daemon.database
    .prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)")
    .run("host:127.0.0.1", "127.0.0.1", input.timestamp, input.timestamp);
  daemon.database
    .prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .run(runtimeId, input.runtime, null, input.timestamp, input.timestamp);
  daemon.database
    .prepare(
      `INSERT OR REPLACE INTO sessions (
        session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
        branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
        source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      "host:127.0.0.1",
      runtimeId,
      input.sourceSessionId,
      "Masthead",
      "/workspace/masthead",
      "/workspace/masthead",
      "agent/canonical-identity",
      input.title,
      "Project usage overlay metadata",
      "running",
      null,
      input.timestamp,
      input.timestamp,
      null,
      "authoritative",
      input.timestamp,
      input.timestamp
    );
}

function insertProjectionUsage(
  daemon: MastheadDaemon,
  input: { model: string; observedAt: string; provider: string; sessionId: string; totalTokens: number; usageId: string }
): void {
  daemon.database
    .prepare(
      `INSERT INTO model_usage (
        usage_id, session_id, model, provider, input_tokens, output_tokens, total_tokens, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.usageId, input.sessionId, input.model, input.provider, null, null, input.totalTokens, input.observedAt, "{}");
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
