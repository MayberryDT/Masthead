import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RUNTIME_KINDS } from "../../../adapters/types.ts";
import { sessionAdapters } from "../../../adapters/registry.ts";
import { normalizeLiveHookPayload } from "../../../core/liveHookAdapter.ts";
import { projectLiveEvents } from "../../../core/liveProjection.ts";
import { parseHerdrServerLogLines, scanHerdrObserver } from "../herdrObserver.ts";
import { scanLocalSources } from "../sourceScanService.ts";
import { scanResultToOnboardingScan } from "../sourceSetupService.ts";
import { supportedAdapters } from "../supportedAdapters.ts";

const adapterHomeEnvKeys = [
  "MASTHEAD_CURSOR_HOME",
  "MASTHEAD_CLAUDE_CODE_HOME",
  "CLAUDE_HOME",
  "MASTHEAD_ANTIGRAVITY_HOME",
  "ANTIGRAVITY_HOME",
  "MASTHEAD_OPENCODE_HOME",
  "OPENCODE_HOME",
  "MASTHEAD_AIDER_HOME",
  "AIDER_HOME",
  "MASTHEAD_OPENCLAW_HOME",
  "OPENCLAW_HOME",
  "MASTHEAD_HERMES_HOME",
  "HERMES_HOME",
  "MASTHEAD_PI_HOME",
  "PI_HOME"
] as const;

const tempDirs: string[] = [];
let savedEnv: Partial<Record<(typeof adapterHomeEnvKeys)[number], string | undefined>>;

beforeEach(() => {
  savedEnv = Object.fromEntries(adapterHomeEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of adapterHomeEnvKeys) delete process.env[key];
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key as (typeof adapterHomeEnvKeys)[number]];
    else process.env[key as (typeof adapterHomeEnvKeys)[number]] = value;
  }
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Herdr passive observer", () => {
  test("parses sanitized Herdr server log lines as metadata-only observations", () => {
    const parsed = parseHerdrServerLogLines(sanitizedHerdrLines(), {
      now: "2026-07-07T12:00:30.000Z",
      sourcePath: "/home/test/.config/herdr/herdr-server.log"
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.observations.map((observation) => observation.kind)).toEqual(
      expect.arrayContaining(["server", "socket", "focus", "process", "agent", "exit", "session_save"])
    );
    expect(parsed.observations.filter((observation) => observation.kind === "agent")).toMatchObject([
      { agentLabel: "Omp", mappedRuntime: "omp", confidence: "heuristic" },
      { agentLabel: "Codex", mappedRuntime: "codex", confidence: "heuristic" },
      { agentLabel: "Claude", mappedRuntime: "claude_code", confidence: "inferred" },
      { agentLabel: "Grok", mappedRuntime: "grok", confidence: "heuristic" },
      { agentLabel: "Hermes", mappedRuntime: "hermes", confidence: "heuristic" }
    ]);
    expect(parsed.observations).toContainEqual(
      expect.objectContaining({
        cwd: "/workspaces/masthead",
        kind: "focus",
        paneId: "pane-1",
        workspaceId: "workspace-1"
      })
    );
    expect(parsed.observations).toContainEqual(expect.objectContaining({ kind: "process", pgid: 4100, pid: 4101 }));
  });

  test("keeps current pane agents when recent focus churn would otherwise evict their agent-change lines", () => {
    const churn = Array.from(
      { length: 20 },
      (_, index) => `2026-07-07T12:01:${String(index).padStart(2, "0")}.000Z INFO workspace="workspace-1" pane="pane-1" focused`
    );
    const parsed = parseHerdrServerLogLines(
      [
        "2026-07-07T12:00:00.000Z INFO workspace=\"workspace-1\" pane=\"pane-1\" focused cwd=\"/workspaces/masthead\"",
        "2026-07-07T12:00:01.000Z INFO pane=\"pane-1\" agent changed None -> Some(Codex)",
        "2026-07-07T12:00:02.000Z INFO workspace=\"workspace-2\" pane=\"pane-2\" focused",
        "2026-07-07T12:00:03.000Z INFO pane=\"pane-2\" agent changed None -> Some(Grok)",
        "2026-07-07T12:00:04.000Z INFO herdr::pane: agent changed pane=\"pane-2\" previous_agent=Some(Grok) agent=None pgid=Some(1200)",
        ...churn
      ],
      {
        maxObservations: 3,
        now: "2026-07-07T12:02:00.000Z",
        sourcePath: "/home/test/.config/herdr/herdr-server.log"
      }
    );

    expect(parsed.observations).toContainEqual(
      expect.objectContaining({ agentLabel: "Codex", kind: "agent", mappedRuntime: "codex", paneId: "pane-1", workspaceId: "workspace-1" })
    );
    expect(parsed.observations).not.toContainEqual(expect.objectContaining({ agentLabel: "Grok", paneId: "pane-2" }));
  });

  test("ignores prompt transcript terminal model and token-looking content", () => {
    const parsed = parseHerdrServerLogLines(
      [
        "2026-07-07T12:00:01.000Z INFO pane=secret-pane agent changed None -> Some(Codex) prompt=HERDR_RAW_PROMPT_SENTINEL",
        "2026-07-07T12:00:02.000Z INFO transcript=HERDR_TRANSCRIPT_SENTINEL terminal=HERDR_TERMINAL_SENTINEL stdout=forbidden",
        "2026-07-07T12:00:03.000Z INFO model=gpt-forbidden totalTokens=12345 inputTokens=12 outputTokens=34 provider=forbidden"
      ],
      { now: "2026-07-07T12:00:30.000Z", sourcePath: "/home/test/.config/herdr/herdr-server.log" }
    );

    expect(parsed.observations).toEqual([]);
    const serializedObservations = JSON.stringify(parsed.observations);
    expect(serializedObservations).not.toContain("HERDR_RAW_PROMPT_SENTINEL");
    expect(serializedObservations).not.toContain("HERDR_TRANSCRIPT_SENTINEL");
    expect(serializedObservations).not.toContain("HERDR_TERMINAL_SENTINEL");
    expect(serializedObservations).not.toContain("gpt-forbidden");
    expect(serializedObservations).not.toContain("totalTokens");
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: "herdr_observer_sensitive_lines_ignored", count: 3 }));
  });

  test("reports Herdr availability from bounded known paths only", async () => {
    const homeDir = await makeHome("masthead-herdr-observer-");
    await writeHerdrFiles(homeDir, sanitizedHerdrLines().join("\n"));
    const arbitraryPath = join(homeDir, "Documents", "random-herdr-like", "session.jsonl");
    await mkdir(join(homeDir, "Documents", "random-herdr-like"), { recursive: true });
    await writeFile(arbitraryPath, "pane=arbitrary agent=Codex\n");

    const observer = await scanHerdrObserver({ exclusions: [], homeDir, now: "2026-07-07T12:00:30.000Z" });

    expect(observer).toMatchObject({
      capabilities: {
        callsSocket: false,
        createsSessions: false,
        passivePaneEvidence: true,
        providesModel: false,
        providesTokens: false,
        providesTranscript: false
      },
      label: "Herdr",
      observer: "herdr",
      state: "available"
    });
    expect(observer.checkedPaths.map((path) => path.path)).toEqual([
      join(homeDir, ".config/herdr/herdr-server.log"),
      join(homeDir, ".config/herdr/session.json"),
      join(homeDir, ".config/herdr/herdr-client.log"),
      join(homeDir, ".local/bin/herdr")
    ]);
    expect(observer.checkedPaths.map((path) => path.path)).not.toContain(arbitraryPath);
    expect(observer.observations).toContainEqual(expect.objectContaining({ agentLabel: "Codex", mappedRuntime: "codex" }));
    expect(JSON.stringify(observer.observations)).not.toContain("model");
    expect(JSON.stringify(observer.observations)).not.toContain("Tokens");
  });

  test("surfaces observers outside adapters importable sources and session creation paths", async () => {
    const homeDir = await makeHome("masthead-herdr-source-scan-");
    await writeHerdrFiles(homeDir, sanitizedHerdrLines().join("\n"));

    const scan = await scanLocalSources({ exclusions: [], homeDir, now: "2026-07-07T12:00:30.000Z" });
    const onboarding = scanResultToOnboardingScan(scan);

    expect(scan.observers).toHaveLength(1);
    expect(scan.observers?.[0]?.observations).toContainEqual(expect.objectContaining({ mappedRuntime: "claude_code" }));
    expect(scan.adapters.map((adapter) => adapter.runtime)).not.toContain("herdr");
    expect(scan.adapters.flatMap((adapter) => adapter.sources)).toEqual([]);
    expect(onboarding.observers).toHaveLength(1);
    expect(onboarding.foundSources).toEqual([]);
    expect(onboarding.summary.foundSources).toBe(0);
    expect(onboarding.summary.detectedHarnesses).toBe(0);
  });

  test("does not create duplicate projection sessions from Herdr observer evidence", async () => {
    const homeDir = await makeHome("masthead-herdr-projection-");
    await writeHerdrFiles(homeDir, sanitizedHerdrLines().join("\n"));
    const scan = await scanLocalSources({ exclusions: [], homeDir, now: "2026-07-07T12:00:30.000Z" });
    const started = normalizeLiveHookPayload(
      {
        cwd: "/workspaces/masthead",
        event: "session_started",
        project: "Masthead",
        provider_event_id: "codex-session-started",
        session_id: "codex-live-session",
        timestamp: "2026-07-07T12:00:12.000Z",
        title: "Repair live harness"
      },
      { receivedAt: "2026-07-07T12:00:12.050Z", runtime: "codex" }
    );

    const envelope = projectLiveEvents([started], [], { generatedAt: "2026-07-07T12:00:30.000Z" });

    expect(scan.observers?.[0]?.observations).toContainEqual(expect.objectContaining({ mappedRuntime: "codex" }));
    expect(envelope.events).toBe(1);
    expect(envelope.projection.cards).toHaveLength(1);
    expect(envelope.projection.cards[0]).toMatchObject({
      runtime: "codex",
      sessionId: "codex-live-session"
    });
  });

  test("keeps Herdr out of runtime kinds supported adapters and adapter registry", () => {
    const runtimeNames: string[] = RUNTIME_KINDS.map((runtime) => runtime);
    const supportedRuntimeNames: string[] = supportedAdapters.map((adapter) => adapter.runtime);
    const adapterRuntimeNames: string[] = sessionAdapters.map((adapter) => adapter.runtime);

    expect(runtimeNames).not.toContain("herdr");
    expect(supportedRuntimeNames).not.toContain("herdr");
    expect(adapterRuntimeNames).not.toContain("herdr");
  });
});

function sanitizedHerdrLines(): string[] {
  return [
    "2026-07-07T12:00:00.000Z INFO herdr server started",
    "2026-07-07T12:00:01.000Z INFO api socket path=\"/home/test/.config/herdr/herdr.sock\"",
    "2026-07-07T12:00:02.000Z INFO workspace=\"workspace-1\" pane=\"pane-1\" focused cwd=\"/workspaces/masthead\"",
    "2026-07-07T12:00:03.000Z INFO pane=\"pane-1\" pid=4101 pgid=4100",
    "2026-07-07T12:00:04.000Z INFO pane=\"pane-1\" agent changed None -> Some(Omp)",
    "2026-07-07T12:00:05.000Z INFO pane=\"pane-1\" agent changed Some(Omp) -> Some(Codex)",
    "2026-07-07T12:00:06.000Z INFO pane=\"pane-1\" agent changed Some(Codex) -> Some(Claude)",
    "2026-07-07T12:00:07.000Z INFO pane=\"pane-1\" agent changed Some(Claude) -> Some(Grok)",
    "2026-07-07T12:00:08.000Z INFO pane=\"pane-1\" agent changed Some(Grok) -> Some(Hermes)",
    "2026-07-07T12:00:09.000Z INFO pane=\"pane-1\" exited status=0",
    "2026-07-07T12:00:10.000Z INFO session saved workspace=\"workspace-1\" pane=\"pane-1\""
  ];
}

async function makeHome(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const homeDir = join(tempDir, "home");
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

async function writeHerdrFiles(homeDir: string, serverLog: string): Promise<void> {
  await mkdir(join(homeDir, ".config/herdr"), { recursive: true });
  await mkdir(join(homeDir, ".local/bin"), { recursive: true });
  await writeFile(join(homeDir, ".config/herdr/herdr-server.log"), `${serverLog}\n`);
  await writeFile(join(homeDir, ".config/herdr/session.json"), "{\"workspaceId\":\"workspace-1\",\"paneId\":\"pane-1\",\"cwd\":\"/workspaces/masthead\"}\n");
  await writeFile(join(homeDir, ".config/herdr/herdr-client.log"), "2026-07-07T12:00:00.000Z INFO client started\n");
  await writeFile(join(homeDir, ".local/bin/herdr"), "#!/usr/bin/env sh\nexit 0\n");
}
