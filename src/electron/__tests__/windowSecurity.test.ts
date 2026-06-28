import { describe, expect, test } from "vitest";
import { isAllowedRendererUrl, mastheadWindowPreferences } from "../window";

describe("Electron window security policy", () => {
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

  test("allows only Masthead renderer origins", () => {
    expect(isAllowedRendererUrl("http://localhost:5173")).toBe(true);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedRendererUrl("masthead://app/index.html")).toBe(true);

    expect(isAllowedRendererUrl("https://example.com")).toBe(false);
    expect(isAllowedRendererUrl("file:///tmp/index.html")).toBe(false);
    expect(isAllowedRendererUrl("http://127.0.0.1:17373/projection")).toBe(false);
  });
});
