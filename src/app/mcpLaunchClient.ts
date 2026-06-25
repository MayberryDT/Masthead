import { defaultLiveProjectionUrl } from "./liveProjectionClient";

export type McpLaunchConfigDto = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type McpLaunchValidationDto = {
  valid: boolean;
  commandExists: boolean;
  entryExists: boolean;
  databaseMatches: boolean;
  problems: string[];
  commandPath?: string;
  entryPath?: string;
  configuredDatabasePath?: string;
  expectedDatabasePath?: string;
};

export type McpTestConnectionDto = {
  status: "passed" | "failed";
  message: string;
  testedAt?: string;
  toolCount?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  problems?: string[];
};

export async function getMcpLaunchConfig(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<McpLaunchConfigDto> {
  const url = mcpUrl(baseUrl, "/mcp/launch-config");
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`MCP launch config request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; launchConfig: McpLaunchConfigDto };
  return body.launchConfig;
}

export async function validateMcpLaunchConfig(
  launchConfig: McpLaunchConfigDto,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<McpLaunchValidationDto> {
  const url = mcpUrl(baseUrl, "/mcp/launch-config/validate");
  const response = await fetch(url.toString(), {
    body: JSON.stringify({ launchConfig }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal: options.signal
  });
  if (!response.ok) throw new Error(`MCP launch config validation failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; validation?: McpLaunchValidationDto; result?: McpLaunchValidationDto };
  const validation = body.validation ?? body.result;
  if (!validation) throw new Error("MCP launch config validation response was missing validation data.");
  return validation;
}

export async function testMcpConnection(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<McpTestConnectionDto> {
  const url = mcpUrl(baseUrl, "/mcp/test-connection");
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, method: "POST", signal: options.signal });
  if (!response.ok) throw new Error(`MCP test connection failed: ${response.status}`);
  const body = (await response.json()) as {
    ok: true;
    connection?: McpTestConnectionDto;
    result?: McpTestConnectionDto;
    test?: McpTestConnectionDto;
  };
  const result = body.test ?? body.connection ?? body.result;
  if (!result) throw new Error("MCP test connection response was missing result data.");
  return result;
}

function mcpUrl(baseUrl: string, pathname: string): URL {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  return url;
}
