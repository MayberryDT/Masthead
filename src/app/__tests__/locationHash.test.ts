// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vitest";
import { clearUnsupportedLocationHash } from "../locationHash";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("location hash handling", () => {
  test("removes unsupported hash fragments while preserving path and query", () => {
    window.history.replaceState({}, "", "/app?view=settings#settings");

    expect(clearUnsupportedLocationHash()).toBe(true);

    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?view=settings");
    expect(window.location.hash).toBe("");
  });

  test("leaves plain URLs unchanged", () => {
    window.history.replaceState({}, "", "/app?view=settings");

    expect(clearUnsupportedLocationHash()).toBe(false);

    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?view=settings");
    expect(window.location.hash).toBe("");
  });
});
