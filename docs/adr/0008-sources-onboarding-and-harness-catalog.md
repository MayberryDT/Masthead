# ADR 0008: Sources Onboarding and Harness Catalog

## Status

Accepted.

## Context

Masthead's Sources surface needs to feel complete without claiming unsupported import coverage. The product is a local-first, harness-neutral session data layer, so onboarding must distinguish local evidence that can be imported from harnesses Masthead only knows about.

## Decision

Sources onboarding uses a bounded local scan, selected-source connection, metadata import, explicit transcript approval, and optional enrichment. The harness catalog separates:

- active import adapters with recognized local schemas,
- detector-only local harnesses whose candidate paths may be checked but not imported,
- cloud-reference harnesses with no local connector in this pass,
- legacy hidden compatibility entries.

Advanced diagnostics will expose scan freshness, checked paths, connected source count, transcript coverage, enrichment coverage, import failures, unrecognized schemas, and repair recommendations from observed daemon data only.

Masthead will keep the no whole-home-scan guarantee. It scans known local agent-history locations and configured overrides, not arbitrary recursive home-directory contents.

## Consequences

- Users can see detector-only and cloud-reference harnesses without mistaking them for successful import support.
- Transcript import remains an explicit approval boundary.
- Unrecognized schemas stay visible as diagnostics and do not create fake transcript sessions.
- Doctor and release evidence can report real Sources pipeline state without fabricating live data.
