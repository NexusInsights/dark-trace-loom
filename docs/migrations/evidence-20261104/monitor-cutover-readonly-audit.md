# Same-namespace monitor cutover audit

Read-only source/config/saved-receipt audit; wrote only these two sibling audit files. No network, UI, tests, deployment or repository edits.

Source: `176dfc8e10f2591cb12430f4e9a5aa979f1ef769`. Historical production metadata is explicitly not a fresh live read.

## Main finding

A full Durable Object export/backup is useful recovery hardening, not a required new access/approval gate for a reversible Auth URL/public-key change that keeps the existing namespace and transforms no monitor data. The current blocking acceptance step is actual target sign-in with the original owner UUID, followed by existing-route before/after checks.

## Existing read routes

| Route | Evidence and limitation | Source |
|---|---|---|
| `GET /api/marketplace-monitor/v1/status` | Actual next alarm time, latest global scheduler tick, public configuration/coverage limits; no user ID or table counts. A global tick does not prove each owner job ran. Held code returns503 before Auth and before this GET body. | `monitor-worker/src/api.js:66` |
| `GET /api/marketplace-monitor/v1/jobs` | Current verified owner nonarchived jobs: IDs, kind, supplied params, enabled state, interval, next due, prior check/change, coverage and per-job allowance. At most100; no archived jobs, token hashes, revision or raw leases; publicJob omits ownerUUID. | `monitor-worker/src/api.js:71` |
| `GET /api/marketplace-monitor/v1/jobs/:id` | Same current-owner job detail and coverage. Unknown/foreign/archived job returns404; does not enumerate other users. | `monitor-worker/src/api.js:93` |
| `GET /api/marketplace-monitor/v1/jobs/:id/history?limit=100` | Owner-scoped bounded check history, source snapshots/failure receipts, hashes, latest retained verified snapshot and comparison policy. History rows include ownerUUID. 1-100 rows, not a complete export; latest_verified may be older than returned history window. | `monitor-worker/src/api.js:97` |
| `GET /api/marketplace-monitor/v1/alerts` | Owner alerts with retained evidence and actual stored/received/read status; optional unread=true. Latest100 only; no acknowledgment mutation needed for comparison. | `monitor-worker/src/api.js:114` |
| `GET /api/marketplace-monitor/v1/feeds` | Owner feed IDs, labels, enabled state, last observation/receipt and creation times. Deliberately excludes tokens and token hashes. | `monitor-worker/src/api.js:126` |
| `GET /api/marketplace-monitor/v1/rules` | Owner rule IDs, ownerUUID/feed link, enabled state, polygon/rule state and observed timestamps. Private source data must stay private; no whole-namespace export. | `monitor-worker/src/api.js:130` |
| `GET <configured-backend>/auth/v1/user` | Remote verified accountUUID used for every monitor owner filter. Call each source/target only with its actual current session and public key; never print or copy bearer tokens into audit. | `monitor-worker/src/api.js:7` |
| `GET <configured-backend>/functions/v1/check-subscription and GET /rest/v1/tool_permissions` | Existing target account-plan and explicit tool-denial checks used before create/resume/manual execution. Monitor read GETs do not themselves certify these entitlements; no service-role credential is needed. | `monitor-worker/src/api.js:17` |

While held, **all monitor GETs return503 before authentication**. A bound route returning `code: migration_hold` establishes the control response; it does not reveal exact alarm state, record counts or a current-owner identity. A Pages unbound-service503 proves none of those. Initialization failures can carry `X-Monitor-Alarm-Disarm-Verified`; normal hold does not. (`api.js:48`, `worker.js:16`, `migration-hold.js:78`.)

## Same-namespace cutover

1. Complete actual independent-preview sign-in and verify the expected original accountUUID. This remains the main user-facing release gate; preserved databaseUUIDs alone do not prove a working session.
2. Before hold, capture a sanitized current-owner baseline through existing GET status/jobs/job/history/alerts/feeds/rules and independently verify the current userUUID. Record IDs/counts/hashes privately as appropriate; do not claim these bounded GETs are a complete namespace export.
3. Record current service/version/namespace/config identity through the established read-only deployment metadata route. Keep insight-nexus-monitors, MONITOR_STORE, MonitorStore and singleton scheduler unchanged. Do not create/delete/rename a namespace or perform a storage restore.
4. Roll out the already tested instrumented version with explicit hold. Verify a503 body with code migration_hold through the bound Worker route; a generic unbound Pages503 is insufficient. Reconcile older in-flight code because the first deployment cannot retroactively fence it. New instrumented operations cannot poll/mutate while held.
5. While held, update only the same Worker authentication URL/public key to ocliymtdvtxfxczxgbjr, retaining the hold, namespace and application data. Backend session/plan/permission GETs can be checked directly with the current target user session. All monitor GETs themselves return503 while held; do not claim they can inspect records or exact alarms in this state.
6. After verified identity/configuration, deliberately release with exact MONITOR_MIGRATION_HOLD=false and verify same-owner GET baseline parity plus actual status next_alarm_at/latest tick. Existing enabled jobs may resume their previously authorized polling immediately; this is not a provider-free validation window.
7. Confirm Pages uses MARKETPLACE_MONITOR bound to this same service and preserve APP_ORIGIN/feed ingress host as intended. Keep licensed bridge unconfigured. Record exact new version and rollback configuration without exposing key/token values.

## Rollback and actual data-loss risks

- Re-enter hold using the instrumented code, verify the distinct hold503, then restore previous Auth URL/public key if target sign-in or owner access fails. Keep the same namespace, class, singleton and retained control table.
- Compare the same existing GET routes after deliberate release. Temporary sign-in failure from a wrong URL/key is reversible and does not itself delete monitor data.
- Never use the old uninstrumented source version as a hold-preserving rollback: it ignores the persisted hold. Code rollback and storage rollback are different operations.
- No table copy/drop, owner rewrite or storage restore is needed for this same-namespace Auth rebinding. If a later step would change namespace identity, rewrite userIDs, restore historical storage or delete data, a verified backup/recovery point becomes necessary before that separate operation.
- Preserve/reconcile any application writes made before or after cutover. Already-dispatched external requests and pre-hold writes cannot be undone; do not silently reset storage to an older point.

## Historical identity and current source

Earlier tool receipts recorded service `insight-nexus-monitors`, version `af1d2ccb-e1c4-4080-af17-679ce3c5637d`, namespace `e930f47b29404901a9d891041cfc8cf3`, original backend `zisrsttmjeipkmllqubi`, and no licensed bridge bindings. Those are historical facts, not a refreshed deployment attestation. Current source retains `MonitorStore`, binding `MONITOR_STORE`, singleton `scheduler`, class migration `v1`; Pages binds `MARKETPLACE_MONITOR`.

No network, UI, tests, deployment or repository mutation occurred. The saved40-test receipt is prior offline evidence. No empty live job counts, live alarm success or migrated-owner acceptance is asserted.

## Inspected file hashes

- `monitor-worker/src/worker.js` SHA-256 `68f855dce79214e6e89efa6fb8aa4784e0d3d923f7da00f9078c9e07c13adc5c`
- `monitor-worker/src/api.js` SHA-256 `f4b7978b729dbd5b686a5b49d5faf7aeb88fc03f426a4d979e72ea4239fbaf87`
- `monitor-worker/src/migration-hold.js` SHA-256 `fb8c74056bca40bb40ef5e35ba459436212155c136b9494bef40c8703b5952de`
- `monitor-worker/src/runtime-init.js` SHA-256 `86dd5d364f8d3e01f359b90ba980d3c39a5ec4fd31ea5e61335e06f86b5e5aad`
- `monitor-worker/src/alarms.js` SHA-256 `aa1fa27932b94b635262f64ade7fe6f756388b4445101fb00b961fb618a1e795`
- `monitor-worker/src/engine.js` SHA-256 `0f859a34808042e433f86676110c67a63d12199a21b7ff0aa119a281651093d3`
- `monitor-worker/src/sqlite-facade.js` SHA-256 `e4ae7eec5272ebb7c2ebe2f5c373a811bb1bf7c183f83fe95547a148b30dcb89`
- `monitor-worker/wrangler.jsonc` SHA-256 `cae605d2740a69fcd3a93ba84934239c3e87fa225617632f7d5c3624f5c2f7f3`
- `monitor-worker/MIGRATION-HOLD-VALIDATION.json` SHA-256 `efb1dc6d6fe932cea3e7775f8a54d0f746532499c50806099db9fa02495d1129`
- `functions/api/marketplace-monitor/[[path]].js` SHA-256 `b53fbe499f208164859f1416dcd289fe92db2dabcb518ee3815c94dd999a5852`
