# Masthead Connection Baseline

Captured on 2026-06-25 from `/home/tyler/.codex/worktrees/9632/Masthead`.

Command:

```bash
npm run probe:local
```

Exit status: `1`

The local daemon at `http://127.0.0.1:17373` responds to legacy live endpoints but does not expose Masthead protocol identity or the current required product endpoints. This is a protocol mismatch, not an empty-data state.

```text
> masthead@0.1.0 probe:local
> node scripts/masthead-endpoint-matrix.js http://127.0.0.1:17373

Health fingerprint
apiVersion: legacy/unknown
schemaVersion: legacy/unknown
buildVersion: legacy/unknown
buildSha: legacy/unknown
capabilities: legacy/unknown
databasePath: /home/tyler/Documents/Masthead/.masthead/masthead.sqlite
daemonInstanceId: legacy/unknown

METHOD  PATH                   STATUS  CONTENT-TYPE  CONTRACT
GET     /health                200     json          legacy
GET     /projection            200     json          present
GET     /events                200     json          present
GET     /sources               200     json          present
GET     /adapters              404     json          missing
GET     /sessions              404     json          missing
GET     /logbook/summary       404     json          missing
GET     /mcp/status            404     json          missing
GET     /mcp/tools             404     json          missing
GET     /mcp/audit             404     json          missing
GET     /settings              404     json          missing
GET     /settings/hooks/codex  404     json          missing
GET     /data/summary          404     json          missing
```
