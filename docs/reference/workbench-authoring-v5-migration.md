# Workbench authoring V5 migration

New guided authoring requests use `workbench-authoring-v5`. They have no canary assignment, no
operator approval gate, and no requirement to disposition a knowledge opportunity before a dossier
can publish.

Schema migration `035_guided_authoring_v5_contract` records the contract on every durable request.
Existing rows default to `workbench-authoring-v4`, which preserves their assignments, drafts,
operator reviews, receipts, and activity as audit history. The migration never relabels a V4 request
as V5 because V4 canary and revision state is not a valid V5 continuation point.

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

Do not edit `contract_version` to V5 by hand. Create a new V5 request so assignment membership,
activity, and receipts describe the contract that actually produced them.

Workbench Activity is observational for normal V5 publication. An accepted V5 assignment becomes
ready to finish directly; no operator approval mutation is part of the path.
