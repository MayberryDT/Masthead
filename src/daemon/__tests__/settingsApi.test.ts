import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
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
          actionSurface: "sources",
          captureMode: "transcript_import",
          label: "Claude Code",
          runtime: "claude_code",
          supportsActions: false
        }),
        expect.objectContaining({
          actionSurface: "sources",
          captureMode: "transcript_import",
          label: "OpenCode",
          runtime: "opencode",
          supportsActions: false
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
      activeProvider: "openai_compatible",
      apiKey: "sk-test-settings-secret-3456",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama-3.1",
      remoteEnrichmentEnabled: true
    });

    expect(JSON.stringify(saved)).not.toContain("sk-test-settings-secret-3456");
    expect(saved.settings.llm).toMatchObject({
      activeProvider: "openai_compatible",
      remoteEnrichmentEnabled: true,
      providers: expect.arrayContaining([
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:11434/v1",
          configured: true,
          id: "openai_compatible",
          keyPreview: "••••3456",
          model: "llama-3.1"
        })
      ])
    });
    expect(saved.settings.enrichment).toMatchObject({
      model: "llama-3.1",
      provider: "OpenAI-compatible",
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
      activeProvider: "openai_compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      clearApiKey: true,
      model: "llama-3.1",
      remoteEnrichmentEnabled: false
    });
    expect(cleared.settings.llm.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          configured: false,
          id: "openai_compatible"
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

  test("installs, tests, and uninstalls the real Codex hooks file", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const hooksPath = join(tempDir, ".codex", "hooks.json");

    const before = await getJson(baseUrl, "/settings/hooks/codex");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: hooksPath,
      installed: false
    });

    const installed = await postJson(baseUrl, "/settings/hooks/codex/install");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      installed: true
    });
    expect(await readFile(hooksPath, "utf8")).toContain("masthead-hook.js");

    const tested = await postJson(baseUrl, "/settings/hooks/codex/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: "Hook round-trip passed: Masthead accepted a synthetic Codex lifecycle event.",
      status: "passed"
    });

    const uninstalled = await postJson(baseUrl, "/settings/hooks/codex/uninstall");
    expect(uninstalled.hooks).toMatchObject({
      installed: false
    });
    expect(uninstalled.hooks.latestBackupPath).toContain("masthead-backup");
  });
});

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
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
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
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
