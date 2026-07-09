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

export function buildWorkbenchHandoff(input: { sessions: WorkbenchQueueSessionDto[] }): string {
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
  return [
    "Masthead is running locally on this machine. The user selected these Workbench sessions for agent processing. Complete the automatic kind set end-to-end with Masthead Workbench tools—claim, gather evidence, validate, apply, and publish—without asking the user to cluster sessions or click publish.",
    "",
    "Automatic completion loop:",
    "1. Claim only the selected seed sessions before working.",
    "2. Check transcript availability; import only when permission already exists or the user explicitly approves.",
    "3. Ensure quality is passed (or stop if quality fails).",
    "4. Apply session enrichment (session capsule listing fields) and a session dossier body for each seed session—this is the required session package.",
    "5. Publish the session package when validation and package gates pass.",
    "6. For runbook, ADR, and incident timeline: publish when evidence supports them; otherwise mark N/A (session-relative only, never a Logbook row). If the seed session is already in provenance of a published multi-session artifact of that kind, mark contributed instead of duplicating.",
    "7. Expand beyond the seed set only with a strong join key (shared failure/error signature; near-duplicate repro + failing check; same decision object; shared environment-plus-symptom fingerprint). Weak joins (same project/topics/time window, file overlap, summary vibes) stay single-session or N/A. Store join rationale on multi-session artifacts.",
    "8. Automatic work is resolved when the session package is published and runbook, ADR, and incident timeline are each published, N/A, or satisfied via contribution.",
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
    "",
    "Selected sessions:",
    ...rows
  ].join("\n");
}
