# Install & Runtime Security Hardening Plan

> Status: **implemented in tree** (2026-08-07). Residual: ship via commit/release; Deepsec app fixes still need release to reach installers.

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Make installers and source-builders stop seeing scary unexplained Critical/High noise, keep production runtime audit clean, and publish clear trust boundaries for Masthead.

**Architecture:** Three layers—(1) dependency hygiene with runtime-vs-toolchain split and safe overrides, (2) application security closeout already largely done via Deepsec fixes, (3) CI gates + public docs so GitHub Releases vs `npm install` trust paths are obvious.

**Tech Stack:** npm/package-lock, GitHub Actions (`security.yml`, `ci.yml`), Electron Forge, existing `audit:runtime`, Deepsec app fixes in working tree.

## Global Constraints

- Never break Electron package/make without verifying `npm run package:electron` or at least `test:electron-security`.
- Prefer `overrides` over `npm audit fix --force` (force wants Forge 7.6.1 downgrade).
- Runtime gate: `npm audit --omit=dev --audit-level=high` must stay at **0**.
- Full-tree audit may still show build-toolchain issues; document them, reduce where safe, do not pretend they are zero if Forge still pulls old `tar`.
- Do not claim Deepsec findings are fixed in a release until those commits ship.
- Local-first loopback trust model stays; do not invent cloud auth in this plan.

### Task 1: Dependency hygiene (Layer 1)

**Files:**
- Modify: `package.json` (scripts + overrides + electron bump if safe)
- Modify: `package-lock.json` via npm
- Create: `scripts/security-audit-report.js` (human-readable runtime vs full split)
- Modify: `SECURITY.md`, `README.md` (install path + audit interpretation)

- [ ] Add npm `overrides` for known high/critical transitive build deps where compatible (`tar`, `undici`, `tmp` as supported).
- [ ] Bump `electron` within current major/wanted range if audit moderate clears without breaking Forge.
- [ ] Add scripts: `audit:runtime` (exists), `audit:all`, `audit:report`.
- [ ] Run `npm run audit:runtime` → 0 high+.
- [ ] Run `npm run audit:report` → prints runtime clean + toolchain residual summary.
- [ ] Smoke: `npm run test:electron-security`.

### Task 2: CI always gates runtime audit (Layer 3 CI)

**Files:**
- Modify: `.github/workflows/security.yml`
- Optionally: `.github/workflows/ci.yml` lightweight audit step

- [ ] On every PR/push: `npm ci` + `npm run audit:runtime` (not only private-repo fallback).
- [ ] Keep dependency-review on public PRs.
- [ ] Keep CodeQL.
- [ ] Optional non-blocking or informational full `npm audit` job that uploads summary without failing on known Forge toolchain residual (or fail only if runtime dirty).

### Task 3: App security closeout (Layer 2)

**Files:**
- Existing Deepsec fix set (already in working tree)
- Modify: `CHANGELOG.md` security section when committing
- Modify: `SECURITY.md` boundaries + “what installers should trust”

- [ ] Confirm bridge/MCP/bundle/SSRF/redaction fixes still present.
- [ ] Document residual intentional risks (loopback trust, deferred identity mixing).
- [ ] Do not re-open large identity redesign in this pass.

### Task 4: Installer-facing docs (Layer 3 docs)

**Files:**
- Modify: `SECURITY.md`
- Modify: `README.md` Install section
- Modify: `docs/OPEN_SOURCE.md` if needed
- Create: `docs/reference/dependency-security.md`

- [ ] Preferred path: GitHub Releases packaged app.
- [ ] Source build: Node engine, `npm ci`, expected `audit:runtime` clean, full audit may list Electron Forge toolchain.
- [ ] How to verify: `npm run audit:runtime`, `npm run test:electron-security`, release checksums when present.
- [ ] How to report vulns (already in SECURITY.md).

### Task 5: Verification

- [ ] `npm run audit:runtime`
- [ ] `npm run audit:report`
- [ ] `npm run test:electron-security`
- [ ] Targeted vitest from Deepsec fix set still green if tree dirty
- [ ] Summarize residual full-audit items honestly

---

## Success criteria

1. Someone running `npm install` can be pointed at docs: **runtime audit is the product gate; full audit includes build tools.**
2. CI fails if runtime high/critical appears.
3. Residual Forge/`tar` issues are reduced or explicitly owned with override/upgrade path.
4. App Deepsec hardening remains in tree and is described in SECURITY/CHANGELOG when released.
