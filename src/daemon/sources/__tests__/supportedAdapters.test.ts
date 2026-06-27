import { describe, expect, test } from "vitest";
import { canImportMetadata, canImportTranscripts } from "../../../adapters/capabilities.ts";
import { RUNTIME_KINDS } from "../../../adapters/types.ts";
import { supportedAdapters } from "../supportedAdapters.ts";

describe("supportedAdapters", () => {
  test("matches the runtime kind registry and excludes Crush", () => {
    const runtimes = supportedAdapters.map((adapter) => adapter.runtime);
    expect(runtimes).toEqual([...RUNTIME_KINDS]);
    expect(runtimes).not.toContain("crush");
  });

  test("keeps gemini_cli only as legacy compatibility", () => {
    const gemini = supportedAdapters.find((adapter) => adapter.runtime === "gemini_cli");
    expect(gemini?.maturity).toBe("planned");
    expect(gemini?.supportsMetadataImport).toBe(false);
    expect(canImportMetadata(gemini!)).toBe(false);
  });

  test("marks all required scan targets active and MCP visible", () => {
    const active = supportedAdapters.filter((adapter) => adapter.runtime !== "gemini_cli");
    expect(active.map((adapter) => adapter.runtime)).toEqual(["codex", "cursor", "claude_code", "antigravity", "opencode", "aider", "openclaw", "hermes", "pi"]);
    expect(active.every((adapter) => adapter.implementationState === "active")).toBe(true);
    expect(active.every((adapter) => adapter.enabled)).toBe(true);
    expect(active.every((adapter) => adapter.supportsMcpExposure)).toBe(true);
    expect(canImportTranscripts(supportedAdapters.find((adapter) => adapter.runtime === "cursor")!)).toBe(true);
    expect(canImportMetadata(supportedAdapters.find((adapter) => adapter.runtime === "antigravity")!)).toBe(true);
  });
});
