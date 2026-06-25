import { describe, expect, test } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import legacyHealth from "../../../fixtures/protocol/legacy-health.json";
import { classifyDaemonHealth } from "../../shared/protocol";

describe("daemon compatibility", () => {
  test("an ok health response without protocol identity is incompatible", () => {
    expect(classifyDaemonHealth(legacyHealth)).toMatchObject({
      state: "incompatible",
      reason: "missing_protocol_identity"
    });
  });

  test("a health response with Masthead protocol identity is compatible", () => {
    expect(classifyDaemonHealth(currentHealth)).toMatchObject({
      state: "compatible"
    });
  });
});
