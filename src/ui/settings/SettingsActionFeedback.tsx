export type SettingsFeedback = {
  message: string;
  tone?: "error" | "neutral" | "success";
};

export function SettingsActionFeedback({ feedback }: { feedback?: SettingsFeedback }) {
  if (!feedback) return null;
  return (
    <span
      aria-live="polite"
      className={`settings-inline-feedback ${feedback.tone ?? ""}`.trim()}
      role="status"
    >
      {feedback.message}
    </span>
  );
}
