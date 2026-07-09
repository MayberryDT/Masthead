import type { ReactNode } from "react";
import type { LogbookInspectorArtifact } from "../../app/logbook/logbookInspectorModel";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { StatusBadge } from "../primitives/StatusBadge";

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
          <div className="logbook-inspector-body">{renderArtifactBody(artifact.kind, artifact.body)}</div>
          <ProvenanceSection
            joinRationale={artifact.joinRationale}
            provenanceLabel={artifact.provenanceLabel}
            provenanceSessionIds={artifact.provenanceSessionIds}
          />
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

function ProvenanceSection({
  joinRationale,
  provenanceLabel,
  provenanceSessionIds
}: {
  joinRationale?: string;
  provenanceLabel?: string;
  provenanceSessionIds: string[];
}) {
  const count = provenanceSessionIds.length;
  const label =
    provenanceLabel ??
    (count === 1 ? "1 session" : count === 0 ? "No sessions" : `${count} sessions`);

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

function renderArtifactBody(kind: string, body: unknown): ReactNode {
  const record = asRecord(body);
  if (!record) {
    if (body === undefined || body === null || body === "") {
      return <p className="surface-status">No body captured for this artifact.</p>;
    }
    return <pre className="logbook-inspector-json">{prettyUnknown(body)}</pre>;
  }

  if (kind === "session_dossier") {
    return (
      <div className="logbook-inspector-sections">
        <TextSection label="Problem" value={stringField(record, "problemStatement") ?? stringField(record, "problem")} />
        <TextSection label="Context" value={stringField(record, "context")} />
        <ListSection label="Approach" values={stringArrayField(record, "approach")} />
        <TextSection label="Outcome" value={stringField(record, "outcome")} />
        <ListSection label="Verification" values={stringArrayField(record, "verification")} />
        <ListSection label="Risks" values={stringArrayField(record, "risksOrGaps") ?? stringArrayField(record, "risks")} />
      </div>
    );
  }

  if (kind === "runbook") {
    return (
      <div className="logbook-inspector-sections">
        <ProblemSignatureSection value={record.problemSignature} />
        <ListSection label="Repro steps" values={stringArrayField(record, "reproSteps")} />
        <ListSection label="Fix steps" values={stringArrayField(record, "fixSteps")} />
        <ListSection label="Dead ends" values={stringArrayField(record, "deadEnds")} />
        <ListSection label="Validation checks" values={stringArrayField(record, "validationChecks")} />
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
      </div>
    );
  }

  if (kind === "incident_timeline") {
    return (
      <div className="logbook-inspector-sections">
        <TextSection label="Symptom" value={stringField(record, "symptom")} />
        <TextSection label="Impact" value={stringField(record, "impact")} />
        <TimelineSection value={record.timeline} />
        <ListSection label="Remediation" values={stringArrayField(record, "remediation")} />
      </div>
    );
  }

  return <pre className="logbook-inspector-json">{prettyUnknown(body)}</pre>;
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
      return { at, summary };
    })
    .filter((entry): entry is { at?: string; summary?: string } => Boolean(entry));
  if (entries.length === 0) return null;

  return (
    <section className="logbook-inspector-section">
      <p className="mono-label">Timeline</p>
      <ol className="logbook-inspector-timeline">
        {entries.map((entry, index) => (
          <li key={`${entry.at ?? "entry"}-${index}`}>
            {entry.at ? <time dateTime={entry.at}>{formatDateTime(entry.at)}</time> : null}
            {entry.summary ? <p>{entry.summary}</p> : null}
          </li>
        ))}
      </ol>
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
