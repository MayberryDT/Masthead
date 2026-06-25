import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentAccessPanel } from "../AgentAccessPanel";

describe("AgentAccessPanel", () => {
  test("shows setup, read-only guarantees, tools, exclusions, and audit state", () => {
    const html = renderToStaticMarkup(<AgentAccessPanel />);

    expect(html).toContain("npm run mcp");
    expect(html).toContain("Local-only and read-only");
    expect(html).toContain("search_sessions");
    expect(html).toContain("get_session_excerpt");
    expect(html).toContain("mcp_query_log");
    expect(html).toContain("Excluded projects and sessions");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
  });
});
