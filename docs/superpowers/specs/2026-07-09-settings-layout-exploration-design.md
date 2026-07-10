# Settings layout exploration design

## Purpose

Create a disposable visual comparison board for the simplified Settings surface. The current implementation leaves too much unstructured canvas around a small General panel. The board should make ten different density and spatial-composition choices easy to compare before changing product UI.

## Scope

- One standalone HTML file under `mockups/`.
- Ten static settings layouts, with no app logic, persistence, routing, or behavior claims.
- Reuse Masthead palette, typography, anodized texture, sail asset, narrow borders, square controls, and compact status treatments.
- Retain the same General, Data, Agent access, Advanced, and Danger zone vocabulary.
- Focus the layouts on making broad desktop space intentional without inventing dashboards, usage analytics, or generic onboarding.
- Assume Masthead's existing application navigation remains outside the Settings workspace. Do not add a Settings category sidebar, a second application menu, or a bespoke navigation system inside a specimen.
- Use familiar Masthead toolbar controls, surface cards, buttons, value rows, and select/dropdown treatments for category location and actions.

## Layout families

1. Four compact full-width utility-grid options that use bands, rails, and aligned modules instead of a narrow floating card.
2. Three split-composition options pairing direct settings controls with quiet contextual material already appropriate to Settings: local storage identity, connection posture, or action scope.
3. Three structural options using a lower equipment rail, indexed plate, or restrained full-bleed ledger to give the canvas a clear spatial anchor.

## Constraints

- Settings remains a control surface, not a KPI dashboard.
- The comparison board must not use cards inside cards, oversized heroes, decorative charts, or new visual language.
- The existing user-owned `mockups/sidebar-bottom-five-directions.html` file is out of scope.
- The artifact is throwaway. Once a direction is selected, capture the decision and delete or replace the board rather than promote it to application code.

## Review question

Which composition makes a small number of direct settings feel deliberate and spatially grounded while remaining recognizably Masthead?
