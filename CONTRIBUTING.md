# Contributing to Masthead

Thanks for taking an interest in Masthead.

Masthead is a **local-first, harness-neutral session data layer** for AI coding agents. It is **pre-1.0** and moving quickly. Contributions are welcome when they match the product boundary—and early on we are selective about pull requests so the core stays coherent.

## Product boundary

Keep these true:

- Sessions are capture / Workbench units; **Logbook is published artifacts only**.
- Live **Now** is a shallow view over collected data, not the product category.
- **MCP is read-only** for the launch surface.
- Local SQLite is canonical; harness files remain owned by their tools.
- Core use does not require a Masthead cloud account.

Read [README.md](README.md), [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md), and [openwiki/quickstart.md](openwiki/quickstart.md) before large changes. UI work follows [design.md](design.md). Domain language lives in [CONTEXT.md](CONTEXT.md).

## What we welcome

**Issues** (preferred entry point):

- Reproducible bugs with sanitized reproduction steps
- Documentation gaps and install friction reports
- Focused feature ideas that fit the session data layer / Workbench / Logbook / Sources model

**Pull requests** (limited while pre-1.0):

- Small, well-tested fixes
- Documentation and install clarity
- Narrow improvements that do not expand product category

Large features, new harness platforms, write-capable MCP tools, or redesigns should start as an **issue** (or discussion) so direction stays intentional. Maintainers may close or defer PRs that expand scope without prior alignment.

## Setup from source

```bash
npm install
npm run dev
```

Requires Node.js `>= 24.15.0` (`package.json` `engines`).

Desktop shell:

```bash
npm run install:electron-dev-launcher
npm run dev:electron
```

## Verification

Before opening a PR, run the checks that match your change:

```bash
npm run verify
```

For Electron / packaging changes, also:

```bash
npm run test:electron
npm run test:electron-security
npm run smoke:electron
```

Docs-only changes, at minimum:

```bash
npm run check:product-contract
npm run verify:no-citations
```

## Local data and privacy

Do **not** commit or paste into issues/PRs:

- Private session history, raw transcripts, or screenshots of personal work
- Local databases (`masthead.sqlite*`) or `.env` / `.env.local`
- Secrets, API keys, auth tokens, or authoring pack dumps (`authoring-v5-pack:*`)
- Unredacted absolute paths to private machines or cloud accounts in new docs

Prefer sanitized fixtures with the minimum evidence needed for the behavior under test.

## Pull request checklist

- Scoped to one clear problem
- Product boundary preserved (see above)
- Docs updated when public commands, endpoints, data paths, or surfaces change
- No write-capable MCP tools without an explicit product decision
- Dev citation wrappers removed; `VITE_MASTHEAD_DEV_CITATIONS` not left enabled
- Verification commands run and noted in the PR

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Do not file public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
