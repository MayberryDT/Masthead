# Masthead Pages publication gate

Acceptance checklist for local **Publish to Masthead Pages**. Complements
`product-release-gate.md`; it does not replace Workbench V5 release criteria.

## Identity and contract

- [ ] `npm run check:masthead-pages-contract` verifies hosted schemas, fixtures, and object-ID vectors.
- [ ] Local and hosted runtimes compute identical object IDs for every vector
      (`npm run smoke:masthead-pages`).
- [ ] Projection version is `session-dossier-public-v1` on portable `PageRevisionV1` objects.

## Eligibility and projection

- [ ] Only current enriched `canonical-session-dossier-v1` local Logbook artifacts are eligible.
- [ ] Multi-session dossiers and non-dossier kinds are ineligible.
- [ ] Projector constructs an allowlist and never spreads local dossier objects.
- [ ] Outbound corpus tests prove raw transcripts, local/source IDs, fingerprints, paths, files,
      tools, usage, provider details, and unselected evidence are absent
      (`src/mastheadPages/__tests__/outboundCorpus.test.ts`).

## Review and transfer

- [ ] Complete final request and routing metadata are shown before transfer.
- [ ] Digest checked at IPC time matches the reviewed request digest.
- [ ] Raw Page objects, hosted envelopes, and tokens are rejected over publication IPC.
- [ ] Confirmed secrets and prohibited structures block publication and cannot be overridden.
- [ ] Warnings require explicit acknowledgment; batch send includes only checked Ready items.

## Credentials and surfaces

- [ ] Long-lived credentials never enter renderer, daemon, SQLite, settings, logs, or previews.
- [ ] Linux `basic_text` safe storage fails closed.
- [ ] No generic external-URL or secret-reading IPC channel was added.
- [ ] Logbook Page checkboxes and filtered **Select all** remain visible; selection is capped and includes only eligible Pages.
- [ ] The compact Logbook **Publish** action stays disabled until selection and opens Masthead Pages review directly; revision/removal actions remain explicitly qualified.

## Local-first failure

- [ ] `npm run smoke:masthead-pages:offline` keeps daemon health, Logbook list, and MCP status up
      without hosted service.
- [ ] Hosted failure, timeout, parent conflict, rate limit, revoked refresh, expired device flow,
      and removal failure leave local Logbook state intact
      (`src/electron/__tests__/mastheadPagesEndToEnd.test.ts`).
- [ ] Private release mappings are excluded from public objects and local MCP.
- [ ] Public Logbook creation has no repository requirement.
- [ ] No deferred Page kind or automatic publication path was introduced.

## Full gate

```bash
npm run verify
npm run test:electron-security
git diff --check
```

Expected: all commands exit 0 without production credentials or production data.
