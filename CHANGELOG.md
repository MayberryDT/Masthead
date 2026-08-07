# Changelog

All notable changes to Masthead are documented in this file.
The format is inspired by [Keep a Changelog](https://keepachangelog.com/).
Versions follow the `package.json` source of truth.

## [0.1.15] — 2026-08-06

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
