# Settings Card Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the compact Settings card the Sources-card entrance and its inline detail the existing fast dropdown reveal.

**Architecture:** Reuse the global `surface-card-enter` and `forged-plate-in` keyframes already owned by `masthead.css`. Add only selector membership and Settings-scoped animation declarations; React state and markup remain unchanged.

**Tech Stack:** CSS, React 19, Vitest.

## Global Constraints

- Use `surface-card-enter 400ms cubic-bezier(0.17, 0.78, 0.13, 1) both` for the card.
- Use `forged-plate-in var(--dropdown-open-dur) var(--dropdown-weight-ease) both` for opened detail content.
- Do not add keyframes, dependencies, timers, or animation state.
- Disable both effects under `prefers-reduced-motion: reduce`.

---

### Task 1: Reuse established Masthead motion

**Files:**
- Modify: `src/styles/masthead.css`
- Modify: `src/styles/settings.css`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`

**Interfaces:**
- Consumes: existing `surface-card-enter`, `forged-plate-in`, `--dropdown-open-dur`, and `--dropdown-weight-ease` CSS contracts.
- Produces: animated `.settings-spine-card` and `.settings-spine-detail` surfaces without changing component props or state.

- [ ] Add failing CSS contract assertions for the card entrance, detail reveal, and reduced-motion selectors.
- [ ] Run the focused Settings surface test and confirm the missing selectors fail.
- [ ] Add `.settings-spine-card` to the existing Sources-card entrance and reduced-motion selector groups; animate `.settings-spine-detail` with the existing dropdown keyframe.
- [ ] Run focused and full verification.
- [ ] Commit as `feat: animate compact settings card`.

## Self-review

- Spec coverage: exact animation reuse, timing, origin, and reduced-motion behavior are covered.
- Placeholder scan: no placeholders.
- Type consistency: no TypeScript interfaces change.
