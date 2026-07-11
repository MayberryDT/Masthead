# Live update motion design

## Goal

Make Masthead's continuously updating knowledge-flow card, Workbench table, and Workbench Activity rail feel stable and deliberate. Updates must read as data seating into a durable metal console, never as a panel refresh, blink, or animated rearrangement.

## Approved direction

Use surgical, keyed motion. Existing content stays mounted and visually anchored during background refresh. Only a value that actually changes or an item that is genuinely new receives motion.

## Knowledge-flow counters

- When a loaded summary refreshes, continue showing its last successful values. Loading placeholders are permitted only before the first successful response.
- Render counts through a reusable changed-number component.
- On change, animate only the replacement digits. Use the Transitions.dev number-pop structure with Masthead-scoped tuning: 200ms duration, 2px vertical distance, 12ms digit stagger, zero blur, and Masthead's `cubic-bezier(0.22, 1, 0.36, 1)` easing.
- Use tabular numerals so character widths do not shift.
- Add no glow, bounce, scale, or card-wide animation.
- Initial render is static. A value change after mount replays the digit transition.
- The automatically-resolved count uses the same component inline with its label.

## Workbench queue

- Existing rows do not animate when polling returns them again.
- Newly observed session IDs receive one minimal entrance: 2px downward-to-rest translation, opacity 0.86 to 1, and a restrained blue inset edge that settles away over 180ms.
- Do not animate row height, table geometry, hover state, selection state, or every status cell.
- Initial rows are marked as already known and do not animate when the Workbench first opens.
- A row's identity remains `sessionId`; refreshes must not remount unchanged rows.

## Workbench Activity

- Existing activity items remain static.
- Newly observed activity IDs receive one minimal 180ms entrance using the same 2px settle. The status gutter may appear a few milliseconds before the body, but there is no blur or large stagger.
- Initial activity history is static. Only activity arriving after mount animates.

## Accessibility and performance

- `prefers-reduced-motion: reduce` disables every new animation.
- Animate only `transform`, `opacity`, `filter` where required by the exact number-pop snippet, and the temporary inset shadow used for a new queue row.
- Never use `transition: all`.
- Do not add a motion dependency.
- Live regions and existing semantic table/list markup remain unchanged.

## Verification

- Component tests prove loaded sidebar values remain visible while refreshing.
- Changed-number tests prove first render is static and later values receive replay hooks.
- Workbench tests prove only IDs introduced after the initial render receive the new-item class.
- CSS contract tests assert exact duration/distance and reduced-motion behavior.
- Inspect Workbench and the sidebar in the in-app Browser at desktop, tablet, and narrow mobile widths with temporary DevCite labels, then remove all citation wrappers before completion.

