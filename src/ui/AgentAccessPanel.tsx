const exposedTools = [
  "search_sessions",
  "get_session",
  "get_session_excerpt",
  "list_project_sessions",
  "get_project_history",
  "get_masthead_coverage"
];

export function AgentAccessPanel() {
  const command = "npm run mcp";
  return (
    <section className="agent-access-panel surface-panel" aria-label="Agent Access">
      <header className="surface-panel-head metal-surface">
        <div>
          <p className="mono-label">Agent Access</p>
          <h1>Read-only session retrieval</h1>
        </div>
        <strong className="surface-count">MCP</strong>
      </header>

      <div className="surface-card-grid">
        <article className="surface-data-card metal-surface metal-card">
          <p className="mono-label">Stdio command</p>
          <h2>Local MCP server</h2>
          <pre className="setup-snippet">{command}</pre>
          <p className="surface-status">Runs against Masthead's local SQLite session graph.</p>
        </article>
        <article className="surface-data-card metal-surface metal-card">
          <p className="mono-label">Guarantees</p>
          <h2>Local-only and read-only</h2>
          <ul className="agent-access-list">
            <li>No shell, Git, file, harness, or session mutation tools.</li>
            <li>Historical transcript text is labeled as untrusted evidence.</li>
            <li>MCP exclusions are enforced before sessions leave Masthead.</li>
          </ul>
        </article>
        <article className="surface-data-card metal-surface metal-card">
          <p className="mono-label">Tools</p>
          <h2>Exposed retrieval tools</h2>
          <ul className="agent-access-list">
            {exposedTools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        </article>
        <article className="surface-data-card metal-surface metal-card">
          <p className="mono-label">Audit</p>
          <h2>Recent MCP queries</h2>
          <p className="surface-status">Query audit rows are stored locally in `mcp_query_log`.</p>
          <p className="surface-status">Excluded projects and sessions are omitted from retrieval responses.</p>
        </article>
      </div>
    </section>
  );
}
