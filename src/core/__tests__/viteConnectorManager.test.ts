import { describe, expect, test } from "vitest";
import { isCompatibleMastheadHealth, resolveDevConnectorPort } from "../../../vite.config";

const compatibleHealth = {
  ok: true,
  product: "masthead",
  apiVersion: 1,
  capabilities: [
    "live_projection",
    "canonical_sessions",
    "logbook_search",
    "source_discovery",
    "adapter_inventory",
    "import_jobs",
    "mcp_status",
    "settings",
    "data_lifecycle"
  ],
  data: {
    databaseId: "db",
    migrationState: "ready"
  }
};

describe("Vite connector manager protocol checks", () => {
  test("accepts the current Masthead health contract", () => {
    expect(isCompatibleMastheadHealth(compatibleHealth)).toBe(true);
  });

  test("rejects legacy and failed-migration health payloads", () => {
    expect(isCompatibleMastheadHealth({ ok: true, events: 12 })).toBe(false);
    expect(isCompatibleMastheadHealth({ ...compatibleHealth, data: { migrationState: "failed" } })).toBe(false);
  });

  test("moves to an available isolated port when the default daemon is incompatible", async () => {
    await expect(resolveDevConnectorPort(17373, "incompatible", async (startPort) => startPort + 1)).resolves.toBe(17375);
    await expect(resolveDevConnectorPort(17373, "offline", async () => 17375)).resolves.toBe(17373);
  });
});
