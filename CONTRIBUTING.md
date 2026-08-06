# Contributing to Masthead

Thank you for considering a contribution. Masthead is a **local-first, harness-neutral session data layer**. Changes should preserve that product boundary:

- Sessions are capture / Workbench units; **Logbook is published artifacts only**.
- Live Now is a shallow view over collected data, not the product category.
- MCP is **read-only** for the launch surface.
- Local SQLite is canonical; harness files remain owned by their tools.

Read [README.md](README.md), [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md), and [openwiki/quickstart.md](openwiki/quickstart.md) before large changes. UI work should follow [design.md](design.md).

## Setup

```bash
npm install
npm run dev
```

Node `>= 24.15.0` is required (`package.json` `engines`).

## Verification

Before opening a PR, run the checks that match your change:

```bash
npm run verify
npm run test:electron
npm run test:electron-security
```

For desktop packaging or launcher changes:

```bash
npm run smoke:electron
npm run smoke:electron:packaged
```

For docs-only changes, at minimum:

```bash
npm run check:product-contract
npm run verify:no-citations
```

## Local data and privacy

Do **not** commit:

- Private session history, raw transcripts, or screenshots of personal work
- Shell history, local databases (`masthead.sqlite*`), or `.env.local`
- Secrets, API keys, auth tokens, or generated authoring pack dumps (`authoring-v5-pack:*`)
- Unredacted absolute paths to private machines or cloud rental accounts in new docs

Test fixtures must be sanitized and should keep only the minimum evidence needed for the behavior under test.

## Branches and PRs

- Keep changes scoped to the behavior or documentation being changed.
- Update docs when public commands, endpoints, data paths, or product boundaries change.
- Note release-gate impact in the PR when relevant.
- Do not add write-capable MCP tools without an explicit product decision.
- Remove dev citation wrappers and ensure `VITE_MASTHEAD_DEV_CITATIONS` is not left enabled.
- Prefer clear commit messages and a PR description that states what changed and how it was verified.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security issues

Do not file public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
