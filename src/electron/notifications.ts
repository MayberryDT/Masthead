export type SessionNotificationTransition = "idle" | "blocked" | "ended";

export type DesktopNotificationConstructor = {
  isSupported: () => boolean;
  new (options: { title: string; body?: string; silent: false }): { show: () => void };
};

export type DesktopNotificationResult =
  | { ok: true; shown: true }
  | { ok: true; shown: false; reason: "unsupported" };

export function showSessionTransitionNotification(
  NotificationCtor: DesktopNotificationConstructor,
  args: Record<string, unknown> | undefined
): DesktopNotificationResult {
  const sessionId = stringArg(args, "sessionId").trim();
  if (!sessionId) throw new Error("Session notification sessionId is required.");
  sessionNotificationTransitionArg(args);
  const title = stringArg(args, "title").trim() || "Session changed state";
  const body = stringArg(args, "body").trim();
  if (!NotificationCtor.isSupported()) return { ok: true, shown: false, reason: "unsupported" };
  const notification = new NotificationCtor({ title, body: body || undefined, silent: false });
  notification.show();
  return { ok: true, shown: true };
}

function sessionNotificationTransitionArg(args: Record<string, unknown> | undefined): SessionNotificationTransition {
  const value = stringArg(args, "transition");
  if (value === "idle" || value === "blocked" || value === "ended") return value;
  throw new Error(`Invalid session notification transition: ${value || "<missing>"}`);
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  return typeof value === "string" ? value : "";
}
