import { describe, expect, test } from "vitest";
import {
  parseMastheadPagesAuthorizationUrl,
  resolveMastheadPagesApiOrigin
} from "../mastheadPagesUrlPolicy";

describe("mastheadPagesUrlPolicy", () => {
  test.each([
    "http://masthead.page/connect",
    "https://evil.example/connect",
    "file:///tmp/connect",
    "https://masthead.page.evil.example/connect",
    "https://user:pass@masthead.page/device-approve",
    "javascript:alert(1)",
    ""
  ])("refuses authorization URL %s", (url) => {
    expect(parseMastheadPagesAuthorizationUrl(url)).toBeUndefined();
  });

  test("accepts https masthead.page device approval URLs", () => {
    expect(parseMastheadPagesAuthorizationUrl("https://masthead.page/device-approve")).toBe(
      "https://masthead.page/device-approve"
    );
    expect(parseMastheadPagesAuthorizationUrl("https://www.masthead.page/device-approve?x=1")).toBe(
      "https://www.masthead.page/device-approve?x=1"
    );
  });

  test("accepts configured https override origins", () => {
    expect(
      parseMastheadPagesAuthorizationUrl("https://pages.dev.example/device-approve", {
        allowedOrigins: ["https://pages.dev.example"]
      })
    ).toBe("https://pages.dev.example/device-approve");
  });

  test("defaults API origin to https://masthead.page", () => {
    expect(resolveMastheadPagesApiOrigin({})).toBe("https://masthead.page");
  });

  test("honors MASTHEAD_PAGES_API_ORIGIN", () => {
    expect(resolveMastheadPagesApiOrigin({ MASTHEAD_PAGES_API_ORIGIN: "https://staging.masthead.page" })).toBe(
      "https://staging.masthead.page"
    );
  });
});
