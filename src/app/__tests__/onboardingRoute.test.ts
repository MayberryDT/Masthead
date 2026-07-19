// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";
import { resolveDatabaseOnboardingRoute } from "../onboardingRoute";
import { writeOnboardingDismissed } from "../onboardingPreference";

beforeEach(() => {
  window.localStorage.clear();
});

describe("database onboarding route", () => {
  test("resolves once for a database, ignores same-database reconnect, and reopens Sources for a replacement", () => {
    writeOnboardingDismissed(true);
    const resolvedDatabaseIds = new Set<string>();

    expect(resolveDatabaseOnboardingRoute("database:existing", resolvedDatabaseIds)).toBe("now");
    expect(resolveDatabaseOnboardingRoute("database:existing", resolvedDatabaseIds)).toBeUndefined();
    expect(resolveDatabaseOnboardingRoute("database:replacement", resolvedDatabaseIds)).toBe("sources");
  });
});
