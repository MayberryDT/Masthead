import { describe, expect, test } from "vitest";
import { activeProjectionUrlAfterConnectorStart } from "../App";
import { projectionRequestUrl } from "../liveProjectionClient";

describe("active daemon URL", () => {
  test("uses connector result projection URL for subsequent App projection requests", () => {
    const result = {
      ok: true,
      started: true,
      command: "masthead daemon",
      message: "Started local Masthead collector.",
      baseUrl: "http://127.0.0.1:17374",
      health: { apiVersion: 1, mode: "primary" },
      projectionUrl: "http://127.0.0.1:17374/projection"
    } as const;

    const activeProjectionUrl = activeProjectionUrlAfterConnectorStart(result, "http://127.0.0.1:17373/projection");

    expect(activeProjectionUrl).toBe("http://127.0.0.1:17374/projection");
    expect(projectionRequestUrl(activeProjectionUrl, "s1")).toBe("http://127.0.0.1:17374/projection?selectedSessionId=s1");
  });

  test("keeps current projection URL when connector start is unsupported", () => {
    const result = {
      ok: false,
      supported: false,
      command: "npm run dev",
      message: "Run npm run dev, then choose Check again."
    } as const;

    expect(activeProjectionUrlAfterConnectorStart(result, "http://127.0.0.1:17373/projection")).toBe(
      "http://127.0.0.1:17373/projection"
    );
  });
});
