# Masthead UI Surface Review

Use this checklist before claiming visual UI work is complete. Automated tests catch regressions in source structure, but this review is the surface-level acceptance pass.

## Required Viewports

- 1440px desktop
- 1024px tablet landscape
- 768px tablet portrait
- 390px narrow mobile

## Required States

Check each touched surface in every relevant state:

- Empty
- Loading
- Populated
- Error
- Long text
- Keyboard focus
- Reduced motion

## Surface Contracts

- Now uses live cards and state lanes.
- Logbook uses a dense table plus inspector.
- Sources uses adapter/settings rows plus import jobs.
- Agent Access uses setup, permissions, tools, and audit tables.
- Settings uses vertical settings sections and a danger zone.

Shared chrome, typography, controls, and evidence patterns should be consistent across surfaces. Do not reuse fixed live-card DOM or CSS as the default layout for Logbook, Sources, Agent Access, or Settings.

## Browser Review

Use the Codex in-app Browser with the `iab` backend first. Render the local app with `npm run dev`, then inspect each touched surface at the required widths. A healthy live or bridge connection should show live sessions and should not show `No live connection` or `No live Codex sessions yet`.

Record the reviewed URL, viewport widths, surface names, and any accepted residual issues in the implementation notes or PR description.
