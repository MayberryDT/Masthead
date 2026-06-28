# Agent Access MCP Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Agent Access into a calm MCP setup, permission, proof, and audit surface where the success moment is Codex using Masthead context.

**Architecture:** Keep existing MCP status, launch config, tools, and audit data. Reorder the UI around four questions: can agents read Masthead, how do I connect one, what can it read, and has it actually used Masthead. Make tools and audit visible as supporting proof, not the first impression.

**Tech Stack:** React 19, TypeScript, Vitest, happy-dom, MCP DTOs from `src/app/daemonClient.ts` and `src/app/mcpLaunchClient.ts`, CSS in `src/styles/agent-access.css`.

---

## Context

- Product decision source: GBrain slug `decisions/masthead-surface-redesign-direction`.
- The first successful MCP moment is Codex answering a project question using Masthead context.
- A green status badge alone is not enough proof.
- The top command row should not exist just to hold Refresh.
- Optimization pass: separate automated launch verification from the actual MCP proof. Component tests can prove the UI guides the user correctly; only a real Codex query plus an audit row proves Agent Access is working end to end.

## File Structure

- Modify: `src/ui/AgentAccessPanel.tsx`
  - Owns the surface order and overall status.
- Modify: `src/ui/agent-access/McpSetup.tsx`
  - Owns Codex-first setup and test connection copy.
- Modify: `src/ui/agent-access/McpPermissions.tsx`
  - Owns plain-English read boundary.
- Modify: `src/ui/agent-access/McpToolsTable.tsx`
  - Remains a supporting details table.
- Modify: `src/ui/agent-access/McpAuditTable.tsx`
  - Remains proof after real usage.
- Modify: `src/styles/agent-access.css`
  - Owns hierarchy and removal of the heavy command row.
- Modify: `src/ui/__tests__/agentAccessPanel.test.tsx`
  - Covers the panel contract.
- Modify: `src/ui/agent-access/__tests__/McpSetup.test.tsx`
  - Covers setup behavior and copy.

### Task 1: Replace The Command Row With A Status Header

**Files:**
- Modify: `src/ui/AgentAccessPanel.tsx`
- Modify: `src/ui/__tests__/agentAccessPanel.test.tsx`
- Modify: `src/styles/agent-access.css`

- [ ] **Step 1: Update panel test assertions**

In `src/ui/__tests__/agentAccessPanel.test.tsx`, replace command-row expectations with:

```tsx
expect(html).toContain("Can agents read Masthead?");
expect(html).toContain("Read-only MCP access is enabled");
expect(html).toContain("Refresh status");
expect(html).not.toContain("agent-access-command-row");
expect(html).not.toContain("MCP status");
```

- [ ] **Step 2: Run the panel test and verify failure**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: FAIL because `AgentAccessPanel` still renders `agent-access-command-row` and `StatStrip`.

- [ ] **Step 3: Add a status summary helper**

In `src/ui/AgentAccessPanel.tsx`, add:

```tsx
function accessSummary(status: McpStatusDto): string {
  if (!status.ready) return "MCP server is unavailable";
  if (!status.globalAccessEnabled) return "Read-only MCP access is disabled";
  if (!status.readOnly) return "MCP is running with write access, which Masthead should not expose";
  return "Read-only MCP access is enabled";
}
```

- [ ] **Step 4: Replace the command row and StatStrip with a compact header**

Remove the `StatStrip` import and replace the command row plus `StatStrip` with:

```tsx
<header className="agent-access-overview">
  <div>
    <p className="mono-label">Agent Access</p>
    <h2>Can agents read Masthead?</h2>
    <p>{accessSummary(status)}</p>
  </div>
  <div className="agent-access-overview-actions">
    <StatusBadge tone={status.ready && status.globalAccessEnabled && status.readOnly ? "active" : "warning"}>
      {status.ready ? "MCP ready" : "MCP unavailable"}
    </StatusBadge>
    {onRefresh ? (
      <AppButton onClick={onRefresh} variant="quiet">
        Refresh status
      </AppButton>
    ) : null}
  </div>
</header>
```

- [ ] **Step 5: Add overview CSS**

In `src/styles/agent-access.css`, replace `.agent-access-command-row` with:

```css
.agent-access-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  min-width: 0;
  border: 1px solid rgba(92, 153, 187, 0.15);
  border-radius: 5px;
  background: var(--toolbar-bg);
  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.24),
    0 6px 14px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(190, 225, 245, 0.042),
    inset 0 -1px 0 rgba(0, 0, 0, 0.48);
  padding: 12px;
}

.agent-access-overview h2 {
  margin: 2px 0 4px;
  color: var(--ink);
  font-size: 17px;
  line-height: 1.2;
}

.agent-access-overview p {
  margin: 0;
  color: var(--body);
  font-size: 13px;
}

.agent-access-overview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 6: Run the panel test**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/AgentAccessPanel.tsx src/styles/agent-access.css src/ui/__tests__/agentAccessPanel.test.tsx
git commit -m "feat: simplify agent access overview"
```

### Task 2: Make Setup Codex-First And Proof-Oriented

**Files:**
- Modify: `src/ui/agent-access/McpSetup.tsx`
- Modify: `src/ui/agent-access/__tests__/McpSetup.test.tsx`

- [ ] **Step 1: Add setup proof expectations**

In `src/ui/agent-access/__tests__/McpSetup.test.tsx`, add or update a render test with:

```tsx
expect(html).toContain("Connect Codex to Masthead");
expect(html).toContain("Copy Codex configuration");
expect(html).toContain("Test MCP launch");
expect(html).toContain("Proof step");
expect(html).toContain("Ask Codex: check Masthead for information on this project.");
expect(html.indexOf("Codex")).toBeLessThan(html.indexOf("Other MCP clients"));
```

- [ ] **Step 2: Run setup test and verify failure**

Run:

```bash
npm test -- --run src/ui/agent-access/__tests__/McpSetup.test.tsx
```

Expected: FAIL because the current setup panel is a generic client tab UI.

- [ ] **Step 3: Keep client tabs but make Codex the dominant section**

In `McpSetup.tsx`, change the section heading:

```tsx
<p className="mono-label">Set up a client</p>
<h2 id="mcp-setup-title">Connect Codex to Masthead</h2>
```

Add this proof copy below the heading:

```tsx
<p className="agent-access-setup-copy">
  Start with Codex. Once the launch test passes, ask Codex to check Masthead for information on this project and confirm the answer uses Masthead context.
</p>
```

Limit the visible tabs to Codex first, with the other client options still available in a compact advanced disclosure. The other labels may still exist in the HTML because the disclosure content is rendered; the hierarchy is what matters.

```tsx
const primaryClients = clients.filter((client) => client.id === "codex");
const secondaryClients = clients.filter((client) => client.id !== "codex");
```

Render primary buttons first and secondary buttons inside:

```tsx
<details className="agent-access-secondary-clients">
  <summary>Other MCP clients</summary>
  <div className="agent-access-tabs" role="tablist" aria-label="Other MCP client configuration">
    {secondaryClients.map((client) => (
      <AppButton
        aria-pressed={client.id === selectedClient}
        className={client.id === selectedClient ? "agent-access-tab-active" : ""}
        key={client.id}
        onClick={() => setSelectedClient(client.id)}
        variant={client.id === selectedClient ? "primary" : "quiet"}
      >
        {client.label}
      </AppButton>
    ))}
  </div>
</details>
```

- [ ] **Step 4: Rename setup actions**

Change:

```tsx
Copy configuration
```

to:

```tsx
Copy Codex configuration
```

when `selectedClient === "codex"`, using:

```tsx
{selectedClient === "codex" ? "Copy Codex configuration" : "Copy configuration"}
```

Change:

```tsx
Test connection
```

to:

```tsx
Test MCP launch
```

- [ ] **Step 5: Add proof step copy**

After `TestConnectionEvidence`, add:

```tsx
<div className="agent-access-proof-step">
  <p className="mono-label">Proof step</p>
  <p>Ask Codex: check Masthead for information on this project.</p>
  <p>Then confirm the answer includes Masthead session context and the audit table records the query.</p>
</div>
```

- [ ] **Step 6: Run setup test**

Run:

```bash
npm test -- --run src/ui/agent-access/__tests__/McpSetup.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/agent-access/McpSetup.tsx src/ui/agent-access/__tests__/McpSetup.test.tsx
git commit -m "feat: make mcp setup codex-first"
```

### Task 3: Reorder Supporting Sections Around Permissions And Proof

**Files:**
- Modify: `src/ui/AgentAccessPanel.tsx`
- Modify: `src/ui/agent-access/McpPermissions.tsx`
- Modify: `src/styles/agent-access.css`
- Modify: `src/ui/__tests__/agentAccessPanel.test.tsx`

- [ ] **Step 1: Update panel ordering assertions**

In `agentAccessPanel.test.tsx`, add:

```tsx
expect(html.indexOf("Connect Codex to Masthead")).toBeLessThan(html.indexOf("Read-only access boundary"));
expect(html.indexOf("Read-only access boundary")).toBeLessThan(html.indexOf("Available MCP tools"));
expect(html.indexOf("Available MCP tools")).toBeLessThan(html.indexOf("MCP query audit"));
```

- [ ] **Step 2: Run the panel test**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: FAIL until permissions heading changes.

- [ ] **Step 3: Rename the permissions section**

In `McpPermissions.tsx`, change:

```tsx
<h2 id="mcp-permissions-title">Read-only access policy</h2>
```

to:

```tsx
<h2 id="mcp-permissions-title">Read-only access boundary</h2>
```

Change the default blocked copy to:

```tsx
const defaultBlocked = ["Execute shell commands", "Mutate files or Git", "Modify harness session files"];
```

- [ ] **Step 4: Keep layout order explicit**

In `AgentAccessPanel.tsx`, keep this order inside `.agent-access-layout`:

```tsx
<McpSetup ... />
<McpPermissions status={status} />
<McpToolsTable tools={tools} />
<McpAuditTable audit={audit} />
```

- [ ] **Step 5: Run panel test**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/AgentAccessPanel.tsx src/ui/agent-access/McpPermissions.tsx src/ui/__tests__/agentAccessPanel.test.tsx
git commit -m "feat: clarify agent access permissions"
```

### Task 4: Make Tool And Audit Details Feel Secondary

**Files:**
- Modify: `src/ui/agent-access/McpToolsTable.tsx`
- Modify: `src/ui/agent-access/McpAuditTable.tsx`
- Modify: `src/styles/agent-access.css`
- Modify: `src/ui/__tests__/agentAccessPanel.test.tsx`

- [ ] **Step 1: Add secondary-details assertions**

In `agentAccessPanel.test.tsx`, add:

```tsx
expect(html).toContain("agent-access-details-section");
expect(html).toContain("Available MCP tools");
expect(html).toContain("MCP query audit");
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: FAIL until details sections get the new class.

- [ ] **Step 3: Add the secondary class to tools and audit sections**

In both table components, make the root section include:

```tsx
className="agent-access-section agent-access-details-section agent-access-tools-section"
```

and:

```tsx
className="agent-access-section agent-access-details-section agent-access-audit-section"
```

- [ ] **Step 4: Add subtle details styling**

Append:

```css
.agent-access-details-section {
  background: rgba(8, 29, 43, 0.72);
}

.agent-access-details-section::before {
  opacity: 0.36;
}
```

- [ ] **Step 5: Run test**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/agent-access/McpToolsTable.tsx src/ui/agent-access/McpAuditTable.tsx src/styles/agent-access.css src/ui/__tests__/agentAccessPanel.test.tsx
git commit -m "feat: demote agent access details"
```

### Task 5: Final Agent Access Verification

**Files:**
- Verify: `src/ui/AgentAccessPanel.tsx`
- Verify: `src/ui/agent-access/*`
- Verify: `src/styles/agent-access.css`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run src/ui/__tests__/agentAccessPanel.test.tsx src/ui/agent-access/__tests__/McpSetup.test.tsx src/daemon/__tests__/mcpStatusApi.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build and MCP smoke**

Run:

```bash
npm run build
npm run smoke:mcp
```

Expected: both commands exit 0.

- [ ] **Step 3: Browser verification**

Run:

```bash
npm run dev
```

Open Agent Access with the Codex in-app Browser. Verify:

- Top row reads as a status explanation, not a toolbar for Refresh.
- Codex is the default setup path.
- Copy configuration is visible only when validation is valid.
- Test MCP launch shows human-readable evidence.
- Permissions are plain English and read-only.
- Tools and audit are lower-priority support sections.
- At 390px width, config text wraps and buttons do not overlap.

- [ ] **Step 4: Manual MCP proof**

After `npm run mcp` or the app-managed MCP server is ready, ask Codex from a real Codex session:

```text
Check Masthead for information on this project.
```

Expected:

- Codex uses Masthead context in the answer.
- Agent Access audit shows a successful query row.
- The row includes the MCP tool name, status, result count, bounded byte count, and at least one session id when a matching session exists.
- If the proof cannot be run because MCP auth, Codex configuration, or local daemon state is unavailable, do not mark this plan complete. Record the blocker and the exact missing prerequisite.

- [ ] **Step 5: Add a short manual proof note to the PR or handoff**

Use this template:

```text
MCP proof:
- Prompt: "Check Masthead for information on this project."
- Result: [passed/failed/blocked]
- Tool observed in audit: [tool name]
- Query status: [status]
- Session ids returned: [count or none]
- Notes: [only the relevant detail]
```

- [ ] **Step 6: Commit verification fixes**

```bash
git add src/ui/AgentAccessPanel.tsx src/ui/agent-access src/styles/agent-access.css
git commit -m "fix: verify agent access proof flow"
```
