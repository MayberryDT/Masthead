import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("live state API", () => {
  test("acknowledges live ingest before slow canonical persistence", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    const resultDir = await mkdtemp(join(tmpdir(), "masthead-live-ack-"));
    tempDirs.push(resultDir);
    const resultPath = join(resultDir, "elapsed.txt");
    daemon.database.function("masthead_test_pause", () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      return 0;
    });
    daemon.database.exec(`
      CREATE TRIGGER pause_live_session_insert
      BEFORE INSERT ON sessions
      WHEN NEW.source_session_id = 'slow-live-ack'
      BEGIN
        SELECT masthead_test_pause();
      END;
    `);

    const childScript = `
      import { writeFile } from "node:fs/promises";
      const started = Date.now();
      const response = await fetch(process.argv[1], {
        body: JSON.stringify({ event: "session_start", session_id: "slow-live-ack", timestamp: new Date().toISOString() }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      await response.text();
      await writeFile(process.argv[2], String(Date.now() - started));
      process.exit(response.status === 202 ? 0 : 1);
    `;
    await childExit(spawn(process.execPath, ["--input-type=module", "-e", childScript, `${baseUrl}/ingest?runtime=codex`, resultPath]));

    expect(Number(await readFile(resultPath, "utf8"))).toBeLessThan(150);
    expect(
      daemon.database.prepare("SELECT source_session_id FROM sessions WHERE source_session_id = ?").get("slow-live-ack")
    ).toEqual({ source_session_id: "slow-live-ack" });
  });

  test("accepts live state reports and returns latest reports", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);

    const accepted = await postJson(baseUrl, "/live/state", {
      runtime: "opencode",
      source: "masthead:opencode-plugin",
      sourceSessionId: "source-live-1",
      state: "running",
      seq: 1,
      observedAt: freshTimestamp()
    });
    const latest = await getJson(baseUrl, "/live/state?runtime=opencode&sourceSessionId=source-live-1");

    expect(accepted).toMatchObject({
      ok: true,
      status: "accepted",
      report: {
        runtime: "opencode",
        sourceSessionId: "source-live-1",
        state: "working"
      }
    });
    expect(latest.reports).toEqual([expect.objectContaining({ sourceSessionId: "source-live-1", state: "working" })]);
  });

  test("ignores stale seq reports", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/live/state", {
      runtime: "codex",
      source: "masthead:codex-hook",
      sourceSessionId: "source-stale",
      state: "working",
      seq: 2,
      observedAt: freshTimestamp()
    });
    const stale = await postJson(baseUrl, "/live/state", {
      runtime: "codex",
      source: "masthead:codex-hook",
      sourceSessionId: "source-stale",
      state: "idle",
      seq: 2,
      observedAt: freshTimestamp(1_000)
    });

    expect(stale).toMatchObject({ ok: true, status: "ignored_stale" });
    expect(await getJson(baseUrl, "/live/state?runtime=codex&sourceSessionId=source-stale")).toMatchObject({
      reports: [expect.objectContaining({ state: "working" })]
    });
  });

  test("returns disabled when global or runtime kill switch is set", async () => {
    vi.stubEnv("MASTHEAD_LIVE_CAPTURE", "0");
    const disabledDaemon = await createTestDaemon();
    const disabledBaseUrl = await listen(disabledDaemon);
    expect(await postJson(disabledBaseUrl, "/live/state", { runtime: "codex", source: "test", state: "working" })).toMatchObject({
      ok: true,
      status: "disabled"
    });

    vi.unstubAllEnvs();
    vi.stubEnv("MASTHEAD_LIVE_CAPTURE_CODEX", "0");
    const runtimeDisabledDaemon = await createTestDaemon();
    const runtimeDisabledBaseUrl = await listen(runtimeDisabledDaemon);
    expect(await postJson(runtimeDisabledBaseUrl, "/live/state", { runtime: "codex", source: "test", state: "working" })).toMatchObject({
      ok: true,
      status: "disabled"
    });
  });

  test("explains session live state from latest report", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/ingest?runtime=opencode", {
      provider_event_id: "live-explain-start",
      event: "session_start",
      session_id: "explain-session",
      sourceSessionId: "explain-session",
      timestamp: freshTimestamp(),
      cwd: "/workspace/masthead",
      title: "Explain state"
    });
    await postJson(baseUrl, "/live/state", {
      runtime: "opencode",
      source: "masthead:opencode-plugin",
      sourceSessionId: "explain-session",
      state: "blocked",
      observedAt: freshTimestamp(1_000)
    });

    const explain = await getJson(baseUrl, "/sessions/explain-session/live-explain");

    expect(explain).toMatchObject({
      ok: true,
      sessionId: "explain-session",
      displayState: "blocked",
      semanticState: "blocked",
      selectedAuthority: "live_state",
      latestLiveState: expect.objectContaining({ state: "blocked" })
    });
  });

  test("overlays fresh live state onto projection cards", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/ingest?runtime=opencode", {
      provider_event_id: "projection-live-start",
      event: "session_start",
      session_id: "projection-live-session",
      sourceSessionId: "projection-live-session",
      timestamp: freshTimestamp(),
      cwd: "/workspace/masthead",
      title: "Projection live state"
    });
    await postJson(baseUrl, "/live/state", {
      runtime: "opencode",
      source: "masthead:opencode-plugin",
      sourceSessionId: "projection-live-session",
      state: "blocked",
      observedAt: freshTimestamp(1_000)
    });

    const projection = await getJson(baseUrl, "/projection");
    const card = projection.projection.cards.find((candidate: { sessionId: string }) => candidate.sessionId === "projection-live-session");

    expect(card).toMatchObject({
      displayState: "blocked",
      lifecycle: "running",
      primaryStatus: "blocked",
      runtimeState: "blocked",
      stateAuthority: "live_state",
      stateLabel: "Blocked"
    });
    expect(projection.projection.lanes.find((lane: { laneId: string }) => lane.laneId === "needs_action")).toMatchObject({
      sessionIds: ["projection-live-session"]
    });
  });

  test("derives live state reports from ingest hook events", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/ingest?runtime=codex", {
      hookEventName: "PermissionRequest",
      session_id: "ingest-derived-state",
      timestamp: freshTimestamp(),
      cwd: "/workspace/masthead"
    });

    expect(await getJson(baseUrl, "/live/state?runtime=codex&sourceSessionId=ingest-derived-state")).toMatchObject({
      reports: [expect.objectContaining({ state: "blocked", authority: "hook" })]
    });
  });

  test("projection keeps newest report when multiple sources report one session", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/ingest?runtime=codex", {
      event: "SessionStart",
      session_id: "multi-source-session",
      timestamp: freshTimestamp(),
      cwd: "/workspace/masthead"
    });
    await postJson(baseUrl, "/live/state", {
      runtime: "codex",
      source: "older-hook",
      sourceSessionId: "multi-source-session",
      state: "idle",
      observedAt: freshTimestamp(1_000)
    });
    await postJson(baseUrl, "/live/state", {
      runtime: "codex",
      source: "newer-plugin",
      sourceSessionId: "multi-source-session",
      state: "blocked",
      observedAt: freshTimestamp(2_000)
    });

    const projection = await getJson(baseUrl, "/projection?expandedSessionId=multi-source-session");
    expect(projection.projection.cards[0]).toMatchObject({
      displayState: "blocked",
      stateAuthority: "live_state"
    });
  });
});

function freshTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function createTestDaemon(): Promise<MastheadDaemon> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-state-api-"));
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

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  const payload = await response.json();
  expect(payload).toBeTypeOf("object");
  return payload as Record<string, any>;
}

function childExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`live ingest probe exited with ${code ?? "unknown"}`));
    });
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toBeTypeOf("object");
  return payload as Record<string, any>;
}
