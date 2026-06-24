import type { AttentionItem, CommandFailureDetail } from "../core/types";

type Props = {
  items: AttentionItem[];
  variant?: "scan" | "detail";
};

export function AttentionQueue({ items, variant = "detail" }: Props) {
  const visibleItems = items.slice(0, 4);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <section id="attention" className="attention-queue" aria-label="Needs attention">
      <header className="section-head">
        <div>
          <p className="mono-label">Queue</p>
          <h1>Needs attention</h1>
        </div>
        <span className="state-token attention">{items.length}</span>
      </header>
      <div className="attention-list">
        {visibleItems.map((item) => {
          const commandDetails = variant === "detail" ? detailsFor(item) : [];

          return (
            <article className="attention-item" key={item.itemId}>
              <div>
                <span className="state-token">{item.severity}</span>
                <h2>{variant === "scan" ? scanTitle(item) : item.title}</h2>
                <p>{item.project}</p>
              </div>
              <p>{variant === "scan" ? scanSummary(item) : item.suggestedNextAction}</p>
              {commandDetails.length > 0 ? (
                <dl className="attention-evidence" aria-label="Failed command evidence">
                  {commandDetails.map((detail, index) => (
                    <div key={`${detail.commandId ?? detail.evidenceId ?? "command"}-${index}`}>
                      <dt>Command evidence</dt>
                      <dd>{commandEvidenceLabel(detail)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </article>
          );
        })}
      </div>
      {hiddenCount > 0 ? <p className="attention-overflow">+{hiddenCount} more attention items in the filtered board.</p> : null}
    </section>
  );
}

function detailsFor(item: AttentionItem): CommandFailureDetail[] {
  if (item.commandDetails?.length) return item.commandDetails;
  if (item.type !== "command_failed") return [];

  return [
    {
      commandId: item.affectedCommandIds[0],
      occurredAt: item.createdAt,
      evidenceId: item.evidence[0]?.id
    }
  ];
}

function commandEvidenceLabel(detail: CommandFailureDetail): string {
  return [
    typeof detail.exitCode === "number" ? `Exit ${detail.exitCode}` : undefined,
    detail.category,
    detail.occurredAt,
    detail.evidenceId
  ]
    .filter(Boolean)
    .join(" / ");
}

function scanTitle(item: AttentionItem): string {
  const labels: Record<AttentionItem["type"], string> = {
    approval_requested: "Approval is pending",
    user_question: "Input is pending",
    command_failed: "A failed step needs review",
    repeated_failure: "Repeated failure needs review",
    stalled: "Progress appears stalled",
    completed_without_verification: "Verification follow-up",
    stale_verification: "Verification follow-up",
    high_risk_change: "High-risk change evidence",
    conflict: "Overlapping work is visible"
  };
  return labels[item.type];
}

function scanSummary(item: AttentionItem): string {
  if (item.type === "approval_requested") return "Review the request in the inspector before continuing.";
  if (item.type === "user_question") return "Review the pending input in the inspector.";
  if (item.type === "command_failed" || item.type === "repeated_failure") return "Review the session detail before continuing.";
  if (item.type === "completed_without_verification" || item.type === "stale_verification") return "Check verification detail before closing this out.";
  if (item.type === "high_risk_change") return "Review the supporting evidence before continuing.";
  if (item.type === "conflict") return "Review overlapping work before either session continues.";
  return "Review the session detail before continuing.";
}
