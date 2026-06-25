export function AgentAccessSurface() {
  return (
    <section className="app-surface agent-access-surface surface-panel" aria-label="Agent Access">
      <header className="surface-panel-head metal-surface">
        <div>
          <p className="mono-label">Agent Access</p>
          <h1>Read-only session retrieval</h1>
        </div>
        <strong className="surface-count">MCP</strong>
      </header>
      <div className="empty-session-state surface-empty-state">
        <p className="mono-label">Local MCP</p>
        <h2>Connected agents can retrieve session history</h2>
        <p>Masthead exposes indexed sessions, excerpts, and source-backed evidence through read-only MCP tools.</p>
      </div>
    </section>
  );
}
