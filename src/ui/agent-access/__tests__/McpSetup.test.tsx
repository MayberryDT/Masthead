import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { McpStatusDto } from "../../../app/daemonClient";
import { McpSetup } from "../McpSetup";

describe("McpSetup", () => {
  test("renders client tabs and a real stdio launch config", () => {
    const status: McpStatusDto = {
      databasePath: "/Users/tyler/Library/Application Support/Masthead/masthead.sqlite",
      globalAccessEnabled: true,
      lastQueryAt: "2026-06-25T12:00:00.000Z",
      launchConfig: {
        args: ["/Applications/Masthead.app/Contents/Resources/daemon/dist/src/mcp/server.js"],
        command: "/Applications/Masthead.app/Contents/Resources/daemon/node",
        env: {
          MASTHEAD_DB_PATH: "/Users/tyler/Library/Application Support/Masthead/masthead.sqlite"
        }
      },
      mode: "stdio",
      queryCount: 24,
      readOnly: true,
      ready: true,
      toolCount: 6
    };

    const html = renderToStaticMarkup(<McpSetup status={status} />);

    expect(html).toContain("Codex");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Cursor");
    expect(html).toContain("Generic stdio");
    expect(html).toContain("MASTHEAD_DB_PATH");
    expect(html).toContain("/Users/tyler/Library/Application Support/Masthead/masthead.sqlite");
    expect(html).toContain("Copy configuration");
    expect(html).toContain("Test connection");
    expect(html).not.toContain("npm run mcp");
  });
});
