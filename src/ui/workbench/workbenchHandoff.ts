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
      ? ` This request has ${packCount} packs covering ${sessionCount} sessions — all of them.`
      : " This request has multiple fixed packs — all of them.";

  const lines = [
    "CRITICAL OBLIGATION: You must finish EVERY pack for this request before you stop. " +
      "Stopping after 1 pack, 6 packs, or any partial count is a failure." +
      scopeBit,
    `Masthead authoring request: ${input.request.handoff.requestId}`,
    `Start: ${input.request.handoff.startCommand}`,
    'Stop rule: Do not stop, end, finish, summarize, or hand control back until nextAction.kind is "complete", a request receipt exists, AND progress.packsCompleted === progress.packsTotal (every pack done).',
    "Pack finish is not request completion. One pack done is not done. Keep looping nextAction.command (and followUp.command if present) until ALL packs complete."
  ];

  if (typeof sessionCount === "number" && typeof packCount === "number") {
    lines.push(`Scope: ${sessionCount} sessions in ${packCount} fixed packs (daemon-owned). You own all ${packCount} packs.`);
  }

  lines.push(
    "Progress only counts when mastheadctl save/finish succeeds. Local file edits are not progress.",
    'Verification: never set status "passed" with empty evidenceRefs.verification; if no verification evidence, use an honest not-run/boundary claim with refs (empty verification refs hard-reject).',
    "After every pack finish: read nextAction + followUp + stopRule + progress. Immediately claim and run the next pack. On hard_reject, fix the pattern and continue — do not stop early. Never write a final answer until nextAction.kind is complete."
  );

  return lines.join("\n");
}
