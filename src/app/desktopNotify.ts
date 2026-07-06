import { invokeDesktopCommand, type DesktopNotificationResult, type DesktopSessionTransitionNotificationInput } from "./desktopBridge";

export async function notifySessionTransitionDesktop(
  input: DesktopSessionTransitionNotificationInput
): Promise<DesktopNotificationResult> {
  const desktop = typeof window === "undefined" ? undefined : window.mastheadDesktop;
  if (!desktop) return { ok: true, shown: false, reason: "bridge_unavailable" };
  if (typeof desktop.notifySessionTransition === "function") {
    return desktop.notifySessionTransition(input);
  }
  const fallback = await invokeDesktopCommand<DesktopNotificationResult>("notify_session_transition_command", { ...input });
  return fallback ?? { ok: true, shown: false, reason: "bridge_unavailable" };
}
