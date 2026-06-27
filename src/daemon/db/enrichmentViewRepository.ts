import type { SessionCapsule, SessionEnrichmentStatus } from "../../enrichment/types.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SessionEnrichmentView = {
  sessionId: string;
  status: SessionEnrichmentStatus;
  title?: string;
  titleSource?: string;
  objective?: string;
  outcome?: string;
  liveSummary?: string;
  searchSummary?: string;
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  topics: string[];
  unresolved: string[];
  searchText?: string;
};

export type LiveProjectionEnrichment = {
  sourceSessionId: string;
  title?: string;
  liveSummary?: string;
};

type EnrichmentRow = {
  sessionId: string;
  sourceSessionId?: string;
  enrichmentKind: "live_summary" | "session_capsule" | "search_projection";
  status: SessionEnrichmentStatus;
  contentJson: string | null;
};

export function currentSessionEnrichmentView(db: MastheadDatabase, sessionId: string): SessionEnrichmentView | undefined {
  const rows = db
    .prepare(
      `SELECT
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        content_json AS contentJson
      FROM session_enrichments
      WHERE session_id = ?
        AND status = 'current'
        AND enrichment_kind IN ('session_capsule', 'live_summary', 'search_projection')`
    )
    .all(sessionId) as EnrichmentRow[];
  return rows.length > 0 ? rowsToView(sessionId, rows) : undefined;
}

export function currentSessionEnrichmentViews(db: MastheadDatabase, sessionIds: string[]): Map<string, SessionEnrichmentView> {
  if (sessionIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        content_json AS contentJson
      FROM session_enrichments
      WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND status = 'current'
        AND enrichment_kind IN ('session_capsule', 'live_summary', 'search_projection')`
    )
    .all(...sessionIds) as EnrichmentRow[];
  const bySession = new Map<string, EnrichmentRow[]>();
  for (const row of rows) {
    const current = bySession.get(row.sessionId) ?? [];
    current.push(row);
    bySession.set(row.sessionId, current);
  }
  return new Map(Array.from(bySession.entries()).map(([sessionId, sessionRows]) => [sessionId, rowsToView(sessionId, sessionRows)]));
}

export function liveProjectionEnrichments(db: MastheadDatabase): Map<string, LiveProjectionEnrichment> {
  const rows = db
    .prepare(
      `SELECT
        sessions.source_session_id AS sourceSessionId,
        session_enrichments.session_id AS sessionId,
        session_enrichments.enrichment_kind AS enrichmentKind,
        session_enrichments.status AS status,
        session_enrichments.content_json AS contentJson
      FROM session_enrichments
      JOIN sessions ON sessions.session_id = session_enrichments.session_id
      WHERE session_enrichments.status = 'current'
        AND session_enrichments.enrichment_kind IN ('session_capsule', 'live_summary')`
    )
    .all() as EnrichmentRow[];

  const bySession = new Map<string, EnrichmentRow[]>();
  for (const row of rows) {
    if (!row.sourceSessionId) continue;
    const current = bySession.get(row.sourceSessionId) ?? [];
    current.push(row);
    bySession.set(row.sourceSessionId, current);
  }
  return new Map(
    Array.from(bySession.entries()).map(([sourceSessionId, sessionRows]) => {
      const view = rowsToView(sessionRows[0]?.sessionId ?? sourceSessionId, sessionRows);
      return [sourceSessionId, { liveSummary: view.liveSummary, sourceSessionId, title: view.title }];
    })
  );
}

function rowsToView(sessionId: string, rows: EnrichmentRow[]): SessionEnrichmentView {
  const capsule = contentForKind<SessionCapsule>(rows, "session_capsule");
  const liveSummary = contentForKind<{ text?: string }>(rows, "live_summary");
  const searchProjection = contentForKind<{ searchText?: string }>(rows, "search_projection");
  return {
    liveSummary: liveSummary?.text ?? capsule?.liveSummary,
    commandsSummary: capsule?.commandsSummary,
    filesChangedSummary: capsule?.filesChangedSummary,
    objective: capsule?.objective,
    outcome: capsule?.outcome,
    searchSummary: capsule?.searchSummary,
    searchText: searchProjection?.searchText,
    sessionId,
    status: "current",
    title: capsule?.title,
    titleSource: capsule?.titleSource,
    topics: capsule?.topics ?? [],
    verificationSummary: capsule?.verificationSummary,
    unresolved: capsule?.unresolved?.map((claim) => claim.text).filter(Boolean) ?? []
  };
}

function contentForKind<T>(rows: EnrichmentRow[], kind: EnrichmentRow["enrichmentKind"]): T | undefined {
  const row = rows.find((candidate) => candidate.enrichmentKind === kind);
  if (!row?.contentJson) return undefined;
  try {
    return JSON.parse(row.contentJson) as T;
  } catch {
    return undefined;
  }
}
