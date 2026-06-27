import { afterEach, describe, expect, test, vi } from "vitest";
import { getSessionTranscript, listImports, listReviewDispositions, saveReviewDisposition } from "../daemonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon client review dispositions", () => {
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
