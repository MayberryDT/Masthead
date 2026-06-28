import { describe, expect, test } from "vitest";
import { ELECTRON_CHANNELS, isAllowedIpcChannel, isAllowedIpcSender } from "../ipc";

describe("Electron IPC security policy", () => {
  test("allows only the Masthead desktop channel set", () => {
    expect(isAllowedIpcChannel(ELECTRON_CHANNELS.startLiveConnector)).toBe(true);
    expect(isAllowedIpcChannel(ELECTRON_CHANNELS.openDataDirectory)).toBe(true);
    expect(isAllowedIpcChannel("shell:openExternal")).toBe(false);
    expect(isAllowedIpcChannel("__proto__")).toBe(false);
  });

  test("accepts only Masthead renderer URLs as IPC senders", () => {
    expect(isAllowedIpcSender("masthead://app/index.html")).toBe(true);
    expect(isAllowedIpcSender("http://localhost:5173/src/App.tsx")).toBe(false);
    expect(isAllowedIpcSender("http://localhost:5173/src/App.tsx", { allowDevRenderer: true })).toBe(true);
    expect(isAllowedIpcSender("https://example.com/app.js")).toBe(false);
    expect(isAllowedIpcSender("file:///tmp/app.js")).toBe(false);
  });
});
