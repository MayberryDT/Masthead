# Launch backlog (2026-08-07)

Post open-source face + marketing surface pass. Durable list of remaining work.

## Shipped tonight

- Public GitHub face (Pip-style README, prune, ROADMAP, release workflow, CI green).
- New hero + OG images on README (`docs/assets/masthead-readme-hero.jpg`, `masthead-og.jpg`).
- animasai.co/masthead.html: product-accurate copy (Sources → Workbench → Logbook → MCP → Now; Electron not Tauri; Logbook = artifacts not session library) + new showcase image. Live via Cloudflare git deploy.
- tylermayberry.dev: Masthead card image + copy updated in repo (`public/` is Worker asset root).

## Blocked / needs human

1. **Cloudflare Wrangler OAuth expired** on Veelox and Halla (`wrangler whoami` cannot refresh non-interactively). Manual `wrangler login` on Halla (or a scoped `CLOUDFLARE_API_TOKEN` with Workers/Pages write) if git auto-deploy stalls for portfolio.
2. **GitHub social preview** — confirm repo Settings → Social preview uses `docs/assets/masthead-og.jpg` (or default OG from README).
3. **usemasthead.com** — confirm production deploy still matches current product language and download → Releases/latest.

## Product / install (from ROADMAP + launch notes)

1. Multi-machine live session tracking (priority).
2. One-line try (`npx`-style) install path.
3. Windows desktop packaging.
4. Apple notarization / Developer ID (replace adhoc macOS signing).

## Quality / hygiene

1. **deepsec** local vuln scan (`npx deepsec`) on the repo before broader promotion.
2. File a few good-first-issues for OSS contributors.
3. CI speed / flaky test budget after tonight's shrink of the V5 multi-pack prep test.
4. Import quality / harness coverage polish.
5. Headline consistency across usemasthead.com, README, animas, portfolio.
6. Optional V4 canary cleanup residue after V5 authoring path.

## Deploy notes (sites)

| Site | Repo | Deploy path |
| --- | --- | --- |
| animasai.co | MayberryDT/animas-ai | Cloudflare Worker `animas-ai-preview`; git push to `master` auto-deploys. Local script: `scripts/deploy-cloudflare.py` (needs fresh Wrangler OAuth). |
| tylermayberry.dev | MayberryDT/apps-portfolio | Cloudflare Worker; **serves `public/`** — always sync HTML/images into `public/` before expecting live change. |

## Do not reintroduce

- Tauri as desktop runtime (product is Electron).
- Board as a product surface.
- Logbook as a session library (artifacts only).
- Monitoring-tower / analytics-dashboard framing.
