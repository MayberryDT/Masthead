import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import {
  isAllowedRendererUrl,
  mastheadWindowChromeOptions,
  mastheadWindowPreferences,
  rendererEntryUrl,
  rendererTrustedOrigins
} from "../window";

describe("Electron window security policy", () => {
  afterEach(() => {
    delete process.env.MASTHEAD_ELECTRON_DEV;
    delete process.env.MASTHEAD_ELECTRON_RENDERER_URL;
  });

  test.each(["linux", "win32"] as const)("uses a native title bar overlay on %s", (platform) => {
    expect(mastheadWindowChromeOptions(platform)).toEqual({
      autoHideMenuBar: true,
      backgroundColor: "#031019",
      frame: true,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#051724", symbolColor: "#d6e4ef", height: 32 }
    });
  });

  test("keeps Electron smoke contracts free of renderer-owned window controls", async () => {
    const [mainSource, developmentSmokeSource, packagedSmokeSource] = await Promise.all([
      readFile("src/electron/main.ts", "utf8"),
      readFile("scripts/masthead-electron-smoke.js", "utf8"),
      readFile("scripts/masthead-electron-packaged-smoke.js", "utf8")
    ]);

    expect(mainSource).toContain(
      "hasRendererWindowControls: document.querySelector('.masthead-window-control') !== null"
    );
    for (const smokeSource of [developmentSmokeSource, packagedSmokeSource]) {
      expect(smokeSource).toContain("parsed.renderer?.hasRendererWindowControls !== false");
      expect(smokeSource).toContain("parsed.renderer?.hasCustomChrome");
      expect(smokeSource).not.toContain('includes("Minimize window")');
      expect(smokeSource).not.toContain('includes("Maximize window")');
      expect(smokeSource).not.toContain('includes("Close window")');
    }
  });

  test("uses the hidden native title bar without an overlay on macOS", () => {
    expect(mastheadWindowChromeOptions("darwin")).toEqual({
      autoHideMenuBar: true,
      backgroundColor: "#031019",
      frame: true,
      titleBarStyle: "hidden"
    });
  });

  test("keeps the renderer isolated from Node and Electron internals", () => {
    expect(mastheadWindowPreferences("/tmp/preload.js")).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      preload: "/tmp/preload.js"
    });
  });

  test("allows only Masthead renderer origins in packaged mode", () => {
    expect(isAllowedRendererUrl("masthead://app/index.html")).toBe(true);

    expect(isAllowedRendererUrl("http://localhost:5173")).toBe(false);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173")).toBe(false);
    expect(isAllowedRendererUrl("https://example.com")).toBe(false);
    expect(isAllowedRendererUrl("file:///tmp/index.html")).toBe(false);
    expect(isAllowedRendererUrl("http://127.0.0.1:17373/projection")).toBe(false);
  });

  test("allows Vite origins only when dev mode opts in", () => {
    expect(isAllowedRendererUrl("http://localhost:5173", { allowDevServer: true })).toBe(true);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173", { allowDevServer: true })).toBe(true);
    expect(rendererTrustedOrigins()).toEqual(["masthead://app"]);
    expect(rendererTrustedOrigins({ allowDevServer: true })).toEqual([
      "masthead://app",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]);
  });

  test("trusts the actual Electron Forge renderer dev server origin", () => {
    const policy = { allowDevServer: true, devServerUrl: "http://localhost:5174/" };

    expect(isAllowedRendererUrl("http://localhost:5174", policy)).toBe(true);
    expect(rendererTrustedOrigins(policy)).toContain("http://localhost:5174");
  });

  test("uses the canonical dev renderer URL when the launcher provides it", () => {
    process.env.MASTHEAD_ELECTRON_DEV = "1";
    process.env.MASTHEAD_ELECTRON_RENDERER_URL = "http://127.0.0.1:5173";

    expect(rendererEntryUrl()).toBe("http://127.0.0.1:5173");
  });
});
