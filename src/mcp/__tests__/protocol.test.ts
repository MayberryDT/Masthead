import { describe, expect, test } from "vitest";
import { toolDefinitions } from "../protocol.ts";

describe("MCP protocol", () => {
  test("tool schemas require identifiers and reject additional properties", () => {
    expect(toolDefinitions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputSchema: expect.objectContaining({ additionalProperties: false, required: ["sessionId"] }),
          name: "get_session"
        }),
        expect.objectContaining({
          inputSchema: expect.objectContaining({ additionalProperties: false, required: ["query"] }),
          name: "search_sessions"
        })
      ])
    );
  });
});
