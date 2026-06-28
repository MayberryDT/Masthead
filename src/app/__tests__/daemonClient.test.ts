import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getSessionTranscript,
  getSourcesAdvanced,
  getSourcesSetup,
  listImports,
  listReviewDispositions,
  repairSources,
  runSourcesSetup,
  saveReviewDisposition,
  scanSourcesSetup,
  syncSources
} from "../daemonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon client review dispositions", () => {
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
    await runSourcesSetup({ importMetadata: true, runtimes: ["codex"] }, "http://127.0.0.1:17373/projection");
    await syncSources("http://127.0.0.1:17373/projection");
    await repairSources("http://127.0.0.1:17373/projection");

    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/sources/setup/scan", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/sources/setup/run", {
      body: JSON.stringify({ importMetadata: true, runtimes: ["codex"] }),
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
          imports: [{ importJobId: "job-1", sourceId: "codex-sessions" }],
          limit: 25,
          offset: 50,
          total: 100
        })
      )
    );

    await expect(
      listImports("http://127.0.0.1:17373/projection", {
        adapterId: "codex",
        limit: 25,
        offset: 50,
        sourceId: "codex-sessions",
        status: "active"
      })
    ).resolves.toMatchObject({
      imports: [{ importJobId: "job-1", sourceId: "codex-sessions" }],
      limit: 25,
      offset: 50,
      total: 100
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/imports?limit=25&offset=50&adapterId=codex&sourceId=codex-sessions&status=active",
      { headers: { accept: "application/json" }, signal: undefined }
    );
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

function response(body: unknown): Response {
  return {
    json: async () => body,
    ok: true,
    status: 200
  } as Response;
}

function failedResponse(status: number): Response {
  return {
    json: async () => ({ ok: false }),
    ok: false,
    status
  } as Response;
}
