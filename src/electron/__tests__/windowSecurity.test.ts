import { describe, expect, test } from "vitest";
import { isAllowedRendererUrl, mastheadWindowChromeOptions, mastheadWindowPreferences, rendererTrustedOrigins } from "../window";

describe("Electron window security policy", () => {
  test("removes native chrome for Masthead-owned window controls", () => {
    expect(mastheadWindowChromeOptions()).toEqual({
      autoHideMenuBar: true,
      backgroundColor: "#031019",
      frame: false,
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
});
