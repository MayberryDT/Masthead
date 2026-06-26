# Masthead Product Release Gate

## Fresh launch
- [ ] No daemon running: Masthead starts compatible daemon.
- [ ] Legacy daemon running: Masthead isolates it and starts current daemon.
- [ ] Compatible wrong-data daemon running: Masthead rejects it.
- [ ] Read-only bridge mode is visibly read-only.

## Sources
- [ ] Codex supported adapter visible.
- [ ] Missing Codex root explained.
- [ ] Detected Codex root shows source locations.
- [ ] Metadata import populates sessions.
- [ ] Transcript import populates messages/tools.

## Logbook
- [ ] Empty state explains source/import next step.
- [ ] Search returns imported sessions.
- [ ] Row inspector shows provenance.
- [ ] Restart does not duplicate sessions.

## Agent Access
- [ ] MCP config uses active database.
- [ ] Invalid config cannot be copied.
- [ ] Test connection passes.
- [ ] Query appears in audit.

## Settings
- [ ] Settings loads real state.
- [ ] Hook test round-trips.
- [ ] Open folder works in Tauri.
- [ ] Delete preview includes database ID.

## Data ownership
- [ ] SQLite is the canonical product store.
- [ ] Legacy NDJSON is migration/compatibility only and receives no new product writes.

## Verification
- [ ] npm run verify passes.
- [ ] cargo tests pass.
- [ ] npm run doctor passes.
- [ ] GitHub Actions run passes for the final commit.
