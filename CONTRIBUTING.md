# Contributing to Masthead

Masthead is a local-first, harness-neutral session data layer. Contributions should preserve that product boundary: Codex is the first supported adapter, the core model remains adapter-neutral, local SQLite is canonical, MCP is read-only for launch, and Live Now is a view over collected session data.

## Setup

```bash
npm install
npm run dev
```

## Verification

Before opening a PR, run the checks that match your change:

```bash
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml
```

For docs-only changes, at minimum run:

```bash
npm run check:product-contract
npm run verify:no-citations
```

## Local Data and Privacy

Do not commit private session history, raw transcripts, screenshots, shell history, local database files, secrets, or generated exports. Test fixtures must be sanitized and should preserve only the minimum evidence needed for the behavior under test.

## Branches and PRs

- Keep changes scoped to the behavior or documentation being changed.
- Update docs when public commands, endpoints, data paths, or product boundaries change.
- Note release-gate impact in the PR.
- Do not add write-capable MCP tools without an explicit product decision.
- Remove dev citation wrappers and ensure `VITE_MASTHEAD_DEV_CITATIONS` is not enabled.
