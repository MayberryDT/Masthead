import { defaultLiveProjectionUrl } from "./liveProjectionClient";
import type { ReviewDisposition } from "../core/store";

export type SourceStatus = {
  sourceId: string;
  runtime: string;
  sourceKind: string;
  path?: string;
  detectedPath?: string;
  sessionCount?: number;
  importedCount?: number;
  queuedCount?: number;
  failures?: number;
  lastSync?: string;
  confidence: "authoritative" | "inferred" | "heuristic";
};

export type SourceExclusionInput = {
  exclusionKind: "source" | "project" | "path";
  pattern: string;
  reason: string;
};

export type LogbookSearchResult = {
  sessions: Array<{
    sessionId: string;
    title: string;
    snippet?: string;
  }>;
  total: number;
};

export async function listSources(baseUrl = defaultLiveProjectionUrl()): Promise<SourceStatus[]> {
  const url = new URL(baseUrl);
  url.pathname = "/sources";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`sources request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; sources: SourceStatus[] };
  return body.sources;
}

export async function importCodexMetadata(baseUrl = defaultLiveProjectionUrl()): Promise<{ imported: number; sources: number }> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/codex/import-metadata";
  url.search = "";
  const response = await fetch(url.toString(), { method: "POST", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`codex metadata import failed: ${response.status}`);
  return response.json() as Promise<{ imported: number; sources: number }>;
}

export async function addSourceExclusion(input: SourceExclusionInput, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/exclusions";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(input),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`source exclusion failed: ${response.status}`);
}

export async function searchLogbook(query: string, baseUrl = defaultLiveProjectionUrl()): Promise<LogbookSearchResult> {
  const url = new URL(baseUrl);
  url.pathname = "/logbook/search";
  url.search = "";
  url.searchParams.set("q", query);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`logbook search failed: ${response.status}`);
  return response.json() as Promise<LogbookSearchResult>;
}

export async function listReviewDispositions(baseUrl = defaultLiveProjectionUrl()): Promise<ReviewDisposition[]> {
  const url = new URL(baseUrl);
  url.pathname = "/review-dispositions";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`review dispositions request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; dispositions: ReviewDisposition[] };
  return body.dispositions;
}

export async function saveReviewDisposition(disposition: ReviewDisposition, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = "/review-dispositions";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(disposition),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`review disposition save failed: ${response.status}`);
}
