# macOS release build

How to produce and test an **arm64** Masthead desktop build on macOS.
This path is **adhoc-signed only** until a paid Apple Developer ID Application
certificate is configured for the build host.

## Product identity

| Field | Value |
| --- | --- |
| Bundle id | `ai.animas.masthead` |
| Executable | `masthead` |
| Category | `public.app-category.developer-tools` |
| Primary human artifact | DMG (`@electron-forge/maker-dmg`) |
| Secondary artifact | Zip (`@electron-forge/maker-zip`) |

## Host prerequisites

- macOS with Xcode CLT / Xcode (Forge / Electron packaging)
- Homebrew or other Node matching `package.json` engines (`>=24.15.0`) for **building**
- Network access to `nodejs.org` during `prepare:electron-resources` when the host
  Node is not relocatable (Homebrew Node is often a thin stub that needs Cellar dylibs;
  packaging downloads the official Node binary for the same `process.version`)

```bash
export PATH="/opt/homebrew/bin:$PATH"
node -v
```

## Get source on the Mac

Prefer a normal clone when the Mac has GitHub access:

```bash
git clone https://github.com/MayberryDT/Masthead.git
cd Masthead
git checkout <branch-or-tag>
```

If you must copy from another machine without GitHub credentials:

```bash
# From a Linux/dev checkout of this repo:
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude out --exclude .vite \
  --exclude 'authoring-v5-pack*' \
  --exclude '.electron-resources' \
  ./ mac-user@mac-host:~/src/Masthead/

# prepare-electron-resources needs a full 40-hex git SHA
rsync -az ./.git/ mac-user@mac-host:~/src/Masthead/.git/
```

## Build (adhoc)

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd ~/src/Masthead   # or your clone path
npm ci
npm run build:electron
```

Expected outputs (version from `package.json`):

- `out/make/*.dmg`
- zip maker artifacts under `out/make/zip/darwin/arm64/` (layout may vary by Forge version)
- packaged app under `out/Masthead-darwin-arm64/Masthead.app` (name may include arch)

Install for manual test:

```bash
# Example: copy packaged app into ~/Applications
cp -R out/Masthead-darwin-arm64/Masthead.app ~/Applications/
open ~/Applications/Masthead.app
```

## Verify identity

With the packaged app running, health should report the package version and a real git SHA—not `development`:

```bash
curl -sS http://127.0.0.1:17373/health | jq '{buildVersion, buildSha, product, ok}'
```

## Dogfood notes

Historical multi-harness dogfood and closeout writeups live under `docs/acceptance/`
(for example `2026-08-06-macos-dogfood-closeout.md`). Those documents are operator
evidence from a specific rental Mac; they are not required for a normal contributor build.

## Related

- [Soft open-source notes](../OPEN_SOURCE.md)
- [Product release gate](../acceptance/product-release-gate.md)
