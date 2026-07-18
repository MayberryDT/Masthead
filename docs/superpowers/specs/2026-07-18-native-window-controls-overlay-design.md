# Native Window Controls Overlay Design

## Goal

Replace Masthead's renderer-drawn minimize, maximize, and close buttons with Electron's native Window Controls Overlay on Windows and Linux. The controls must meet the top and right window edges, use full native hit targets and hover treatments, and retain Masthead's dark title-bar surface.

This is a new implementation based on Electron's current Window Controls Overlay API. It must not restore measurements, pseudo-elements, or styling from Masthead's earlier title-bar implementations.

## Window architecture

`BrowserWindow` will keep the native frame, use `titleBarStyle: "hidden"`, and add a `titleBarOverlay` object on Windows and Linux. The overlay will use Masthead's toolbar background (`#051724`), body text color (`#d6e4ef`), and a 32px height. Electron will own control geometry, hover behavior, maximize state, accessibility, and edge hit targets.

macOS will retain Electron's native traffic-light controls through the hidden title-bar style rather than rendering the Windows/Linux control cluster.

The renderer will keep a title-bar drag surface and reserve the native overlay's safe area. Its height will use `env(titlebar-area-height, 32px)`, and horizontal content will use `env(titlebar-area-x, 0px)` plus `env(titlebar-area-width, 100%)`. It will not render minimize, maximize, or close buttons when native controls are active.

Reference: [Electron custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar).

## Visual behavior

- The control cluster touches the top and right window edges with no outer gap.
- Each control uses its complete native hover cell. Close receives the platform's destructive hover treatment; minimize and maximize receive the platform's normal hover treatment.
- Controls are contiguous and have no card shape, inset highlight, rounded rectangle, or decorative divider.
- Masthead's title bar remains a quiet dark-blue surface with the existing bottom hairline separating it from the workspace.
- Renderer content must not sit beneath the native controls. Layout will respect Electron's title-bar safe-area environment values where available.

## Interaction behavior

Electron owns minimize, maximize/restore, and close behavior. Masthead's existing renderer IPC commands may remain for compatibility, but the native overlay will not depend on them.

The remaining title-bar surface stays draggable. Interactive content, if added later, must use a non-drag region and remain outside the native control safe area.

## Fallback boundary

This change targets the installed Electron desktop application. The browser-only renderer continues without desktop chrome. If Electron does not expose native overlay controls on a supported desktop platform, Masthead must fail visibly in development rather than silently rendering both native and custom controls; a separate fallback design would require explicit product approval.

## Verification

Automated tests will verify:

- the platform-specific `BrowserWindow` chrome options;
- native overlay color, symbol color, and height;
- absence of renderer-drawn window buttons when desktop chrome uses the overlay;
- preservation of the draggable title-bar region and bottom hairline.

Visual acceptance will use a non-production Electron run and confirm:

- close hover reaches the top-right corner;
- minimize and maximize hover cells are full-height and contiguous;
- icons are natively centered;
- maximize and restore states work;
- the title bar has no duplicate controls or content overlap.

The running production installation and its database will not be stopped, rebuilt, or modified while developing this change.
