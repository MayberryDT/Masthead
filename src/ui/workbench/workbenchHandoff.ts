import type { CreateGuidedAuthoringRequestResponse } from "../../app/daemonClient";
import type { WorkbenchAuthoringV5CapabilitiesDto } from "../../shared/workbenchAuthoringV5";

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
  capabilities: WorkbenchAuthoringV5CapabilitiesDto;
  request: CreateGuidedAuthoringRequestResponse;
}): string {
  const sessionCount = input.request.request?.sessionCount;
  const packCount = input.request.request?.packCount;
  const scopeBit =
    typeof sessionCount === "number" && typeof packCount === "number"
      ? ` This request has ${packCount} packs covering ${sessionCount} sessions — all of them must be authored well.`
      : " This request has multiple fixed packs — all of them must be authored well.";

  const lines = [
    "ROLE: You are the ORCHESTRATOR for this Workbench V5 request. You do NOT write dossier field prose yourself. " +
      "You claim packs and delegate each pack to a sub-agent that hand-authors dossiers. If your harness cannot spawn sub-agents, say so and stop — do not silently fall back to filling dossiers yourself unless the user explicitly tells you to.",
    "PURPOSE (for every sub-agent): Logbook session dossiers — published knowledge for humans and future agents. " +
      "Natural language, specific, searchable: clear title, short description, purpose/outcome from the real user ask and retained result, keywords for retrieval. " +
      "Transcript dumps, skill inventories, and automation meta-comments are not enrichment.",
    "HOW SUB-AGENTS WRITE: For every session in their pack, read inspected evidence and synthesize from the last substantive user ask and retained outcome. " +
      "Title = short PR-style name. Description = 1–3 searchable sentences. Scaffold fields start blank; the sub-agent fills prose by hand.",
    "NO FACTORIES: Neither you nor sub-agents write fill scripts, synthesizers, or pack runners. " +
      "Shell/tools only run daemon nextAction.command (and followUp.command if present).",
    "ORCHESTRATOR LOOP: bootstrap/status → start (claim pack) → spawn one sub-agent for THAT pack only " +
      "(inspect → scaffold → hand-author → save → finish; sub-agent must NOT claim_next) → verify pack finished → claim_next/start → next sub-agent. " +
      "One pack at a time (daemon claim model). Re-spawn a pack-scoped resume sub-agent if a pack stalls.",
    `Masthead authoring request: ${input.request.handoff.requestId}`,
    `Start: ${input.request.handoff.startCommand}`,
    "COMPLETION: Finish every pack for this request before you stop." +
      scopeBit +
      ' Stop only when nextAction.kind is "complete", a request receipt exists, AND progress.packsCompleted === progress.packsTotal. ' +
      "Pack finish is not request completion.",
    'Stop rule: Do not stop until nextAction.kind is "complete", a request receipt exists, and every pack is done.'
  ];

  if (typeof sessionCount === "number" && typeof packCount === "number") {
    lines.push(
      `Scope: ${sessionCount} sessions in ${packCount} fixed packs (daemon-owned). You orchestrate all ${packCount} packs via sub-agents; you do not batch-script prose.`
    );
  }

  const excluded = input.request.selection?.excludedSessions ?? [];
  const included =
    input.request.selection?.eligibleSessionCount ?? input.request.request?.sessionCount;
  if (excluded.length > 0) {
    const reasonCounts = new Map<string, number>();
    for (const row of excluded) {
      reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
    }
    const reasonSummary = [...reasonCounts.entries()]
      .map(([reason, count]) => `${count}× ${reason}`)
      .join(", ");
    lines.push(
      `SELECTION DEALING: ${included ?? "some"} session(s) entered the authoring pack; ${excluded.length} selected session(s) were excluded (${reasonSummary}). ` +
        "Definitive noise (session-start shells, empty, hook-only, etc.) is automatically dismissed to Not Added so it leaves Workbench. " +
        "For sessions still in the pack that have no real work after inspect, hard_reject them so they also leave package path — do not leave undealable Workbench rows behind."
    );
  } else {
    lines.push(
      "SELECTION DEALING: Every selected session that remains on the package path must be authored or hard_rejected. " +
        "hard_reject removes noise from Workbench (Not Added); publishable dossiers go to Logbook."
    );
  }

  lines.push(
    "Progress only counts when mastheadctl save/finish succeeds. Local file edits are not progress.",
    'Verification: never set status "passed" with empty evidenceRefs.verification; if no verification evidence, use an honest not-run/boundary claim with refs (empty verification refs hard-reject).',
    "After each pack finish: run nextAction (and followUp if present), then carefully author the next pack the same way. " +
      "On hard_reject, rewrite those sessions with real synthesis when they have real work; use hard_reject for empty/meta shells so they leave Workbench. " +
      "Never write a final answer until nextAction.kind is complete."
  );

  return lines.join("\n");
}
