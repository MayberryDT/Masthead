import { describe, expect, test } from "vitest";
import { shouldHideWindowOnClose } from "../windowCloseBehavior";

describe("window close behavior", () => {
  test("hides only when the tray preference is enabled and the app is not quitting", () => {
    expect(shouldHideWindowOnClose({ keepRunningInTray: true, quitting: false })).toBe(true);
    expect(shouldHideWindowOnClose({ keepRunningInTray: false, quitting: false })).toBe(false);
    expect(shouldHideWindowOnClose({ keepRunningInTray: true, quitting: true })).toBe(false);
  });
});
