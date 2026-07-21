import { describe, expect, test } from "vitest";
import {
  MAX_LOGBOOK_PAGE_CACHE_ENTRIES,
  logbookPageCacheKey,
  logbookPageSearchFilters,
  readCachedLogbookPage,
  writeCachedLogbookPage
} from "../logbookPageCache";

describe("logbook page cache", () => {
  test("builds daemon search filters from the selected page", () => {
    expect(
      logbookPageSearchFilters({
        baseUrl: "http://127.0.0.1:17373/projection",
        filters: { project: "", kind: "runbook" },
        logbookRevision: 0,
        pageIndex: 2,
        pageSize: 50,
        query: "toolbar",
        sort: "recent"
      })
    ).toEqual({
      kind: "runbook",
      limit: 50,
      offset: 100,
      q: "toolbar",
      sort: "recent"
    });
  });

  test("uses a stable key for equivalent filter objects", () => {
    const first = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: { project: "Masthead", kind: "runbook" },
      logbookRevision: 7,
      pageIndex: 1,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const second = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: { kind: "runbook", project: "Masthead" },
      logbookRevision: 7,
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
      logbookRevision: 0,
      pageIndex: 0,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const pageTwo = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      logbookRevision: 0,
      pageIndex: 1,
      pageSize: 50,
      query: "",
      sort: "recent"
    });
    const retriedPageOne = logbookPageCacheKey({
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      logbookRevision: 0,
      pageIndex: 0,
      pageSize: 50,
      query: "",
      retryKey: 1,
      sort: "recent"
    });

    expect(pageOne).not.toBe(pageTwo);
    expect(pageOne).not.toBe(retriedPageOne);
  });

  test("separates cached pages by daemon Logbook revision", () => {
    const request = {
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      logbookRevision: 4,
      pageIndex: 0,
      pageSize: 50,
      query: "",
      sort: "recent" as const
    };

    expect(logbookPageCacheKey(request)).not.toBe(logbookPageCacheKey({ ...request, logbookRevision: 5 }));
  });

  test("evicts older revisions and ignores a stale response that arrives afterward", () => {
    const cache = new Map();
    const request = {
      baseUrl: "http://127.0.0.1:17373/projection",
      filters: {},
      logbookRevision: 4,
      pageIndex: 0,
      pageSize: 50,
      query: "",
      sort: "recent" as const
    };
    const revisionFour = { sessions: [], total: 4 };
    const revisionFive = { sessions: [], total: 5 };

    writeCachedLogbookPage(cache, request, revisionFour);
    writeCachedLogbookPage(cache, { ...request, logbookRevision: 5 }, revisionFive);
    writeCachedLogbookPage(cache, request, revisionFour);

    expect(cache.size).toBe(1);
    expect(readCachedLogbookPage(cache, request)).toBeUndefined();
    expect(readCachedLogbookPage(cache, { ...request, logbookRevision: 5 })).toBe(revisionFive);
  });

  test("bounds cached pages across daemon URLs", () => {
    const cache = new Map();
    for (let index = 0; index < MAX_LOGBOOK_PAGE_CACHE_ENTRIES + 10; index += 1) {
      writeCachedLogbookPage(cache, {
        baseUrl: `http://127.0.0.1:${17_373 + index}/projection`,
        filters: {},
        logbookRevision: 1,
        pageIndex: 0,
        pageSize: 50,
        query: "",
        sort: "recent"
      }, { sessions: [], total: index });
    }

    expect(cache.size).toBe(MAX_LOGBOOK_PAGE_CACHE_ENTRIES);
  });
});
