// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppShell } from "../AppShell";
import {
  mastheadMotionDisabledStorageKey,
  prefersReducedMotion,
  readStoredMotionDisabled,
  writeStoredMotionDisabled
} from "../motionPreference";

describe("motion preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false })
    });
  });

  test("persists the local disabled-motion setting", () => {
    writeStoredMotionDisabled(true);

    expect(localStorage.getItem(mastheadMotionDisabledStorageKey)).toBe("1");
    expect(readStoredMotionDisabled()).toBe(true);

    writeStoredMotionDisabled(false);

    expect(localStorage.getItem(mastheadMotionDisabledStorageKey)).toBeNull();
    expect(readStoredMotionDisabled()).toBe(false);
  });

  test("treats shell motion off as reduced motion", () => {
    document.body.innerHTML = '<main class="masthead-shell" data-motion-mode="off"></main>';

    expect(prefersReducedMotion()).toBe(true);
  });

  test("exposes motion off on the app shell", () => {
    const html = renderToStaticMarkup(<AppShell sidebar={<nav />} main={<section />} motionMode="off" />);

    expect(html).toContain('data-motion-mode="off"');
  });
});
