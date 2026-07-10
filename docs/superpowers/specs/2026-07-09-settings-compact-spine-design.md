# Settings compact spine design

## Decision

Replace the Settings category rail and focused pane with one centered compact steel card. The card uses the exact secondary steel treatment already used by the sidebar Knowledge flow card: `#071b28` surface, subtle machining lines, a restrained blue lower edge, and no nested cards.

## Composition

- The card header is `Settings` with a quiet local-only label.
- Motion and Session notifications remain direct toggles and are always visible. Their live state text sits immediately left of the switch; the switch sits at the far right. Neither row has explanatory subtext.
- Data, Agent access, Advanced, and Danger zone are compact label/action rows.
- Each category row uses Masthead's existing `AppButton` component. Normal detail actions use the quiet variant; Danger zone uses the danger variant.
- One detail may expand beneath the spine inside the same steel card. Selecting the active row again closes it.
- Existing Data, MCP, Advanced, and Danger components retain their behavior but render as unframed detail content inside the card. Existing confirmation dialogs remain outside the card and unchanged.

## Motion

- The compact Settings card enters with the existing Sources-card `surface-card-enter` animation: `400ms cubic-bezier(0.17, 0.78, 0.13, 1)` from a bottom-center origin.
- An opened inline detail enters with the existing dropdown `forged-plate-in` animation using `--dropdown-open-dur` and `--dropdown-weight-ease` from a top-center origin.
- No Settings-specific keyframes or JavaScript animation state are added.
- Existing reduced-motion handling disables both animations.

## Constraints

- No category sidebar, tab bar, dropdown menu, second card, dashboard summary, or new button class.
- No cards inside the steel card.
- The card is horizontally centered and top-balanced on desktop; it becomes full-width with safe padding on narrow screens.
- Controls keep their existing accessible labels, disabled states, focus behavior, feedback, and 40px hit areas.
- Sources styling remains unaffected even though it shares Settings primitives.

## Success criteria

- Static Settings markup contains one `settings-spine-card`, no numbered flow nodes, and no `settings-category-nav` or `settings-pane`.
- General toggles work directly from the spine.
- Data, Agent access, Advanced, and Danger details open and close from real `AppButton` controls.
- The selected detail remains the only expanded detail.
- The card reuses the shared steel shell rather than duplicating a divergent card treatment.
- Card entrance and detail reveal reuse the established Sources-card and dropdown motion contracts.
