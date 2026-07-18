# Native Window Controls Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Masthead's renderer-drawn window buttons with Electron-owned native overlay controls that meet the top-right window edges.

**Architecture:** `src/electron/window.ts` owns platform-specific BrowserWindow chrome: Windows and Linux receive a 32px Window Controls Overlay, while macOS keeps native traffic lights. `AppShell` retains only a draggable renderer title-bar surface sized from Electron's safe-area environment values; no renderer button or hover geometry remains.

**Tech Stack:** Electron 42, React 19, CSS, TypeScript, Vitest, happy-dom.

## Global Constraints

- Do not restore any historical Masthead title-bar CSS, measurements, or pseudo-elements.
- Use `#051724` for the native overlay background, `#d6e4ef` for symbols, and a 32px overlay height.
- Keep the running production installation and its database untouched.
- Implement test-first and verify in a separate development Electron window.

---

### Task 1: Electron-owned window controls

**Files:**
- Modify: `src/electron/window.ts`
- Modify: `src/electron/__tests__/windowSecurity.test.ts`

**Interfaces:**
- Consumes: Node's `process.platform` and Electron `BrowserWindow` constructor options.
- Produces: `mastheadWindowChromeOptions(platform?: NodeJS.Platform): MastheadWindowChromeOptions` with a Windows/Linux `titleBarOverlay` and no overlay on macOS.

- [ ] **Step 1: Write the failing platform tests**

Add expectations that Linux and Windows return:

```ts
{
  autoHideMenuBar: true,
  backgroundColor: "#031019",
  frame: true,
  titleBarStyle: "hidden",
  titleBarOverlay: { color: "#051724", symbolColor: "#d6e4ef", height: 32 }
}
```

Add a macOS expectation with the same base options and no `titleBarOverlay` property.

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest --run src/electron/__tests__/windowSecurity.test.ts`

Expected: FAIL because `mastheadWindowChromeOptions` does not accept a platform, still disables the native frame, and does not return an overlay.

- [ ] **Step 3: Implement the platform-specific options**

Update the option type and function so `frame` is `true`; add the exact overlay object when `platform !== "darwin"`; omit it for `darwin`.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `npx vitest --run src/electron/__tests__/windowSecurity.test.ts`

Expected: all window security tests pass.

### Task 2: Renderer drag surface without duplicate controls

**Files:**
- Modify: `src/ui/AppShell.tsx`
- Modify: `src/styles/masthead.css`
- Modify: `src/ui/__tests__/windowChromeStyles.test.ts`

**Interfaces:**
- Consumes: Electron's `titlebar-area-height`, `titlebar-area-x`, and `titlebar-area-width` CSS environment values.
- Produces: a `.masthead-window-bar` containing only `.masthead-window-drag-region`; no `.masthead-window-controls` or `.masthead-window-control` DOM or CSS.

- [ ] **Step 1: Write failing renderer and CSS tests**

Mount `AppShell` with `window.mastheadDesktop` available and assert:

```ts
expect(container.querySelector(".masthead-window-bar")).not.toBeNull();
expect(container.querySelector(".masthead-window-drag-region")).not.toBeNull();
expect(container.querySelector(".masthead-window-controls")).toBeNull();
expect(container.querySelectorAll(".masthead-window-control")).toHaveLength(0);
```

Replace the historical 30px/20px CSS assertions with requirements for `env(titlebar-area-height, 32px)`, safe-area positioning, the bottom 1px hairline, and complete absence of `.masthead-window-control` rules.

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx vitest --run src/ui/__tests__/windowChromeStyles.test.ts`

Expected: FAIL because `AppShell` still renders three buttons and CSS still defines the centered 20px hover layer.

- [ ] **Step 3: Implement the drag-only renderer bar**

Remove the window-control JSX and its icon/IPC imports. Keep:

```tsx
<header className="masthead-window-bar" aria-label="Window title bar">
  <div className="masthead-window-drag-region" aria-hidden="true" />
</header>
```

Size the workspace row and bar from `env(titlebar-area-height, 32px)`, position the drag region using the safe-area environment values, retain `app-region: drag`, and delete all renderer window-control CSS.

- [ ] **Step 4: Run the tests to verify GREEN**

Run: `npx vitest --run src/ui/__tests__/windowChromeStyles.test.ts src/electron/__tests__/windowSecurity.test.ts`

Expected: both test files pass with no warnings.

### Task 3: Verify the native desktop result

**Files:**
- Verify: `src/electron/window.ts`
- Verify: `src/ui/AppShell.tsx`
- Verify: `src/styles/masthead.css`

**Interfaces:**
- Consumes: the completed native overlay and drag-only renderer title bar.
- Produces: verified source and a separate development Electron window for visual inspection.

- [ ] **Step 1: Run source verification**

Run: `npm run typecheck && npm run verify:no-citations && npm run check:surface-contract && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 2: Launch a separate development Electron window**

Run: `npm run dev:electron` from this worktree without stopping the production process.

Expected: Masthead Dev opens with native controls and no duplicate renderer buttons.

- [ ] **Step 3: Inspect the native chrome**

Confirm the close hover reaches the top-right corner, minimize/maximize use contiguous native cells, maximize toggles restore state, the bottom hairline remains visible, and no title-bar content overlaps the native safe area.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/electron/window.ts src/electron/__tests__/windowSecurity.test.ts src/ui/AppShell.tsx src/styles/masthead.css src/ui/__tests__/windowChromeStyles.test.ts
git commit -m "fix: use native Electron window controls"
```
