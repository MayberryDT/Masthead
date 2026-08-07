import { describe, expect, test } from "vitest";
import { assertSafeProviderFetchUrl, isBlockedOutboundIpAddress } from "../safeProviderUrl";
import { assertLoopbackBindHost, isLoopbackHost } from "../loopbackHost";

describe("loopback bind host", () => {
  test("accepts loopback hosts and rejects LAN or wildcard binds", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.0.5")).toBe(false);
    expect(() => assertLoopbackBindHost("0.0.0.0")).toThrow(/loopback/i);
    expect(assertLoopbackBindHost("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("safe provider fetch URL", () => {
  test("allows the default OpenAI endpoint and loopback HTTP providers", async () => {
    await expect(assertSafeProviderFetchUrl("https://api.openai.com/v1/responses")).resolves.toMatchObject({
      hostname: "api.openai.com"
    });
    await expect(assertSafeProviderFetchUrl("http://127.0.0.1:11434/v1/chat/completions")).resolves.toMatchObject({
      hostname: "127.0.0.1"
    });
  });

  test("blocks private and metadata destinations", async () => {
    await expect(assertSafeProviderFetchUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/private|link-local/i);
    await expect(assertSafeProviderFetchUrl("http://10.0.0.8/v1")).rejects.toThrow(/HTTPS|private|link-local/i);
    await expect(assertSafeProviderFetchUrl("https://metadata.google.internal/")).rejects.toThrow(/metadata/i);
    expect(isBlockedOutboundIpAddress("10.1.2.3")).toBe(true);
    expect(isBlockedOutboundIpAddress("8.8.8.8")).toBe(false);
  });
});
