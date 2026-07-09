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
    return `- Session: ${title} (id: ${sessionId}; runtime: ${runtime}${project}; lifecycle: ${lifecycle}; last activity: ${lastActivityAt}; next action: ${nextAction}; transcript: ${sanitizeWorkbenchVisibleText(session.transcriptStatus)}; quality: ${sanitizeWorkbenchVisibleText(session.qualityStatus)}; enrichment: ${sanitizeWorkbenchVisibleText(session.sessionEnrichmentStatus)}; dossier: ${sanitizeWorkbenchVisibleText(session.sessionDossierStatus)}; bug fix trace: ${sanitizeWorkbenchVisibleText(session.bugFixTraceStatus)})`;
  });
  return [
    "Masthead is running locally on this machine. The user selected these Workbench sessions for agent processing. Use the Masthead Workbench CLI from the Masthead repo and write changes only through Workbench commands.",
    "",
    "Repository:",
    "/home/tyler/.codex/worktrees/f503/Masthead",
    "",
    "Agent workflow:",
    "1. Change into the Masthead repo.",
    "2. If `dist/daemon/src/cli/mastheadctl.js` is missing, run `npm run build:daemon`.",
    "3. Run `node dist/daemon/src/cli/mastheadctl.js workbench status --json` to confirm the database path and queue state.",
    "4. Claim only the selected sessions before working: `node dist/daemon/src/cli/mastheadctl.js workbench claim --session <session-id> --claimed-by codex --json`.",
    "5. Run lightweight transcript checks first: `node dist/daemon/src/cli/mastheadctl.js workbench transcript check --session <session-id> --json`.",
    "6. Import transcripts only when a source-scoped transcript permission already exists or the user explicitly approves that import. Use `workbench transcript preview` before `workbench transcript import`.",
    "7. For each selected session, fetch the evidence packet with `node dist/daemon/src/cli/mastheadctl.js workbench evidence --kind session_enrichment --session <session-id> --json`.",
    "8. Read the kind-specific instructions with `node dist/daemon/src/cli/mastheadctl.js workbench instructions --kind session_enrichment --scope missing` and the JSON schema with `node dist/daemon/src/cli/mastheadctl.js workbench schema session_enrichment --json`.",
    "9. Write one JSON output per selected session using only evidence refs from the packet.",
    "10. Validate before applying: `node dist/daemon/src/cli/mastheadctl.js workbench validate --kind session_enrichment --session <session-id> --file <path-to-output> --json`.",
    "11. Apply only validated output: `node dist/daemon/src/cli/mastheadctl.js workbench apply --kind session_enrichment --session <session-id> --file <path-to-output> --json`.",
    "12. Create and apply a session_dossier for each session. Create and apply a bug_fix_trace only when evidence supports it; otherwise mark it not applicable through the Workbench artifact flow.",
    "13. Publish only after transcript, quality, enrichment, dossier, and bug-fix readiness are satisfied: `node dist/daemon/src/cli/mastheadctl.js workbench publish --session <session-id> --json`.",
    "",
    "Output kinds:",
    "- `session_enrichment`: required first for each selected session; updates the current capsule, live summary, and search projection.",
    "- `session_dossier`: create only when the evidence supports a durable summary of the session objective, decisions, outcome, verification, and open risks.",
    "- `bug_fix_trace`: create only when the evidence shows a concrete bug investigation/fix with symptom, cause, fix, files, verification, and follow-up risk.",
    "",
    "Rules:",
    "- Do not infer facts that are not in the evidence packet.",
    "- Every conclusion needs an evidence ref from the packet.",
    "- If evidence is missing, record it in `missingEvidence` instead of guessing.",
    "- Keep titles and summaries useful for Logbook search and future MCP retrieval.",
    "- Do not inspect or mention Not Added to Logbook sessions unless the user explicitly asks.",
    "- Do not modify user projects; only write through the Masthead Workbench apply command.",
    "",
    "Selected sessions:",
    ...rows
  ].join("\n");
}
