import { describe, expect, test } from "vitest";
import { logbookPageCacheKey, logbookPageSearchFilters } from "../logbookPageCache";

describe("logbook page cache", () => {
  test("builds daemon search filters from the selected page", () => {
    expect(
      logbookPageSearchFilters({
        baseUrl: "http://127.0.0.1:17373/projection",
        filters: { project: "", runtime: "codex" },
        pageIndex: 2,
        pageSize: 50,
        query: "toolbar",
        sort: "recent"
      })
    ).toEqual({
      limit: 50,
      offset: 100,
      q: "toolbar",
      runtime: "codex",
      sort: "recent"
    });
  });

  test("uses a stable key for equivalent filter objects", () => {
    const first = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: { project: "Masthead", runtime: "codex" },
      pageIndex: 1,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const second = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: { runtime: "codex", project: "Masthead" },
      pageIndex: 1,
      pageSize: 50,
      query: "",
      sort: "recent"
    });

    expect(first).toBe(second);
  });

  test("separates pages and explicit retries", () => {
    const pageOne = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      pageIndex: 0,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const pageTwo = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      pageIndex: 1,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const retriedPageOne = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      pageIndex: 0,
      pageSize: 50,
      query: "",
      retryKey: 1,
      sort: "recent"
    });

    expect(pageOne).not.toBe(pageTwo);
    expect(pageOne).not.toBe(retriedPageOne);
  });
});
