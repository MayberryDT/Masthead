# Onboarding Live Connector Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-run onboarding install and verify real live connectors before history import, keep connector refresh fast, and route empty product states to the surface that can resolve them.

**Architecture:** The daemon owns connector installation and command verification. Connector tests execute the same managed command written into the host configuration instead of posting synthetic payloads directly. Onboarding composes enable and test actions into a visible per-runtime connection gate; persistent Sources refresh remains a lightweight presence/status operation while onboarding performs history discovery separately.

**Tech Stack:** TypeScript, Node.js daemon, React, Vitest, Electron production packaging.

## Global Constraints

- Do not add a Now-only watcher or transcript fallback; fix live capture at the connector boundary.
- Never label a synthetic daemon request as proof that the installed connector works.
- Keep Codex host trust/restart distinct from command verification and real-event observation.
- Sources toolbar refresh must not run full history enumeration.
- Preserve the current Masthead visual language and existing empty-state primitives.

---

### Task 1: Real managed-command verification

**Files:**
- Modify: `src/daemon/liveConnectorSettings.ts`
- Modify: `src/daemon/settingsService.ts`
- Test: `src/daemon/__tests__/liveConnectorSettings.test.ts`

**Interfaces:**
- Produces: a connector test function that executes the installed command with a runtime-appropriate synthetic hook payload and returns `LiveConnectorTestResult`.
- Consumes: `liveConnectorCommand(config, runtime)` and the existing validation ingest/state endpoints.

- [ ] Write a failing test proving a packaged command path is absolute even when a supplied home path uses `~`.
- [ ] Write a failing test proving connector verification invokes the managed command and fails when the executable cannot be launched.
- [ ] Replace direct-fetch round-trip verification with child-process execution of the managed command, using stdin for hook runtimes and an explicit verifier for generated plugin runtimes.
- [ ] Update test copy to say `Connector command verified` and never claim a real live event was observed.
- [ ] Run `npx vitest run src/daemon/__tests__/liveConnectorSettings.test.ts src/daemon/__tests__/harnessConnectorsApi.test.ts` and require all tests to pass.

### Task 2: Fast Sources refresh and separate onboarding history discovery

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/sources/useSourcesConnectorsController.ts`
- Modify: `src/ui/SourcesPanel.tsx`
- Test: `src/daemon/__tests__/harnessConnectorsApi.test.ts`
- Test: `src/app/__tests__/collectorAutostart.test.tsx`

**Interfaces:**
- Produces: lightweight connector refresh and an explicit onboarding discovery call that includes history counts.
- Consumes: `discoverHarnessConnectors`, `scanSourcesAndPersist`, and `withHistoryDiscovery`.

- [ ] Write a failing API test that distinguishes lightweight refresh from history discovery.
- [ ] Make normal connector discovery return only presence/live status without calling `scanSourcesAndPersist`.
- [ ] Add an explicit onboarding discovery request that merges history counts.
- [ ] Route the Sources toolbar to lightweight refresh and onboarding to the count-bearing request.
- [ ] Run the focused daemon and controller tests and require all tests to pass.

### Task 3: Connect-and-verify onboarding gate

**Files:**
- Modify: `src/ui/sources/SourcesConnectOnboarding.tsx`
- Modify: `src/ui/SourcesPanel.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/ui/sources/__tests__/SourcesConnectOnboarding.test.tsx`

**Interfaces:**
- Consumes: async `onEnable(runtime)` and `onTest(runtime)` callbacks returning refreshed connector state.
- Produces: per-runtime `enabling`, `verifying`, `verified`, `needs_action`, and `failed` presentation state; history navigation only after every selected connector has completed a verification attempt.

- [ ] Write failing component tests proving Connect performs enable then test for every selected runtime.
- [ ] Write a failing component test proving history cannot open while verification is pending or failed.
- [ ] Add concise inline status per selected connector without adding a redundant activation screen.
- [ ] Keep Codex trust/restart visible as host action after command verification.
- [ ] Run `npx vitest run src/ui/sources/__tests__/SourcesConnectOnboarding.test.tsx` and require all tests to pass.

### Task 4: Correct empty-state destinations

**Files:**
- Modify: `src/ui/SessionBoard.tsx`
- Modify: `src/ui/HistoryPanel.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/ui/__tests__/historyPanel.test.tsx`
- Test: the applicable SessionBoard/App test file located with `rg`.

**Interfaces:**
- Produces: `onOpenSources` on the unfiltered Now empty state and `onOpenWorkbench` on the empty Logbook state.

- [ ] Write failing render tests for `Open Sources` in empty Now and `Open Workbench` in empty Logbook.
- [ ] Wire the actions through App surface navigation.
- [ ] Ensure filtered/offline/loading states do not receive misleading setup actions.
- [ ] Run the focused UI tests and require all tests to pass.

### Task 5: Product verification and production replacement

**Files:**
- Modify only build/install artifacts outside Git according to `AGENTS.md` production disk hygiene.

**Interfaces:**
- Consumes: the verified source tree.
- Produces: one installed production bundle under `~/.local/share/masthead-production/` with `current` pointing to it.

- [ ] Run focused connector, onboarding, and empty-state tests.
- [ ] Run `npm run verify:no-citations`, `npm run build`, and the relevant release gate checks.
- [ ] Use the in-app Browser to inspect Sources onboarding, empty Now, and empty Logbook at desktop and narrow widths.
- [ ] Build the Electron production bundle, replace AppMenu's current Masthead bundle, and remove every older production install artifact.
- [ ] Relaunch production without erasing or resetting user data and verify daemon health plus installed connector command paths.
