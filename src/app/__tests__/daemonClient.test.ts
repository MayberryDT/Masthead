import { afterEach, describe, expect, test, vi } from "vitest";
import { listReviewDispositions, saveReviewDisposition } from "../daemonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon client review dispositions", () => {
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
