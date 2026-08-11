import type { PublishedSessionDossierV1 } from "../shared/sessionDossier.ts";
import type { DurableSessionEnrichment } from "../shared/sessionEnrichment.ts";
import { validateSourceLinks } from "./sourceLinks.ts";
import type {
  EvidenceItemV1,
  PageLicense,
  PageRevisionBodyV1,
  PageRevisionV1,
  SourceLinkV1,
  VerificationStatus,
} from "./types.ts";

export type SessionDossierProjectionInput = {
  dossier: PublishedSessionDossierV1;
  license: PageLicense;
  generatorVersion: string;
  evidence?: readonly EvidenceItemV1[];
  sourceLinks?: readonly SourceLinkV1[];
  /** Publisher-reviewed topic labels; never auto-copied from narrative. */
  topics?: readonly string[];
  /** Publisher-reviewed technology labels; never auto-copied from narrative. */
  technologies?: readonly string[];
  /** When true, emit YYYY-MM-DD from identity.endedAt or startedAt. */
  includeSourceDate?: boolean;
};

export class ProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectionError";
    this.code = code;
  }
}

export function projectSessionDossier(
  input: SessionDossierProjectionInput,
): PageRevisionV1 {
  const durable = requireDurableEnrichment(input.dossier);
  const title = requireNonEmpty(durable.sessionTitle.text, "title_required");
  const summary = requireNonEmpty(
    durable.sessionSummary.text,
    "summary_required",
  );
  const sourceLinks = validateSourceLinks(input.sourceLinks ?? []);
  const evidence = [...(input.evidence ?? [])];
  const topics = [...(input.topics ?? [])];
  const technologies = [...(input.technologies ?? [])];

  const body = projectBody(durable);
  const verification = projectVerification(durable);
  const provenance: PageRevisionV1["provenance"] = {
    sourceKind: "session_dossier",
    sourceSchema: "canonical-session-dossier-v1",
    sourceLinks,
  };

  if (input.includeSourceDate) {
    const sourceDate = projectSourceDate(input.dossier);
    if (sourceDate) {
      provenance.sourceDate = sourceDate;
    }
  }

  const page: PageRevisionV1 = {
    schemaVersion: "masthead-page-revision-v1",
    kind: "session_dossier",
    title,
    summary,
    body,
    labels: {
      topics,
      technologies,
    },
    verification,
    evidence,
    provenance,
    license: input.license,
    generator: {
      name: "Masthead",
      version: requireNonEmpty(input.generatorVersion, "generator_version_required"),
      projection: "session-dossier-public-v1",
    },
  };

  return page;
}

function requireDurableEnrichment(
  dossier: PublishedSessionDossierV1,
): DurableSessionEnrichment {
  if (dossier.enrichment.status !== "current" || !dossier.durableEnrichment) {
    throw new ProjectionError(
      "durable_enrichment_required",
      "Current durable enrichment is required; raw prompts are never used as fallback",
    );
  }
  return dossier.durableEnrichment;
}

function projectBody(durable: DurableSessionEnrichment): PageRevisionBodyV1 {
  const session = durable.sessionDossier;
  const body: PageRevisionBodyV1 = {
    keyWork: [...session.keyWork],
    decisions: [...session.decisions],
    blockers: [...session.blockers],
    continuation: {
      openQuestions: [...session.continuation.openQuestions],
      constraints: [...session.continuation.constraints],
    },
    warnings: [...session.warnings],
  };

  const purpose = optionalText(session.purpose);
  if (purpose !== undefined) {
    body.purpose = purpose;
  }

  const outcome = optionalText(session.outcome);
  if (outcome !== undefined) {
    body.outcome = outcome;
  }

  const nextStep = optionalText(session.continuation.nextStep);
  if (nextStep !== undefined) {
    body.continuation.nextStep = nextStep;
  }

  return body;
}

function projectVerification(durable: DurableSessionEnrichment): PageRevisionV1["verification"] {
  const verification = durable.sessionDossier.verification;
  return {
    status: verification.status as VerificationStatus,
    summary: requireNonEmpty(verification.summary, "verification_summary_required"),
    checks: [...verification.commands],
    failures: [...verification.failures],
  };
}

function projectSourceDate(dossier: PublishedSessionDossierV1): string | undefined {
  const raw = dossier.identity.endedAt ?? dossier.identity.startedAt;
  if (!raw) {
    return undefined;
  }
  const date = dateOnlyUtc(raw);
  if (!date) {
    throw new ProjectionError(
      "source_date_invalid",
      "Provenance source date must derive from a valid timestamp",
    );
  }
  return date;
}

function dateOnlyUtc(value: string): string | undefined {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireNonEmpty(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ProjectionError(code, `${code}: non-empty text is required`);
  }
  return trimmed;
}
