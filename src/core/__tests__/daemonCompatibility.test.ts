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

  test("rejects a health response from another product", () => {
    expect(classifyDaemonHealth({ ...currentHealth, product: "other" })).toMatchObject({
      state: "incompatible",
      reason: "wrong_product"
    });
  });

  test("rejects an older API version", () => {
    expect(classifyDaemonHealth({ ...currentHealth, apiVersion: 0 })).toMatchObject({
      state: "incompatible",
      reason: "unsupported_api_version"
    });
  });

  test("rejects a newer API version until an explicit compatibility window exists", () => {
    expect(classifyDaemonHealth({ ...currentHealth, apiVersion: 2 })).toMatchObject({
      state: "incompatible",
      reason: "unsupported_api_version"
    });
  });

  test("rejects missing required capabilities", () => {
    expect(classifyDaemonHealth({ ...currentHealth, capabilities: ["live_projection"] })).toMatchObject({
      state: "incompatible",
      reason: "missing_capabilities",
      missingCapabilities: [
        "canonical_sessions",
        "logbook_search",
        "source_discovery",
        "adapter_inventory",
        "import_jobs",
        "mcp_status",
        "usage_stats",
        "settings",
        "data_lifecycle",
        "artifact_authoring"
      ]
    });
  });

  test("treats a migration failure as degraded rather than compatible", () => {
    expect(classifyDaemonHealth({ ...currentHealth, data: { ...currentHealth.data, migrationState: "failed" } })).toMatchObject({
      state: "degraded",
      reason: "migration_failed"
    });
  });

  test("rejects missing runtime identity fields", () => {
    expect(classifyDaemonHealth({ ...currentHealth, runtime: { ...currentHealth.runtime, daemonInstanceId: undefined } })).toMatchObject({
      state: "malformed",
      reason: "missing_required_fields"
    });
  });

  test("rejects missing database identity fields", () => {
    expect(classifyDaemonHealth({ ...currentHealth, data: { ...currentHealth.data, databaseId: "" } })).toMatchObject({
      state: "malformed",
      reason: "missing_required_fields"
    });
  });
});
