# First Run: Codex Import

This tutorial proves the first Masthead vertical slice: discover Codex history, import it into local SQLite, search it in Logbook, and expose it through read-only MCP.

## 1. Install

```bash
npm install
```

## 2. Start Masthead

```bash
npm run dev
```

Leave the launcher running. It prints the UI URL and the daemon URL.

## 3. Check the Daemon

In another shell:

```bash
npm run doctor
```

The doctor should identify the Masthead daemon, database path, source status, Logbook state, and MCP tool status.

## 4. Discover Sources

Open the UI and go to Sources. Codex is the first supported adapter. If your Codex home is not the default user home, restart with:

```bash
MASTHEAD_CODEX_HOME=/path/to/home npm run dev
```

## 5. Import

Start with metadata import. Transcript import requires explicit review approval because it can contain sensitive local work history.

After import, open Logbook and search for a known project, branch, or session term.

## 6. Verify MCP

Open Agent Access and confirm the launch config points `MASTHEAD_DB_PATH` at the active `masthead.sqlite`. The MCP tools are read-only and retrieve bounded historical evidence.
