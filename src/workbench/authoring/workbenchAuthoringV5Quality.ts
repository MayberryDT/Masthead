import type {
  WorkbenchAuthoringV5Draft,
  WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";

/**
 * S2 seam for S4's semantic quality policy. Until S4 lands, a structurally valid,
 * canonically referenced session is publishable.
 */
export function classifyWorkbenchAuthoringV5Session(
  session: WorkbenchAuthoringV5Draft["sessions"][number]
): WorkbenchAuthoringV5SessionOutcome {
  return { disposition: "publishable", findings: [], sessionId: session.sessionId };
}
