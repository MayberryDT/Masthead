// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GuidedAuthoringReviewDto } from "../../../shared/guidedAuthoring";
import { AuthoringCanaryReview } from "../AuthoringCanaryReview";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("AuthoringCanaryReview", () => {
  test("requires an operator identifier before approving a canary", async () => {
    const approve = vi.fn();
    render(<AuthoringCanaryReview review={stagedReview()} onApprove={approve} onReject={vi.fn()} />);

    await click("Approve canary");

    expect(approve).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Enter your operator identifier before reviewing this canary.");
  });

  test("submits the trimmed human-entered operator identifier when approving", async () => {
    const approve = vi.fn();
    render(<AuthoringCanaryReview review={stagedReview()} onApprove={approve} onReject={vi.fn()} />);
    await typeInto("Operator identifier", "  tyler@example.com  ");

    await click("Approve canary");

    expect(approve).toHaveBeenCalledWith(stagedReview(), "tyler@example.com");
  });

  test("requires notes when rejecting a canary", async () => {
    const reject = vi.fn();
    render(<AuthoringCanaryReview review={stagedReview()} onApprove={vi.fn()} onReject={reject} />);

    await typeInto("Operator identifier", "tyler@example.com");

    await click("Reject canary");

    expect(reject).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Add review notes before rejecting this canary.");
  });

  test("submits rejection notes with the human-entered operator identifier", async () => {
    const reject = vi.fn();
    render(<AuthoringCanaryReview review={stagedReview()} onApprove={vi.fn()} onReject={reject} />);
    await typeInto("Operator identifier", "operator:tyler");
    await typeInto("Rejection notes", "  The dossier is still generic.  ");

    await click("Reject canary");

    expect(reject).toHaveBeenCalledWith(stagedReview(), "The dossier is still generic.", "operator:tyler");
  });

  test("renders dossier, artifact, claim support, and quality findings", () => {
    render(<AuthoringCanaryReview review={stagedReview()} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(container?.textContent).toContain("session dossier");
    expect(container?.textContent).toContain("Repair the authoring daemon");
    expect(container?.textContent).toContain("runbook");
    expect(container?.textContent).toContain("Restart the daemon safely");
    expect(container?.textContent).toContain("Daemon health returned ok");
    expect(container?.textContent).toContain("generic_summary");
  });

  test("shows every claim-support excerpt for operator review", () => {
    const review = stagedReview();
    review.draft!.artifacts[0]!.output.claimSupport = Array.from({ length: 9 }, (_, index) => ({
      evidenceRef: `session:a:item:${index + 1}`,
      excerpt: `Claim support ${index + 1}`
    }));

    render(<AuthoringCanaryReview review={review} onApprove={vi.fn()} onReject={vi.fn()} />);

    expect(container?.textContent).toContain("Claim support 9");
  });
});

function render(node: React.ReactNode): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

async function click(label: string): Promise<void> {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`missing_button:${label}`);
  await act(async () => button.click());
}

async function typeInto(label: string, value: string): Promise<void> {
  const control = Array.from(container?.querySelectorAll("input, textarea") ?? [])
    .find((item) => item.closest("label")?.textContent?.includes(label));
  if (!control) throw new Error(`missing_control:${label}`);
  await act(async () => {
    const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function stagedReview(): GuidedAuthoringReviewDto {
  const evidenceRef = {
    id: "session:a:item:4",
    kind: "event" as const,
    observedAt: "2026-07-20T00:00:00.000Z",
    source: "codex"
  };
  return {
    assignmentId: "assignment:canary",
    coverage: [{ accessedItems: 4, complete: true, evidenceRevision: "sha256:evidence", sessionId: "session:a", totalItems: 4 }],
    draft: {
      artifacts: [{
        draftId: "draft:runbook",
        kind: "runbook",
        output: {
          claimSupport: [{ evidenceRef: "session:a:item:4", excerpt: "Daemon health returned ok" }],
          summary: "Restart the daemon safely"
        },
        provenanceSessionIds: ["session:a"],
        seedSessionId: "session:a"
      }],
      assignmentId: "assignment:canary",
      bundleVersion: "workbench-authoring-v4",
      evidenceRevision: "sha256:evidence",
      opportunityDispositions: [],
      sessionEnrichments: [{
        claimSupport: [],
        enrichment: {
          keywords: ["authoring daemon", "safe restart", "health check"],
          sessionDossier: {
            blockers: [],
            continuation: { constraints: [], openQuestions: [] },
            decisions: [],
            evidenceRefs: [evidenceRef],
            keyWork: ["Restarted the daemon"],
            verification: { commands: [], evidenceRefs: [evidenceRef], failures: [], status: "passed", summary: "Healthy" },
            warnings: []
          },
          sessionSummary: { confidence: "high", evidenceRefs: [evidenceRef], state: "completed", text: "Repair the authoring daemon" },
          sessionTitle: { basis: "dominant_work", confidence: "high", evidenceRefs: [evidenceRef], text: "Repair the authoring daemon" },
          version: "session-capsule-v4"
        },
        sessionId: "session:a"
      }]
    },
    draftRevision: 2,
    editorialQuestions: ["Does the verification prove the daemon stayed healthy?"],
    evidenceRevision: "sha256:evidence",
    findings: [{ code: "generic_summary", message: "Use concrete evidence", severity: "warning" }],
    nextAction: { command: "mastheadctl authoring review --assignment assignment:canary", kind: "await_operator", reason: "Canary is staged" },
    operatorReviews: [],
    requestId: "request:one",
    status: "staged_canary"
  };
}
