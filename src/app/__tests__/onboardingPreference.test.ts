// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";
import {
  mastheadOnboardingDismissedStorageKey,
  readOnboardingDismissed,
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
});
