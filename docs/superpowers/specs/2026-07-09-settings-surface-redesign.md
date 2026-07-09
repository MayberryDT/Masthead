# Settings surface redesign

**Status:** Approved design direction

**Companion scope:** [`2026-07-09-sidebar-knowledge-flow-design.md`](./2026-07-09-sidebar-knowledge-flow-design.md)

## Intent

Replace the current Priority Bay of explanatory cards with a focused, modern settings surface. Settings should expose direct controls and useful local actions with very little prose. Existing Masthead buttons, toggles, inputs, colors, typography, and metal treatment remain the visual foundation.

Agent access does not become a primary navigation surface. MCP information and setup are too small to justify a separate destination and remain a compact Settings category.

## Information architecture

Settings uses a narrow category rail and one focused content pane. The categories are:

1. **General** — motion and session transition notifications.
2. **Data** — database location, open folder, export, raw-copy count, and raw-copy deletion.
3. **Agent access** — MCP readiness, access status, launch test, configuration format, and copy configuration.
4. **Advanced** — compact runtime and database diagnostics.
5. **Danger zone** — scoped deletion and delete-all controls.

General is selected when Settings opens. Category selection is local UI state; it does not add routes, hashes, persistence, or daemon state.

## Ownership decisions

- Sources owns source discovery, connector enablement, repair, testing, refresh, and onboarding. Remove the onboarding card and its reopen-onboarding wiring from Settings.
- Settings owns the small MCP information/setup experience. Do not add Agent Access to primary navigation.
- Usage is removed as a surface. Usage collection and daemon summary APIs remain available for internal evidence unless separately retired later.
- Provider/enrichment configuration remains where Sources currently exposes it. Do not add it back to Settings.

## Content rules

- Every setting row begins with a short noun or noun phrase.
- The control or current value is visible without expanding the row.
- Descriptions are omitted when the label and control are self-explanatory.
- When required for safety or ambiguity, descriptions are one sentence and no more than 110 characters.
- Operational success and failure feedback appears inline beside the action that caused it.
- Runtime paths, IDs, ports, API versions, schema versions, and counts use IBM Plex Mono.
- Do not show paragraphs that merely restate a status badge or button label.

## Layout and visual contract

- Desktop: a 176–190px category rail beside a content pane capped near 760px, aligned to the top-left of the workspace.
- The category rail uses Masthead's flat steel navigation treatment with square/folded selected state, not rounded pills.
- The content pane is a flat settings ledger: compact heading followed by divided rows. It is not a grid of cards and contains no cards inside cards.
- Preserve the existing square toggle, button, filterable-select, input, status-badge, and confirmation-dialog styling.
- Use the shared `#071b28` steel surface, hairline borders, stamped-band texture where already available, and restrained blue selection accents.
- Healthy state stays quiet. Red appears only inside Danger zone or failure feedback.
- Tablet and narrow widths move the category rail above the pane as a horizontally scrollable category strip. Rows stack controls beneath labels when necessary.
- The page must not horizontally scroll at 390px.

## Category behavior

### General

- `Motion` has the existing on/off toggle.
- `Session notifications` has the existing on/off toggle.
- Remove the explanatory paragraphs currently shown under both rows.

### Data

- `Database` shows the shortened path and an **Open folder** button.
- `Export` provides an **Export data** button.
- `Raw source copies` shows the current raw-event count and a **Delete raw copies** button.
- Database ID, runtime mode, API version, and schema version do not appear here.

### Agent access

- `MCP server` shows one readiness badge and a **Test connection** button.
- `Access` shows Enabled or Disabled from the existing effective MCP access state.
- `Client setup` offers the existing JSON, TOML, and stdio formats plus one **Copy configuration** button.
- Remove the always-visible code block, long status summary, refresh button, and prose describing standard MCP formats.
- Loading, test success, test failure, and copy failure render as compact inline status. The section does not become a tools catalog or audit log.

### Advanced

- Show database ID, database path, data directory, runtime host/port, runtime mode, API version, and schema version as a compact definition list.
- Advanced contains no destructive controls and no explanatory paragraphs.

### Danger zone

- Keep scoped deletion and delete-all behavior and typed confirmations unchanged.
- Show one safety sentence: Masthead deletes only its local canonical data and never original harness files.
- Remove the duplicate target-database narrative; show the database ID as a compact mono value.

## States

- **Loading:** render the shell, category rail, and selected pane with stable skeleton rows or `Loading` values. Do not replace the whole surface with a spinner.
- **Settings unavailable:** keep the existing recoverable error with **Retry settings**.
- **Read-only bridge:** show values and disable actions that mutate data. MCP copy and read-only status remain available; launch testing follows the existing bridge policy until that policy is separately corrected.
- **Action busy:** disable only controls that conflict with the active action and retain the current content layout.
- **Action error:** render one concise inline error near the initiating control.

## Component boundary

- `OperationsPanel` owns category selection and coordinates existing settings data/action props.
- `SettingsCategoryNav` renders the category rail only.
- Each category component renders its own rows and controls.
- `SettingsSection` and `SettingsRow` remain shared primitives but are simplified for the single-pane ledger.
- No new global settings store, router, persistence layer, or daemon endpoint is introduced for category navigation.

## Removal boundary

Remove the obsolete Priority Bay CSS, `OnboardingSettings`, its Settings-only props/wiring, and tests that require explanatory copy or the multi-column card grid. Remove code only when this redesign makes it unused.

Do not change Sources behavior, MCP daemon behavior, data deletion semantics, retention semantics, or stored preference formats in this work.

## Verification

- Rendering tests cover every category, category switching, direct labels, and absence of onboarding/obsolete prose.
- Interaction tests cover both toggles, open folder, export, raw-copy deletion request, MCP copy/test, scoped deletion, and delete-all confirmation.
- Operational-state tests cover loading, unavailable, read-only, busy, and action failure.
- Run `npm run check:surface-contract`, focused Vitest suites, `npm run verify:no-citations`, and `npm run typecheck`.
- Inspect Settings with the in-app Browser at desktop, tablet, and 390px widths using temporary `DevCite` wrappers around the category rail and content pane. Remove wrappers before closeout.

## Success criteria

Settings reads as a small configuration surface rather than an operations dashboard. A user can change the two preferences, manage local Masthead data, set up MCP access, inspect advanced identity, or perform destructive deletion without reading a wall of explanatory text. Usage is absent from navigation, Agent Access is not added, and the lower sidebar shows the approved Knowledge flow card.
