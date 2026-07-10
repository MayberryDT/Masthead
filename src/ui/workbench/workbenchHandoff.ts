import type { WorkbenchQueueSessionDto } from "../../shared/workbench";

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
  databaseId: string;
  sessions: WorkbenchQueueSessionDto[];
}): string {
  const rows = input.sessions.map((session) => {
    const title = sanitizeWorkbenchVisibleText(session.title);
    const sessionId = sanitizeWorkbenchVisibleText(session.sessionId);
    const runtime = sanitizeWorkbenchVisibleText(session.runtime);
    const lifecycle = sanitizeWorkbenchVisibleText(session.lifecycle);
    const lastActivityAt = sanitizeWorkbenchVisibleText(session.lastActivityAt);
    const project = session.project ? `; project: ${sanitizeWorkbenchVisibleText(session.project)}` : "";
    const nextAction = sanitizeWorkbenchVisibleText(session.nextAction);
    const resolution = sanitizeWorkbenchVisibleText(session.resolutionStatus ?? "in_progress");
    return `- Session: ${title} (id: ${sessionId}; runtime: ${runtime}${project}; lifecycle: ${lifecycle}; last activity: ${lastActivityAt}; next action: ${nextAction}; resolution: ${resolution}; transcript: ${sanitizeWorkbenchVisibleText(session.transcriptStatus)}; quality: ${sanitizeWorkbenchVisibleText(session.qualityStatus)}; enrichment: ${sanitizeWorkbenchVisibleText(session.sessionEnrichmentStatus)}; dossier: ${sanitizeWorkbenchVisibleText(session.sessionDossierStatus)}; runbook: ${sanitizeWorkbenchVisibleText(session.runbookStatus ?? session.bugFixTraceStatus)}; adr: ${sanitizeWorkbenchVisibleText(session.adrStatus ?? "unknown")}; incident timeline: ${sanitizeWorkbenchVisibleText(session.incidentTimelineStatus ?? "unknown")})`;
  });
  const request = {
    protocol: "masthead.workbench.authoring/v1",
    databaseId: input.databaseId,
    completion: "publish_and_resolve",
    evidencePolicy: "all_canonical_redacted_evidence",
    authoringTool: {
      kind: "cli",
      command: input.authoringCommand,
      capability: "artifact_authoring"
    },
    sessionIds: input.sessions.map((session) => session.sessionId)
  };

  return [
    "Complete this Masthead Workbench authoring request end to end. This is an unattended automatic handoff: complete this request end to end without pausing for routine approval or asking the user to perform intermediate steps.",
    "Masthead is running locally. Use the installed Masthead Workbench authoring interface identified below and verify its artifact_authoring capability and exact database identity before opening the selected sessions.",
    "For this request, use all available canonical redacted session evidence, gather as many evidence pages as needed, and produce the strongest justified artifacts while keeping every existing evidence, schema, provenance, and publication quality gate intact.",
    "Resolve deterministic validation findings yourself: revise and resubmit until the bundle is ready, then finish publication and resolve every automatic artifact kind; report results only after completion.",
    "The session package always resolves through publication. Publish runbook, ADR, and incident timeline when evidence supports them; otherwise resolve them as N/A or an existing published contribution. Sessions stay the capture and pipeline unit; Logbook stores published artifacts only.",
    "",
    "Machine request:",
    JSON.stringify(request),
    "",
    "Artifact kinds:",
    "- session package: enrichment capsule fields + session dossier (exactly one session provenance).",
    "- runbook: multi-session-capable reusable fix recipe with problem signature, repro, dead ends, fix steps, validation.",
    "- adr: multi-session-capable decision record (context, decision, alternatives, consequences).",
    "- incident timeline: multi-session-capable ordered failure narrative with evidence refs.",
    "",
    "Rules:",
    "- Apply is not publish. Fail closed on invalid schema, unknown evidence refs, or weak multi-session joins.",
    "- Cite only evidence from the declared provenance evidence packet.",
    "- Do not invent files, commands, outcomes, or root causes.",
    "- Do not copy secrets into artifact bodies.",
    "- High-confidence runbook fix claims need supporting validation checks.",
    "- Prefer strong single-session artifacts over weak multi-session merges.",
    "- Expand beyond the selected sessions only with a strong join key; record the join rationale for every multi-session artifact.",
    "- A session package is resolved only after publication; runbook, ADR, and incident timeline each resolve through publication, N/A, or an existing published contribution.",
    "",
    "Selected sessions:",
    ...rows
  ].join("\n");
}
