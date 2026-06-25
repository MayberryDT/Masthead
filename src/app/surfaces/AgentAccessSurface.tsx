import { useCallback, useEffect, useState } from "react";
import { getMcpStatus, listMcpAudit, listMcpTools, type McpAuditRowDto, type McpStatusDto, type McpToolDto } from "../daemonClient";
import { AgentAccessPanel } from "../../ui/AgentAccessPanel";

export function AgentAccessSurface() {
  const [status, setStatus] = useState<McpStatusDto | undefined>();
  const [tools, setTools] = useState<McpToolDto[]>([]);
  const [audit, setAudit] = useState<McpAuditRowDto[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>();

  const loadMcpState = useCallback((signal?: AbortSignal) => {
    setLoadState((current) => (current === "ready" ? current : "loading"));
    void Promise.all([getMcpStatus(undefined, { signal }), listMcpTools(undefined, { signal }), listMcpAudit(undefined, { limit: 50, signal })])
      .then(([nextStatus, nextTools, nextAudit]) => {
        setStatus(nextStatus);
        setTools(nextTools);
        setAudit(nextAudit);
        setError(undefined);
        setLoadState("ready");
      })
      .catch((nextError: unknown) => {
        if (signal?.aborted) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoadState("error");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadMcpState(controller.signal);
    return () => controller.abort();
  }, [loadMcpState]);

  return (
    <section className="app-surface agent-access-surface surface-panel" aria-label="Agent Access">
      <AgentAccessPanel audit={audit} error={error} loadState={loadState} onRefresh={() => loadMcpState()} status={status} tools={tools} />
    </section>
  );
}
