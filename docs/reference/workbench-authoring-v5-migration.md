# Workbench authoring V5 migration

New guided authoring requests use `workbench-authoring-v5`. They have no canary pack, no
operator approval gate, and no requirement to disposition a knowledge opportunity before a dossier
can publish.

Schema migration `037_guided_authoring_v5_contract` records the legacy contract marker on guided
request audit rows. The live V5 protocol uses the separate `workbench_authoring_v5_*` tables created
by migration `036_workbench_authoring_v5`.
Existing rows default to `workbench-authoring-v4`, which preserves their assignments, drafts,
operator reviews, receipts, and activity as audit history. The migration never relabels a V4 request
as V5 because V4 canary and revision state is not a valid V5 continuation point.

Schema migration `038_workbench_authoring_v5_evidence_snapshots` adds the immutable per-request,
per-session evidence payload used by new V5 requests. Request creation stores the canonical evidence
JSON and its session digest in the same transaction as request membership and fixed packs, so later
inspect, scaffold, save, and finish operations do not depend on mutable live-ingestion tables.
Existing V5 audit rows have no snapshot records; they remain readable and use the legacy live-evidence
path only while their stored evidence revision still matches.

ADR 0017 changes no tables. Evidence-rich scaffold files remain valid local authoring inputs, but the
current CLI projects them to a bounded authored draft before save. The daemon stores authored fields,
reference IDs, optional decisions/drafts, and pack/evidence identity, then rehydrates canonical
catalogs from the immutable request snapshot during save and atomic finish. Previously stored full
draft JSON remains readable and its embedded catalog is ignored in favor of Masthead-owned evidence.
The existing stable identity contract is unchanged: if installation changes the build SHA, create a
new V5 request rather than attempting to resume a request bound to the previous build.

## Open V4 requests

An open V4 request cannot continue. Start, progress-recording inspect, draft save, canary decision,
and finish mutations return `authoring_contract_retired` before writing. Read-only request status,
assignment review, existing operator reviews, and receipts remain available.

Choose one of these migration outcomes:

1. **Abandon the campaign.** Leave the V4 request in audit history and create a new V5 request from
   the intended compile-ready selection. Published artifacts and completed receipts remain intact.
2. **Convert it to read-only history.** Upgrade the database and retain the request as-is. The schema
   migration performs this conversion automatically by marking legacy rows V4; no campaign state is
   rewritten or resumed.

Do not edit `contract_version` to V5 by hand. Create a new V5 request so pack membership,
activity, and receipts describe the contract that actually produced them.

Workbench Activity is observational for normal V5 publication. A saved V5 pack becomes
ready to finish directly; no operator approval mutation is part of the path.
