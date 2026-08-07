# Changelog

All notable changes to Masthead are documented in this file.
The format is inspired by [Keep a Changelog](https://keepachangelog.com/).
Versions follow the `package.json` source of truth.

## [Unreleased]

### Security

- Application hardening from Deepsec review: read-only worktree bridge no longer proxies process-spawn or model-discovery SSRF routes; MCP test-connection uses canonical launch config only; packaged bundle digest covers the full tree and rejects symlink escapes; provider fetch redirect/SSRF guards; non-loopback daemon bind rejected; key-aware secret redaction; V5 session enrichment secret gate; GitHub release workflow least privilege.
- Dependency hygiene: npm `overrides` for previously noisy build-toolchain advisories (`tar`, `undici`, `tmp`, `postcss`, `fast-uri`, `ip-address`, `brace-expansion`); Electron bumped within 42.x; `npm run audit:runtime` and full-tree `npm audit` clean on the gated set.
- Installer clarity: `npm run audit:report`, `docs/reference/dependency-security.md`, SECURITY/README/CONTRIBUTING notes distinguishing GitHub Releases vs source build vs full-tree audit; CI security workflow always fails on runtime high+.

## [0.1.15] — 2026-08-06

### Changed

- Public repository tree prune: removed agent-skill harness (`.agents`, `skills-lock.json`), design mockups, throwaway prototypes, Superpowers plans, nested deepsec project, and other workshop residue from the default tree.
- Moved agent operating docs to `docs/internal/` and product map to `docs/openwiki/`; dogfood acceptance notes to `docs/archive/acceptance/`.
- Root keeps a short `AGENTS.md` pointer so coding agents still find instructions.

### Added

- macOS Electron packaging path: DMG and zip makers, relocatable official Node bundling when the host Node is non-relocatable (e.g. Homebrew).
- `releaseIdentity` resolution so packaged health/capabilities report real `buildVersion` and `buildSha` from `release.json` / env (not `development`).
- Soft open-source entry docs: public-facing README structure, `docs/OPEN_SOURCE.md`, expanded ignore rules for local authoring dumps.
- Public launch surface: Pip-style README, community docs rewrite, `ROADMAP.md`, release workflow that publishes macOS + Linux desktop artifacts on `v*` tags, and marketing assets under `docs/assets/`.

### Documented

- MacinCloud / remote Mac dogfood closeout and release-build notes under `docs/acceptance/` and `docs/reference/macos-release-build.md`.
- Historical root specs moved to `docs/archive/` (not current product SoT).

## [0.1.0] — 2026-06

### Added

- Local-first Masthead daemon, UI, canonical SQLite session graph, Codex-oriented source loop, Logbook search, and read-only MCP access.
- Launch documentation for first-run import, Codex import, daemon API, MCP tools, configuration, and data paths.
- Repository health files (license, security, contributing, issue/PR templates).

### Security

- Documented read-only MCP boundary, local data handling expectations, and private vulnerability reporting path.
