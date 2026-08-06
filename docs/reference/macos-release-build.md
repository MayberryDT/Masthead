# macOS release build (MacinCloud)

How to produce and test an **arm64** Masthead desktop build on a remote Mac
(for example MacinCloud host `macincloud` / TX089). This path is **adhoc-signed only**
until a paid Apple Developer ID Application certificate is available.

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
  Node is not relocatable (Homebrew Node is a thin stub that needs Cellar dylibs;
  packaging downloads the official Node binary for the same `process.version`)
- SSH from the Linux dev host: `ssh macincloud`
- Optional RDP on MacinCloud port `6000` for UI checks

On TX089:

```bash
export PATH="/opt/homebrew/bin:$PATH"
node -v   # e.g. v25.x
```

## Sync source from Veelox

The Mac may not have a GitHub deploy key. Prefer rsync from the Linux checkout:

```bash
# From the Masthead repo on Veelox:
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude out --exclude .vite \
  --exclude 'authoring-v5-pack*' \
  --exclude '.electron-resources' \
  ./ macincloud:~/src/Masthead/

# prepare-electron-resources needs a full 40-hex git SHA
rsync -az ./.git/ macincloud:~/src/Masthead/.git/
```

## Build (adhoc)

```bash
ssh macincloud
export PATH="/opt/homebrew/bin:$PATH"
cd ~/src/Masthead
npm ci
npm run build:electron
```

Expected outputs (version from `package.json`):

- App: `out/Masthead-darwin-arm64/Masthead.app`
- Zip: `out/make/zip/darwin/arm64/Masthead-darwin-arm64-<version>.zip`
- DMG: `out/make/Masthead-<arch>.dmg` or under `out/make/` (maker-dmg default)

Package only (no makers):

```bash
npm run package:electron
```

Zip + DMG only after package:

```bash
npx electron-forge make --targets=@electron-forge/maker-zip,@electron-forge/maker-dmg
```

## Codesign expectation (no paid identity)

```bash
codesign -dv --verbose=4 out/Masthead-darwin-arm64/Masthead.app
```

Expect **adhoc** (`Signature=adhoc`, no TeamIdentifier). That is correct for local RC
on this Mac. **Do not** gate Phase-1 on `spctl` acceptance or notarization.

Gatekeeper on **other** Macs will block double-click install until Developer ID +
notarization are wired (see “Later: paid signing”).

## Automated smoke

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd ~/src/Masthead
# Uses resolvePackagedExecutableLayout so Contents/Resources is correct on darwin
node scripts/masthead-electron-packaged-smoke.js
# or
MASTHEAD_ELECTRON_PACKAGED_BIN=out/Masthead-darwin-arm64/Masthead.app \
  node scripts/masthead-electron-packaged-smoke.js
```

Also useful:

```bash
npm run typecheck
npm run test:electron -- --run
```

## Manual install + UI RC (this Mac only)

1. Quit any running Masthead.
2. Mount the DMG; copy `Masthead.app` to `~/Applications` or `/Applications`.
3. First open may need **right-click → Open** (quarantine / adhoc).
4. Confirm cold start, daemon health, and surfaces: Now, Workbench, Logbook, Sources, Settings.
5. Data lives under macOS Application Support (see `docs/architecture/data-paths.md`).

## Product testing (not this doc)

Packaging success is not product proof. For harness discover, import, live capture,
Now / Workbench / Logbook on MacinCloud, use:

- [Host inventory](../acceptance/macos-macincloud-host-inventory.md)
- [macOS product RC checklist](../acceptance/macos-product-rc-checklist.md)

## Later: paid signing (not Phase 1)

When a Developer ID Application cert and App Store Connect API key exist:

1. Import the cert into the Mac login keychain.
2. Set env for Forge (do not commit secrets):

   - `APPLE_TEAM_ID`
   - API key path + key id + issuer (preferred for `notarytool`)
3. Enable `packagerConfig.osxSign` (hardened runtime + entitlements) and
   `packagerConfig.osxNotarize` in `forge.config.ts`.
4. Rebuild; verify:

   ```bash
   codesign --verify --deep --strict --verbose=2 Masthead.app
   spctl -a -vvv --type execute Masthead.app
   xcrun stapler validate Masthead.app
   ```

Until then, keep builds adhoc and limit distribution to machines you control
(or document the Gatekeeper bypass).
