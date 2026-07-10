# Import Codex history

Masthead can materialize existing Codex history into its canonical local session database. Imported sessions enter Workbench; they do not become Logbook rows. Logbook contains only artifacts published from Workbench.

## Start Masthead

```bash
npm run dev
```

For a non-default Codex home:

```bash
MASTHEAD_CODEX_HOME=/path/to/home npm run dev
```

Use the Sources surface to **Discover**, **Enable**, activate, and test the Codex live connector. That flow configures future live capture. It does not bulk-import transcript history.

## Import session metadata

Existing-history import is a daemon operation. Ask the writable primary daemon to queue Codex metadata import:

```bash
curl -X POST http://127.0.0.1:17373/adapters/codex/import-metadata
```

Metadata import creates canonical session records without importing transcript bodies. Check the returned job and the import list:

```bash
curl http://127.0.0.1:17373/imports
curl http://127.0.0.1:17373/imports/<importJobId>
curl http://127.0.0.1:17373/imports/<importJobId>/units
curl http://127.0.0.1:17373/imports/<importJobId>/report
```

## Deepen selected sessions in Workbench

Open Workbench after metadata import. Select the sessions you want to deepen, then use **Check Transcript** and **Import Transcript**. Transcript import is per session and requires the exact linked source to have source-scoped permission. Masthead does not grant or bypass that permission automatically.

The Workbench UI calls these supported primary-daemon operations:

```bash
curl -X POST \
  http://127.0.0.1:17373/workbench/sessions/session%3Aabc/check-transcript

curl -X POST \
  -H 'content-type: application/json' \
  --data '{"sourceId":"source:abc"}' \
  http://127.0.0.1:17373/workbench/sessions/session%3Aabc/import-transcript-preview

curl -X POST \
  -H 'content-type: application/json' \
  --data '{"sourceId":"source:abc"}' \
  http://127.0.0.1:17373/workbench/sessions/session%3Aabc/import-transcript
```

URL-encode the session id in the path. Preview checks that the requested source is linked and permitted; import queues the transcript job only when that check passes. These writes are intentionally unavailable through a read-only worktree bridge.

For artifact authoring, copy the plain-language handoff from Workbench or direct your agent to the selected Workbench sessions. The installed CLI is a daemon HTTP adapter; normal authoring never opens SQLite directly.

After automatic authoring finishes, search the published artifacts in Logbook. Use `/sessions` only for session evidence and Workbench inspection, not as a Logbook listing.
