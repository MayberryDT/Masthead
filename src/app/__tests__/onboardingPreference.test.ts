// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";
import {
  mastheadOnboardingDismissedStorageKey,
  readOnboardingDismissed,
  resolveOnboardingDismissed,
  writeOnboardingDismissed
} from "../onboardingPreference";

describe("onboarding preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("defaults to not dismissed", () => {
    expect(readOnboardingDismissed()).toBe(false);
  });

  test("persists dismissal", () => {
    writeOnboardingDismissed(true);

    expect(window.localStorage.getItem(mastheadOnboardingDismissedStorageKey)).toBe("1");
    expect(readOnboardingDismissed()).toBe(true);
  });

  test("clears dismissal when onboarding is manually reopened", () => {
    writeOnboardingDismissed(true);
    writeOnboardingDismissed(false);

    expect(window.localStorage.getItem(mastheadOnboardingDismissedStorageKey)).toBeNull();
    expect(readOnboardingDismissed()).toBe(false);
  });

  test("scopes dismissal to the active canonical database", () => {
    writeOnboardingDismissed(true, "database:old");

    expect(readOnboardingDismissed("database:old")).toBe(true);
    expect(readOnboardingDismissed("database:new")).toBe(false);
  });

  test("does not let the legacy profile-wide dismissal hide onboarding for a replacement database", () => {
    window.localStorage.setItem(mastheadOnboardingDismissedStorageKey, "1");

    expect(resolveOnboardingDismissed("database:existing")).toBe(true);
    expect(readOnboardingDismissed("database:existing")).toBe(true);
    expect(resolveOnboardingDismissed("database:new")).toBe(false);
  });

  test("migrates the legacy dismissal only for the first canonical database seen", () => {
    writeOnboardingDismissed(true);

    expect(resolveOnboardingDismissed("database:first")).toBe(true);
    expect(resolveOnboardingDismissed("database:second")).toBe(false);
    expect(resolveOnboardingDismissed("database:first")).toBe(true);
  });
});
