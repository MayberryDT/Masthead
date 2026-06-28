## Summary

-

## Verification

- [ ] `npm run check:product-contract`
- [ ] `npm run verify:no-citations`
- [ ] `npm run verify`
- [ ] `npm run test:electron`
- [ ] `npm run test:electron-security`
- [ ] `npm run smoke:electron`
- [ ] `npm run smoke:electron:packaged`
- [ ] Other:

## Checklist

- [ ] Product contract considered: Masthead remains a local-first, harness-neutral session data layer.
- [ ] Tests run and results noted above.
- [ ] Docs updated when behavior changed.
- [ ] No dev citations remain and `VITE_MASTHEAD_DEV_CITATIONS` is not enabled.
- [ ] No write-capable MCP tools added.
- [ ] Release-gate impact noted.
- [ ] Electron renderer does not expose Node, raw IPC, or file protocol loading.
