import type { LogbookSearchFilters, LogbookSearchResult, LogbookSort } from "./daemonClient";

export type LogbookPageCacheRequest = {
  baseUrl: string;
  filters: LogbookSearchFilters;
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
    filters: sortSearchFilters(logbookPageSearchFilters(request)),
    retryKey: request.retryKey ?? 0
  });
}

export function readCachedLogbookPage(cache: Map<string, LogbookSearchResult>, request: LogbookPageCacheRequest): LogbookSearchResult | undefined {
  return cache.get(logbookPageCacheKey(request));
}

export function writeCachedLogbookPage(cache: Map<string, LogbookSearchResult>, request: LogbookPageCacheRequest, result: LogbookSearchResult): void {
  cache.set(logbookPageCacheKey(request), result);
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
