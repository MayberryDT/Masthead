import type { SessionCapsule, SessionEnrichmentStatus } from "../../enrichment/types.ts";
import { SESSION_CAPSULE_PROMPT_VERSION } from "../../enrichment/sessionCompiler.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SessionEnrichmentView = {
  sessionId: string;
  status: SessionEnrichmentStatus;
  title?: string;
  titleSource?: string;
  subject?: string;
  action?: string;
  object?: string;
  objective?: string;
  outcome?: string;
  liveSummary?: string;
  searchSummary?: string;
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  topics: string[];
  technologies: string[];
  unresolved: string[];
  searchText?: string;
  provider?: string;
  model?: string;
};

export type LiveProjectionEnrichment = {
  sourceSessionId: string;
  title?: string;
  liveSummary?: string;
  subject?: string;
  action?: string;
  object?: string;
  outcome?: string;
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  topics?: string[];
  technologies?: string[];
  provider?: string;
  model?: string;
  status?: string;
};

type EnrichmentRow = {
  enrichmentId: string;
  sessionId: string;
  sourceSessionId?: string;
  enrichmentKind: "live_summary" | "session_capsule" | "search_projection";
  status: SessionEnrichmentStatus;
  generatedAt?: string | null;
  promptVersion?: string | null;
  provider?: string | null;
  model?: string | null;
  contentJson: string | null;
};

export function currentSessionEnrichmentView(db: MastheadDatabase, sessionId: string): SessionEnrichmentView | undefined {
  const rows = db
    .prepare(
      `SELECT
        enrichment_id AS enrichmentId,
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        generated_at AS generatedAt,
        prompt_version AS promptVersion,
        provider,
        model,
        content_json AS contentJson
      FROM session_enrichments
      WHERE session_id = ?
        AND status = 'current'
        AND enrichment_kind IN ('session_capsule', 'live_summary', 'search_projection')
      ORDER BY enrichment_kind ASC, COALESCE(generated_at, '') DESC, enrichment_id DESC`
    )
    .all(sessionId) as EnrichmentRow[];
  return rows.length > 0 ? rowsToView(sessionId, rows) : undefined;
}

export function currentSessionEnrichmentViews(db: MastheadDatabase, sessionIds: string[]): Map<string, SessionEnrichmentView> {
  if (sessionIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT
        enrichment_id AS enrichmentId,
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        generated_at AS generatedAt,
        prompt_version AS promptVersion,
        provider,
        model,
        content_json AS contentJson
      FROM session_enrichments
      WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND status = 'current'
        AND enrichment_kind IN ('session_capsule', 'live_summary', 'search_projection')
      ORDER BY session_id ASC, enrichment_kind ASC, COALESCE(generated_at, '') DESC, enrichment_id DESC`
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

export function liveProjectionEnrichments(db: MastheadDatabase, sourceSessionIds?: Iterable<string>): Map<string, LiveProjectionEnrichment> {
  const scopedSourceSessionIds = sourceSessionIds ? [...new Set([...sourceSessionIds].filter(Boolean))] : undefined;
  if (scopedSourceSessionIds && scopedSourceSessionIds.length === 0) return new Map();
  const sourceSessionFilter = scopedSourceSessionIds ? `AND sessions.source_session_id IN (${scopedSourceSessionIds.map(() => "?").join(", ")})` : "";
  const rows = db
    .prepare(
      `SELECT
        session_enrichments.enrichment_id AS enrichmentId,
        sessions.source_session_id AS sourceSessionId,
        session_enrichments.session_id AS sessionId,
        session_enrichments.enrichment_kind AS enrichmentKind,
        session_enrichments.status AS status,
        session_enrichments.generated_at AS generatedAt,
        session_enrichments.prompt_version AS promptVersion,
        session_enrichments.provider AS provider,
        session_enrichments.model AS model,
        session_enrichments.content_json AS contentJson
      FROM session_enrichments
      JOIN sessions ON sessions.session_id = session_enrichments.session_id
      WHERE session_enrichments.status = 'current'
        AND session_enrichments.enrichment_kind IN ('session_capsule', 'live_summary')
        ${sourceSessionFilter}
      ORDER BY sessions.source_session_id ASC, session_enrichments.enrichment_kind ASC, COALESCE(session_enrichments.generated_at, '') DESC, session_enrichments.enrichment_id DESC`
    )
    .all(...(scopedSourceSessionIds ?? [])) as EnrichmentRow[];

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
      return [
        sourceSessionId,
        {
          action: view.action,
          commandsSummary: view.commandsSummary,
          filesChangedSummary: view.filesChangedSummary,
          liveSummary: view.liveSummary,
          model: view.model,
          object: view.object,
          outcome: view.outcome,
          provider: view.provider,
          sourceSessionId,
          status: view.status,
          subject: view.subject,
          technologies: view.technologies,
          title: view.title,
          topics: view.topics,
          verificationSummary: view.verificationSummary
        }
      ];
    })
  );
}

function rowsToView(sessionId: string, rows: EnrichmentRow[]): SessionEnrichmentView {
  const capsuleRow = rowForKind(rows, "session_capsule");
  const liveSummaryRow = rowForKind(rows, "live_summary");
  const searchProjectionRow = rowForKind(rows, "search_projection");
  const capsule = contentFromRow<SessionCapsule>(capsuleRow);
  const liveSummary = contentFromRow<{ text?: string }>(liveSummaryRow);
  const searchProjection = contentFromRow<{ searchText?: string }>(searchProjectionRow);
  return {
    liveSummary: liveSummary?.text ?? capsule?.liveSummary,
    commandsSummary: capsule?.commandsSummary,
    filesChangedSummary: capsule?.filesChangedSummary,
    model: capsuleRow?.model ?? undefined,
    object: capsule?.object,
    objective: capsule?.objective,
    outcome: capsule?.outcome,
    provider: capsuleRow?.provider ?? undefined,
    searchSummary: capsule?.searchSummary,
    searchText: searchProjection?.searchText,
    sessionId,
    status: "current",
    title: capsule?.title,
    titleSource: capsule?.titleSource,
    subject: capsule?.subject?.label,
    technologies: capsule?.technologies ?? [],
    topics: capsule?.topics ?? [],
    verificationSummary: capsule?.verificationSummary,
    unresolved: capsule?.unresolved?.map((claim) => claim.text).filter(Boolean) ?? []
  };
}

function rowForKind(rows: EnrichmentRow[], kind: EnrichmentRow["enrichmentKind"]): EnrichmentRow | undefined {
  const candidates = rows.filter((candidate) => candidate.enrichmentKind === kind);
  return candidates.find((candidate) => candidate.promptVersion === SESSION_CAPSULE_PROMPT_VERSION) ?? candidates.toSorted(compareEnrichmentRows)[0];
}

function compareEnrichmentRows(left: EnrichmentRow, right: EnrichmentRow): number {
  return (right.generatedAt ?? "").localeCompare(left.generatedAt ?? "") || right.enrichmentId.localeCompare(left.enrichmentId);
}

function contentFromRow<T>(row: EnrichmentRow | undefined): T | undefined {
  if (!row?.contentJson) return undefined;
  try {
    return JSON.parse(row.contentJson) as T;
  } catch {
    return undefined;
  }
}
