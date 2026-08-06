# Plan: Soft open-source release readiness

**Goal:** Make the Masthead repository presentable as a soft public open-source project (readable product story, install path, license/security/contrib hygiene, no local junk or host-private ops noise) without a full marketing site or npm publish.

**Non-goals:** Paid Apple signing, npm un-private publish, rewriting git history, deleting historical ADRs/plans, renaming product identity.

## Work items

1. **Public entrypoint (`README.md`)** — Human-first overview: what/why, status (pre-1.0 soft release), install/run, product surfaces, docs map, license/security/contributing. Move dense V5 contract detail below the fold with links.
2. **Metadata** — `package.json` repository/bugs/homepage/keywords; keep `"private": true` (not npm-publishing). Refresh `CHANGELOG.md` for `0.1.15`.
3. **Community/legal hygiene** — Ensure LICENSE (MIT), SECURITY, CONTRIBUTING, CODE_OF_CONDUCT remain accurate and external-friendly; light CONTRIBUTING expansion.
4. **Repo hygiene** — Expand `.gitignore` for authoring pack dumps and common local artifacts; delete untracked `authoring-v5-pack:*` junk from the working tree (never commit).
5. **Sanitize host-private ops docs** — Genericize Mac remote-build and dogfood acceptance docs (no rental usernames, internal host aliases, or donor machine names as if they were product docs). Keep technical facts.
6. **Soft-release note** — Short `docs/OPEN_SOURCE.md` stating pre-1.0 expectations, privacy model, and what “soft open source” means for this repo.
7. **Commit + push** — One focused PR-ready commit on `main` or a short branch; prefer branch + PR if main is protected, else commit on main if allowed.

## Done when

- A cold reader can understand Masthead, run `npm install` / `npm run dev`, and find license/security/contrib paths from the README alone.
- No untracked multi‑MB pack dumps sit at repo root as accidental publish risk.
- Host rental inventory does not read like a leak of personal cloud account paths.
- CHANGELOG reflects current version line.
