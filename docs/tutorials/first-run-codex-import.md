# First Run: Codex Capture to Artifact

This tutorial proves the first complete Masthead knowledge loop: capture or import Codex history,
prepare a useful session in Workbench, publish an evidence-backed artifact, find it in Logbook, and
retrieve it through read-only MCP.

## 1. Install

```bash
npm install
```

## 2. Start Masthead

```bash
npm run dev
```

Leave the launcher running. It prints the UI URL and daemon URL. If another compatible primary
daemon is already running, the launcher may use a read-only worktree bridge.

## 3. Check the daemon

In another shell:

```bash
npm run doctor
```

Doctor should identify the Masthead daemon, database path, source/connector status, Workbench and
Logbook state, and MCP tool status.

## 4. Connect Codex

Open Sources and find Codex. Follow the connector flow:

```text
Discover -> Enable -> Activate -> Test -> Ready
```

Codex command hooks must be reviewed and trusted in Codex after installation. If your Codex home is
not the default user home, restart Masthead with:

```bash
MASTHEAD_CODEX_HOME=/path/to/home npm run dev
```

Sources owns live connection. Existing-history import and per-session transcript work are separate
from this connector flow.

## 5. Capture or import a session

Use Codex normally to create live session evidence, or import existing Codex metadata as described
in [Import Codex history](../how-to/import-codex-history.md). Captured/imported records enter the
canonical session database. They do not become Logbook rows.

## 6. Prepare the session in Workbench

Open Workbench and enroll missing captured sessions if needed. Select a useful session, check its
transcript, run the quality precheck, and import transcript evidence only when exact source-scoped
permission exists.

Use **Copy Agent Prompt** to create a disposable handoff for your coding agent. The handoff asks the
agent to complete the session package and attempt runbook, ADR, and incident timeline when evidence
supports them. Unsupported kinds are recorded as N/A.

## 7. Publish artifacts

The agent validates and applies each output with `mastheadctl`, then publishes each valid artifact.
Apply is not publish. The session is automatically resolved only when the session package is
published and each optional automatic kind is published, N/A, or satisfied by contribution to an
existing multi-session artifact.

## 8. Verify Logbook and MCP

Open Logbook and search for the artifact title, project, or kind. Every result is a published
artifact capsule; opening it shows the artifact body and provenance.

Open Settings -> Agent access and confirm the launch config points `MASTHEAD_DB_PATH` at the active
`masthead.sqlite`. From an MCP-connected agent, prefer:

- `search_artifacts` to find published knowledge,
- `get_artifact` to open the body, provenance, join rationale, and evidence refs.

Session and transcript MCP tools remain available when the agent needs bounded compile evidence.
