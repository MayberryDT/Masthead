import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { upsertSessionEnrichment } from "../db/enrichmentRepository.ts";
import { getSessionDossier } from "../db/sessionDossierRepository.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { publishSessionToLogbook, seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { markWorkbenchNotAdded } from "../db/workbenchPipelineRepository.ts";
import { resolveLiveConnectorCommandPaths } from "../liveConnectorSettings.ts";

const LIVE_CONNECTOR_RUNTIME_EXPECTATIONS = [
  { label: "Codex", runtime: "codex" },
  { label: "Cursor", runtime: "cursor" },
  { label: "Claude Code", runtime: "claude_code" },
  { label: "OpenCode", runtime: "opencode" },
  { label: "Grok Build", runtime: "grok" },
  { label: "Hermes", runtime: "hermes" },
  { label: "Pi", runtime: "pi" },
  { label: "Oh My Pi", runtime: "omp" }
] as const;

const CLAUDE_STYLE_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop"] as const;


const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("settings API", () => {
  test("reports effective settings and enumerable deletion targets", async () => {
    const { daemon, databasePath, storePath } = await createTestHarness();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:settings", title: "Settings API" });
    publishSessionToLogbook(daemon.database, "session:settings");
    seedWeakSessionWithoutEffects(daemon.database);
    seedUnsupportedLegacyRuntime(daemon.database);
    const baseUrl = await listen(daemon);

    const state = await getJson(baseUrl, "/settings");
    const settings = state.settings as Record<string, any>;

    expect(state).toMatchObject({
      ok: true,
      settings: {
        enrichment: {
          provider: "Deterministic fallback",
          remoteModelEnabled: false
        },
        llm: {
          activeProvider: "openai",
          providers: expect.arrayContaining([
            expect.objectContaining({
              configured: false,
              id: "openai",
              model: "gpt-5-nano-2025-08-07"
            }),
            expect.objectContaining({
              configured: false,
              id: "anthropic",
              model: "claude-sonnet-4-6"
            }),
            expect.objectContaining({
              configured: false,
              id: "gemini",
              model: "gemini-3.5-flash"
            }),
            expect.objectContaining({
              apiKeyRequired: false,
              baseUrl: "http://127.0.0.1:11434/v1",
              id: "ollama",
              label: "Ollama",
              local: true,
              model: "llama3.1"
            }),
            expect.objectContaining({
              apiKeyRequired: false,
              baseUrl: "http://127.0.0.1:8000/v1",
              id: "vllm",
              label: "vLLM",
              local: true
            })
          ]),
          remoteEnrichmentEnabled: false
        },
        privacy: {
          mcpAccessEnabled: true,
          redactionEnabled: true
        },
        schemaVersion: expect.any(Number),
        runtime: {
          mode: "primary",
          writable: true
        },
        storage: {
          databasePath,
          dataDirectory: dirname(databasePath),
          storePath
        }
      }
    });
    expect(settings.data).toMatchObject({
      databasePath,
      dataDirectory: dirname(databasePath),
      migrationState: "ready",
      storePath
    });
    const health = await getJson(baseUrl, "/health");
    expect(settings.data.databaseId).toBe(health.data.databaseId);
    expect(settings.enrichment.health).toMatchObject({
      sessionsWithMessagesButNoEffects: 1,
      weakCurrentTitles: 1
    });
    expect(settings.hooks.integrations.map((integration: { runtime: string }) => integration.runtime)).toEqual(
      LIVE_CONNECTOR_RUNTIME_EXPECTATIONS.map((runtime) => runtime.runtime)
    );
    expect(settings.hooks.integrations).toEqual(
      LIVE_CONNECTOR_RUNTIME_EXPECTATIONS.map(({ label, runtime }) =>
        expect.objectContaining({
          actionSurface: "settings",
          captureMode: "live_hook",
          label,
          runtime,
          supportsActions: true
        })
      )
    );
    expect(state.settings.deletionTargets.projects).toEqual([{ label: "Masthead", value: "Masthead" }]);
    expect(state.settings.deletionTargets.runtimes).toEqual([{ label: "opencode", value: "opencode" }]);
    expect(state.settings.deletionTargets.hosts).toEqual([{ label: "masthead-test-host", value: "masthead-test-host" }]);
  });

  test("saves LLM provider settings without exposing API keys", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const saved = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      apiKey: "sk-test-settings-secret-3456",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    expect(JSON.stringify(saved)).not.toContain("sk-test-settings-secret-3456");
    expect(saved.settings.llm).toMatchObject({
      activeProvider: "ollama",
      remoteEnrichmentEnabled: true,
      providers: expect.arrayContaining([
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:11434/v1",
          configured: true,
          id: "ollama",
          keyPreview: "••••3456",
          model: "llama-3.1"
        })
      ])
    });
    expect(saved.settings.enrichment).toMatchObject({
      model: "llama-3.1",
      provider: "Ollama",
      remoteModelEnabled: true
    });

    const reloaded = await getJson(baseUrl, "/settings");
    expect(JSON.stringify(reloaded)).not.toContain("sk-test-settings-secret-3456");
    expect(reloaded.settings.llm.providers).toEqual(saved.settings.llm.providers);

    const stored = daemon.database.prepare("SELECT setting_json AS settingJson FROM app_settings WHERE setting_key = ?").get("llm_provider") as
      | { settingJson: string }
      | undefined;
    expect(stored?.settingJson).toContain("sk-test-settings-secret-3456");

    const cleared = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      clearApiKey: true,
      model: "llama-3.1",
      remoteEnrichmentEnabled: false
    });
    expect(cleared.settings.llm.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ollama"
        })
      ])
    );
    expect(JSON.stringify(cleared)).not.toContain("sk-test-settings-secret-3456");
    expect(cleared.settings.enrichment).toMatchObject({
      provider: "Deterministic fallback",
      remoteModelEnabled: false
    });
  });

  test("reflects Settings-backed compatible enrichment in board headline health", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "openai_compatible",
      apiKey: "compatible-settings-key",
      baseUrl: "https://compatible.example.test/v1",
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    const health = await getJson(baseUrl, "/health");

    expect(health.boardHeadlines).toMatchObject({
      configured: true,
      enabled: true,
      model: "llama-3.1",
      provider: "openai_compatible"
    });
    expect(health.boardHeadlines.provider).not.toBe("openai");
  });

  test("disabling remote enrichment without resubmitting credentials retains provider settings", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      apiKey: "sk-test-settings-secret-3456",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    const disabled = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      remoteEnrichmentEnabled: false
    });

    expect(disabled.settings.llm).toMatchObject({
      activeProvider: "ollama",
      remoteEnrichmentEnabled: false,
      providers: expect.arrayContaining([
        expect.objectContaining({
          configured: true,
          id: "ollama",
          keyPreview: "••••3456",
          model: "llama-3.1"
        })
      ])
    });
    expect(JSON.stringify(disabled)).not.toContain("sk-test-settings-secret-3456");
  });

  test("rejects incomplete OpenAI-compatible provider settings", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const response = await fetch(`${baseUrl}/settings/llm-provider`, {
      body: JSON.stringify({
        activeProvider: "openai_compatible",
        apiKey: "sk-test",
        model: "llama-3.1",
        remoteEnrichmentEnabled: true
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("OpenAI-compatible providers require an HTTP base URL");
  });

  test("enables local Ollama enrichment without an API key", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const saved = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.1",
      remoteEnrichmentEnabled: true
    });

    expect(JSON.stringify(saved)).not.toContain("sk-");
    expect(JSON.stringify(saved)).not.toContain('"apiKey":');
    expect(saved.settings.llm).toMatchObject({
      activeProvider: "ollama",
      providers: expect.arrayContaining([
        expect.objectContaining({
          apiKeyRequired: false,
          baseUrl: "http://127.0.0.1:11434/v1",
          configured: true,
          id: "ollama",
          label: "Ollama",
          local: true,
          model: "llama3.1"
        })
      ]),
      remoteEnrichmentEnabled: true
    });
    expect(saved.settings.enrichment).toMatchObject({
      model: "llama3.1",
      provider: "Ollama",
      remoteModelEnabled: true
    });
  });

  test("session dossier GET is read-only and does not queue enrichment", async () => {
    let providerCalls = 0;
    const providerServer = createServer((request, response) => {
      request.resume();
      providerCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    });
    servers.push(providerServer);
    const providerBaseUrl = await listenHttp(providerServer);
    const { daemon } = await createTestHarness();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:dossier-read-only",
      title: "Cached dossier"
    });
    publishSessionToLogbook(daemon.database, "session:dossier-read-only");
    daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session:dossier-read-only");
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      apiKey: "test-compatible-key",
      baseUrl: `${providerBaseUrl}/v1`,
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    const dossier = await getJson(baseUrl, `/sessions/${encodeURIComponent("session:dossier-read-only")}/dossier`);
    await delay(250);

    expect(dossier.dossier.enrichment.status).toBe("not_enriched");
    expect(providerCalls).toBe(0);
  });

  test("session dossier and transcript GET hide unpublished and Not Added sessions", async () => {
    const { daemon } = await createTestHarness();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:hidden",
      title: "Hidden raw session"
    });
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:not-added",
      title: "Not Added session"
    });
    markWorkbenchNotAdded(daemon.database, {
      actor: { kind: "system", id: "quality" },
      reason: "metadata_only",
      sessionId: "session:not-added"
    });
    const baseUrl = await listen(daemon);

    for (const path of [
      `/sessions/${encodeURIComponent("session:hidden")}/dossier`,
      `/sessions/${encodeURIComponent("session:hidden")}/transcript`,
      `/sessions/${encodeURIComponent("session:not-added")}/dossier`,
      `/sessions/${encodeURIComponent("session:not-added")}/transcript`
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
      expect(response.status).toBe(404);
    }
  });

  test("manual Dossier enrichment retries old failed sessions in the background", async () => {
    let providerCalls = 0;
    const providerServer = createServer((request, response) => {
      expect(request.url).toBe("/v1/chat/completions");
      request.resume();
      providerCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  durableProviderOutput({
                    summary: "Manual Dossier enrichment refreshed a previously failed session.",
                    title: "Manual Dossier enrichment retry"
                  })
                )
              }
            }
          ]
        })
      );
    });
    servers.push(providerServer);
    const providerBaseUrl = await listenHttp(providerServer);
    const { daemon } = await createTestHarness();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:manual-dossier-enrich",
      title: "Old failed enrichment"
    });
    publishSessionToLogbook(daemon.database, "session:manual-dossier-enrich");
    daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session:manual-dossier-enrich");
    upsertSessionEnrichment(daemon.database, {
      contentFingerprint: "manual-dossier:fingerprint:failed:timeout",
      enrichmentKind: "session_capsule",
      failureCode: "timeout",
      failureMessage: "Previous enrichment timed out.",
      generatedAt: "2026-07-03T18:00:00.000Z",
      model: "llama-3.1",
      promptVersion: "session-capsule-v4",
      provider: "openai_compatible",
      sessionId: "session:manual-dossier-enrich",
      sourceRefs: [],
      status: "failed"
    });
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      apiKey: "test-compatible-key",
      baseUrl: `${providerBaseUrl}/v1`,
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    const accepted = await postJson(baseUrl, `/sessions/${encodeURIComponent("session:manual-dossier-enrich")}/dossier/enrich`, {});

    expect(accepted).toMatchObject({ ok: true, enrichment: { status: "enriching" } });
    await waitFor(() => providerCalls === 1);
    await waitFor(() => getSessionDossier(daemon.database, "session:manual-dossier-enrich")?.enrichment.status === "current");
    const dossier = await getJson(baseUrl, `/sessions/${encodeURIComponent("session:manual-dossier-enrich")}/dossier`);
    expect(dossier.dossier.enrichment.status).toBe("current");
    expect(dossier.dossier.identity.title).toBe("Manual Dossier enrichment retry");
  });

  test("manual Dossier enrichment enqueue is not blocked by old tool result bodies", async () => {
    const { daemon } = await createTestHarness();
    const sessionId = "session:manual-dossier-large-history";
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Large old Dossier"
    });
    publishSessionToLogbook(daemon.database, sessionId);
    seedLargeToolHistory(daemon.database, sessionId, 180);
    const baseUrl = await listen(daemon);

    const startedAt = performance.now();
    const accepted = await postJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier/enrich`, {});
    const elapsedMs = performance.now() - startedAt;

    expect(accepted).toMatchObject({ ok: true, enrichment: { status: "enriching" } });
    expect(elapsedMs).toBeLessThan(500);
  });


  test("lists models from a local OpenAI-compatible provider", async () => {
    const modelServer = createServer((request, response) => {
      expect(request.url).toBe("/v1/models");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "llama3.1" }, { id: "qwen2.5-coder" }] }));
    });
    servers.push(modelServer);
    const modelBaseUrl = await listenHttp(modelServer);
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const discovered = await postJson(
      baseUrl,
      "/settings/llm-provider/models",
      {
        activeProvider: "ollama",
        baseUrl: `${modelBaseUrl}/v1`
      },
      200
    );

    expect(discovered).toEqual({
      ok: true,
      models: [
        { id: "llama3.1", label: "llama3.1" },
        { id: "qwen2.5-coder", label: "qwen2.5-coder" }
      ]
    });
  });

  test("saves native Anthropic and Gemini provider settings without exposing API keys", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const anthropic = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "anthropic",
      apiKey: "anthropic-settings-secret-7890",
      model: "claude-sonnet-4-6",
      remoteEnrichmentEnabled: true
    });
    expect(JSON.stringify(anthropic)).not.toContain("anthropic-settings-secret-7890");
    expect(anthropic.settings.llm).toMatchObject({
      activeProvider: "anthropic",
      providers: expect.arrayContaining([
        expect.objectContaining({
          configured: true,
          id: "anthropic",
          keyPreview: "••••7890",
          model: "claude-sonnet-4-6"
        })
      ]),
      remoteEnrichmentEnabled: true
    });
    expect(anthropic.settings.enrichment).toMatchObject({
      model: "claude-sonnet-4-6",
      provider: "Anthropic",
      remoteModelEnabled: true
    });

    const gemini = await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "gemini",
      apiKey: "gemini-settings-secret-2468",
      model: "gemini-3.5-flash",
      remoteEnrichmentEnabled: true
    });
    expect(JSON.stringify(gemini)).not.toContain("anthropic-settings-secret-7890");
    expect(JSON.stringify(gemini)).not.toContain("gemini-settings-secret-2468");
    expect(gemini.settings.llm).toMatchObject({
      activeProvider: "gemini",
      providers: expect.arrayContaining([
        expect.objectContaining({
          configured: true,
          id: "gemini",
          keyPreview: "••••2468",
          model: "gemini-3.5-flash"
        })
      ]),
      remoteEnrichmentEnabled: true
    });
    expect(gemini.settings.enrichment).toMatchObject({
      model: "gemini-3.5-flash",
      provider: "Gemini",
      remoteModelEnabled: true
    });
  });

  test("rejects stale database identity on destructive previews and confirms", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const settings = await getJson(baseUrl, "/settings");
    const currentDatabaseId = settings.settings.data.databaseId;

    const currentPreview = await fetch(`${baseUrl}/data/summary?databaseId=${encodeURIComponent(currentDatabaseId)}`, { headers: { accept: "application/json" } });
    expect(currentPreview.status).toBe(200);

    const preview = await fetch(`${baseUrl}/data/summary?databaseId=sqlite:stale`, { headers: { accept: "application/json" } });
    expect(preview.status).toBe(400);
    expect(await preview.text()).toContain("Masthead database changed");

    const confirm = await fetch(`${baseUrl}/data/delete`, {
      body: JSON.stringify({ databaseId: "sqlite:stale", scope: { kind: "all" } }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(confirm.status).toBe(400);
    expect(await confirm.text()).toContain("Masthead database changed");
  });


  test("installs, tests, and uninstalls the live connector hook files", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const claudePath = join(tempDir, ".claude", "settings.json");
    const codexPath = join(tempDir, ".codex", "hooks.json");
    const cursorPath = join(tempDir, ".cursor", "hooks.json");
    const grokPath = join(tempDir, ".grok", "hooks", "masthead.json");
    const ompPath = join(tempDir, ".omp", "agent", "extensions", "masthead-live.js");
    const opencodePath = join(tempDir, ".config", "opencode", "plugins", "masthead-live.js");
    const piPath = join(tempDir, ".pi", "agent", "extensions", "masthead-live.js");
    const hermesPath = join(tempDir, ".hermes", "plugins", "masthead-live", "plugin.yaml");
    const hermesInitPath = join(tempDir, ".hermes", "plugins", "masthead-live", "__init__.py");
    const hermesConfigPath = join(tempDir, ".hermes", "config.yaml");

    const before = await getJson(baseUrl, "/settings/hooks");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: codexPath,
      installed: false
    });
    await mkdir(dirname(cursorPath), { recursive: true });
    await writeFile(
      cursorPath,
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: "node existing-cursor-hook.js" }, { command: "MASTHEAD_INGEST_URL=http://old/ingest node /old/masthead-hook.js" }]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    for (const { runtime } of LIVE_CONNECTOR_RUNTIME_EXPECTATIONS) {
      await postJson(baseUrl, `/settings/hooks/${runtime}/install`);
    }
    const installed = await getJson(baseUrl, "/settings/hooks");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      installed: true
    });
    const codexConfig = JSON.parse(await readFile(codexPath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(codexConfig.hooks)).toEqual(CLAUDE_STYLE_HOOK_EVENTS);
    for (const eventName of CLAUDE_STYLE_HOOK_EVENTS) {
      expect(codexConfig.hooks[eventName]?.[0]?.hooks[0]?.command).toContain("runtime=codex");
      expect(codexConfig.hooks[eventName]?.[0]?.hooks[0]?.command).toContain("/live/state");
    }
    expect(await readFile(claudePath, "utf8")).toContain("runtime=claude_code");
    const cursorConfig = JSON.parse(await readFile(cursorPath, "utf8")) as { hooks: Record<string, Array<{ command: string }>> };
    expect(cursorConfig.hooks.beforeSubmitPrompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "node existing-cursor-hook.js" }),
        expect.objectContaining({ command: expect.stringContaining("runtime=cursor") })
      ])
    );
    const cursorMastheadPromptHooks = cursorConfig.hooks.beforeSubmitPrompt.filter((entry) => entry.command.includes("masthead-hook.js"));
    expect(cursorMastheadPromptHooks).toHaveLength(1);
    expect(cursorMastheadPromptHooks[0]?.command).not.toContain("/old/");
    expect(cursorConfig.hooks.afterFileEdit).toEqual([expect.objectContaining({ command: expect.stringContaining("runtime=cursor") })]);
    expect(await readFile(grokPath, "utf8")).toContain("runtime=grok");
    expect(await readFile(ompPath, "utf8")).toContain("masthead-live-connector");
    expect(await readFile(ompPath, "utf8")).toContain("runtime=omp");
    expect(await readFile(ompPath, "utf8")).toContain("/live/state");
    expect(await readFile(ompPath, "utf8")).toContain("session_start");
    expect(await readFile(opencodePath, "utf8")).toContain("masthead-live-connector");
    expect(await readFile(opencodePath, "utf8")).toContain("runtime=opencode");
    expect(await readFile(opencodePath, "utf8")).toContain("/live/state");
    expect(await readFile(piPath, "utf8")).toContain("masthead-live-connector");
    expect(await readFile(piPath, "utf8")).toContain("runtime=pi");
    expect(await readFile(piPath, "utf8")).toContain("/live/state");
    expect(await readFile(hermesPath, "utf8")).toContain("masthead-live-connector");
    expect(await readFile(hermesPath, "utf8")).toContain("name: masthead-live");
    expect(await readFile(hermesInitPath, "utf8")).toContain("runtime=hermes");
    expect(await readFile(hermesInitPath, "utf8")).toContain("/live/state");
    expect(await readFile(hermesInitPath, "utf8")).toContain("on_session_start");
    expect(await readFile(hermesConfigPath, "utf8")).toMatch(/enabled:[\s\S]*masthead-live/);
    expect(installed.hooks.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ configPath: codexPath, runtime: "codex", status: "installed" }),
        expect.objectContaining({ configPath: claudePath, runtime: "claude_code", status: "installed" }),
        expect.objectContaining({ configPath: cursorPath, runtime: "cursor", status: "installed" }),
        expect.objectContaining({ configPath: grokPath, runtime: "grok", status: "installed" }),
        expect.objectContaining({ configPath: ompPath, runtime: "omp", status: "installed" }),
        expect.objectContaining({ configPath: opencodePath, runtime: "opencode", status: "installed" }),
        expect.objectContaining({ configPath: piPath, runtime: "pi", status: "installed" }),
        expect.objectContaining({ configPath: hermesPath, runtime: "hermes", status: "installed" })
      ])
    );

    const tested = await postJson(baseUrl, "/settings/hooks/claude_code/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: expect.stringContaining("Connector command verified"),
      status: "passed"
    });
    const syntheticRows = daemon.database
      .prepare(
        `SELECT runtimes.runtime_kind AS runtime, sessions.source_session_id AS sourceSessionId
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        WHERE sessions.source_session_id LIKE 'masthead-hook-test-%'
        ORDER BY runtimes.runtime_kind`
      )
      .all() as Array<{ runtime: string; sourceSessionId: string }>;
    expect(syntheticRows).toEqual([]);
    const stateRows = daemon.database
      .prepare("SELECT runtime, state FROM live_state_reports WHERE source = 'masthead:claude_code-hook' AND source_session_id LIKE 'masthead-hook-test-%' ORDER BY runtime")
      .all() as Array<{ runtime: string; state: string }>;
    expect(stateRows).toEqual([expect.objectContaining({ runtime: "claude_code", state: "working" })]);
    const projection = await getJson(baseUrl, "/projection");
    expect(projection.projection.cards).toHaveLength(0);

    for (const { runtime } of LIVE_CONNECTOR_RUNTIME_EXPECTATIONS) {
      await postJson(baseUrl, `/settings/hooks/${runtime}/uninstall`);
    }
    const uninstalled = await getJson(baseUrl, "/settings/hooks");
    expect(uninstalled.hooks).toMatchObject({
      installed: false
    });
    expect(uninstalled.hooks.latestBackupPath).toContain("masthead-backup");
    const uninstalledCursorConfig = JSON.parse(await readFile(cursorPath, "utf8")) as { hooks: Record<string, Array<{ command: string }>> };
    expect(uninstalledCursorConfig.hooks.beforeSubmitPrompt).toEqual([{ command: "node existing-cursor-hook.js" }]);
    expect(uninstalledCursorConfig.hooks.afterFileEdit).toEqual([]);
    await expect(readFile(ompPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(opencodePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(piPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(hermesPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(hermesInitPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("supports runtime-specific live connector settings actions", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const claudePath = join(tempDir, ".claude", "settings.json");

    const before = await getJson(baseUrl, "/settings/hooks/claude_code");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: claudePath,
      endpoint: expect.stringContaining("runtime=claude_code"),
      installed: false
    });

    const installed = await postJson(baseUrl, "/settings/hooks/claude_code/install");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      configPath: claudePath,
      installed: true
    });
    expect(await readFile(claudePath, "utf8")).toContain("runtime=claude_code");

    const tested = await postJson(baseUrl, "/settings/hooks/claude_code/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: expect.stringContaining("Claude Code"),
      status: "passed"
    });

    const uninstalled = await postJson(baseUrl, "/settings/hooks/claude_code/uninstall");
    expect(uninstalled.hooks).toMatchObject({
      configExists: true,
      installed: false
    });
  });

  test("supports runtime-specific OMP live connector extension actions", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const ompPath = join(tempDir, ".omp", "agent", "extensions", "masthead-live.js");

    const before = await getJson(baseUrl, "/settings/hooks/omp");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: ompPath,
      endpoint: expect.stringContaining("runtime=omp"),
      installed: false
    });

    const installed = await postJson(baseUrl, "/settings/hooks/omp/install");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      configPath: ompPath,
      installed: true
    });
    expect(await readFile(ompPath, "utf8")).toContain("runtime=omp");
    expect(await readFile(ompPath, "utf8")).toContain("/live/state");

    const tested = await postJson(baseUrl, "/settings/hooks/omp/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: expect.stringContaining("Oh My Pi"),
      status: "passed"
    });

    const uninstalled = await postJson(baseUrl, "/settings/hooks/omp/uninstall");
    expect(uninstalled.hooks).toMatchObject({
      configExists: false,
      installed: false
    });
    await expect(readFile(ompPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("prefers stable current symlink paths for packaged hook commands", () => {
    const homeDir = "/tmp/masthead-home";
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const execPath = join(homeDir, ".local", "share", "masthead-production", "Masthead-linux-x64-0.1.0", "resources", "daemon", nodeName);
    const stableNode = join(homeDir, ".local", "share", "masthead-production", "current", "resources", "daemon", nodeName);
    const stableScript = join(homeDir, ".local", "share", "masthead-production", "current", "resources", "daemon", "scripts", "masthead-hook.js");

    expect(
      resolveLiveConnectorCommandPaths({
        env: {},
        execPath,
        exists: (path) => path === stableNode || path === stableScript,
        homeDir
      })
    ).toEqual({
      nodePath: stableNode,
      scriptPath: stableScript
    });

    const exactPackageScript = join(homeDir, ".local", "share", "masthead-production", "Masthead-linux-x64-0.1.0", "resources", "daemon", "scripts", "masthead-hook.js");
    expect(
      resolveLiveConnectorCommandPaths({
        env: { MASTHEAD_HOOK_SCRIPT: exactPackageScript },
        execPath,
        exists: (path) => path === stableNode || path === stableScript,
        homeDir
      })
    ).toEqual({
      nodePath: stableNode,
      scriptPath: stableScript
    });
  });

  test("uses the packaged hook script override when generating runtime hook commands", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const codexPath = join(tempDir, ".codex", "hooks.json");
    const packagedHookScript = join(tempDir, "resources", "daemon", "scripts", "masthead-hook.js");
    const originalHookScript = process.env.MASTHEAD_HOOK_SCRIPT;

    try {
      process.env.MASTHEAD_HOOK_SCRIPT = packagedHookScript;

      const before = await getJson(baseUrl, "/settings/hooks/codex");
      expect(before.hooks.command).toContain(packagedHookScript);
      expect(before.hooks.command).toContain("runtime=codex");

      const installed = await postJson(baseUrl, "/settings/hooks/codex/install");
      expect(installed.hooks.command).toContain(packagedHookScript);
      expect(await readFile(codexPath, "utf8")).toContain(packagedHookScript);
    } finally {
      if (originalHookScript === undefined) delete process.env.MASTHEAD_HOOK_SCRIPT;
      else process.env.MASTHEAD_HOOK_SCRIPT = originalHookScript;
    }
  });

  test("keeps aggregate live hook status separate from runtime-specific hook status", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const codexPath = join(tempDir, ".codex", "hooks.json");

    await postJson(baseUrl, "/settings/hooks/codex/install");

    const codex = await getJson(baseUrl, "/settings/hooks/codex");
    expect(codex.hooks).toMatchObject({
      configExists: true,
      configPath: codexPath,
      endpoint: expect.stringContaining("runtime=codex"),
      installed: true,
      mismatchedEvents: [],
      missingEvents: []
    });

    const aggregate = await getJson(baseUrl, "/settings/hooks");
    expect(aggregate.hooks).toMatchObject({
      configExists: true,
      configPath: codexPath,
      installed: false
    });
    expect(aggregate.hooks.missingEvents).toEqual(expect.arrayContaining(["claude_code:SessionStart", "omp:event"]));

    const statuses = new Map(
      aggregate.hooks.integrations.map((integration: { runtime: string; status: string }) => [integration.runtime, integration.status])
    );
    expect(statuses.get("codex")).toBe("installed");
    expect(statuses.get("claude_code")).toBe("not_installed");
    expect(statuses.get("omp")).toBe("not_installed");
  });
});

async function createTestHarness(
  overrides: Partial<DaemonConfig> = {}
): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-settings-api-"));
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
    storePath,
    ...overrides
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
}


function seedLargeToolHistory(db: MastheadDaemon["database"], sessionId: string, count: number): void {
  const output = Array.from({ length: 2600 }, (_, index) => `large historical output line ${index}`).join("\n");
  const insertTool = db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)");
  const insertResult = db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 0; index < count; index += 1) {
    const padded = String(index).padStart(4, "0");
    const toolCallId = `${sessionId}:tool-${padded}`;
    const observedAt = `2026-07-03T13:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
    insertTool.run(toolCallId, sessionId, "shell", observedAt, "{}");
    insertResult.run(`${sessionId}:tool-result-${padded}`, toolCallId, sessionId, "succeeded", output, `hash-${padded}`, 0, observedAt, "{}");
  }
}


function seedWeakSessionWithoutEffects(db: MastheadDaemon["database"]): void {
  const now = "2026-06-25T12:05:00.000Z";
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session:weak", "host:test", "runtime:opencode", "source-session:weak", "Masthead", "Codex hook event", "ended", now, "authoritative", now, now);
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "session:weak:message",
    "session:weak",
    "user",
    "Work on the headline refreshes and data enrichment.",
    "session:weak:message-hash",
    now,
    "{}",
    "authoritative"
  );
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      provider, model, generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "enrichment:weak",
    "session:weak",
    "session_capsule",
    "current",
    "weak:fingerprint",
    "session-capsule-v1",
    "deterministic",
    "local-rules",
    now,
    JSON.stringify({
      candidateDecisions: [],
      liveSummary: "Recent activity is active.",
      searchPhrases: [],
      technologies: [],
      title: "Codex hook event",
      topics: [],
      unresolved: []
    }),
    "[]"
  );
}

function seedUnsupportedLegacyRuntime(db: MastheadDaemon["database"]): void {
  const now = "2026-06-25T12:06:00.000Z";
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "runtime:legacy-codex",
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session:legacy-codex",
    "host:test",
    "runtime:legacy-codex",
    "source-session:legacy-codex",
    "Masthead",
    "Legacy Codex database row",
    "ended",
    now,
    "authoritative",
    now,
    now
  );
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function listenHttp(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  expect(predicate()).toBe(true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

async function postJson(baseUrl: string, path: string, body?: unknown, expectedStatus = 202): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(expectedStatus);
  return response.json() as Promise<Record<string, any>>;
}

function durableProviderOutput(input: { summary: string; title: string }): Record<string, unknown> {
  return {
    confidence: "high",
    dossier: {
      blockers: [],
      continuation: {
        constraints: [],
        nextStep: "Use the durable Dossier enrichment after the background job finishes.",
        openQuestions: []
      },
      decisions: [],
      evidenceRefIds: [],
      keyWork: ["Generated durable Dossier enrichment from transcript evidence."],
      outcome: "Dossier enrichment completed with durable title and summary content.",
      purpose: "Generate durable Dossier enrichment for an opened session.",
      verification: {
        commands: ["vitest"],
        evidenceRefIds: [],
        failures: [],
        status: "passed",
        summary: "The focused settings API test covered the route behavior."
      },
      warnings: []
    },
    missingEvidence: [],
    outcome: "Dossier enrichment completed with durable title and summary content.",
    searchSummary: input.summary,
    summary: input.summary,
    title: input.title,
    version: "session-capsule-v4"
  };
}
