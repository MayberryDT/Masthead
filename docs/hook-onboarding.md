# Masthead Hook Onboarding

Masthead uses Codex lifecycle hooks for passive observation. Hook installation is an explicit admin action and should target Codex `hooks.json`, not `config.toml`.

Codex supports hooks from `~/.codex/hooks.json` and inline `[hooks]` tables in `~/.codex/config.toml`. The Masthead admin tool writes `hooks.json` because Codex warns when one layer contains both representations.

After installing a non-managed hook, open `/hooks` in Codex to review and trust the hook definition before expecting it to run.

## Start the Live Local App

From the Masthead repo:

```bash
npm run dev
```

This is the harness-neutral launcher for both the primary checkout and secondary worktrees. It starts a connector and a Vite UI when the primary port is free. If a healthy primary connector is already running, it starts a read-only worktree bridge instead and points the new UI at that bridge.

Open the URL printed by the launcher, usually:

```text
http://127.0.0.1:5173
```

Defaults:

- Host: `127.0.0.1`
- Port: `17373`
- Ingest URL: `http://127.0.0.1:17373/ingest`
- Projection URL: `http://127.0.0.1:17373/projection`
- Health URL: `http://127.0.0.1:17373/health`
- UI URL: `http://127.0.0.1:5173`
- Local event store: `.masthead/events.ndjson`

Secondary worktree behavior:

- UI port: first available port starting at `5173`
- Bridge port: first available port starting at `17374`
- Upstream connector: `http://127.0.0.1:17373`
- Bridge projection URL: `http://127.0.0.1:<bridge-port>/projection`
- Read-only endpoints: `/health`, `/projection`, `/events`, `/fixture`

Do not manually point a secondary worktree UI directly at `http://127.0.0.1:17373/projection`. The primary connector generally only allows the primary UI origin, so secondary UIs should go through the launcher-created bridge.

Run the readiness check with:

```bash
npm run doctor
```

Fixture replay is explicit demo mode:

```bash
npm run dev:fixture
```

Override the collector listener with:

```bash
MASTHEAD_HOST=127.0.0.1 MASTHEAD_PORT=17374 npm run ingest
```

Force launcher modes with:

```bash
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
MASTHEAD_UI_PORT=5180 npm run dev
```

## Preview the User-Level Hook Config

Preview does not write files:

```bash
node scripts/masthead-hook-admin.js preview \
  --config ~/.codex/hooks.json
```

Masthead installs matcher groups for:

- `SessionStart`
- `PermissionRequest`
- `PostToolUse`
- `Stop`

Each group contains a documented Codex command hook:

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest MASTHEAD_HOOK_TIMEOUT_MS=750 node /home/tyler/Documents/Masthead/scripts/masthead-hook.js",
      "timeout": 1
    }
  ]
}
```

The hook helper:

- Reads the Codex hook payload from stdin.
- Rejects malformed or oversized payloads before posting.
- Redacts common secrets before leaving the hook process.
- Posts the redacted payload to the loopback ingest server.
- Uses a short timeout.
- Exits `0` even when Masthead is offline or the post fails.
- Avoids normal stdout.

## Install

Install into the user-level Codex hook file:

```bash
node scripts/masthead-hook-admin.js install \
  --config ~/.codex/hooks.json
```

The install command creates `~/.codex/hooks.json` if it does not exist. If the file exists, it creates a sibling backup before writing. Existing non-Masthead hook groups remain in place, and existing Masthead handlers are not duplicated.

Then open `/hooks` in Codex, review the Masthead hook entries, and trust them.

## Verify

```bash
node scripts/masthead-hook-admin.js verify --config ~/.codex/hooks.json
```

Verification exits `0` when all Masthead hook events are present. It exits non-zero and prints missing event names when entries are incomplete.

This verifies file configuration only. It does not prove Codex has trusted the hook or that real events have reached Masthead. For that, run `npm run doctor` while the live app is running, then create a real Codex session and confirm it appears in the board.

## Disable or Uninstall

Disable and uninstall both remove only command handlers whose command includes `masthead-hook.js`:

```bash
node scripts/masthead-hook-admin.js disable --config ~/.codex/hooks.json
node scripts/masthead-hook-admin.js uninstall --config ~/.codex/hooks.json
```

Other hook entries remain untouched.

## Rollback

Rollback restores the latest sibling Masthead backup for the same config path. It first backs up the current config, then restores the latest prior backup:

```bash
node scripts/masthead-hook-admin.js rollback --config ~/.codex/hooks.json
```

Stop any running `scripts/masthead-ingest-server.js` process when you want no local Masthead hook traffic at all.

The hook helper is fail-open, so an unavailable Masthead server should not interrupt Codex sessions. Uninstalling is still the right choice when you want no local hook traffic at all.
