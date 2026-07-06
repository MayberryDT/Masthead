import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getLiveHookSettings,
  getRuntimeHookSettings,
  getSessionTranscript,
  getSourcesAdvanced,
  getSourcesSetup,
  getImportReport,
  installRuntimeHooks,
  listImports,
  listImportWorkUnits,
  listReviewDispositions,
  previewSourcesImport,
  rebuildEnrichments,
  repairSources,
  runSourcesSetup,
  saveReviewDisposition,
  searchLogbook,
  scanSourcesSetup,
  testRuntimeHooks,
  syncSources
} from "../daemonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon client review dispositions", () => {
  test("unions multi-value Logbook filters when the daemon only honors the first repeated param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = new URL(String(url));
        const project = requestUrl.searchParams.get("project");
        return response({
          nextCursor: undefined,
          sessions: project
            ? [
                {
                  errorCount: 0,
                  fileCount: 0,
                  hostId: "host:test",
                  lastActivityAt: project === "Project one" ? "2026-07-03T10:00:00.000Z" : "2026-07-03T11:00:00.000Z",
                  lifecycle: "ended",
                  models: [],
                  project,
                  runtime: "opencode",
                  sessionId: project === "Project one" ? "session-one" : "session-two",
                  sourceConfidence: "authoritative",
                  sourceSessionId: `${project}:source`,
                  title: `${project} session`,
                  toolCount: 0,
                  topics: [],
                  unresolved: []
                }
              ]
            : [],
          total: project ? 1 : 0
        });
      })
    );

    await expect(
      searchLogbook({ limit: 50, offset: 0, project: ["Project one", "Project two"], sort: "recent" }, "http://127.0.0.1:17373/projection")
    ).resolves.toMatchObject({
      sessions: [
        { project: "Project two", sessionId: "session-two" },
        { project: "Project one", sessionId: "session-one" }
      ],
      total: 2
    });
  });

  test("loads sources setup state from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          setup: {
            connectedSources: [],
            setupId: "setup:1",
            status: "empty",
            updatedAt: "2026-06-27T10:00:00.000Z"
          }
        })
      )
    );

    await expect(getSourcesSetup("http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      setupId: "setup:1",
      status: "empty"
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/setup", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts sources setup actions to the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          queued: 0,
          scan: {
            adapters: [],
            foundSources: [],
            generatedAt: "2026-06-27T10:00:00.000Z",
            scanId: "scan:1",
            status: "completed",
            summary: {
              detectedHarnesses: 0,
              foundSources: 0,
              scannedHarnesses: 0
            }
          },
          setup: {
            connectedSources: [],
            setupId: "setup:1",
            status: "empty",
            updatedAt: "2026-06-27T10:00:00.000Z"
          }
        })
      )
    );

    await scanSourcesSetup("http://127.0.0.1:17373/projection");
    await runSourcesSetup({ importMetadata: true, runtimes: ["opencode"] }, "http://127.0.0.1:17373/projection");
    await syncSources("http://127.0.0.1:17373/projection");
    await repairSources("http://127.0.0.1:17373/projection");

    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/sources/setup/scan", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/sources/setup/run", {
      body: JSON.stringify({ importMetadata: true, runtimes: ["opencode"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(3, "http://127.0.0.1:17373/sources/sync", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(4, "http://127.0.0.1:17373/sources/repair", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("loads sources advanced diagnostics from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          advanced: {
            adapters: [],
            imports: [],
            sources: []
          },
          ok: true
        })
      )
    );

    await expect(getSourcesAdvanced("http://127.0.0.1:17373/projection")).resolves.toEqual({
      adapters: [],
      imports: [],
      sources: []
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/advanced", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("loads paged import jobs from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          imports: [{ importJobId: "job-1", sourceId: "opencode-sessions" }],
          limit: 25,
          offset: 50,
          total: 100
        })
      )
    );

    await expect(
      listImports("http://127.0.0.1:17373/projection", {
        adapterId: "opencode",
        limit: 25,
        offset: 50,
        sourceId: "opencode-sessions",
        status: "active"
      })
    ).resolves.toMatchObject({
      imports: [{ importJobId: "job-1", sourceId: "opencode-sessions" }],
      limit: 25,
      offset: 50,
      total: 100
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/imports?limit=25&offset=50&adapterId=opencode&sourceId=opencode-sessions&status=active",
      { headers: { accept: "application/json" }, signal: undefined }
    );
  });

  test("previews a harness-first sources import", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          previews: [
            {
              runtime: "opencode",
              summary: {
                excludedUnits: 1,
                generatedAt: "2026-07-01T00:00:00.000Z",
                importJobId: "preview:opencode",
                importKind: "transcript",
                includedUnits: 2,
                manifestId: "",
                runtime: "opencode",
                scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
                totalBytes: 120,
                totalUnits: 3
              }
            }
          ]
        })
      )
    );

    await expect(
      previewSourcesImport("http://127.0.0.1:17373/projection", {
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        importTranscripts: true,
        runtimes: ["opencode"]
      })
    ).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/import/preview", {
      body: JSON.stringify({
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        importTranscripts: true,
        runtimes: ["opencode"]
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });

  test("loads import work units and completion reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ ok: true, limit: 50, offset: 0, units: [{ status: "succeeded", workUnitId: "unit-1" }] }))
        .mockResolvedValueOnce(response({ ok: true, report: { importJobId: "job-1", sessionsCreated: 1 } }))
    );

    await expect(
      listImportWorkUnits("http://127.0.0.1:17373/projection", "job-1", { limit: 50, status: "succeeded" })
    ).resolves.toEqual({
      limit: 50,
      offset: 0,
      units: [{ status: "succeeded", workUnitId: "unit-1" }]
    });
    await expect(getImportReport("http://127.0.0.1:17373/projection", "job-1")).resolves.toMatchObject({
      importJobId: "job-1",
      sessionsCreated: 1
    });
    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/imports/job-1/units?limit=50&status=succeeded", {
      headers: { accept: "application/json" }
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/imports/job-1/report", {
      headers: { accept: "application/json" }
    });
  });

  test("loads paginated session transcripts from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          coverage: {
            assistantMessages: 1,
            checkpoints: 0,
            fileEffects: 0,
            hasUsableTranscript: true,
            lowValueItems: 0,
            messages: 2,
            runtimeSignals: 0,
            toolCalls: 0,
            toolResults: 0,
            userMessages: 1
          },
          items: [{ itemId: "message:1", kind: "message", label: "user", role: "user", text: "hello" }],
          nextCursor: "100",
          total: 101
        })
      )
    );

    await expect(
      getSessionTranscript(
        "session 1",
        { cursor: "50", kind: "assistant", limit: 25, q: "sqlite" },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toMatchObject({
      nextCursor: "100",
      total: 101
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/sessions/session%201/transcript?cursor=50&limit=25&kind=assistant&q=sqlite",
      { headers: { accept: "application/json" }, signal: undefined }
    );
  });

  test("throws when session transcript loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failedResponse(503)));

    await expect(getSessionTranscript("session-1", {}, "http://127.0.0.1:17373/projection")).rejects.toThrow(
      "session transcript failed: 503"
    );
  });

  test("loads review dispositions from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: true, dispositions: [{ dispositionId: "review:1", subjectId: "session-1" }] }))
    );

    await expect(listReviewDispositions("http://127.0.0.1:17373/projection")).resolves.toEqual([
      { dispositionId: "review:1", subjectId: "session-1" }
    ]);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/review-dispositions", {
      headers: { accept: "application/json" }
    });
  });

  test("saves review dispositions to the daemon", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true })));

    await saveReviewDisposition(
      {
        dispositionId: "review:session:session-1:reviewed",
        recordedAt: "2026-06-25T12:00:00.000Z",
        status: "reviewed",
        subjectId: "session-1",
        subjectType: "session"
      },
      "http://127.0.0.1:17373/projection"
    );

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/review-dispositions", {
      body: JSON.stringify({
        dispositionId: "review:session:session-1:reviewed",
        recordedAt: "2026-06-25T12:00:00.000Z",
        status: "reviewed",
        subjectId: "session-1",
        subjectType: "session"
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });
});

describe("daemon client enrichment rebuilds", () => {
  test("posts rebuild depth and strips the transport ok field from the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          failed: 0,
          ok: true,
          requested: 2,
          sessions: [
            { sessionId: "session-1", status: "succeeded" },
            { sessionId: "session-2", status: "succeeded" }
          ],
          succeeded: 2
        })
      )
    );

    await expect(
      rebuildEnrichments(
        { depth: "summary", limit: 2, scope: "sessionIds", sessionIds: ["session-1", "session-2"] },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toEqual({
      failed: 0,
      requested: 2,
      sessions: [
        { sessionId: "session-1", status: "succeeded" },
        { sessionId: "session-2", status: "succeeded" }
      ],
      succeeded: 2
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/enrichment/rebuild", {
      body: JSON.stringify({ depth: "summary", limit: 2, scope: "sessionIds", sessionIds: ["session-1", "session-2"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });
});

describe("daemon client runtime hook helpers", () => {
  test("loads hook settings from the runtime-scoped settings endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "claude_code" }) })));

    await expect(getRuntimeHookSettings("claude_code", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "claude_code" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/claude_code", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts hook actions to the selected supported runtime route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "claude_code" }) })));

    await expect(testRuntimeHooks("claude_code", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "claude_code" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/claude_code/test", {
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("keeps OpenCode on the same runtime-scoped hook action path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "opencode" }) })));

    await expect(installRuntimeHooks("opencode", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "opencode" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/opencode/install", {
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("loads aggregate hook settings without choosing a runtime-specific action route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          hooks: {
            ...hookSettings({ runtime: "opencode" }),
            integrations: [
              hookSettings({ runtime: "claude_code" }).integrations[0],
              hookSettings({ runtime: "opencode" }).integrations[0],
              hookSettings({ runtime: "omp" }).integrations[0]
            ]
          }
        })
      )
    );

    await expect(getLiveHookSettings("http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [
        expect.objectContaining({ runtime: "claude_code" }),
        expect.objectContaining({ runtime: "opencode" }),
        expect.objectContaining({ runtime: "omp" })
      ]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });
});

function response(body: unknown): Response {
  return {
    json: async () => body,
    ok: true,
    status: 200
  } as Response;
}

function hookSettings({ runtime }: { runtime: string }) {
  return {
    command: "masthead hook",
    configExists: true,
    configPath: `/home/tyler/.${runtime}/hooks.json`,
    endpoint: `http://127.0.0.1:17373/ingest?runtime=${runtime}`,
    installed: true,
    integrations: [
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: `${runtime} live hooks`,
        label: runtime,
        runtime,
        status: "installed",
        supportsActions: true
      }
    ],
    missingEvents: [],
    mismatchedEvents: []
  };
}

function failedResponse(status: number): Response {
  return {
    json: async () => ({ ok: false }),
    ok: false,
    status
  } as Response;
}
