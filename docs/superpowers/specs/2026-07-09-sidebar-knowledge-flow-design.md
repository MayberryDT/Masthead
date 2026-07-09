# Sidebar knowledge flow — Stamped Steel Spine

**Status:** Approved visual direction; implementation contract awaiting review

**Selected prototype:** [`mockups/sidebar-knowledge-flow-ten-iterations.html#v1`](../../../mockups/sidebar-knowledge-flow-ten-iterations.html#v1)

**Replaces:** the Usage navigation item and the sidebar's current Today usage card

## Intent

Use the bottom of Masthead's navigation column to show what the system has retained and produced through its core pipeline. The card is a quiet, durable orientation aid, not a live-monitoring widget, productivity score, or call to action.

The selected direction is option 1, **Stamped Steel Spine**: three numbered stages pressed into Masthead's existing secondary-card surface, followed by a restrained automatic-resolution note.

## Scope

- Remove the Usage item from the primary navigation and remove the Usage surface from normal app routing/rendering.
- Replace `SidebarUsageStats` and its Today data-loading path with a `SidebarKnowledgeFlow` card.
- Add one read-only summary response that returns the four counts needed by the card.
- Preserve the existing Usage data repository and daemon API unless removing a caller makes a small piece of UI-only code unambiguously orphaned. Historical usage capture and storage are not part of this change.
- Keep the card informational. It has no links, buttons, hover actions, progress animation, or drill-down behavior.

## Information contract

The card displays current inventory counts, with no time window:

| Display label | Response field | Unit | Definition |
| --- | --- | --- | --- |
| Captured sessions | `capturedSessions` | sessions | Canonical sessions whose `deleted_at` is null. |
| In Workbench | `workbenchSessions` | sessions | Non-deleted sessions whose Workbench `publication_status` is `publish_path`. This matches the default Workbench queue total. |
| Published artifacts | `publishedArtifacts` | artifacts | Current artifacts whose `publication_status` is `published` and `status` is `current`. This matches the artifact-first Logbook total. |
| Automatically resolved | `automaticallyResolvedSessions` | sessions | Non-deleted Workbench sessions whose `resolution_status` is `automatic_resolved`. |

These figures describe related inventories; they are not a conversion funnel and are not expected to add up. The UI must keep “sessions” and “artifacts” in the visible labels so the units remain honest.

## Read boundary

Expose a focused read endpoint:

```text
GET /knowledge-flow/summary
```

It returns one shared DTO:

```ts
type KnowledgeFlowSummaryDto = {
  capturedSessions: number;
  workbenchSessions: number;
  publishedArtifacts: number;
  automaticallyResolvedSessions: number;
};
```

The repository query should calculate the four values together. The sidebar controller should make one request, load when Masthead has a live connection, abort stale requests on teardown or projection changes, and refresh through the app's existing refresh trigger. It must not derive these values from Usage statistics or make separate requests to the Data, Workbench, and Logbook surfaces.

Because the endpoint is read-only, include it in the worktree bridge's read-route coverage if the route matcher does not already admit it.

## Visual contract

The outer card must use the exact shared secondary-card treatment already used by Today, Sources connections, and Usage:

- background: `#071b28`
- border: `1px solid rgba(92, 153, 187, 0.14)`
- radius: `5px`
- no outer box shadow
- the existing inset stamped horizontal-band texture
- bottom edge: `2px solid rgba(46, 167, 255, 0.42)`

Inside that shared shell:

- Header reads **Knowledge flow** in the same quiet section-label style as the prototype.
- A single vertical blue rule connects three 17px square stamped nodes.
- Nodes are labeled `01`, `02`, and `03` in IBM Plex Mono.
- Each row places the visible stage label on the left and the count, in mono numerals, flush right.
- The final stage is not green. Green is reserved for the separate completion note so publication is not confused with full pipeline resolution.
- The bottom note reads `{count} automatically resolved`, separated from the spine by a fine rule.
- Use Masthead's existing design tokens and typography. Do not introduce gradients, glow, rounded pills, elevated shadows, or decorative fasteners beyond what appears in the selected prototype.

The production component should reproduce the selected prototype rather than importing mockup CSS. Shared card rules should be reused from the existing card system wherever the current CSS structure permits it.

## States

- **Loading:** render the full card and labels with em dashes in the count positions. Do not show a spinner or animate the spine.
- **Loaded with zeros:** render `0` normally for every count. Zero is valid inventory, not an empty-state error.
- **Unavailable/error:** retain the card and labels, render em dashes for counts, and replace the completion note with `Summary unavailable` in muted text. No retry control appears in the sidebar.
- **Disconnected:** use the same unavailable presentation. The card must not claim cached counts are current unless the existing app data layer explicitly marks them as current.

## Placement and responsiveness

- The card remains anchored in the lower sidebar region beneath primary navigation, in the space currently occupied by Today.
- Desktop width continues to follow the existing 215px sidebar.
- At tablet and narrow widths, follow the sidebar's current responsive behavior. Do not invent a second compact visualization or allow the card to force horizontal scrolling.
- Long localized labels may wrap, but counts remain right-aligned and nodes remain aligned to the spine.

## Removal boundary

Remove UI code made obsolete by deleting the Usage surface and Today card, including navigation typing, surface selection branches, Usage-only controller wiring, and tests that assert those surfaces exist. Keep daemon-side usage collection and summary capability intact because this change removes a product surface, not the underlying canonical evidence.

Do not rename or redesign Now, Workbench, Logbook, Sources, Agent Access, or Settings as part of this work.

## Verification

- Repository/API tests prove each count's filtering semantics, including deleted sessions, `not_added_to_logbook`, non-current artifacts, and automatic resolution.
- Client/controller tests cover loaded, zero, aborted/stale, disconnected, and request-failure states.
- Sidebar rendering tests prove Usage is absent and Knowledge flow renders the four values with their correct units.
- Run the repository's surface contract check and relevant type/test suites.
- Inspect the live rendered Masthead UI with the in-app Browser at desktop, tablet, and narrow mobile widths. Use the UI citation protocol around `SidebarKnowledgeFlow` during visual work and remove the wrapper before closeout.

## Success criteria

The sidebar no longer reports obsolete Today usage statistics or offers a Usage destination. In the same physical space, Masthead shows a restrained, steel-like summary of captured sessions, current Workbench inventory, published artifacts, and automatically resolved sessions, matching option 1 of the approved prototype.
