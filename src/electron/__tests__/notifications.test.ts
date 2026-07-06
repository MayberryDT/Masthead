import { describe, expect, test, vi } from "vitest";
import { showSessionTransitionNotification, type DesktopNotificationConstructor } from "../notifications";

type NotificationOptions = { title: string; body?: string; silent: false };

function fakeNotificationConstructor(supported: boolean) {
  const constructed: NotificationOptions[] = [];
  const show = vi.fn();
  class FakeNotification {
    static isSupported = vi.fn(() => supported);

    constructor(options: NotificationOptions) {
      constructed.push(options);
    }

    show() {
      show();
    }
  }

  return { constructed, show, ctor: FakeNotification as unknown as DesktopNotificationConstructor };
}

describe("session transition desktop notifications", () => {
  test("constructs and shows a supported notification with sanitized title/body", () => {
    const notification = fakeNotificationConstructor(true);

    const result = showSessionTransitionNotification(notification.ctor, {
      sessionId: " session-1 ",
      transition: "blocked",
      title: "  Approval needed  ",
      body: "  Blocked: Approval requested  "
    });

    expect(result).toEqual({ ok: true, shown: true });
    expect(notification.constructed).toEqual([{ title: "Approval needed", body: "Blocked: Approval requested", silent: false }]);
    expect(notification.show).toHaveBeenCalledTimes(1);
  });

  test("skips unsupported notification environments without constructing an OS notification", () => {
    const notification = fakeNotificationConstructor(false);

    const result = showSessionTransitionNotification(notification.ctor, {
      sessionId: "session-1",
      transition: "idle",
      title: "Session idle"
    });

    expect(result).toEqual({ ok: true, shown: false, reason: "unsupported" });
    expect(notification.constructed).toEqual([]);
    expect(notification.show).not.toHaveBeenCalled();
  });

  test("defaults a blank title and omits a blank body", () => {
    const notification = fakeNotificationConstructor(true);

    const result = showSessionTransitionNotification(notification.ctor, {
      sessionId: "session-1",
      transition: "ended",
      title: "   ",
      body: "  "
    });

    expect(result).toEqual({ ok: true, shown: true });
    expect(notification.constructed).toEqual([{ title: "Session changed state", body: undefined, silent: false }]);
  });

  test("rejects invalid transition payloads before constructing a notification", () => {
    const notification = fakeNotificationConstructor(true);

    expect(() =>
      showSessionTransitionNotification(notification.ctor, {
        sessionId: "session-1",
        transition: "paused",
        title: "Session paused"
      })
    ).toThrow("Invalid session notification transition: paused");
    expect(notification.constructed).toEqual([]);
    expect(notification.show).not.toHaveBeenCalled();
  });
});
