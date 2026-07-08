# Sources and onboarding

Masthead’s Sources area is the product surface for discovering local harness history, connecting selected sources, setting source-scoped transcript permissions, and tracking setup/capture health. It is the harness capture and permissions surface—not the per-session import/publish pipeline (that is Workbench). The first-run path scans local sources, selects harness history, and installs or repairs live connectors for Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP.

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
- source-scoped transcript permission remains opt-in; per-session transcript import is a Workbench action.

`src/daemon/sources/sourceSetupService.ts` also converts raw discoveries into onboarding-friendly records. A discovered source is considered importable only when the adapter capability profile supports metadata import, the source kind is recognized, the path is present, and the kind is not an inference-only source.

## Transcript permission boundary

Transcript content is privacy-sensitive (prompts, code, secrets, customer material). Sources grants or withholds **source-scoped transcript permission**; Workbench owns the explicit per-session transcript import action that uses that permission.

The setup code marks transcript capability as requiring approval when the adapter supports it. The UI should treat metadata discovery, source-scoped permission, and Workbench per-session import as separate decisions.

## Live connector state

Live connector state comes from `/settings/hooks`. The daemon exposes the focused runtime set—Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP—as a runtime list, with status, managed config path, endpoint, and whether Settings/Sources can run install, test, or uninstall actions.

The settings test path uses a validation-only ingest endpoint, so hook checks can confirm the connector path without creating live rows. Runtime-specific daemon routes operate on one connector at a time for the focused runtimes. Live capture can create canonical session identity and runtime-signal rows before source-scoped transcript permission is granted; per-session transcript import remains a Workbench decision that must respect that permission. Import progress surfaces stalled status, heartbeat, current path, progress counts, and grouped failures without requiring transcript permission.

## What the Sources page is for

Sources is not just a discovery list. It is the administrative surface for:

- recognizing supported harnesses,
- previewing what Masthead can capture,
- granting or withholding source-scoped transcript permissions,
- watching capture/import health and failures,
- understanding whether a source is healthy, importing, or needs attention.

Per-session transcript import, cleanup, enrichment, and publication live in Workbench, not Sources.

The canonical reference docs `docs/reference/sources.md` and `docs/adr/0008-sources-onboarding-and-harness-catalog.md` add more detail about the harness catalog and setup flow.

## What to watch out for

- Keep renderer onboarding rules aligned with daemon setup statuses.
- Avoid describing detected-only harnesses as imported or connected.
- Do not imply transcript import is automatic; source-scoped permission and Workbench per-session import are both explicit.
- Preserve the distinction between scan, connect, import, and sync when changing labels or APIs.
- If a new runtime is added, update both capability mapping and onboarding behavior together.
