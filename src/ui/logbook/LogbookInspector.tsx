import type { ReactNode } from "react";
import {
  CANONICAL_SESSION_DOSSIER_SCHEMA,
  isKnownLegacySessionDossierSchema,
  isPublishedSessionDossierV1,
  type LogbookInspectorArtifact
} from "../../app/logbook/logbookInspectorModel";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { StatusBadge } from "../primitives/StatusBadge";
import { SessionDossierContent } from "../session-dossier/SessionDossierContent";

export type { LogbookInspectorArtifact };

type Props = {
  loading?: boolean;
  error?: string;
  artifact?: LogbookInspectorArtifact;
  onClose: () => void;
};

export function LogbookInspector({ artifact, error, loading = false, onClose }: Props) {
  if (!artifact && !loading && !error) return null;

  const title = artifact?.title ?? (loading ? "Loading artifact" : error ? "Could not load artifact" : "Artifact detail");
  const label = artifact ? kindLabel(artifact.kind) : "Artifact detail";

  return (
    <aside className="logbook-inspector metal-surface" aria-label="Artifact detail">
      <header>
        <div>
          <p className="mono-label">{label}</p>
          <h2>{title}</h2>
          {artifact ? <ArtifactMeta artifact={artifact} /> : null}
        </div>
        <button type="button" className="surface-inline-action logbook-inspector-close" aria-label="Close artifact detail" onClick={onClose}>
          <Icon name="close" size="toolbar" weight={iconWeights.toolbar} />
        </button>
      </header>

      {artifact ? (
        <>
          <div className="logbook-inspector-body">{renderArtifactBody(artifact)}</div>
          <ProvenanceSection joinRationale={artifact.joinRationale} provenanceLabel={artifact.provenanceLabel} provenanceSessionIds={artifact.provenanceSessionIds} />
        </>
      ) : loading ? (
        <p className="surface-status">Loading artifact detail...</p>
      ) : error ? (
        <p className="surface-status" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

function ArtifactMeta({ artifact }: { artifact: LogbookInspectorArtifact }) {
  const chips: ReactNode[] = [];
  if (artifact.project) {
    chips.push(
      <span key="project" className="logbook-inspector-meta-chip">
        {artifact.project}
      </span>
    );
  }
  if (artifact.confidence) {
    chips.push(
      <StatusBadge key="confidence" tone={confidenceTone(artifact.confidence)}>
        {labelize(artifact.confidence)}
      </StatusBadge>
    );
  }
  if (artifact.publishedAt) {
    chips.push(
      <time key="published" dateTime={artifact.publishedAt} className="logbook-inspector-meta-chip">
        {formatDateTime(artifact.publishedAt)}
      </time>
    );
  }
  if (chips.length === 0) return null;
  return <div className="logbook-inspector-meta">{chips}</div>;
}

function ProvenanceSection({ joinRationale, provenanceLabel, provenanceSessionIds }: { joinRationale?: string; provenanceLabel?: string; provenanceSessionIds: string[] }) {
  const count = provenanceSessionIds.length;
  const label = provenanceLabel ?? (count === 1 ? "1 session" : count === 0 ? "No sessions" : `${count} sessions`);

  return (
    <section className="logbook-inspector-provenance" aria-label="Provenance">
      <p className="mono-label">Provenance</p>
      <p>{label}</p>
      {count > 0 ? (
        <ul className="logbook-inspector-provenance-list">
          {provenanceSessionIds.map((sessionId) => (
            <li key={sessionId}>
              <code>{sessionId}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {joinRationale ? (
        <div className="logbook-inspector-join">
          <p className="mono-label">Join rationale</p>
          <p>{joinRationale}</p>
        </div>
      ) : null}
    </section>
  );
}

function renderArtifactBody(artifact: LogbookInspectorArtifact): ReactNode {
  const { body, kind, schemaVersion } = artifact;
  if (kind === "session_dossier" && schemaVersion === CANONICAL_SESSION_DOSSIER_SCHEMA) {
    if (!isPublishedSessionDossierV1(body)) {
      return <DossierSchemaStatus title="Invalid canonical session dossier" detail="The published body does not match the canonical dossier contract." />;
    }
    return (
      <SessionDossierContent
        compactShell
        dossier={body}
        transcript={artifact.provenanceTranscript}
        transcriptError={artifact.provenanceTranscriptError}
        transcriptLoading={artifact.provenanceTranscriptLoading}
      />
    );
  }

  if (kind === "session_dossier" && !isKnownLegacySessionDossierSchema(schemaVersion)) {
    return <DossierSchemaStatus title="Unsupported session dossier schema" detail={schemaVersion ? `Schema ${schemaVersion} is not supported by this version of Masthead.` : "The artifact does not declare a supported dossier schema."} />;
  }

  const record = asRecord(body);
  if (!record) {
    if (body === undefined || body === null || body === "") {
      return <p className="surface-status">No body captured for this artifact.</p>;
    }
    if (isKnownArtifactKind(kind)) {
      if (typeof body === "string") return <TextSection label="Body" value={body.trim()} />;
      if (Array.isArray(body)) {
        const values = body.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
        if (values.length > 0) return <ListSection label="Body" values={values} />;
      }
      return <p className="surface-status">No structured body captured for this artifact.</p>;
    }
    return <pre className="logbook-inspector-json">{prettyUnknown(body)}</pre>;
  }

  if (kind === "session_dossier") {
    return (
      <div className="logbook-inspector-sections">
        <p className="mono-label">Legacy session dossier</p>
        <TextSection label="Problem" value={stringField(record, "problemStatement") ?? stringField(record, "problem")} />
        <TextSection label="Objective" value={stringField(record, "objective")} />
        <TextSection label="Context" value={stringField(record, "context")} />
        <ListSection label="Approach" values={stringArrayField(record, "approach")} />
        <ListSection label="Key decisions" values={stringArrayField(record, "keyDecisions")} />
        <ObjectListSection label="Files touched" values={record.filesTouched} primary="label" secondary="role" />
        <ObjectListSection label="Commands and tools" values={record.commandsAndTools} primary="label" secondary="purpose" tertiary="status" />
        <TextSection label="Outcome" value={stringField(record, "outcome")} />
        <ListSection label="Verification" values={stringArrayField(record, "verification")} />
        <ListSection label="Risks" values={stringArrayField(record, "risksOrGaps") ?? stringArrayField(record, "risks")} />
        <ListSection label="Lessons learned" values={stringArrayField(record, "lessonsLearned")} />
        <CommonArtifactSections record={record} />
      </div>
    );
  }

  if (kind === "runbook") {
    return (
      <div className="logbook-inspector-sections">
        <ProblemSignatureSection value={record.problemSignature} />
        <ListSection label="Preconditions" values={stringArrayField(record, "preconditions")} />
        <ListSection label="Reproduction" values={stringArrayField(record, "reproSteps")} />
        <ListSection label="Dead ends" values={stringArrayField(record, "deadEnds")} />
        <ListSection label="Fix steps" values={stringArrayField(record, "fixSteps")} />
        <ListSection label="Commands" values={stringArrayField(record, "commands")} />
        <ListSection label="Changed files" values={stringArrayField(record, "changedFiles")} />
        <ListSection label="Validation checks" values={stringArrayField(record, "validationChecks")} />
        <ListSection label="Environment" values={stringArrayField(record, "environmentRequirements")} />
        <TextSection label="Root cause" value={stringField(record, "rootCause")} />
        <ListSection label="Prevention" values={stringArrayField(record, "preventionNotes")} />
        <ListSection label="Risks and gaps" values={stringArrayField(record, "risksOrGaps")} />
        <CommonArtifactSections record={record} />
      </div>
    );
  }

  if (kind === "adr") {
    return (
      <div className="logbook-inspector-sections">
        <TextSection label="Status" value={stringField(record, "status")} />
        <TextSection label="Context" value={stringField(record, "context")} />
        <TextSection label="Decision" value={stringField(record, "decision")} />
        <ListSection label="Alternatives" values={stringArrayField(record, "alternatives")} />
        <ListSection label="Consequences" values={stringArrayField(record, "consequences")} />
        <ListSection label="Affected paths" values={stringArrayField(record, "affectedPaths")} />
        <ListSection label="Supersedes" values={stringArrayField(record, "supersedes")} />
        <CommonArtifactSections record={record} />
      </div>
    );
  }

  if (kind === "incident_timeline") {
    return (
      <div className="logbook-inspector-sections">
        <TextSection label="Symptom" value={stringField(record, "symptom")} />
        <TextSection label="Impact" value={stringField(record, "impact")} />
        <TimelineSection value={record.timeline} />
        <TextSection label="Root cause" value={stringField(record, "rootCause")} />
        <ListSection label="Contributing factors" values={stringArrayField(record, "contributingFactors")} />
        <ListSection label="Remediation" values={stringArrayField(record, "remediation")} />
        <ListSection label="Prevention" values={stringArrayField(record, "prevention")} />
        <TextSection label="Status" value={stringField(record, "status")} />
        <CommonArtifactSections record={record} />
      </div>
    );
  }

  return <pre className="logbook-inspector-json">{prettyUnknown(body)}</pre>;
}

function DossierSchemaStatus({ detail, title }: { detail: string; title: string }) {
  return (
    <section className="logbook-inspector-section" role="status">
      <p className="mono-label">{title}</p>
      <p>{detail}</p>
    </section>
  );
}

function isKnownArtifactKind(kind: string): boolean {
  return kind === "session_dossier" || kind === "runbook" || kind === "adr" || kind === "incident_timeline";
}

function CommonArtifactSections({ record }: { record: Record<string, unknown> }) {
  return (
    <>
      <ListSection label="Evidence" values={stringArrayField(record, "evidenceRefs")} />
      <ClaimEvidenceSection values={record.claimEvidence} />
      <ListSection label="Missing evidence" values={stringArrayField(record, "missingEvidence")} />
      <ListSection label="Provenance sessions" values={stringArrayField(record, "provenanceSessionIds")} />
      <TextSection label="Join rationale" value={stringField(record, "joinRationale")} />
      <TextSection label="Signature" value={stringField(record, "signatureKey")} />
    </>
  );
}

function ProblemSignatureSection({ value }: { value: unknown }) {
  const signature = asRecord(value);
  if (!signature) return null;
  const symptoms = stringArrayField(signature, "symptoms") ?? [];
  const errorStrings = stringArrayField(signature, "errorStrings") ?? [];
  const affectedScope = stringField(signature, "affectedScope");
  if (symptoms.length === 0 && errorStrings.length === 0 && !affectedScope) return null;

  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">Problem signature</p>
      {affectedScope ? <p>{affectedScope}</p> : null}
      {symptoms.length > 0 ? (
        <ul>
          {symptoms.map((item) => (
            <li key={`symptom:${item}`}>{item}</li>
          ))}
        </ul>
      ) : null}
      {errorStrings.length > 0 ? (
        <ul>
          {errorStrings.map((item) => (
            <li key={`error:${item}`}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TimelineSection({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return undefined;
      const at = stringField(record, "at");
      const summary = stringField(record, "summary");
      if (!at && !summary) return undefined;
      return {
        at,
        evidenceRefs: stringArrayField(record, "evidenceRefs"),
        summary
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  if (entries.length === 0) return null;

  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">Timeline</p>
      <ol className="logbook-inspector-timeline">
        {entries.map((entry, index) => (
          <li key={`${entry.at ?? "entry"}-${index}`}>
            {entry.at ? <time dateTime={entry.at}>{formatDateTime(entry.at)}</time> : null}
            {entry.summary ? <p>{entry.summary}</p> : null}
            {entry.evidenceRefs?.length ? (
              <ul>
                {entry.evidenceRefs.map((evidenceRef) => (
                  <li key={`${entry.at ?? index}:${evidenceRef}`}>
                    <code>{evidenceRef}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ObjectListSection({ label, primary, secondary, tertiary, values }: { label: string; primary: string; secondary?: string; tertiary?: string; values: unknown }) {
  if (!Array.isArray(values)) return null;
  const entries = values.flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const primaryValue = stringField(record, primary);
    if (!primaryValue) return [];
    return [
      {
        primary: primaryValue,
        secondary: secondary ? stringField(record, secondary) : undefined,
        tertiary: tertiary ? stringField(record, tertiary) : undefined
      }
    ];
  });
  if (entries.length === 0) return null;

  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">{label}</p>
      <ul>
        {entries.map((entry, index) => (
          <li key={`${label}:${entry.primary}:${index}`}>
            <span>{entry.primary}</span>
            {entry.secondary ? <span>{` — ${entry.secondary}`}</span> : null}
            {entry.tertiary ? <span>{` (${entry.tertiary})`}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimEvidenceSection({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const entries = values.flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const path = stringField(record, "path");
    const evidenceRefs = stringArrayField(record, "evidenceRefs") ?? [];
    if (!path && evidenceRefs.length === 0) return [];
    return [{ evidenceRefs, path }];
  });
  if (entries.length === 0) return null;

  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">Claim evidence</p>
      <ul>
        {entries.map((entry, index) => (
          <li key={`${entry.path ?? "claim"}:${index}`}>
            {entry.path ? <code>{entry.path}</code> : null}
            {entry.evidenceRefs.length > 0 ? (
              <ul>
                {entry.evidenceRefs.map((evidenceRef) => (
                  <li key={`${entry.path ?? index}:${evidenceRef}`}>
                    <code>{evidenceRef}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TextSection({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">{label}</p>
      <p>{value}</p>
    </section>
  );
}

function ListSection({ label, values }: { label: string; values?: string[] }) {
  if (!values || values.length === 0) return null;
  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">{label}</p>
      <ul>
        {values.map((item) => (
          <li key={`${label}:${item}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return items;
}

function prettyUnknown(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function kindLabel(kind: string): string {
  if (kind === "session_dossier") return "Session dossier";
  if (kind === "runbook") return "Runbook";
  if (kind === "adr") return "ADR";
  if (kind === "incident_timeline") return "Incident timeline";
  return kind
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function confidenceTone(confidence: string): "active" | "info" | "warning" {
  const normalized = confidence.toLowerCase();
  if (normalized === "high" || normalized === "authoritative") return "active";
  if (normalized === "medium" || normalized === "inferred") return "info";
  return "warning";
}

function labelize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
