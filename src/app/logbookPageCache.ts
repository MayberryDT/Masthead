import type { LogbookSearchFilters, LogbookSearchResult, LogbookSort } from "./daemonClient";

export const MAX_LOGBOOK_PAGE_CACHE_ENTRIES = 50;

export type LogbookPageCacheRequest = {
  baseUrl: string;
  /** Canonical database identity; cache must not reuse pages after a DB replace at the same URL. */
  databaseId?: string;
  filters: LogbookSearchFilters;
  logbookRevision: number;
  pageIndex: number;
  pageSize: number;
  query: string;
  retryKey?: number;
  sort: LogbookSort;
};

export function logbookPageSearchFilters(request: LogbookPageCacheRequest): LogbookSearchFilters {
  return compactSearchFilters({
    ...request.filters,
    limit: request.pageSize,
    offset: request.pageIndex * request.pageSize,
    q: request.query,
    sort: request.sort
  });
}

export function logbookPageCacheKey(request: LogbookPageCacheRequest): string {
  return JSON.stringify({
    baseUrl: request.baseUrl,
    databaseId: request.databaseId ?? "",
    filters: sortSearchFilters(logbookPageSearchFilters(request)),
    logbookRevision: request.logbookRevision,
    retryKey: request.retryKey ?? 0
  });
}

export function readCachedLogbookPage(cache: Map<string, LogbookSearchResult>, request: LogbookPageCacheRequest): LogbookSearchResult | undefined {
  return cache.get(logbookPageCacheKey(request));
}

export function writeCachedLogbookPage(cache: Map<string, LogbookSearchResult>, request: LogbookPageCacheRequest, result: LogbookSearchResult): void {
  const cachedRequests = [...cache.keys()].map((key) => ({ key, request: parseLogbookPageCacheKey(key) }));
  const requestDatabaseId = request.databaseId ?? "";
  const newestRevision = cachedRequests.reduce((revision, entry) => (
    entry.request?.baseUrl === request.baseUrl && entry.request.databaseId === requestDatabaseId
      ? Math.max(revision, entry.request.logbookRevision)
      : revision
  ), -1);
  if (newestRevision > request.logbookRevision) return;
  for (const entry of cachedRequests) {
    if (
      entry.request?.baseUrl === request.baseUrl &&
      (
        entry.request.databaseId !== requestDatabaseId ||
        entry.request.logbookRevision !== request.logbookRevision
      )
    ) cache.delete(entry.key);
  }
  cache.set(logbookPageCacheKey(request), result);
  while (cache.size > MAX_LOGBOOK_PAGE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function parseLogbookPageCacheKey(key: string): { baseUrl: string; databaseId: string; logbookRevision: number } | undefined {
  try {
    const parsed = JSON.parse(key) as { baseUrl?: unknown; databaseId?: unknown; logbookRevision?: unknown };
    if (typeof parsed.baseUrl !== "string" || typeof parsed.logbookRevision !== "number") return undefined;
    return {
      baseUrl: parsed.baseUrl,
      databaseId: typeof parsed.databaseId === "string" ? parsed.databaseId : "",
      logbookRevision: parsed.logbookRevision
    };
  } catch {
    return undefined;
  }
}

function compactSearchFilters(filters: LogbookSearchFilters): LogbookSearchFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== "";
    })
  ) as LogbookSearchFilters;
}

function sortSearchFilters(filters: LogbookSearchFilters): LogbookSearchFilters {
  return Object.fromEntries(Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))) as LogbookSearchFilters;
}
