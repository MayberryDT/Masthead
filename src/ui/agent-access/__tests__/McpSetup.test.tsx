// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { McpStatusDto } from "../../../app/daemonClient";
import type { McpLaunchConfigDto, McpLaunchValidationDto } from "../../../app/mcpLaunchClient";
import { McpSetup } from "../McpSetup";

describe("McpSetup", () => {
  test("renders client tabs and a real stdio launch config", () => {
    const html = renderToStaticMarkup(<McpSetup launchConfig={launchConfig} status={status} validation={validLaunchConfig} />);

    expect(html).toContain("Codex");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Cursor");
    expect(html).toContain("Generic stdio");
    expect(html).toContain("MASTHEAD_DB_PATH");
    expect(html).toContain("/Users/tyler/Library/Application Support/Masthead/masthead.sqlite");
    expect(html).toContain("Copy configuration");
    expect(html).toContain("Test connection");
    expect(html).toContain("Launch config valid");
    expect(html).not.toContain("npm run mcp");
  });

  test("disables copy and shows launch config problems when validation fails", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <McpSetup
          launchConfig={launchConfig}
          status={status}
          validation={{
            commandExists: false,
            databaseMatches: false,
            entryExists: true,
            expectedDatabasePath: status.databasePath,
            problems: ["Configured command does not exist."],
            valid: false
          }}
        />
      );
    });

    expect(buttonByText(container, "Copy configuration").disabled).toBe(true);
    expect(container.textContent).toContain("Configured command does not exist.");
    expect(container.textContent).toContain("MASTHEAD_DB_PATH points at");

    await act(async () => root.unmount());
  });

  test("shows successful test connection evidence", async () => {
    const onTestConnection = vi.fn().mockResolvedValue({
      message: "MCP server returned coverage metadata.",
      output: "get_masthead_coverage ok",
      status: "passed",
      toolCount: 6
    });
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <McpSetup launchConfig={launchConfig} onTestConnection={onTestConnection} status={status} validation={validLaunchConfig} />
      );
    });

    await act(async () => {
      buttonByText(container, "Test connection").click();
    });

    expect(onTestConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connection passed");
    expect(container.textContent).toContain("MCP server returned coverage metadata.");
    expect(container.textContent).toContain("get_masthead_coverage ok");

    await act(async () => root.unmount());
  });

  test("shows failed test connection evidence", async () => {
    const onTestConnection = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <McpSetup launchConfig={launchConfig} onTestConnection={onTestConnection} status={status} validation={validLaunchConfig} />
      );
    });

    await act(async () => {
      buttonByText(container, "Test connection").click();
    });

    expect(onTestConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connection failed");
    expect(container.textContent).toContain("spawn ENOENT");

    await act(async () => root.unmount());
  });
});

const status: McpStatusDto = {
  databasePath: "/Users/tyler/Library/Application Support/Masthead/masthead.sqlite",
  globalAccessEnabled: true,
  lastQueryAt: "2026-06-25T12:00:00.000Z",
  mode: "stdio",
  queryCount: 24,
  readOnly: true,
  ready: true,
  toolCount: 6
};

const launchConfig: McpLaunchConfigDto = {
  args: ["/Applications/Masthead.app/Contents/Resources/daemon/dist/src/mcp/server.js"],
  command: "/Applications/Masthead.app/Contents/Resources/daemon/node",
  env: {
    MASTHEAD_DB_PATH: "/Users/tyler/Library/Application Support/Masthead/masthead.sqlite"
  }
};

const validLaunchConfig: McpLaunchValidationDto = {
  commandExists: true,
  databaseMatches: true,
  entryExists: true,
  problems: [],
  valid: true
};

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}
