# Sources and onboarding

Masthead’s Sources area is the product surface for discovering local harness history, connecting selected sources, approving transcript import, and tracking setup/import health. It is also the first-run path for getting data into the canonical store, including the setup flow that can scan local sources, select harness history, and install or repair live connectors for Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode.

## The setup model

The daemon computes source setup state in `src/daemon/sources/sourceSetupService.ts` and the renderer reads it through `src/app/daemonClient.ts` and `src/app/sources/useSourcesController.ts`.

The core status values are:

- `empty` — no connected sources and no useful scan result yet,
- `detected` — scans found sources, but nothing is connected,
- `importing` — a connected source has active import work,
- `needs_attention` — a connected source has failures or transcript/enrichment follow-up,
- `ready` — connected sources are healthy.

That status is not just a label; it decides whether the first-run onboarding opens automatically.

## First-run onboarding

`src/app/App.tsx` contains the onboarding decision logic. It opens onboarding when setup status is one of the first-run states, or when the connected sources are all detected-only records with no imported sessions/records.

This means the onboarding flow is a mix of persisted user preference and live source state:

- `src/app/onboardingPreference.ts` stores dismissal state,
- `src/app/App.tsx` decides whether to show onboarding,
- `src/daemon/sources/sourceSetupService.ts` reports the underlying setup state,
- `src/app/sources/SourcesOnboardingModal.tsx` renders the guided setup UI.

## Discovery, scan, connect, import

The renderer controller in `src/app/sources/useSourcesController.ts` orchestrates the main actions:

- `scanSources` and `scanSourcesSetup` refresh discovery,
- `connectSources` persists selected source inventory,
- `importAdapterMetadata` and `importAdapterTranscripts` queue import work,
- `repairSources`, `retryImport`, `cancelImport`, and `syncAdapter` manage follow-up work.

The daemon source services separate these concerns further:

- discovery/scanning identifies local harness locations,
- setup summarizes what is connected and what needs attention,
- connect/import moves the selected source into the canonical store,
- transcript import remains opt-in.

`src/daemon/sources/sourceSetupService.ts` also converts raw discoveries into onboarding-friendly records. A discovered source is considered importable only when the adapter capability profile supports metadata import, the source kind is recognized, the path is present, and the kind is not an inference-only source.

## Transcript approval boundary

Transcript import is intentionally explicit because transcript data may contain private prompts, code, secrets, or customer material.

The setup code marks transcript import as requiring approval when the adapter capability supports it. The UI should therefore treat metadata discovery and transcript import as separate decisions.

## Live connector state

Live connector state comes from `/settings/hooks`. The daemon exposes the release target set—Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode—as a runtime list, with status, managed config path, endpoint, and whether Settings/Sources can run install, test, or uninstall actions.

The settings test path now uses a validation-only ingest endpoint, so hook checks can confirm the connector path without creating live rows. The Codex compatibility actions still manage the full release target set, while runtime-specific daemon routes can operate on one non-Codex connector at a time. Live capture can create canonical session identity and runtime-signal rows before transcript import is approved; transcript import remains a separate Sources decision. The most recently updated Codex desktop transcript can also appear in the live projection before approval because `/projection` refreshes the transcript scanner first, but that live surface remains metadata-only and distinct from import.

## What the Sources page is for

Sources is not just a discovery list. It is the administrative surface for:

- recognizing supported harnesses,
- previewing what Masthead can import,
- approving or withholding transcript capture,
- watching active imports and failures,
- understanding whether a source is healthy, importing, or needs attention.

The canonical reference docs `docs/reference/sources.md` and `docs/adr/0008-sources-onboarding-and-harness-catalog.md` add more detail about the harness catalog and setup flow.

## What to watch out for

- Keep renderer onboarding rules aligned with daemon setup statuses.
- Avoid describing detected-only harnesses as imported or connected.
- Do not imply transcript import is automatic; it is an approval-gated step.
- Preserve the distinction between scan, connect, import, and sync when changing labels or APIs.
- If a new runtime is added, update both capability mapping and onboarding behavior together.
