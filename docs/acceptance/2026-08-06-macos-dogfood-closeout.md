# macOS dogfood closeout (2026-08-06)

**Status:** Closed — good enough to stop remote macOS dogfood.  
**Host:** Remote macOS arm64 rental (session ended after teardown; vendor hostname private).  
**Branch / code:** `macos/packaging-and-identity` (merged; packaging, DMG, Node layout, release identity).  
**Prior evidence:** [in-depth results](./2026-08-06-macos-in-depth-results.md), [RC checklist](./macos-product-rc-checklist.md), [host inventory template](./macos-macincloud-host-inventory.md).

## Verdict

macOS product path is proven for RC dogfood: packaged install, correct release identity, multi-harness import, Codex hook trust + live capture, Workbench V5 agent authoring into Logbook, and a visual pass. Remaining gaps are non-blocking for this pass (OpenCode not seeded, full 40-pack authoring not finished, adhoc signing only).

## What was proven

| Area | Outcome |
| --- | --- |
| Packaging | Electron Forge darwin-arm64, DMG/zip makers, relocatable official Node when Homebrew Node is non-relocatable |
| Release identity | Packaged health reports real `buildVersion` / `buildSha` (e.g. `0.1.15` / `58c7e0fb…`) via `releaseIdentity` + daemon env inject |
| Multi-harness import | Codex ~500 + Claude / Cursor / Grok / Hermes / OMP; Workbench ~470–500 sessions |
| Codex live hooks | `hooks.json` + `features.hooks=true`; trust via correct `hooks.state` hashes; SessionStart / UserPromptSubmit / Stop completed without trust bypass |
| Live Now | Synthetic multi-runtime cards earlier; real Codex hook live state (`working` / `idle`) during authoring |
| Workbench V5 authoring | Real Codex orchestrator + pack workers; **15/40 packs completed** before stop; **~128 published session dossiers**; soft-flags/rejects present (expected) |
| Visual | Operator visual pass accepted |
| Teardown | Masthead + Codex stopped; seed/app/instance data deleted on rental host |

## Explicitly not required / skipped

- Remaining authoring packs (diminishing returns after 15 packs / 128 dossiers)
- OpenCode history seed
- Paid Apple Developer ID / notarization (adhoc only)
- Overnight soak after dogfood stop

## Engineering shipped (this branch)

- `forge.config.ts` — app identity, DMG maker
- `scripts/prepare-electron-resources.js` — official Node fallback for darwin packaging
- `src/daemon/releaseIdentity.ts` + health/server/launcher wiring
- Packaged smoke / path-policy / bundle-manifest tests
- Docs under `docs/acceptance/*macos*` and `docs/reference/macos-release-build.md`

## Follow-ups (not Mac rental)

1. Merge packaging branch into `main`.
2. Product: Sources V2 activation UX (hook trust / enablement less opaque than desktop Codex Settings).
3. Product: Workbench authoring field validation friction (`verification.status` / evidenceRefs hard fails during agent saves).
4. Release: Developer ID signing when a paid Apple identity is available.
5. Do not re-rent cloud Mac vendor unless signing or a fresh Mac-only regression is needed.

## Operator note

Rental billing stops only when the cloud Mac vendor control panel stops or ends the host.
Local teardown of apps/data does not end host billing.
