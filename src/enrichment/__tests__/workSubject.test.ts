import { describe, expect, test } from "vitest";
import { classifyWorkSubject } from "../workSubject.ts";

describe("work subject classification", () => {
  test("does not classify Sources from Codex runtime text alone", () => {
    expect(classifyWorkSubject({ texts: ["codex"] })).not.toMatchObject({ area: "Sources" });
  });

  test("classifies transcript import as Sources", () => {
    expect(classifyWorkSubject({ texts: ["Codex transcript import finished"] })).toMatchObject({
      area: "Sources"
    });
  });

  test("keeps MCP tools list classification", () => {
    expect(classifyWorkSubject({ texts: ["MCP tools list validation"] })).toMatchObject({
      area: "MCP"
    });
  });

  test("does not classify generic tool work as MCP", () => {
    expect(classifyWorkSubject({ texts: ["Tool output cleanup for live cards"] })).not.toMatchObject({
      area: "MCP"
    });
  });
});
