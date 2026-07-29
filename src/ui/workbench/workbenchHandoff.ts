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
  const lines = [
    `Masthead authoring request: ${input.request.handoff.requestId}`,
    `Start: ${input.request.handoff.startCommand}`,
    'Stop rule: Do not stop, end, finish, or hand control back until nextAction.kind is "complete", a request receipt exists, and every pack for this request is done.',
    "Pack finish is not request completion. One pack done is not done. Keep looping nextAction.command (and followUp if present) until all packs complete."
  ];

  const sessionCount = input.request.request?.sessionCount;
  const packCount = input.request.request?.packCount;
  if (typeof sessionCount === "number" && typeof packCount === "number") {
    lines.push(`Scope: ${sessionCount} sessions in ${packCount} fixed packs (daemon-owned).`);
  }

  lines.push(
    "Progress only counts when mastheadctl save/finish succeeds. Local file edits are not progress.",
    'Verification: never set status "passed" with empty evidenceRefs.verification; if no verification evidence, use an honest not-run/boundary claim with refs (empty verification refs hard-reject).',
    "After every pack finish, immediately claim and run the next pack. On hard_reject, read findings, fix the pattern, and continue — do not stop early."
  );

  return lines.join("\n");
}
