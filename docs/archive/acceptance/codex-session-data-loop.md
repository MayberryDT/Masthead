# Codex Session Data Loop Acceptance

The release is accepted only when a user can complete this loop:

```text
Install Masthead
-> detect existing Codex history
-> review detected sources
-> import metadata
-> see sessions in Logbook
-> import transcripts
-> receive persisted enrichment
-> search by concept/file/project/model
-> connect Codex through MCP
-> retrieve a prior session with evidence
-> run a new Codex session
-> see it appear in Now and later in Logbook
-> restart Masthead without losing or duplicating data
```

Automated gates:

- `npm run check:product-contract`
- `npm run smoke:import`
- `npm run smoke:mcp`
- `npm run verify`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Manual sign-off should record the detected source path, imported session count, Logbook query, MCP query, and restart duplicate count.
