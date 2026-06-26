import { describe, expect, test } from "vitest";
import { MastheadApiClient } from "../api/MastheadApiClient";

describe("active daemon URL", () => {
  test("connection API normalizes connector projection URL and keeps isolated port", () => {
    const api = new MastheadApiClient("http://127.0.0.1:17374/projection");

    expect(api.baseUrl).toBe("http://127.0.0.1:17374");
    expect(api.projectionUrl("s1")).toBe("http://127.0.0.1:17374/projection?selectedSessionId=s1");
    expect(api.url("/health").toString()).toBe("http://127.0.0.1:17374/health");
  });
});
