import type { WorkbenchArtifactCandidateDto } from "../../shared/workbenchAuthoring";

const FORBIDDEN_HANDOFF_SUBSTRINGS = [
  ["mast", "head", "ctl"].join(""),
  ["np", "m", " run"].join(""),
  ["out", "put", ".json"].join(""),
  ["sch", "ema", ".json"].join(""),
  ["app", "ly", ".sh"].join("")
] as const;

export function sanitizeWorkbenchVisibleText(value: string | undefined): string {
  return FORBIDDEN_HANDOFF_SUBSTRINGS.reduce((text, token) => {
    const pattern = new RegExp(escapeRegExp(token), "gi");
    return text.replace(pattern, "[redacted]");
  }, value ?? "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWorkbenchHandoff(input: {
  authoringCommand: string;
  candidate: WorkbenchArtifactCandidateDto;
  databaseId: string;
}): string {
  const candidate = input.candidate;
  const provenanceCount = candidate.provenanceSessionIds.length;
  const machineRequest = {
    protocol: "masthead.workbench.authoring/v1",
    bundleVersion: "workbench-authoring-v2",
    capability: "artifact_authoring",
    databaseId: input.databaseId,
    evidencePolicy: "candidate_scoped_canonical_evidence",
    transport: "daemon_http",
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    evidenceRevision: candidate.evidenceRevision,
    provenanceSessionIds: candidate.provenanceSessionIds,
    authoringTool: {
      command: input.authoringCommand,
      kind: "cli"
    }
  };

  return [
    `Author one reusable ${formatKind(candidate.kind)} from this nominated Masthead candidate.`,
    `Candidate: ${sanitizeWorkbenchVisibleText(candidate.candidateId)} · ${provenanceCount} provenance ${provenanceCount === 1 ? "session" : "sessions"}.`,
    `Positive signals: ${sanitizeWorkbenchVisibleText(candidate.signalSummary)}`,
    "Ground every substantive claim in the candidate's canonical redacted evidence. Every claim must include its evidence reference and a verbatim claim excerpt from that evidence.",
    "Revise deterministic validation findings until the artifact is accepted, then finish publication and report the completed artifact.",
    "",
    "Machine request:",
    JSON.stringify(machineRequest)
  ].join("\n");
}

function formatKind(kind: WorkbenchArtifactCandidateDto["kind"]): string {
  return kind.replaceAll("_", " ");
}
