# Reset Local Data

Masthead reset operations affect Masthead-owned local data only. They must not delete Codex history, Git repositories, source files, browser state, shell history, or external services.

## Inspect the Active Store

```bash
npm run doctor
curl "http://127.0.0.1:17373/data/summary"
```

Use the database ID from `/health` or `/data/summary` when a destructive UI flow asks for confirmation.

## Apply Default Retention

```bash
curl -X POST http://127.0.0.1:17373/data/retention/default
```

Default retention prunes Masthead-managed local records according to the built-in policy and reports `touchedExternalState: false`.

## Delete a Scope

Project scope:

```bash
curl -X POST http://127.0.0.1:17373/data/delete \
  -H "content-type: application/json" \
  -d '{"scope":{"kind":"project","project":"Masthead"}}'
```

Session scope:

```bash
curl -X POST http://127.0.0.1:17373/data/delete \
  -H "content-type: application/json" \
  -d '{"scope":{"kind":"session","sessionId":"SESSION_ID"}}'
```

All Masthead-owned data:

```bash
curl -X POST http://127.0.0.1:17373/data/delete \
  -H "content-type: application/json" \
  -d '{"scope":{"kind":"all"}}'
```

## Full Development Reset

Stop the daemon, then remove the development data directory if you intentionally want a blank local store:

```bash
rm -rf ~/.local/share/masthead-dev
```

Do this only for disposable development data.
