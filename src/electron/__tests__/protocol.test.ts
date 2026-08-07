import { describe, expect, test } from "vitest";
import { resolveProtocolPath } from "../protocol";

describe("Electron protocol path policy", () => {
  test("serves root and client routes from index.html", () => {
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/")).toBe("/home/app/dist/index.html");
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/logbook/session-1")).toBe("/home/app/dist/index.html");
  });

  test("serves static assets from the renderer dist directory", () => {
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/assets/index.js")).toBe("/home/app/dist/assets/index.js");
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/favicon.ico")).toBe("/home/app/dist/favicon.ico");
  });

  test("rejects path traversal, malformed encoding, and non-Masthead protocol URLs", () => {
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/assets/../../secret.txt")).toBeUndefined();
    expect(resolveProtocolPath("/home/app/dist", "masthead://app/%E0%A4%A")).toBeUndefined();
    expect(resolveProtocolPath("/home/app/dist", "file:///home/app/dist/index.html")).toBeUndefined();
  });
});
