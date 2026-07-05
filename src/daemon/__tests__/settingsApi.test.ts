import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, test } from "vitest";
import { codexHookSource } from "../../adapters/codex/hookAdapter.ts";
import type { DaemonConfig } from "../config.ts";
import { upsertSessionEnrichment } from "../db/enrichmentRepository.ts";
import { getSessionDossier } from "../db/sessionDossierRepository.ts";
import { canonicalSessionId, runtimeIdFor } from "../db/sessionRepository.ts";
import { recentHookEventsWithTranscriptPathsForSessions } from "../hookTranscriptRecovery.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";

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
    seedWeakSessionWithoutEffects(daemon.database);
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
    expect(settings.hooks.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionSurface: "settings",
          captureMode: "live_hook",
          label: "Codex",
          runtime: "codex",
          supportsActions: true
        }),
        expect.objectContaining({
          actionSurface: "settings",
          captureMode: "live_hook",
          label: "Claude Code",
          runtime: "claude_code",
          supportsActions: true
        }),
        expect.objectContaining({
          actionSurface: "settings",
          captureMode: "live_hook",
          label: "OpenCode",
          runtime: "opencode",
          supportsActions: true
        })
      ])
    );
    expect(state.settings.deletionTargets.projects).toEqual([{ label: "Masthead", value: "Masthead" }]);
    expect(state.settings.deletionTargets.runtimes).toEqual([{ label: "codex", value: "codex" }]);
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
    seedLargeToolHistory(daemon.database, sessionId, 180);
    const baseUrl = await listen(daemon);

    const startedAt = performance.now();
    const accepted = await postJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier/enrich`, {});
    const elapsedMs = performance.now() - startedAt;

    expect(accepted).toMatchObject({ ok: true, enrichment: { status: "enriching" } });
    expect(elapsedMs).toBeLessThan(150);
  });

  test("manual Dossier enrichment catches up hook transcript before provider request", async () => {
    let providerCalls = 0;
    const providerInputs: Array<{ facts?: { userEvidence?: string[]; assistantEvidence?: string[] } }> = [];
    const providerServer = createServer(async (request, response) => {
      const body = JSON.parse(await readRequestBody(request)) as { messages?: Array<{ content?: string }> };
      providerInputs.push(JSON.parse(body.messages?.[1]?.content ?? "{}"));
      providerCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  durableProviderOutput({
                    summary: "Dossier enrichment ran after transcript catch-up imported the current transcript evidence.",
                    title: "Dossier transcript catch-up"
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
    const { daemon, tempDir } = await createTestHarness({ hookTranscriptCatchupEnabled: true });
    const sourceSessionId = "source-session:dossier-catchup";
    const sessionId = canonicalSessionId("host:127.0.0.1", runtimeIdFor("codex", undefined), sourceSessionId);
    seedCanonicalDossierSession(daemon.database, { sessionId, sourceSessionId, title: "Cached dossier" });
    daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run(sessionId);
    const transcriptPath = join(tempDir, ".codex", "sessions", "2026", "07", "03", "dossier-catchup.jsonl");
    await mkdir(dirname(transcriptPath), { recursive: true });
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        content: "Transcript prompt imported after Dossier response.",
        role: "user",
        session_id: sourceSessionId,
        timestamp: "2026-07-03T12:05:00.000Z"
      })}\n`,
      "utf8"
    );
    seedHookTranscriptRecord(daemon.database, {
      observedAt: "2026-07-03T12:06:00.000Z",
      sourceSessionId,
      transcriptPath
    });
    expect(
      recentHookEventsWithTranscriptPathsForSessions(
        daemon.database,
        codexHookSource.sourceId,
        new Set([sourceSessionId]),
        1
      )
    ).toHaveLength(1);
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/sources/codex/approve-transcripts", {});
    await postJson(baseUrl, "/settings/llm-provider", {
      activeProvider: "ollama",
      apiKey: "test-compatible-key",
      baseUrl: `${providerBaseUrl}/v1`,
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    const request = postJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier/enrich`, {});
    const race = await Promise.race([request.then(() => "returned"), delay(50).then(() => "blocked")]);
    await request;
    const first = await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier`);

    expect(race).toBe("returned");
    expect(first.dossier.narrative.latestUserPrompt).toBe("Fix the OAuth authentication callback.");
    await waitFor(() => providerCalls === 1);
    expect(providerInputs[0]?.facts?.userEvidence ?? []).toContain("Historical untrusted transcript evidence: Transcript prompt imported after Dossier response.");
    await waitFor(() =>
      transcriptMessageTexts(daemon.database, sessionId).includes("Transcript prompt imported after Dossier response."),
      3_000
    );
  });

  test("session dossier GET skips hook transcript catch-up when transcript is already current", async () => {
    const { daemon, tempDir } = await createTestHarness({ hookTranscriptCatchupEnabled: true });
    const sourceSessionId = "source-session:dossier-catchup-current";
    const sessionId = canonicalSessionId("host:127.0.0.1", runtimeIdFor("codex", undefined), sourceSessionId);
    seedCanonicalDossierSession(daemon.database, { sessionId, sourceSessionId, title: "Caught-up dossier" });
    dbInsertMessage(
      daemon.database,
      sessionId,
      "caught-up-assistant",
      "assistant",
      "Assistant transcript already imported after the hook event.",
      "2026-07-03T12:10:00.000Z"
    );
    const transcriptPath = join(tempDir, ".codex", "sessions", "2026", "07", "03", "already-current.jsonl");
    await mkdir(dirname(transcriptPath), { recursive: true });
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        content: "This stale transcript row should not be imported again.",
        role: "user",
        session_id: sourceSessionId,
        timestamp: "2026-07-03T12:04:00.000Z"
      })}\n`,
      "utf8"
    );
    seedHookTranscriptRecord(daemon.database, {
      observedAt: "2026-07-03T12:05:00.000Z",
      sourceSessionId,
      transcriptPath
    });
    const baseUrl = await listen(daemon);
    await postJson(baseUrl, "/sources/codex/approve-transcripts", {});

    await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier`);
    await delay(250);

    expect(transcriptMessageTexts(daemon.database, sessionId)).not.toContain("This stale transcript row should not be imported again.");
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

  test("projects a recent Codex desktop transcript as a live session", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const cwd = join(tempDir, "worktrees", "masthead-live");
    const transcriptPath = join(tempDir, ".codex", "sessions", "2026", "07", "05", "rollout.jsonl");
    const observedAt = new Date();
    await mkdir(dirname(transcriptPath), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        payload: {
          cwd,
          id: "codex-desktop-active",
          model: "gpt-5-codex"
        },
        timestamp: observedAt.toISOString(),
        type: "session_meta"
      })}\n${JSON.stringify({
        payload: {
          info: {
            last_token_usage: {
              input_tokens: 42,
              output_tokens: 8,
              total_tokens: 50
            }
          },
          type: "token_count"
        },
        timestamp: observedAt.toISOString(),
        type: "event_msg"
      })}\n`,
      "utf8"
    );
    await utimes(transcriptPath, observedAt, observedAt);

    const projection = await getJson(baseUrl, "/projection");

    expect(projection.projection.cards).toHaveLength(1);
    expect(projection.projection.cards[0]).toMatchObject({
      branchOrWorktree: "masthead-live",
      harness: "Codex",
      model: "gpt-5-codex",
      runtime: "codex",
      sourceSessionId: "codex-desktop-active",
      totalTokens: 50
    });

    const laterObservedAt = new Date(observedAt.getTime() + 2_500);
    await appendFile(
      transcriptPath,
      `${JSON.stringify({
        payload: {
          cwd,
          model: "gpt-5-codex"
        },
        timestamp: laterObservedAt.toISOString(),
        type: "turn_context"
      })}\n`,
      "utf8"
    );
    await utimes(transcriptPath, laterObservedAt, laterObservedAt);
    await delay(2_100);

    const updatedProjection = await getJson(baseUrl, "/projection");
    expect(updatedProjection.projection.cards).toHaveLength(1);
    expect(updatedProjection.projection.cards[0]).toMatchObject({
      sourceSessionId: "codex-desktop-active",
      totalTokens: 50
    });
  });

  test("installs, tests, and uninstalls the live connector hook files", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const hooksPath = join(tempDir, ".codex", "hooks.json");
    const claudePath = join(tempDir, ".claude", "settings.json");
    const cursorPath = join(tempDir, ".cursor", "hooks.json");
    const grokPath = join(tempDir, ".grok", "hooks", "masthead.json");
    const ompPath = join(tempDir, ".omp", "agent", "extensions", "masthead-live.js");
    const opencodePath = join(tempDir, ".config", "opencode", "plugins", "masthead-live.js");

    const before = await getJson(baseUrl, "/settings/hooks");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: hooksPath,
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

    const installed = await postJson(baseUrl, "/settings/hooks/codex/install");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      installed: true
    });
    expect(await readFile(hooksPath, "utf8")).toContain("masthead-hook.js");
    expect(await readFile(hooksPath, "utf8")).toContain("/ingest");
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
    expect(await readFile(ompPath, "utf8")).toContain("session_start");
    expect(await readFile(opencodePath, "utf8")).toContain("masthead-live-connector");
    expect(await readFile(opencodePath, "utf8")).toContain("runtime=opencode");
    expect(installed.hooks.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ configPath: claudePath, runtime: "claude_code", status: "installed" }),
        expect.objectContaining({ configPath: cursorPath, runtime: "cursor", status: "installed" }),
        expect.objectContaining({ configPath: grokPath, runtime: "grok", status: "installed" }),
        expect.objectContaining({ configPath: ompPath, runtime: "omp", status: "installed" }),
        expect.objectContaining({ configPath: opencodePath, runtime: "opencode", status: "installed" })
      ])
    );

    const tested = await postJson(baseUrl, "/settings/hooks/codex/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: expect.stringContaining("Masthead accepted synthetic live events"),
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
    const projection = await getJson(baseUrl, "/projection");
    expect(projection.projection.cards).toHaveLength(0);

    const uninstalled = await postJson(baseUrl, "/settings/hooks/codex/uninstall");
    expect(uninstalled.hooks).toMatchObject({
      installed: false
    });
    expect(uninstalled.hooks.latestBackupPath).toContain("masthead-backup");
    const uninstalledCursorConfig = JSON.parse(await readFile(cursorPath, "utf8")) as { hooks: Record<string, Array<{ command: string }>> };
    expect(uninstalledCursorConfig.hooks.beforeSubmitPrompt).toEqual([{ command: "node existing-cursor-hook.js" }]);
    expect(uninstalledCursorConfig.hooks.afterFileEdit).toEqual([]);
    await expect(readFile(ompPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(opencodePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

function seedHookTranscriptRecord(
  db: MastheadDaemon["database"],
  input: { observedAt: string; sourceSessionId: string; transcriptPath: string }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO ingest_sources (
      source_id, adapter, source_kind, endpoint, schema_version, runtime_version, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    codexHookSource.sourceId,
    codexHookSource.runtime,
    codexHookSource.sourceKind,
    codexHookSource.endpoint ?? null,
    codexHookSource.schemaVersion ?? null,
    codexHookSource.runtimeVersion ?? null,
    codexHookSource.confidence,
    input.observedAt,
    input.observedAt
  );
  const record = {
    capturedAt: input.observedAt,
    recordId: "raw:hook:dossier-catchup",
    recordType: "event",
    value: {
      eventId: "hook:dossier-catchup",
      occurredAt: input.observedAt,
      payload: { transcriptPath: input.transcriptPath },
      sessionId: input.sourceSessionId,
      source: { adapter: "codex", surface: "hook" }
    }
  };
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "raw:hook:dossier-catchup",
    codexHookSource.sourceId,
    "hook:dossier-catchup",
    input.observedAt,
    input.observedAt,
    "hook",
    "hash:hook:dossier-catchup",
    JSON.stringify(record)
  );
}

function transcriptMessageTexts(db: MastheadDaemon["database"], sessionId: string): string[] {
  const rows = db
    .prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ? ORDER BY observed_at")
    .all(sessionId) as Array<{ text: string }>;
  return rows.map((row) => row.text);
}

function dbInsertMessage(
  db: MastheadDaemon["database"],
  sessionId: string,
  id: string,
  role: string,
  text: string,
  observedAt: string
): void {
  db.prepare(
    "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(`${sessionId}:${id}`, sessionId, role, text, `${sessionId}:${id}:hash`, observedAt, JSON.stringify({ id }), "authoritative");
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

function seedCanonicalDossierSession(
  db: MastheadDaemon["database"],
  input: { sessionId: string; sourceSessionId: string; title: string }
): void {
  const now = "2026-07-03T12:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:127.0.0.1",
    "127.0.0.1",
    now,
    now
  );
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    runtimeIdFor("codex", undefined),
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    "host:127.0.0.1",
    runtimeIdFor("codex", undefined),
    input.sourceSessionId,
    "Masthead",
    "/workspace/masthead",
    "/workspace/masthead",
    "main",
    input.title,
    "Open the Dossier without blocking on transcript catch-up",
    "ended",
    "completed",
    now,
    now,
    now,
    "authoritative",
    now,
    now
  );
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${input.sessionId}:message`,
    input.sessionId,
    "user",
    "Fix the OAuth authentication callback.",
    `${input.sessionId}:message-hash`,
    now,
    JSON.stringify({ source: "fixture", id: `${input.sessionId}:message` }),
    "authoritative"
  );
  db.prepare("INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${input.sessionId}:usage`,
    input.sessionId,
    "gpt-5",
    "openai",
    now,
    "{}"
  );
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${input.sessionId}:file`,
    input.sessionId,
    "src/daemon/server.ts",
    "modified",
    now,
    "{}"
  );
}

function seedWeakSessionWithoutEffects(db: MastheadDaemon["database"]): void {
  const now = "2026-06-25T12:05:00.000Z";
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session:weak", "host:test", "runtime:codex", "source-session:weak", "Masthead", "Codex hook event", "ended", now, "authoritative", now, now);
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
