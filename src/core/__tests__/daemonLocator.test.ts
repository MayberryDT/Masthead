import { describe, expect, test } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import legacyHealth from "../../../fixtures/protocol/legacy-health.json";
import { locateCompatibleDaemon } from "../daemonLocator.ts";

describe("daemon locator", () => {
  test("classifies current Masthead health as compatible", async () => {
    await expect(locateCompatibleDaemon("http://127.0.0.1:17373", async () => currentHealth)).resolves.toMatchObject({
      baseUrl: "http://127.0.0.1:17373",
      compatibility: { state: "compatible" },
      health: currentHealth
    });
  });

  test("classifies legacy ok health as incompatible", async () => {
    await expect(locateCompatibleDaemon("http://127.0.0.1:17373", async () => legacyHealth)).resolves.toMatchObject({
      baseUrl: "http://127.0.0.1:17373",
      compatibility: {
        state: "incompatible",
        reason: "missing_protocol_identity"
      },
      state: "incompatible"
    });
  });
});
