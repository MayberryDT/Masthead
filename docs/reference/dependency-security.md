# Dependency security

How Masthead treats npm audit results, and what source installers should expect.

## Preferred install path

For day-to-day use, install a **packaged desktop build** from
[GitHub Releases](https://github.com/MayberryDT/Masthead/releases/latest).

Source installs (`git clone` + `npm install` + build) are fully supported for
contributors and packagers, but they pull **dev/build tooling** (Electron Forge,
Vite, rebuild helpers) that does not ship as Masthead’s runtime dependency set.

## Two audit scopes

| Command | Scope | Product gate |
| --- | --- | --- |
| `npm run audit:runtime` | Production dependencies only (`--omit=dev`) | **Must stay 0 high/critical** |
| `npm run audit:report` | Runtime + full tree summary | Fails if runtime high+ |
| `npm audit` / `npm run audit:all` | Entire install including devDependencies | Informational for toolchain |

Production `dependencies` in `package.json` are intentionally small (UI fonts,
icons, React). The local daemon and desktop shell are built from this repo;
Electron Forge packages them. Most scary audit graphs historically came from
**Forge rebuild / tar / undici / tmp**, not from the production dependency list.

## What we pin

`package.json` `overrides` force fixed floors for known transitive advisories
when upstream toolchains lag (for example `tar`, `undici`, `tmp`, `postcss`,
`fast-uri`, `ip-address`). Overrides are reviewed when bumping Electron Forge
or Vite.

## Verify after install

```bash
npm ci
npm run audit:runtime    # product gate
npm run audit:report     # plain-language split
npm run test:electron-security
```

If `audit:runtime` is clean but full `npm audit` still lists packages under
`node_modules/@electron-forge` or `vite`, that is **build-machine** surface area.
Treat it as supply-chain hygiene for developers/CI, not as “the Masthead daemon
ships that vulnerable module to end users.”

## CI

`.github/workflows/security.yml` runs:

1. `npm run audit:runtime` (fail closed on high+)
2. `npm run audit:report`
3. CodeQL
4. GitHub dependency review on public pull requests

## Application security vs dependency audit

Dependency audit does **not** replace application review. Masthead also tracks
local-first boundaries (loopback daemon, read-only bridge, MCP read-only launch
surface) in [SECURITY.md](../../SECURITY.md). Deepsec-style code findings are a
separate class from npm advisory IDs.

## Reporting

See [SECURITY.md](../../SECURITY.md). Do not file public issues with exploit
detail for unfixed vulnerabilities.
