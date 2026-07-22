---
version: alpha
name: Masthead
description: Local-first session data product for importing, searching, enriching, and reusing AI-agent session history. The UI is a dense developer console that keeps live work, historical records, sources, and local settings evidence-forward.
colors:
  primary: "#031019"
  secondary: "#071b28"
  tertiary: "#2ea7ff"
  neutral: "#f6fbff"
  canvas: "#031019"
  sidebar-bg: "#041522"
  toolbar-bg: "#051724"
  surface: "#071b28"
  surface-hover: "#082130"
  control-bg: "#061925"
  control-raised: "#081d2a"
  control-raised-hover: "#092231"
  surface-border: "rgba(92, 153, 187, 0.18)"
  surface-border-hover: "rgba(112, 173, 205, 0.24)"
  line: "rgba(194, 221, 241, 0.13)"
  line-strong: "rgba(196, 226, 248, 0.2)"
  ink: "#f6fbff"
  body: "#d6e4ef"
  mute: "#91a8ba"
  ash: "#61798e"
  green: "#36d869"
  green-soft: "rgba(89, 212, 153, 0.14)"
  blue: "#2ea7ff"
  blue-soft: "rgba(45, 168, 255, 0.16)"
  yellow: "#ffcf36"
  yellow-soft: "rgba(247, 201, 72, 0.15)"
  red: "#ff483e"
  red-soft: "rgba(255, 77, 77, 0.14)"
typography:
  heading-lg:
    fontFamily: IBM Plex Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0
  heading-md:
    fontFamily: IBM Plex Sans
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.32
    letterSpacing: 0
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label-mono:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
  data-mono:
    fontFamily: IBM Plex Mono
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0
rounded:
  control: 3px
  card: 5px
  panel: 5px
  modal: 8px
  legacy-rail: 10px
  full: 9999px
spacing:
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  shell-gap: 14px
  sidebar-width: 215px
  surface-card-height: 238px
  surface-card-mobile-height: 268px
  minimum-control-height: 40px
components:
  app-shell:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.body-sm}"
    width: 100%
  canvas:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
  sidebar:
    backgroundColor: "{colors.sidebar-bg}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    width: "{spacing.sidebar-width}"
  toolbar:
    backgroundColor: "{colors.toolbar-bg}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    height: "{spacing.minimum-control-height}"
  surface-panel:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    padding: 0
  surface-data-card:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.card}"
    height: "{spacing.surface-card-height}"
  surface-data-card-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.card}"
    height: "{spacing.surface-card-height}"
  hairline-border:
    backgroundColor: "{colors.surface-border}"
    height: 1px
  hairline-border-hover:
    backgroundColor: "{colors.surface-border-hover}"
    height: 1px
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.line-strong}"
    height: 1px
  muted-label:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.mute}"
    typography: "{typography.label-mono}"
  secondary-label:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.mute}"
    typography: "{typography.label-mono}"
  ash-swatch:
    backgroundColor: "{colors.ash}"
    height: 1px
  low-control:
    backgroundColor: "{colors.control-bg}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "{spacing.minimum-control-height}"
  toolbar-button:
    backgroundColor: "{colors.control-raised}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "{spacing.minimum-control-height}"
  toolbar-button-hover:
    backgroundColor: "{colors.control-raised-hover}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "{spacing.minimum-control-height}"
  modal-panel:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.modal}"
  status-active:
    backgroundColor: "{colors.green}"
    textColor: "{colors.primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
  status-active-soft:
    backgroundColor: "{colors.green-soft}"
    rounded: "{rounded.full}"
  status-info:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
  status-observed:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
  status-observed-soft:
    backgroundColor: "{colors.blue-soft}"
    rounded: "{rounded.full}"
  status-warning:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
  status-warning-soft:
    backgroundColor: "{colors.yellow-soft}"
    rounded: "{rounded.full}"
  status-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
  status-danger-soft:
    backgroundColor: "{colors.red-soft}"
    rounded: "{rounded.full}"
x-motion:
  modal-open-duration: 250ms
  modal-close-duration: 220ms
  dropdown-open-duration: 250ms
  dropdown-close-duration: 260ms
  user-layout-duration: 380-430ms
  system-layout-duration: 180-260ms
  easing: "cubic-bezier(0.22, 1, 0.36, 1)"
---

> **Authoring runtime boundary:** New guided requests use V5 assignments without canary review or
> operator approval. V1–V4 authoring state remains read-only audit history and cannot resume into the
> current product path.

# Masthead Design

This is the master design source for Masthead. The repo intentionally uses the lowercase filename `design.md`; tools or agents that expect Google's uppercase `DESIGN.md` format should be pointed at this file.

Product requirements live in `prd.md`. Historical implementation plans under `docs/superpowers/plans/` are not current visual direction. Do not use deleted files, old screenshots, generic dashboard examples, or the previous Raycast-inspired document as design authority.

## Overview

Masthead is a local-first session data product for people who use multiple AI-agent harnesses.
The interface makes one private session graph useful through live awareness, historical retrieval,
source management, and read-only agent reuse.

The visual system remains a dense, calm developer console. Shared chrome, typography, color,
spacing, and evidence patterns unify the application; individual surfaces may use different
compositions when their jobs differ. Logbook is not required to imitate the live card board.
Sources is not required to imitate Logbook.

The UI helps the developer answer what is happening now, what happened before, where the data came
from, and what an existing agent can safely retrieve. It is not a marketing site, KPI dashboard,
analytics product, task manager, employee monitor, chat client, or token-spend console.

The center workspace is the product. Now, Workbench, Logbook, Sources, and Settings
must share one visual language: a headed surface, compact controls, restrained stats when useful,
and evidence-forward records. Healthy background work should stay visually quiet. Attention,
conflicts, failed verification, stale data, and inferred states should be prominent only when they
change what the developer should do next.

Masthead should look specific to local agent-session memory. Every repeated record should expose
concrete evidence such as session state, project, branch, command, source path, changed files,
timestamp, outcome, provenance, or confidence. Decorative charts, generic metric blocks, oversized
hero text, and empty visual ornament are failures.

## Colors

The palette is a near-black blue operator console with restrained semantic color. The background should read as a deep local-machine workspace, not a purple SaaS dashboard, beige productivity app, or bright analytics interface.

- **Canvas (`#031019`):** Full app background and the base of the session manager.
- **Sidebar and toolbar blues (`#041522`, `#051724`):** Persistent navigation and control chrome. These surfaces should recede behind the center board.
- **Surface metal (`#071b28`):** Cards, data panels, and repeated operational surfaces.
- **Raised control (`#081d2a`):** Buttons, inputs, filters, and select triggers.
- **Ink (`#f6fbff`):** Primary text and high-confidence data.
- **Body (`#d6e4ef`):** Normal readable text.
- **Mute (`#91a8ba`):** Secondary labels, descriptions, and old timestamps.
- **Green:** healthy, complete, verified, active, or source-connected.
- **Blue:** inferred, informational, idle, selected, or locally observed.
- **Yellow:** warning, review-needed, stale, or pending.
- **Red:** attention, conflict, failed, destructive risk, or broken connection.

State color must be sparse. Do not color every card for variety. A card may carry a thin state rail, status token, or small accent only when the state has meaning. The default healthy card should mostly be metal, border, typography, and evidence.

## Typography

Use IBM Plex Sans for interface text and IBM Plex Mono for paths, timestamps, counts, command names, short IDs, and technical facts. Numeric data should use tabular numerals.

Headings inside the app are compact. The center surface heading can use 24px, but cards, panels, rails, and controls should stay in the 11px to 17px range. Do not use landing-page or hero-scale type inside the product.

Letter spacing is 0. Do not introduce negative tracking. Avoid all-caps paragraphs. Monospace labels can be uppercase when they are short metadata labels, but do not let label styling overpower the actual evidence.

Text must wrap deliberately. Long project names, source paths, branches, and snippets need ellipsis, line clamps, or `overflow-wrap: anywhere` depending on the container. Text may not overlap icons, rails, buttons, or following content.

## Layout

The primary layout is a session manager:

- Left sidebar: navigation and product identity.
- Center workspace: the active product surface.
- Right rail when present: contextual support, status, and secondary evidence.

The center workspace is organized, not a stack of generic panels. Shared surface elements should
recur across views, but each surface may use the structure that fits its job:

- Now may use cards and state lanes.
- Workbench: dense ops table plus terminal-like Activity rail and selection-driven pipeline actions.
- Logbook should optimize scanning, filtering, and opening historical records.
- Sources owns the live-connector portion of onboarding. The app-level first-run coordinator may
  continue into a one-time Workbench-owned history import and reconciliation phase; the normal
  Sources surface remains connector-only.
- Settings should optimize direct controls, exact blast-radius controls, local data policy, and
  compact MCP setup and access evidence.
- The right rail is optional and must be contextual to the active surface.

## Surface Archetypes

- Now: live cards.
- Workbench: dense publish-path table + Activity console rail + metal ops toolbar.
  Human ops cover transcript check/import, quality review, claim/release, publish,
  Not Added inspection, session selection, and guided authoring request creation. **Copy Agent Prompt**
  first persists the compile-ready selection and campaign policy, then
  copies only the opaque request ID and one instance-bound start command. Review-needed sessions
  remain selected for human operations, are disclosed, and never enter the request. The Activity
  rail observes the current assignment, next action, editorial findings, and publication events
  without becoming a command cookbook or approval console.
- Logbook: dense table plus inspector.
- Sources: harness connector rows plus enablement detail (Discover → Enable → Activate → Test).
- Settings: one centered compact steel card with direct controls for everyday preferences and one
  inline detail section at a time for Data, Agent access, Advanced, or Danger zone.
- Agent access is a compact MCP information/setup section inside Settings, not a primary surface.

Shared visual language does not permit reusing fixed live-card DOM or CSS on every surface.

When a surface uses cards, desktop grids should prefer three columns when width allows, two columns
on tablet, and one column on mobile. Fixed-format cards need stable dimensions so hover states,
labels, snippets, icons, and data facts do not resize the grid. Current live-session data cards use
238px height on desktop and 268px on narrow mobile.

Do not put cards inside other cards. Do not wrap whole page sections in floating cards. Use full-width bands or unframed layouts for sections, and reserve cards for repeated data items, modals, and genuinely framed tools.

Mobile should be a usable session manager, not a crushed desktop screenshot. Collapse rails, keep controls at least 40px tall, reduce card columns to one when cards are used, and preserve the evidence hierarchy.

## Elevation & Depth

Depth comes from hairline borders, subtle inset highlights, low-opacity shadows, and the anodized surface texture. It should feel like machined dark UI, not glassmorphism or marketing gloss.

Use:

- 1px borders with `surface-border` or `line`.
- Inset top highlights for raised metal surfaces.
- Soft, tight shadows that imply separation without floating the card off the board.
- Hover states that add one step of surface brightness and border clarity.

Avoid:

- Big drop shadows.
- Gradient blobs, bokeh, or decorative background orbs.
- Bright neon outlines except for accessibility focus.
- White cards or translucent frosted panels.
- Busy grid backgrounds behind dense information.

## Shapes

The interface uses small radii. Controls are 3px, cards and panels are 5px, modals can be 8px, and legacy rail surfaces may remain 10px until touched for product reasons.

Do not introduce pill-shaped rectangles for normal buttons. Reserve full radius for small state tokens, count chips, and compact tags where the pill shape carries metadata meaning.

Buttons and inputs should maintain a minimum 40px hit area. Smaller inline buttons are allowed only inside dense card footers or source chips where the available space is constrained.

## Components

### Session Cards

Session cards are the reference pattern for the Now workspace. A card must show state, project or task identity, meaningful timing, and evidence of recent activity. Healthy cards stay quiet. Attention, conflicts, approvals, failed commands, stale verification, and review-needed states should be visually scannable from the live surface without opening the modal.

Clicking a card opens the detail modal. The card itself should not become a miniature dashboard. Keep it focused on the decision a developer can make from the board.

#### Card visual tiers

All tiers use the same metal slab, texture, dovetail shape, typography, and layout system.

- **Tier quiet:** valid background information; no action required.
- **Tier live:** active or recently changing information; alive but not urgent.
- **Tier action:** blocked, failed, stale, conflicted, destructive, or user-action-required.

Tier controls visual intensity. Lifecycle controls state meaning. Do not conflate them.

### Logbook

> **Product unit (ADR 0011):** Logbook is an **artifact book**. Rows are published artifacts
> (session dossier, runbook, ADR, incident timeline), not sessions. See `CONTEXT.md` and
> `openwiki/logbook-and-workbench.md`.

The Logbook is not an old utility list or session library. It should optimize scanning, filtering,
pagination, and opening **published artifact** capsules while retaining the shared surface language.

Locked composition: dense capsule table (Kind · Title/Highlight · Project · Conf · Provenance ·
Published) plus a selection-driven inspector with **kind-specific body** and **always-visible
provenance**. No bulk selection checkboxes, no bulk enrich chrome, no session-era summary metrics strip.

Each capsule should answer: what kind of knowledge this is, what it claims, where/when it was
published, confidence, and which sessions provenance it. Body detail and multi-session join rationale
belong in the inspector, not free-floating table paragraphs.

`session_dossier` has one visual and semantic contract: the original canonical dossier structure.
Under `workbench-authoring-v5`, the agent traverses complete canonical evidence and writes grounded
durable enrichment for each assignment session, then the daemon rebuilds that canonical
presentation. The agent may also author zero or more claim-supported runbooks, ADRs, or incident
timelines. Publication atomically admits one accepted assignment into Logbook without operator
approval; nothing enters Logbook until its enrichment and editorial review are accepted.

### Guided authoring vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Assignment = one daemon-grouped authoring unit containing at most 12 sessions.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = historical V4 resolution state; V5 opportunities are nonbinding.

Canary = historical V4 approval state; V5 has no canary.

Next action = the single command Masthead requires from the agent at the current assignment state.

### Sources

Sources is the harness connection control plane for live capture, not an import console and not a session browser. Product contract: `docs/reference/sources-v2.md`.

It should look like a connector inventory: one row per live-capable harness, with presence, live status, and a clear Enable / Repair / Test action. Detail drawers show managed paths, endpoints, activation steps (for example Codex hook trust), and diagnostics. Do not center import job tables, transcript bulk import, or Workbench pipeline progress on Sources.

Sources owns the live-connector portion of onboarding. Each connector row should answer: is this
harness on the machine, is Masthead wired for live capture, what human activation remains, and did
the last test or live event prove it. On a clean install, the app-level first-run coordinator may
then offer Everything or a recent-history range and remain open while the durable Workbench import
reconciles. That one-time coordinator is not the Sources surface: ongoing history processing and
retry state belong to Workbench, while published history belongs in Logbook.

### Settings

Settings uses one centered compact steel card. Everyday preferences are direct controls; Data,
Agent access, Advanced, and Danger zone open one inline detail section at a time. Rows should prefer
direct controls with no explanatory paragraph unless safety or ambiguity requires one. Agent access
stays compact and evidence-forward: show MCP status, setup, format selection, testing, and copy
actions without turning the section into a code wall.

### Toolbar, Filters, And Dropdowns

Toolbar controls should feel mechanical and responsive. Use raised dark controls, 40px minimum hit areas, exact-property transitions, and clear selected state.

Dropdowns must animate. Open with opacity and a slight scale from the trigger origin. Close with a short opacity/scale transition before unmounting. Chevron rotation should track the open state. Options should have hover and selected states, but they should not bounce or over-animate.

### Layout Change Button

Changing card density or layout must animate the cards, not only flip the button state. Use a transform-based FLIP pattern or equivalent view transition so cards preserve spatial continuity as they resize and move.

The button itself needs hover, focus, and active press transitions. The layout change should be smooth enough to read as intentional, but short enough that repeated supervision remains efficient.

### Modals

The session modal is the strongest current interaction and should stay central. Open and close with synchronized backdrop opacity and panel transform/opacity. Keep focus trap, Escape close, backdrop click, and a 40px close control.

The modal content should remain an evidence inspector, not a form-heavy settings panel. Use compact fact grids, sections, and read-only evidence blocks.

### Buttons And Actions

Buttons should use icons when the command is familiar and text when the action needs clarity. Press states should use a small scale change around 0.96 to 0.98. Hover and focus states should be visible but not loud.

Dangerous or mutating actions must be visually distinct and must state their blast radius in copy near the action. Masthead observes before it controls, so avoid casual destructive controls.

### Empty States

Empty states should be quiet operator states. They should explain the missing data in one short line and preserve the surrounding surface geometry. Do not turn empty states into onboarding cards, marketing panels, illustrations, or generic "get started" flows.

## Motion

Motion is part of the design system, not a bonus. It should clarify state changes, preserve spatial continuity, and make interactive controls feel responsive.

### Motion cause model

Masthead motion is cause-based:

1. User-invoked motion may be richer because the user caused the spatial change. Examples: density toggle, explicit sort change, major filter change, modal open/close.
2. Semantic system motion may be visible because meaning changed. Examples: session becomes blocked, new active session appears, headline meaning changes.
3. Routine refresh motion must stay quiet. Examples: polling succeeded, same headline was refreshed, counters changed, usage totals updated.

Daily mode is restrained. Presentation mode may use richer timing. Reduced motion removes transform motion while preserving visible state changes.

Use the current motion tokens:

- Modal open: 250ms with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Modal close: 220ms.
- Dropdown open: 250ms.
- Dropdown close: 260ms.
- User-invoked layout motion: 380-430ms.
- System-invoked activity reorder: 180-260ms.
- Semantic headline replacement: 500-680ms only when headline meaning changes.
- Routine refresh pulse: 120-180ms, no text replacement animation.
- Button hover and press: about 160ms.

Animate exact properties only: `transform`, `opacity`, `border-color`, `background-color`, `box-shadow`, and `color`. Do not use `transition: all`.

Required motion:

- Dropdown menus open and close with transform and opacity.
- User-invoked layout/density changes animate cards moving and resizing.
- Live polling reorder may animate, but must use shorter system timing.
- Modals open and close with panel and backdrop transitions.
- Buttons, source actions, and card hover/press states have transitions.

Do not animate evidence values just because they changed. Do not run full headline replacement motion when only a routine refresh timestamp changed. Use motion for spatial changes, semantic changes, and interaction feedback, not for decorative activity. Respect reduced-motion settings by removing transform motion while keeping state changes visible.

## Do's and Don'ts

Do:

- Read this file before UI work.
- Use shared surface chrome, typography, controls, and evidence patterns across Now, Logbook, Sources, and Settings.
- Keep Masthead dense, local, evidence-forward, and state-first.
- Make healthy work quiet and attention states unmistakable.
- Keep routine refresh motion quiet and reserve richer motion for user-invoked or semantic changes.
- Use quiet, live, and action visual tiers without changing the Masthead metal card language.
- Use fixed card dimensions and responsive grid tracks.
- Keep controls at 40px minimum height unless there is a strong dense-card reason.
- Verify with the in-app Browser at desktop and mobile widths.
- Update this file first when the visual direction changes.

Don't:

- Recreate the deleted Raycast-inspired design file.
- Treat archived plan files or old screenshots as current design authority.
- Force Logbook, Sources, or Settings into the live session-card composition.
- Use generic SaaS analytics patterns, hero sections, decorative KPI cards, token dashboards, or marketing copy.
- Add cards inside cards or floating page-section cards.
- Add decorative blobs, one-note purple gradients, beige productivity palettes, or bright dashboard themes.
- Use `transition: all`.
- Give every panel the same visual urgency.
- Animate headlines, counters, or usage totals merely because polling refreshed them.
- Let text overlap, resize the grid, or spill outside buttons and cards.
- Hide uncertainty. Inferred or weakly attributed states must be labeled.

## Verification

Any UI change that touches the visual system should pass these gates before being called done:

1. Run the relevant unit tests and `npm run build`.
2. Open the rendered app with the Codex in-app Browser at the active local URL.
3. Verify Sessions, Logbook, and Sources against live or fixture data.
4. Check desktop, tablet, and a narrow mobile width around 390px.
5. Confirm no `No live connection` state appears when a healthy connector or bridge is expected.
6. Confirm dropdowns, layout changes, card hover/press states, and modals visibly transition.
7. Confirm all text fits, wraps, clamps, or ellipsizes inside its container.
8. Confirm Logbook, Sources, and Settings use the shared visual language without being forced into the Now card composition.
