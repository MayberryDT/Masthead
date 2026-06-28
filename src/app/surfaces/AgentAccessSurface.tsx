import { useCallback, useEffect, useState } from "react";
import { getMcpStatus, listMcpAudit, listMcpTools, type McpAuditRowDto, type McpStatusDto, type McpToolDto } from "../daemonClient";
import {
  getMcpLaunchConfig,
  testMcpConnection,
  validateMcpLaunchConfig,
  type McpLaunchConfigDto,
  type McpLaunchValidationDto,
  type McpTestConnectionDto
} from "../mcpLaunchClient";
import { useMastheadConnection } from "../connection/useMastheadConnection";
import { AgentAccessPanel } from "../../ui/AgentAccessPanel";

export function AgentAccessSurface() {
  const [status, setStatus] = useState<McpStatusDto | undefined>();
  const [tools, setTools] = useState<McpToolDto[]>([]);
  const [audit, setAudit] = useState<McpAuditRowDto[]>([]);
  const [launchConfig, setLaunchConfig] = useState<McpLaunchConfigDto | undefined>();
  const [launchValidation, setLaunchValidation] = useState<McpLaunchValidationDto | undefined>();
  const [launchValidationError, setLaunchValidationError] = useState<string | undefined>();
  const [testConnectionResult, setTestConnectionResult] = useState<McpTestConnectionDto | undefined>();
  const [testConnectionState, setTestConnectionState] = useState<"idle" | "testing" | "passed" | "failed">("idle");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>();
  const connection = useMastheadConnection();

  const loadMcpState = useCallback((signal?: AbortSignal) => {
    setLoadState((current) => (current === "ready" ? current : "loading"));
    void (async () => {
      try {
        const [nextStatus, nextLaunchConfig, nextTools, nextAudit] = await Promise.all([
          getMcpStatus(connection.baseUrl, { signal }),
          getMcpLaunchConfig(connection.baseUrl, { signal }),
          listMcpTools(connection.baseUrl, { signal }),
          listMcpAudit(connection.baseUrl, { limit: 50, signal })
        ]);

        let nextValidation: McpLaunchValidationDto | undefined;
        let nextValidationError: string | undefined;
        try {
          nextValidation = await validateMcpLaunchConfig(nextLaunchConfig, connection.baseUrl, { signal });
        } catch (validationError: unknown) {
          if (signal?.aborted) return;
          nextValidationError = validationError instanceof Error ? validationError.message : String(validationError);
        }

        if (signal?.aborted) return;
        setStatus(nextStatus);
        setLaunchConfig(nextLaunchConfig);
        setLaunchValidation(nextValidation);
        setLaunchValidationError(nextValidationError);
        setTools(nextTools);
        setAudit(nextAudit);
        setError(undefined);
        setLoadState("ready");
      } catch (nextError: unknown) {
        if (signal?.aborted) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoadState("error");
      }
    })();
  }, [connection.baseUrl]);
  const runTestConnection = useCallback(async () => {
    setTestConnectionState("testing");
    setTestConnectionResult(undefined);
    try {
      const result = await testMcpConnection(connection.baseUrl);
      setTestConnectionResult(result);
      setTestConnectionState(result.status === "passed" ? "passed" : "failed");
      if (result.status === "passed") loadMcpState();
      return result;
    } catch (testError: unknown) {
      const result: McpTestConnectionDto = {
        message: testError instanceof Error ? testError.message : String(testError),
        status: "failed"
      };
      setTestConnectionResult(result);
      setTestConnectionState("failed");
      return result;
    }
  }, [connection.baseUrl, loadMcpState]);

  useEffect(() => {
    const controller = new AbortController();
    loadMcpState(controller.signal);
    return () => controller.abort();
  }, [loadMcpState]);

  return (
    <section className="app-surface agent-access-surface surface-panel" aria-label="Agent Access">
      <AgentAccessPanel
        audit={audit}
        error={error}
        launchConfig={launchConfig}
        launchValidation={launchValidation}
        launchValidationError={launchValidationError}
        loadState={loadState}
        onRefresh={() => loadMcpState()}
        onTestConnection={runTestConnection}
        status={status}
        testConnectionResult={testConnectionResult}
        testConnectionState={testConnectionState}
        tools={tools}
      />
    </section>
  );
}
